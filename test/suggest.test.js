import test from "node:test";
import assert from "node:assert/strict";
import { suggestBudget } from "../src/lib/suggest.js";

const accounts = [{ id: "chk", offbudget: false }, { id: "brk", offbudget: true }];
const categories = [
  { id: "groc", name: "Groceries", groupName: "Food", isIncome: false }, { id: "ins", name: "Car Insurance", groupName: "Auto", isIncome: false },
  { id: "gift", name: "Gifts", groupName: "Fun", isIncome: false }, { id: "pay", name: "Paycheck", groupName: "Income", isIncome: true },
  { id: "dead", name: "Old", groupName: "Misc", isIncome: false, hidden: true },
];
const months = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const T = (m, cat, amt, o = {}) => ({ accountId: "chk", date: `${m}-10`, amount: amt, categoryId: cat, transferAcctId: null, ...o });
const txns = [
  ...months.map((m, i) => T(m, "groc", -(600 + (i % 3) * 20))),       // steady ~620
  ...months.map((m) => T(m, "pay", 5000)),
  T("2025-12", "gift", -900), T("2026-06", "gift", -300),           // occasional
  ...months.map((m) => T(m, "ins", -1)),                            // tiny, steady
  T("2026-03", "groc", -999, { transferAcctId: "brk" }),             // transfers ignored
  { accountId: "brk", date: "2026-03-10", amount: -500, categoryId: "groc", transferAcctId: null }, // offbudget ignored
];

test("steady category uses the last three months and flags the gap to the current budget", () => {
  const r = suggestBudget({ txns, accounts, categories, month: "2026-11", currentBudget: new Map([["groc", 500], ["gift", 100]]) });
  const g = r.rows.find((x) => x.categoryId === "groc");
  assert.equal(g.method, "average 3 months");
  assert.equal(g.template, "#template average 3 months");
  assert.equal(g.suggested, Math.round((600 + 620 + 640) / 3)); // Aug..Oct: i=9,10,11 -> 600,620,640
  assert.equal(g.flag, "raise");
  assert.equal(g.difference, g.suggested - 500);
});

test("occasional category is smoothed over 12 months", () => {
  const r = suggestBudget({ txns, accounts, categories, month: "2026-11" });
  const g = r.rows.find((x) => x.categoryId === "gift");
  assert.equal(g.method, "average 12 months");
  assert.equal(g.suggested, Math.round(1200 / 12));
  assert.equal(g.flag, "no budget set");
});

test("income, hidden categories and off-budget accounts are not budgeted; income is averaged", () => {
  const r = suggestBudget({ txns, accounts, categories, month: "2026-11" });
  assert.ok(!r.rows.find((x) => x.categoryId === "pay"));
  assert.ok(!r.rows.find((x) => x.categoryId === "dead"));
  assert.equal(r.averageIncome, 5000);
  assert.equal(r.rows.find((x) => x.categoryId === "groc").average12, Math.round(months.reduce((s, _, i) => s + 600 + (i % 3) * 20, 0) / 12));
});

test("schedule-backed categories get a schedule template; sparse data is warned about", () => {
  const r = suggestBudget({ txns, accounts, categories, month: "2026-11", scheduleNames: new Map([["ins", "Car insurance"]]) });
  assert.equal(r.rows.find((x) => x.categoryId === "ins").template, "#template schedule Car insurance");
  const few = suggestBudget({ txns: txns.filter((t) => t.date >= "2026-09"), accounts, categories, month: "2026-11" });
  assert.ok(few.notes.length === 1);
});
