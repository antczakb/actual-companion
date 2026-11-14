import test from "node:test";
import assert from "node:assert/strict";
import { parseVenmoCSV, matchVenmo, parseMoney } from "../src/lib/venmo.js";

const CSV = `Account Statement - (@brad) ,,,,,,,,,,,,,,,,,,
Account Activity,,,,,,,,,,,,,,,,,,
,ID,Datetime,Type,Status,Note,From,To,Amount (total),Amount (fee),Tax Rate,Tax Amount,Amount (tip),Amount (net),Beginning Balance,Ending Balance,Statement Period Venmo Fees,Terminal Location,Year to Date Venmo Fees,Disclaimer
,,,,,,,,,,,,,,$0.00,,,,,
,4001,2026-10-03T14:22:11,Payment,Complete,"Pizza, drinks 🍕",Brad Antczak,Sam Lee,- $42.50,,0,,,- $42.50,,,,Venmo,,
,4002,2026-10-10T09:00:00,Payment,Complete,rent,Brad Antczak,Pat Roe,"- $1,200.00",,0,,,"- $1,200.00",,,,Venmo,,
,4003,2026-10-12T18:30:00,Payment,Complete,Thanks!,Jo Kim,Brad Antczak,+ $25.00,,0,,,+ $25.00,,,,Venmo,,
,4004,2026-10-14T10:00:00,Standard Transfer,Complete,,,,- $25.00,,,,,- $25.00,,,,,,
,4005,2026-10-15T10:00:00,Payment,Pending,coffee,Brad Antczak,Al Fox,- $5.00,,0,,,- $5.00,,,,Venmo,,
,4006,2026-10-20T10:00:00,Payment,Complete,lunch,Brad Antczak,Al Fox,- $18.00,,0,,,- $18.00,,,,Venmo,,
,4007,2026-10-21T10:00:00,Payment,Complete,"cake ""special""",Brad Antczak,Sam Lee,- $42.50,,0,,,- $42.50,,,,Venmo,,
`;
// Add funding source to the CSV by header position: easier to build a second CSV with the column.
const CSV2 = CSV.replace("Terminal Location", "Funding Source").replace(/,Venmo,,\n/g, (m) => m).replace("lunch,Brad Antczak,Al Fox,- $18.00,,0,,,- $18.00,,,,Venmo", "lunch,Brad Antczak,Al Fox,- $18.00,,0,,,- $18.00,,,,Venmo balance");

test("money parsing", () => {
  assert.equal(parseMoney("- $1,200.00"), -1200); assert.equal(parseMoney("+ $25.00"), 25); assert.equal(parseMoney("$0.00"), 0); assert.equal(parseMoney(""), null);
});

test("statement parsing: preamble, quoted commas and quotes, emoji, pending skipped", () => {
  const { rows, skipped } = parseVenmoCSV(CSV2);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].note, "Pizza, drinks 🍕"); assert.equal(rows[0].counterparty, "Sam Lee"); assert.equal(rows[0].amount, -42.5);
  assert.equal(rows[2].counterparty, "Jo Kim"); assert.equal(rows[2].direction, "in");
  assert.equal(rows[5].note, 'cake "special"');
  assert.equal(skipped.length, 1); assert.match(skipped[0].reason, /Pending/);
  assert.throws(() => parseVenmoCSV("a,b\n1,2"), /Venmo statement/);
});

const bank = [
  { id: "b1", date: "2026-10-05", amount: -42.5, payeeName: "Venmo", importedPayee: "VENMO PAYMENT 1234", notes: "", categoryId: null },
  { id: "b2", date: "2026-10-12", amount: -1200, payeeName: "Venmo", importedPayee: "VENMO PAYMENT", notes: "", categoryId: null },
  { id: "b3", date: "2026-10-16", amount: 25, payeeName: "Venmo", importedPayee: "VENMO CASHOUT", notes: "", categoryId: "x" },
  { id: "b4", date: "2026-10-23", amount: -42.5, payeeName: "Venmo", importedPayee: "VENMO PAYMENT", notes: "", categoryId: null },
  { id: "b5", date: "2026-10-30", amount: -77.77, payeeName: "Venmo", importedPayee: "VENMO PAYMENT", notes: "", categoryId: null },
  { id: "b6", date: "2026-10-05", amount: -42.5, payeeName: "Grocer", importedPayee: "GROCER", notes: "", categoryId: "g" },
  { id: "h1", date: "2026-05-01", amount: -30, payeeName: "Sam Lee", importedPayee: "", notes: "", categoryId: "dining" },
  { id: "h2", date: "2026-06-01", amount: -35, payeeName: "Sam Lee", importedPayee: "", notes: "", categoryId: "dining" },
];
const cats = [{ id: "rent", name: "Rent" }, { id: "dining", name: "Dining" }];

test("matching pairs equal amounts within the window, one to one, by closest date", () => {
  const { rows } = parseVenmoCSV(CSV2);
  const r = matchVenmo(rows, bank, cats, { windowDays: 5, keywordCategories: { rent: "Rent" } });
  const by = Object.fromEntries(r.matched.map((m) => [m.venmo.id, m]));
  assert.equal(by["4001"].bank.id, "b1");                // 2 days apart
  assert.equal(by["4007"].bank.id, "b4");                // second $42.50: not b1 again, not the grocer
  assert.equal(by["4002"].bank.id, "b2");
  assert.equal(by["4004"].bank.id, "b3");                // transfer: amounts are opposite signs
  assert.ok(!by["4003"]);                                // +25 received had no matching bank row (cashout matched the transfer)
  assert.equal(r.unmatchedVenmo.length, 2);
  assert.ok(r.unmatchedVenmo.find((v) => v.id === "4006").reason.includes("Venmo balance"));
  assert.deepEqual(r.unmatchedBank.map((b) => b.id), ["b5"]);
});

test("proposals: payee, note with marker, category from history or keyword or existing", () => {
  const { rows } = parseVenmoCSV(CSV2);
  const r = matchVenmo(rows, bank, cats, { keywordCategories: { rent: "Rent" } });
  const by = Object.fromEntries(r.matched.map((m) => [m.venmo.id, m.proposal]));
  assert.equal(by["4001"].payeeName, "Sam Lee"); assert.equal(by["4001"].categoryId, "dining"); assert.match(by["4001"].categorySource, /history/);
  assert.equal(by["4001"].notes, "Venmo to Sam Lee: Pizza, drinks 🍕 [venmo:4001]");
  assert.equal(by["4002"].categoryId, "rent"); assert.match(by["4002"].categorySource, /keyword/);
  assert.equal(by["4004"].categoryId, "x"); assert.equal(by["4004"].categorySource, "existing"); assert.equal(by["4004"].payeeName, null);
});

test("re-running is idempotent: applied rows are recognised by their marker", () => {
  const { rows } = parseVenmoCSV(CSV2);
  const first = matchVenmo(rows, bank, cats);
  const applied = bank.map((b) => { const m = first.matched.find((x) => x.bank.id === b.id); return m ? { ...b, notes: m.proposal.notes } : b; });
  const second = matchVenmo(rows, applied, cats);
  assert.equal(second.matched.length, 0);
  assert.equal(second.alreadyApplied, first.matched.length);
});
