import test from "node:test";
import assert from "node:assert/strict";
import { parseAmazonCSV, matchAmazon, groupCharges } from "../src/lib/amazon.js";

const CSV = `Website,Order ID,Order Date,Currency,Unit Price,Unit Price Tax,Shipping Charge,Total Discounts,Total Owed,Quantity,Ship Date,Order Status,Product Name
Amazon.com,111-0000001-0000001,2026-11-01T10:00:00Z,USD,20.00,1.40,0,0,21.40,1,2026-11-02T08:00:00Z,Closed,"Dog Food 30 lb, Chicken"
Amazon.com,111-0000002-0000002,2026-11-03T10:00:00Z,USD,10.00,0.70,0,0,10.70,1,2026-11-04T08:00:00Z,Closed,USB-C Cable 6ft
Amazon.com,111-0000002-0000002,2026-11-03T10:00:00Z,USD,30.00,2.10,0,0,32.10,2,2026-11-04T08:00:00Z,Closed,Garden Hose 50ft
Amazon.com,111-0000003-0000003,2026-11-05T10:00:00Z,USD,50.00,3.50,0,0,53.50,1,2026-11-06T08:00:00Z,Closed,Camper Water Filter
Amazon.com,111-0000003-0000003,2026-11-05T10:00:00Z,USD,5.00,0.35,0,0,5.35,1,2026-11-09T08:00:00Z,Closed,Camper Hose Washers
Amazon.com,111-0000004-0000004,2026-11-07T10:00:00Z,USD,9.00,0,0,0,9.00,1,2026-11-08T08:00:00Z,Cancelled,Nothing
`;
const cats = [{ id: "pet", name: "Pets" }, { id: "home", name: "Home" }, { id: "rv", name: "Camper" }];
const bank = (id, date, amount, extra = {}) => ({ id, date, amount, payeeName: "Amazon", importedPayee: "AMZN Mktp US*AB12", notes: "", categoryId: null, accountId: "a", ...extra });

test("parse: finds columns by name, skips cancelled, handles commas in names", () => {
  const { items, skipped } = parseAmazonCSV(CSV);
  assert.equal(items.length, 5); assert.equal(skipped.length, 1);
  assert.equal(items[0].name, "Dog Food 30 lb, Chicken"); assert.equal(items[0].amount, 21.4); assert.equal(items[0].shipDate, "2026-11-02");
});

test("parse: falls back to unit price + tax when total is missing; rejects other files with the headers it saw", () => {
  const { items } = parseAmazonCSV("Order ID,Order Date,Product Name,Unit Price,Unit Price Tax,Quantity,Shipping Charge,Total Discounts\n1,2026-01-01,Thing,10,0.8,2,3,1\n");
  assert.equal(items[0].amount, 10 * 2 + 0.8 + 3 - 1);
  assert.throws(() => parseAmazonCSV("a,b\n1,2\n"), /Columns found: a, b/);
});

test("match: per-shipment charge, whole-order charge, notes with item names, keyword category by biggest item", () => {
  const { items } = parseAmazonCSV(CSV);
  const b = [bank("b1", "2026-11-03", -21.4), bank("b2", "2026-11-05", -42.8), bank("b3", "2026-11-07", -53.5), bank("b4", "2026-11-10", -5.35), bank("b5", "2026-11-20", -99.99), bank("b6", "2026-11-03", -21.4, { payeeName: "Shell", importedPayee: "SHELL OIL 123" })];
  const r = matchAmazon(items, b, cats, { keywordCategories: { dog: "Pets", hose: "Home", camper: "Camper", cable: "Home" } });
  const by = Object.fromEntries(r.matched.map((m) => [m.bank.id, m]));
  assert.equal(r.matched.length, 4);
  assert.match(by.b1.proposal.notes, /^Amazon: Dog Food 30 lb/); assert.match(by.b1.proposal.notes, /\[amzn:111-0000001-0000001\]$/);
  assert.equal(by.b1.proposal.categoryId, "pet");
  // order 2: cable 10.70 + hose 32.10 shipped the same day = one charge 42.80; hose is the bigger item, both map to Home
  assert.equal(by.b2.charge.items.length, 2); assert.equal(by.b2.proposal.categoryId, "home");
  // order 3 shipped in two parts, charged separately
  assert.match(by.b3.proposal.notes, /\[amzn:111-0000003-0000003@2026-11-06\]/); assert.match(by.b4.proposal.notes, /@2026-11-09\]/);
  assert.equal(r.unmatchedBank.length, 1); assert.equal(r.unmatchedBank[0].id, "b5"); // not Shell, which is not Amazon
});

test("match: whole multi-shipment order charged once; already-applied are skipped; existing category kept without keyword", () => {
  const { items } = parseAmazonCSV(CSV);
  const r = matchAmazon(items, [bank("b1", "2026-11-09", -58.85, { categoryId: "home" })], cats, {});
  assert.equal(r.matched.length, 1); assert.equal(r.matched[0].charge.key, "111-0000003-0000003"); assert.equal(r.matched[0].proposal.categoryId, "home"); assert.equal(r.matched[0].proposal.categorySource, "existing");
  const again = matchAmazon(items, [bank("b1", "2026-11-03", -21.4, { notes: "Amazon: Dog food [amzn:111-0000001-0000001]" })], cats, {});
  assert.equal(again.matched.length, 0); assert.equal(again.alreadyApplied >= 1, true);
});

test("match: outside the date window does not match, and refunds (positive bank amounts) are ignored", () => {
  const { items } = parseAmazonCSV(CSV);
  const r = matchAmazon(items, [bank("b1", "2026-12-20", -21.4), bank("b2", "2026-11-03", 21.4)], cats, {});
  assert.equal(r.matched.length, 0); assert.ok(r.unmatchedOrders.length >= 3);
});

test("department column: parsed, mapped to an Actual category after keywords, reported per department", () => {
  const csv = "Order ID,Order Date,Product Name,Total Owed,Ship Date,Department\n1,2026-11-01,Dog Food,21.40,2026-11-02,Pet Supplies\n2,2026-11-03,Garden Hose,32.10,2026-11-04,Patio & Garden\n3,2026-11-05,Widget,10.00,2026-11-06,Gadgets\n";
  const { items, hasDepartment, columns } = parseAmazonCSV(csv);
  assert.equal(hasDepartment, true); assert.equal(items[0].department, "Pet Supplies"); assert.ok(columns.includes("Department"));
  assert.equal(parseAmazonCSV(CSV).hasDepartment, false);
  const b = [bank("b1", "2026-11-02", -21.4), bank("b2", "2026-11-04", -32.1), bank("b3", "2026-11-06", -10)];
  const r = matchAmazon(items, b, cats, { departmentCategories: { "Pet Supplies": "Pets", "Patio & Garden": "Home" }, keywordCategories: { hose: "Camper" } });
  const by = (id) => r.matched.find((m) => m.bank.id === id);
  assert.equal(by("b1").proposal.categoryId, "pet"); assert.match(by("b1").proposal.categorySource, /Amazon department "Pet Supplies"/);
  assert.equal(by("b2").proposal.categoryId, "rv", "item keyword beats department");
  assert.equal(by("b3").proposal.categoryId, null, "unmapped department proposes nothing"); assert.deepEqual(by("b3").departments, ["Gadgets"]);
});
