// Turns normalized Actual transactions into monthly cash flows and a month-by-month projection.
import { addMonths, monthKey } from "./dates.js";

// txn: {id, accountId, date:'YYYY-MM-DD', amount (dollars, +in/-out), categoryId, transferAcctId}
// accounts: [{id, offbudget}], categories: [{id, isIncome}]
export function monthlyFlows(txns, accounts, categories) {
  const acct = new Map(accounts.map((a) => [a.id, a]));
  const cat = new Map(categories.map((c) => [c.id, c]));
  const out = new Map();
  const slot = (m) => { if (!out.has(m)) out.set(m, { income: 0, expenses: 0, investing: 0 }); return out.get(m); };
  for (const t of txns) {
    const a = acct.get(t.accountId);
    if (!a || a.offbudget) continue;
    const s = slot(monthKey(t.date));
    if (t.transferAcctId) {
      const to = acct.get(t.transferAcctId);
      if (to && to.offbudget) s.investing -= t.amount; // money leaving on-budget cash to investments/loans
      continue; // on-budget to on-budget transfers net to zero
    }
    const c = t.categoryId ? cat.get(t.categoryId) : null;
    if (c && c.isIncome) s.income += t.amount;
    else s.expenses -= t.amount;
  }
  return out;
}

export function trailingAverages(flows, endMonthExclusive, n) {
  const months = Array.from({ length: n }, (_, i) => addMonths(endMonthExclusive, -(i + 1)));
  const sum = { income: 0, expenses: 0, investing: 0 };
  let seen = 0;
  for (const m of months) {
    const f = flows.get(m);
    if (!f) continue;
    seen++;
    sum.income += f.income; sum.expenses += f.expenses; sum.investing += f.investing;
  }
  if (!seen) return { income: 0, expenses: 0, investing: 0, monthsUsed: 0 };
  return { income: sum.income / seen, expenses: sum.expenses / seen, investing: sum.investing / seen, monthsUsed: seen };
}

// opts: {startMonth, horizon, cash0, income, expenses, investing, incomeGrowthPct, expenseInflationPct,
//        reserveMonths, reserveFixed, purchases:[{month, amount, name}],
//        payoffs:[{month, amount, freed, name}]  (pay off an existing loan: cash out in that month, `freed` per month back from then on)
//        jobLoss:{startMonth, months (0 = rest of projection), incomePct (0-1 of income still coming in), severance, expenseCutPct (0-100), pauseInvesting}
//        bonuses:[{month, amount, name, repeat:"once"|"yearly"}]  (extra cash in; "yearly" repeats every 12 months from that month)}
export const monthsBetween = (a, b) => { const [ay, am] = String(a).split("-").map(Number), [by, bm] = String(b).split("-").map(Number); return (by - ay) * 12 + (bm - am); };
export function buildProjection(o) {
  const months = [];
  let cash = o.cash0;
  for (let i = 0; i < o.horizon; i++) {
    const label = addMonths(o.startMonth, i);
    const yrs = Math.floor(i / 12); // step up once a year
    let inc = o.income * Math.pow(1 + (o.incomeGrowthPct || 0) / 100, yrs);
    let exp = o.expenses * Math.pow(1 + (o.expenseInflationPct || 0) / 100, yrs);
    let invest = o.investing || 0, severance = 0;
    const J = o.jobLoss, jd = J ? monthsBetween(J.startMonth, label) : -1, jobLost = !!J && jd >= 0 && (!J.months || jd < J.months);
    if (jobLost) { inc *= Math.min(1, Math.max(0, J.incomePct || 0)); exp *= 1 - Math.min(100, Math.max(0, J.expenseCutPct || 0)) / 100; if (J.pauseInvesting) invest = 0; if (jd === 0) severance = J.severance || 0; }
    const payoffOut = (o.payoffs || []).filter((p) => p.month === label).reduce((s, p) => s + (+p.amount || 0), 0);
    const freed = (o.payoffs || []).filter((p) => monthsBetween(p.month, label) >= 0).reduce((s, p) => s + (+p.freed || 0), 0);
    const purchases = (o.purchases || []).filter((p) => p.month === label).reduce((s, p) => s + (+p.amount || 0), 0);
    const bonuses = jobLost ? severance : (o.bonuses || []).filter((b) => (b.repeat === "yearly" ? monthsBetween(b.month, label) >= 0 && monthsBetween(b.month, label) % 12 === 0 : b.month === label)).reduce((s, b) => s + (+b.amount || 0), 0);
    cash += inc + bonuses + freed - exp - invest - purchases - payoffOut;
    const reserve = o.reserveFixed != null ? o.reserveFixed : (o.reserveMonths || 0) * (o.jobLoss ? o.expenses * Math.pow(1 + (o.expenseInflationPct || 0) / 100, yrs) : exp);
    months.push({ label, income: inc, bonuses, expenses: exp, investing: invest, purchases, payoffs: payoffOut, freed, jobLoss: jobLost, cash, reserve });
  }
  return months;
}
