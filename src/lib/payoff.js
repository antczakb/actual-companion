// Payoff strategies for a sized loan: how fast can it be paid off, and is that affordable?
// "Affordable" means two things: the payment fits within a share of monthly surplus, and cash
// (with the extra payments) never drops below the floor during the look-ahead window.
import { pmtPerDollar } from "./loan.js";
import { addMonths } from "./dates.js";

export function monthsToPayOff(balance, annualRate, payment) {
  if (balance <= 0) return 0;
  const r = annualRate / 12;
  if (r === 0) return payment > 0 ? Math.ceil(balance / payment - 1e-9) : Infinity;
  if (payment <= balance * r + 1e-9) return Infinity;
  return Math.ceil(-Math.log(1 - (r * balance) / payment) / Math.log(1 + r) - 1e-9);
}

// payFn(k) = payment due in month k (1-based). Returns per-month payments, balances and total interest.
function run(balance, annualRate, payFn, maxMonths = 600) {
  const r = annualRate / 12, payments = [], balances = [];
  let b = balance, interest = 0;
  for (let k = 1; k <= maxMonths && b > 0.005; k++) {
    const i = b * r, pay = Math.min(payFn(k), b + i);
    interest += i; b = b + i - pay; payments.push(pay); balances.push(Math.max(0, b));
  }
  return { months: payments.length, interest, payments, balances, paidOff: b <= 0.005 };
}

export function minimumSchedule(balance, product) {
  const io = Math.round((product.ioYears || 0) * 12), n = Math.round((product.termYears || 0) * 12);
  const r = product.rate / 12, rep = balance * pmtPerDollar(product.rate, product.termYears || 0);
  return run(balance, product.rate, (k) => (k <= io ? balance * r : k <= io + n ? rep : 0), io + n);
}

function lowestHeadroom(rows, draw, plan) {
  if (!rows || draw == null) return null;
  let cum = 0, low = Infinity;
  for (const r of rows) {
    if (r.h < draw) continue;
    const k = r.h - draw;
    if (k >= 1) cum += (k <= plan.months ? plan.payments[k - 1] : 0) - (r.loanPayment || 0);
    low = Math.min(low, r.headroomWithLoan - cum);
  }
  return Number.isFinite(low) ? low : null;
}

// Cash with the loan under a payoff plan, one value per projection row (before the draw it is just the row's own cash).
function cashSeries(rows, draw, plan) {
  if (!rows || draw == null) return null;
  let cum = 0;
  return rows.map((r) => {
    if (r.h < draw) return Math.round(r.cashWithLoan);
    const k = r.h - draw;
    if (k >= 1) cum += (k <= plan.months ? plan.payments[k - 1] : 0) - (r.loanPayment || 0);
    return Math.round(r.cashWithLoan - cum);
  });
}

export function payoffPlans({ loan, product, monthlySurplus = 0, budgetPct = 0.5, targetYears = [2, 3, 5, 7, 10, 15], rows = null, draw = null, drawLabel = null }) {
  if (!(loan > 0)) return { plans: [], bestKey: null, budgetCap: 0 };
  const cap = Math.max(0, budgetPct * monthlySurplus);
  const fees = loan * (product.feePct || 0) + (product.fixedFee || 0);
  const min = minimumSchedule(loan, product);
  const raw = [{ key: "minimum", name: "Minimum payments (full term)", ...min }];
  const seen = new Set([min.months]);
  for (const y of targetYears) {
    const n = y * 12;
    if (n >= min.months) continue;
    const pay = loan * pmtPerDollar(product.rate, y);
    const sim = run(loan, product.rate, () => pay, n + 2);
    raw.push({ key: `y${y}`, name: `Pay off in ${y} years`, ...sim }); seen.add(sim.months);
  }
  // Fastest fixed payment that fits: the budget cap if cash allows it, otherwise the largest payment below the cap that keeps cash above the floor.
  const attempt = (pay) => { const n = monthsToPayOff(loan, product.rate, pay); if (!Number.isFinite(n)) return null; const sim = run(loan, product.rate, () => pay, n + 2); return { sim, ok: (lowestHeadroom(rows, draw, sim) ?? 0) >= -0.5 }; };
  const label = (pay) => (pay >= cap - 0.5 ? `Fastest within budget (${Math.round(budgetPct * 100)}% of surplus)` : "Fastest that keeps cash above your floor");
  let pick = null;
  if (cap > 0) {
    const top = attempt(cap);
    if (top?.ok) pick = { pay: cap, sim: top.sim };
    else {
      let lo = loan * (product.rate / 12) * 1.001 + 0.01, hi = cap;
      const bottom = lo < hi ? attempt(lo) : null;
      if (bottom?.ok) {
        let best = { pay: lo, sim: bottom.sim };
        for (let i = 0; i < 40 && hi - lo > 0.5; i++) { const mid = (lo + hi) / 2, a = attempt(mid); if (a?.ok) { lo = mid; best = { pay: mid, sim: a.sim }; } else hi = mid; }
        pick = best;
      }
    }
  }
  if (pick && pick.sim.months < min.months && !seen.has(pick.sim.months)) raw.push({ key: "budget", name: label(pick.pay), ...pick.sim });

  const plans = raw.map((p) => {
    const payment = Math.max(...p.payments), headroom = lowestHeadroom(rows, draw, p);
    const floorOk = headroom == null ? true : headroom >= -0.5;
    return {
      key: p.key, name: p.name, payment, months: p.months, paidOffBy: drawLabel ? addMonths(drawLabel, p.months) : null,
      totalInterest: p.interest, interestSaved: min.interest - p.interest, fees, totalCost: p.interest + fees,
      pctOfSurplus: monthlySurplus > 0 ? payment / monthlySurplus : null, lowestHeadroom: headroom, floorOk,
      withinBudget: floorOk && payment <= cap + 0.5, balances: p.balances, cash: cashSeries(rows, draw, p),
    };
  });
  const ok = plans.filter((p) => p.withinBudget);
  const best = ok.length ? ok.reduce((a, b) => (b.totalInterest < a.totalInterest - 0.5 || (Math.abs(b.totalInterest - a.totalInterest) <= 0.5 && b.months < a.months) ? b : a)) : null;
  const feasible = plans.filter((p) => p.withinBudget && Number.isFinite(p.months));
  const fastest = feasible.length ? feasible.reduce((a, b) => (b.months < a.months ? b : a)) : null;
  for (const p of plans) if (p.key !== "minimum" && (!best || p.key !== best.key)) delete p.balances; // keep curves for the chart only
  return { plans, bestKey: best?.key || null, fastestKey: fastest?.key || null, budgetCap: cap };
}
