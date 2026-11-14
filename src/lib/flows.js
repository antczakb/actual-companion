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
//        reserveMonths, reserveFixed, purchases:[{month, amount, name}]}
export function buildProjection(o) {
  const months = [];
  let cash = o.cash0;
  for (let i = 0; i < o.horizon; i++) {
    const label = addMonths(o.startMonth, i);
    const yrs = Math.floor(i / 12); // step up once a year
    const inc = o.income * Math.pow(1 + (o.incomeGrowthPct || 0) / 100, yrs);
    const exp = o.expenses * Math.pow(1 + (o.expenseInflationPct || 0) / 100, yrs);
    const purchases = (o.purchases || []).filter((p) => p.month === label).reduce((s, p) => s + (+p.amount || 0), 0);
    cash += inc - exp - (o.investing || 0) - purchases;
    const reserve = o.reserveFixed != null ? o.reserveFixed : (o.reserveMonths || 0) * exp;
    months.push({ label, income: inc, expenses: exp, investing: o.investing || 0, purchases, cash, reserve });
  }
  return months;
}
