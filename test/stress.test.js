import test from "node:test";
import assert from "node:assert/strict";
import { buildProjection } from "../src/lib/flows.js";
import { balanceAfter, remainingPlan, planExistingLoan } from "../src/lib/existing.js";

const base = { startMonth: "2027-01", horizon: 12, cash0: 10000, income: 8000, expenses: 5000, investing: 1000 };
const at = (rows, l) => rows.find((r) => r.label === l);

test("job loss: income drops, expenses cut, investing paused, severance lands in month one, bonuses stop", () => {
  const rows = buildProjection({ ...base, bonuses: [{ month: "2027-05", amount: 9999, repeat: "once" }], jobLoss: { startMonth: "2027-03", months: 4, incomePct: 0.25, severance: 6000, expenseCutPct: 10, pauseInvesting: true } });
  assert.equal(at(rows, "2027-02").jobLoss, false); assert.equal(at(rows, "2027-02").income, 8000);
  const m3 = at(rows, "2027-03"), m5 = at(rows, "2027-05");
  assert.equal(m3.income, 2000); assert.equal(m3.expenses, 4500); assert.equal(m3.investing, 0); assert.equal(m3.bonuses, 6000);
  assert.equal(m5.bonuses, 0, "the 2027-05 bonus does not arrive while out of work");
  assert.equal(at(rows, "2027-06").jobLoss, true); assert.equal(at(rows, "2027-07").jobLoss, false); assert.equal(at(rows, "2027-07").income, 8000);
  // cash path: two normal months (+2000 each), then 4 loss months
  assert.equal(at(rows, "2027-02").cash, 14000);
  assert.equal(m3.cash, 14000 + 2000 + 6000 - 4500);
});

test("job loss: months 0 means the rest of the projection; reserve target is not shrunk by the expense cut", () => {
  const rows = buildProjection({ ...base, reserveMonths: 3, jobLoss: { startMonth: "2027-06", months: 0, incomePct: 0, severance: 0, expenseCutPct: 20, pauseInvesting: false } });
  assert.ok(rows.slice(5).every((r) => r.jobLoss)); assert.equal(at(rows, "2027-12").income, 0);
  assert.equal(at(rows, "2027-12").reserve, 3 * 5000);
});

test("existing loan math: balance after payments, remaining interest, never-paying-off case", () => {
  const after12 = balanceAfter(20000, 0.06, 400, 12);
  assert.ok(after12 > 16000 && after12 < 16700);
  const rest = remainingPlan(after12, 0.06, 400);
  assert.ok(rest.months > 44 && rest.months < 48 && rest.interest > 1000);
  assert.equal(remainingPlan(10000, 0.12, 50).months, Infinity);
  assert.equal(balanceAfter(1000, 0, 500, 5), 0);
});

test("existing loan payoff: auto amount, override, freed payment only if it is in your spending", () => {
  const loan = { balance: 20000, rate: 0.06, payment: 400, payoffAmount: null, paymentInSpending: true };
  const p = planExistingLoan(loan, 12);
  assert.equal(p.payoffAmount, p.balanceAtPayoff); assert.equal(p.auto, true); assert.equal(p.freedPayment, 400); assert.ok(p.interestAvoided > 1000);
  assert.equal(planExistingLoan({ ...loan, payoffAmount: 15000 }, 12).payoffAmount, 15000);
  assert.equal(planExistingLoan({ ...loan, paymentInSpending: false }, 12).freedPayment, 0);
  assert.equal(planExistingLoan({ ...loan, balance: 1000, payment: 2000 }, 12).freedPayment, 0, "already paid off before the payoff month");
});

test("projection with a payoff: cash out in the payoff month, payment freed from then on", () => {
  const rows = buildProjection({ ...base, payoffs: [{ month: "2027-04", amount: 12000, freed: 400, name: "Car loan" }] });
  assert.equal(at(rows, "2027-03").freed, 0);
  assert.equal(at(rows, "2027-04").payoffs, 12000); assert.equal(at(rows, "2027-04").freed, 400);
  assert.equal(at(rows, "2027-05").freed, 400); assert.equal(at(rows, "2027-05").payoffs, 0);
  assert.equal(at(rows, "2027-05").cash - at(rows, "2027-04").cash, 2000 + 400);
});
