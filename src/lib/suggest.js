// Budget suggestions from actuals: one proposed monthly amount per category plus the Actual template line that would produce it.
import { addMonths, monthKey } from "./dates.js";

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

export function suggestBudget(o) {
  const { txns, accounts, categories, month, currentBudget = new Map(), trailing = 12, tolerancePct = 0.1, toleranceDollars = 10,
    excludeGroups = [], excludeCategories = [], scheduleNames = new Map() } = o;
  const offbudget = new Set(accounts.filter((a) => a.offbudget).map((a) => a.id));
  const window = Array.from({ length: trailing }, (_, i) => addMonths(month, -(trailing - i))); // oldest..newest, all before `month`
  const idx = new Map(window.map((m, i) => [m, i]));
  const spend = new Map(); // categoryId -> number[trailing]
  const dataMonths = new Set();
  let income = new Array(trailing).fill(0);
  const catById = new Map(categories.map((c) => [c.id, c]));
  for (const t of txns) {
    if (offbudget.has(t.accountId) || t.transferAcctId) continue;
    const i = idx.get(monthKey(t.date));
    if (i === undefined) continue;
    dataMonths.add(monthKey(t.date));
    const c = t.categoryId ? catById.get(t.categoryId) : null;
    if (c && c.isIncome) { income[i] += t.amount; continue; }
    if (!c) continue; // uncategorized: reported by the caller, not budgeted
    if (!spend.has(c.id)) spend.set(c.id, new Array(trailing).fill(0));
    spend.get(c.id)[i] -= t.amount;
  }
  const rows = [];
  for (const c of categories) {
    if (c.isIncome || c.hidden) continue;
    if (excludeGroups.includes(c.groupName) || excludeCategories.includes(c.name)) continue;
    const a = spend.get(c.id) || new Array(trailing).fill(0);
    const total = a.reduce((s, x) => s + x, 0);
    const cur = currentBudget.has(c.id) ? currentBudget.get(c.id) : null;
    if (Math.abs(total) < 0.5 && !(cur > 0)) continue;
    const zeroMonths = a.filter((x) => Math.abs(x) < 0.005).length;
    const m12 = mean(a), last3 = mean(a.slice(-3));
    const cv = m12 > 0 ? sd(a) / m12 : Infinity;
    let method, amount, template, reason;
    if (scheduleNames.has(c.id)) {
      method = "schedule"; amount = m12; template = `#template schedule ${scheduleNames.get(c.id)}`;
      reason = "Has a scheduled transaction; the schedule drives the amount (figure shown is the 12-month average).";
    } else if (Math.abs(total) < 0.5) {
      method = "none"; amount = 0; template = null; reason = "Budgeted but no spending in the window.";
    } else if (zeroMonths <= 2 && cv <= 0.35) {
      method = "average 3 months"; amount = last3; template = "#template average 3 months";
      reason = "Steady: spending is similar month to month, so the last three months is a good guide.";
    } else {
      method = "average 12 months"; amount = m12; template = "#template average 12 months";
      reason = zeroMonths >= 8 ? "Occasional: spent in only a few months, so set aside a smoothed monthly amount." : "Irregular: spending swings, so smooth it over 12 months.";
    }
    amount = Math.round(amount);
    const diff = cur == null ? null : amount - cur;
    const flag = cur == null ? "no budget set" : Math.abs(diff) > Math.max(toleranceDollars, tolerancePct * Math.abs(cur)) ? (diff > 0 ? "raise" : "lower") : "ok";
    rows.push({ categoryId: c.id, group: c.groupName, category: c.name, method, template, reason,
      average12: Math.round(m12), average3: Math.round(last3), median12: Math.round(median(a)), variability: Number.isFinite(cv) ? +cv.toFixed(2) : null,
      zeroMonths, suggested: amount, current: cur, difference: diff, flag });
  }
  rows.sort((x, y) => Math.abs(y.difference ?? y.suggested) - Math.abs(x.difference ?? x.suggested));
  const notes = [];
  if (dataMonths.size < 3) notes.push(`Only ${dataMonths.size} month(s) of data in the window; suggestions are unreliable until there are at least 3.`);
  return {
    month, window: [window[0], window.at(-1)], rows,
    totals: { suggested: rows.reduce((s, r) => s + r.suggested, 0), current: rows.reduce((s, r) => s + (r.current || 0), 0) },
    averageIncome: Math.round(mean(income.filter((_, i) => dataMonths.has(window[i])))), notes,
  };
}
