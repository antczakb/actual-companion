import test from "node:test";
import assert from "node:assert/strict";
import { monthlyFlows, trailingAverages, buildProjection } from "../src/lib/flows.js";

const accounts = [{ id: "chk", offbudget: false }, { id: "sav", offbudget: false }, { id: "brk", offbudget: true }];
const categories = [{ id: "pay", isIncome: true }, { id: "food", isIncome: false }];
const T = (o) => ({ transferAcctId: null, categoryId: null, ...o });

test("flows: income, expenses, refunds, transfers, investing, offbudget", () => {
  const txns = [
    T({ accountId: "chk", date: "2026-09-01", amount: 5000, categoryId: "pay" }),
    T({ accountId: "chk", date: "2026-09-03", amount: -400, categoryId: "food" }),
    T({ accountId: "chk", date: "2026-09-04", amount: 50, categoryId: "food" }), // refund
    T({ accountId: "chk", date: "2026-09-05", amount: -1000, transferAcctId: "sav" }), // on-budget transfer: ignored
    T({ accountId: "sav", date: "2026-09-05", amount: 1000, transferAcctId: "chk" }),
    T({ accountId: "chk", date: "2026-09-06", amount: -300, transferAcctId: "brk" }), // investing
    T({ accountId: "brk", date: "2026-09-06", amount: 300, transferAcctId: "chk" }), // off-budget side ignored
    T({ accountId: "chk", date: "2026-09-07", amount: -20 }), // uncategorized spend
  ];
  const f = monthlyFlows(txns, accounts, categories).get("2026-09");
  assert.equal(f.income, 5000);
  assert.equal(f.expenses, 400 - 50 + 20);
  assert.equal(f.investing, 300);
});

test("trailing averages skip months with no data", () => {
  const flows = new Map([["2026-08", { income: 100, expenses: 50, investing: 0 }], ["2026-09", { income: 300, expenses: 150, investing: 10 }]]);
  const a = trailingAverages(flows, "2026-10", 12);
  assert.equal(a.monthsUsed, 2); assert.equal(a.income, 200); assert.equal(a.expenses, 100); assert.equal(a.investing, 5);
});

test("projection: cumulative cash, purchases, yearly step-ups, reserve", () => {
  const m = buildProjection({ startMonth: "2026-11", horizon: 14, cash0: 1000, income: 5000, expenses: 4000, investing: 200,
    incomeGrowthPct: 0, expenseInflationPct: 10, reserveMonths: 3, purchases: [{ month: "2027-01", amount: 2500, name: "x" }] });
  assert.equal(m[0].label, "2026-11"); assert.equal(m[2].label, "2027-01");
  assert.equal(m[0].cash, 1000 + 800);
  assert.equal(m[2].cash, 1000 + 800 * 3 - 2500);
  assert.ok(Math.abs(m[12].expenses - 4400) < 1e-9); // month 13 = second year
  assert.ok(Math.abs(m[12].reserve - 3 * 4400) < 1e-9);
});
