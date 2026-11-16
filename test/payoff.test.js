import test from "node:test";
import assert from "node:assert/strict";
import { monthsToPayOff, minimumSchedule, payoffPlans } from "../src/lib/payoff.js";
import { sizeLoan } from "../src/lib/loan.js";

const product = { name: "Personal", rate: 0.11, ioYears: 0, termYears: 5, feePct: 0.04, fixedFee: 0, secured: false };

test("monthsToPayOff matches a month-by-month simulation", () => {
  for (const [bal, rate, pay] of [[50000, 0.08, 1200], [10000, 0.0, 500], [80000, 0.11, 2500]]) {
    let b = bal, n = 0; while (b > 0.005 && n < 1000) { b = b * (1 + rate / 12) - pay; n++; }
    assert.equal(monthsToPayOff(bal, rate, pay), n);
  }
  assert.equal(monthsToPayOff(10000, 0.12, 100), Infinity); // payment below interest
});

test("minimum schedule: interest equals the loan module's closed form", () => {
  const m = minimumSchedule(30000, product);
  const closed = 30000 * (5 * 12 * (0.11 / 12 / (1 - Math.pow(1 + 0.11 / 12, -60))) - 1);
  assert.ok(Math.abs(m.interest - closed) < 0.5);
  assert.equal(m.months, 60);
});

test("interest-only product: balance is flat during the draw period", () => {
  const heloc = { name: "HELOC", rate: 0.08, ioYears: 2, termYears: 3, feePct: 0, fixedFee: 0 };
  const m = minimumSchedule(60000, heloc);
  assert.ok(m.balances.slice(0, 24).every((b) => Math.abs(b - 60000) < 1e-6));
  assert.equal(m.months, 60); assert.ok(m.paidOff);
});

test("plans: faster payoff costs less interest, higher payments, and respects the budget", () => {
  const { plans, bestKey, budgetCap } = payoffPlans({ loan: 40000, product, monthlySurplus: 2000, budgetPct: 0.5 });
  assert.equal(budgetCap, 1000);
  const by = Object.fromEntries(plans.map((p) => [p.key, p]));
  assert.ok(by.y3.totalInterest < by.minimum.totalInterest);
  assert.ok(by.y3.payment > by.minimum.payment);
  assert.equal(by.minimum.interestSaved, 0);
  assert.ok(by.y3.interestSaved > 0);
  assert.equal(by.y2.withinBudget, false);  // 2-year payment ~ $1,860 > $1,000
  assert.equal(by.y3.withinBudget, false);  // ~ $1,310 > $1,000
  assert.ok(by.budget && by.budget.payment <= 1000.5 && by.budget.months < 60);
  assert.equal(bestKey, "budget");
  for (const p of plans) assert.ok(Math.abs(p.totalCost - (p.totalInterest + 40000 * 0.04)) < 1e-6);
});

test("cash floor: extra payments that push cash under the floor are not 'within budget'", () => {
  // thin cushion: with the loan, headroom stays just above zero on the minimum schedule
  const months = Array.from({ length: 36 }, (_, i) => ({ label: `2027-${String((i % 12) + 1).padStart(2, "0")}`, cash: 30000 - (i >= 2 ? 40000 : 0) + i * 900, reserve: 5000 }));
  const sized = sizeLoan({ months, product, protectReserve: true, cushion: 0, roundTo: 100, monthlySurplus: 2000, drawMonth: 3 });
  const loan = sized.summary.usedLoan; assert.ok(loan > 0);
  const out = payoffPlans({ loan, product, monthlySurplus: 100000, budgetPct: 1, rows: sized.rows, draw: sized.summary.drawIndex, drawLabel: "2027-03" });
  const min = out.plans.find((p) => p.key === "minimum");
  assert.equal(min.floorOk, true);
  const fast = out.plans.find((p) => p.key === "budget");   // the budget cap is huge, so the plan is limited by cash, not the cap
  assert.match(fast.name, /keeps cash above your floor/);
  assert.equal(fast.floorOk, true); assert.equal(fast.withinBudget, true);
  assert.ok(fast.payment < 99999);
  // paying even a little more than that breaks the floor
  const over = payoffPlans({ loan, product, monthlySurplus: 100000, budgetPct: 1, rows: sized.rows, draw: sized.summary.drawIndex, drawLabel: "2027-03", targetYears: [1] }).plans;
  assert.equal(over.find((p) => p.key === "y1")?.floorOk ?? false, false);
  assert.equal(out.bestKey, "budget");
});

test("no loan, no plans", () => { assert.deepEqual(payoffPlans({ loan: 0, product, monthlySurplus: 1000 }).plans, []); });

test("payoff: fastestKey is the shortest plan inside budget, and each plan carries a cash series aligned to the rows", async () => {
  const { sizeLoan } = await import("../src/lib/loan.js");
  const { buildProjection } = await import("../src/lib/flows.js");
  const months = buildProjection({ startMonth: "2026-12", horizon: 36, cash0: 20000, income: 9000, expenses: 5500, investing: 500, purchases: [{ month: "2027-03", amount: 60000 }], reserveMonths: 3 });
  const product = { name: "HELOC", rate: 0.08, termYears: 20, ioYears: 10, feePct: 0, fixedFee: 0, secured: true };
  const res = sizeLoan({ months, product, protectReserve: true, cushion: 0, roundTo: 1000, maxLtv: 0.85, homeValue: 600000, mortgage: 200000, otherLiens: 0, monthlyIncome: 9000, monthlySurplus: 3000 });
  const po = payoffPlans({ loan: res.summary.usedLoan, product, monthlySurplus: 3000, budgetPct: 0.5, rows: res.rows, draw: res.summary.drawIndex, drawLabel: res.summary.drawLabel });
  assert.ok(po.fastestKey, "a fastest plan exists");
  const fast = po.plans.find((p) => p.key === po.fastestKey);
  assert.ok(fast.withinBudget);
  for (const p of po.plans.filter((x) => x.withinBudget)) assert.ok(fast.months <= p.months);
  for (const p of po.plans) assert.equal(p.cash.length, res.rows.length);
  const min = po.plans.find((p) => p.key === "minimum");
  assert.deepEqual(min.cash, res.rows.map((r) => Math.round(r.cashWithLoan))); // minimum plan == the loan's own cash line
  // paying off faster costs more cash in the month after the draw
  const k = res.summary.drawIndex + 1;
  assert.ok(fast.cash[k] <= min.cash[k]);
});
