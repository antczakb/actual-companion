import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SETTINGS = {
  loan: {
    product: "HELOC", payoffBudgetPct: 0.5, protectReserve: true, cushion: 2000, roundTo: 1000, maxLtv: 0.8,
    homeValue: 0, mortgage: 0, otherLiens: 0, horizonMonths: 60,
    homeValueAccount: null, mortgageAccount: null, otherLiensAccount: null, // an Actual account name, or null to use the custom value above
    products: [
      { name: "HELOC", rate: 0.08, ioYears: 10, termYears: 20, feePct: 0, fixedFee: 0, secured: true },
      { name: "Home equity loan", rate: 0.0775, ioYears: 0, termYears: 15, feePct: 0.02, fixedFee: 0, secured: true },
      { name: "Personal loan", rate: 0.11, ioYears: 0, termYears: 5, feePct: 0.04, fixedFee: 0, secured: false },
    ],
  },
  projection: {
    cashAccounts: [], trailingMonths: 12, reserveMonths: 3, reserveFixed: null,
    incomeGrowthPct: 0, expenseInflationPct: 0, incomeOverride: null, expensesOverride: null, investingOverride: null,
    purchases: [],
    bonuses: [],
    existingLoans: [], // {name, balanceAccount, balance, rate, payment, payoffMonth, payoffAmount|null, paymentInSpending}
    jobLoss: { enabled: false, startMonth: "", months: 6, incomePct: 0, severance: 0, expenseCutPct: 10, pauseInvesting: true },
  },
  budget: { trailingMonths: 12, tolerancePct: 0.1, toleranceDollars: 10, excludeGroups: [], excludeCategories: [] },
  venmo: { dayWindow: 5, payeeRegex: "venmo", keywordCategories: {} },
  amazon: { dayWindow: 7, payeeRegex: "amazon|amzn", keywordCategories: {}, departmentCategories: {} },
  simplefin: { startDaysBack: 90, cacheHours: 6 },
  utilities: { payees: { electric: "duke energy", water: "raleigh", gas: "enbridge|piedmont" }, categories: { electric: [], water: [], gas: [] }, match: "payee" }, // how payments are found in Actual: payee pattern and/or category; match = payee | category | either | both
  networth: { kinds: {} }, // SimpleFIN account id -> cash | investment | credit | loan | other-asset | ignore
  reminders: { enabled: true, day: 1 }, // monthly "update your home and vehicle values" reminder (banner, plus a push if NOTIFY_URL is set)
  snapshots: { enabled: true, time: "23:55" }, // end-of-day investment and asset snapshot, server local time
};

export function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== "object" || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = k in base && v && typeof v === "object" && !Array.isArray(v) ? deepMerge(base[k], v) : v;
  return out;
}

export function validateSettings(s) {
  const errs = [];
  const num = (v, name, min = -Infinity, max = Infinity) => { if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) errs.push(`${name} must be a number between ${min} and ${max}`); };
  const L = s.loan || {};
  if (!Array.isArray(L.products) || !L.products.length) errs.push("loan.products needs at least one product");
  else L.products.forEach((p, i) => {
    if (!p.name) errs.push(`loan.products[${i}].name is required`);
    num(p.rate, `loan.products[${i}].rate`, 0, 1); num(p.ioYears, `loan.products[${i}].ioYears`, 0, 50); num(p.termYears, `loan.products[${i}].termYears`, 0, 50);
    num(p.feePct, `loan.products[${i}].feePct`, 0, 1); num(p.fixedFee, `loan.products[${i}].fixedFee`, 0);
  });
  if (L.products && !L.products.find((p) => p.name === L.product)) errs.push("loan.product must match a product name");
  num(L.maxLtv, "loan.maxLtv", 0, 1); num(L.payoffBudgetPct, "loan.payoffBudgetPct", 0, 1); num(L.horizonMonths, "loan.horizonMonths", 6, 120); num(L.cushion, "loan.cushion", 0); num(L.roundTo, "loan.roundTo", 0);
  for (const k of ["homeValue", "mortgage", "otherLiens"]) num(L[k], `loan.${k}`, 0);
  for (const k of ["homeValueAccount", "mortgageAccount", "otherLiensAccount"]) if (L[k] != null && typeof L[k] !== "string") errs.push(`loan.${k} must be an account name or null`);
  for (const [k, v] of Object.entries(s.amazon?.departmentCategories || {})) if (typeof v !== "string" || !k.trim()) errs.push("amazon.departmentCategories needs a department and a category name on every row");
  if (s.amazon) {
    num(s.amazon.dayWindow, "amazon.dayWindow", 0, 60);
    try { new RegExp(s.amazon.payeeRegex || ""); } catch { errs.push("amazon.payeeRegex is not a valid pattern"); }
    for (const [k, v] of Object.entries(s.amazon.keywordCategories || {})) if (typeof v !== "string" || !k.trim()) errs.push("amazon.keywordCategories needs a word and a category name on every row");
  }
  for (const [id, k] of Object.entries(s.networth?.kinds || {})) if (!["cash", "investment", "credit", "loan", "other-asset", "ignore"].includes(k)) errs.push(`networth.kinds.${id} is not a valid kind`);
  for (const k of ["electric", "water", "gas"]) { try { new RegExp(s.utilities?.payees?.[k] || ""); } catch { errs.push(`utilities.payees.${k} is not a valid pattern`); } }
  if (!["payee", "category", "either", "both"].includes(s.utilities?.match)) errs.push("utilities.match must be payee, category, either or both");
  for (const k of ["electric", "water", "gas"]) if (!Array.isArray(s.utilities?.categories?.[k])) errs.push(`utilities.categories.${k} must be a list`);
  if (s.reminders) { if (typeof s.reminders.enabled !== "boolean") errs.push("reminders.enabled must be true or false"); num(s.reminders.day, "reminders.day", 1, 28); }
  if (s.snapshots) { if (typeof s.snapshots.enabled !== "boolean") errs.push("snapshots.enabled must be true or false"); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.snapshots.time || "")) errs.push("snapshots.time must look like 23:55"); }
  (s.projection?.existingLoans || []).forEach((x, i) => {
    const w = `projection.existingLoans[${i}]`;
    if (!String(x.name || "").trim()) errs.push(`${w}.name is required`);
    if (!/^\d{4}-\d{2}$/.test(x.payoffMonth || "")) errs.push(`${w}.payoffMonth must look like 2027-06`);
    num(+x.balance, `${w}.balance`, 0); num(+x.rate, `${w}.rate`, 0, 1); num(+x.payment, `${w}.payment`, 0);
    if (x.payoffAmount != null) num(+x.payoffAmount, `${w}.payoffAmount`, 0);
  });
  if (s.projection?.jobLoss) {
    const J = s.projection.jobLoss;
    if (J.enabled && !/^\d{4}-\d{2}$/.test(J.startMonth || "")) errs.push("projection.jobLoss.startMonth must look like 2027-03");
    num(+J.months, "projection.jobLoss.months", 0, 120); num(+J.incomePct, "projection.jobLoss.incomePct", 0, 1); num(+J.severance, "projection.jobLoss.severance", 0); num(+J.expenseCutPct, "projection.jobLoss.expenseCutPct", 0, 100);
  }
  (s.projection?.bonuses || []).forEach((b, i) => { if (!/^\d{4}-\d{2}$/.test(b.month || "")) errs.push(`projection.bonuses[${i}].month must look like 2027-03`); if (b.repeat && !["once", "yearly"].includes(b.repeat)) errs.push(`projection.bonuses[${i}].repeat must be once or yearly`); num(+b.amount, `projection.bonuses[${i}].amount`, 0); });
  (s.projection?.purchases || []).forEach((p, i) => { if (!/^\d{4}-\d{2}$/.test(p.month || "")) errs.push(`projection.purchases[${i}].month must look like 2027-06`); num(+p.amount, `projection.purchases[${i}].amount`, 0); });
  const P = s.projection || {};
  num(P.trailingMonths, "projection.trailingMonths", 1, 60); num(P.reserveMonths, "projection.reserveMonths", 0, 36);
  num(P.incomeGrowthPct, "projection.incomeGrowthPct", -50, 100); num(P.expenseInflationPct, "projection.expenseInflationPct", -50, 100);
  if (P.reserveFixed != null) num(P.reserveFixed, "projection.reserveFixed", 0);
  if (!Array.isArray(P.cashAccounts) || P.cashAccounts.some((x) => typeof x !== "string")) errs.push("projection.cashAccounts must be a list of account names");
  const B = s.budget || {};
  num(B.trailingMonths, "budget.trailingMonths", 1, 60); num(B.tolerancePct, "budget.tolerancePct", 0, 1); num(B.toleranceDollars, "budget.toleranceDollars", 0);
  for (const k of ["excludeGroups", "excludeCategories"]) if (!Array.isArray(B[k]) || B[k].some((x) => typeof x !== "string")) errs.push(`budget.${k} must be a list of names`);
  const V = s.venmo || {};
  num(V.dayWindow, "venmo.dayWindow", 0, 31);
  try { new RegExp(V.payeeRegex || "", "i"); } catch { errs.push("venmo.payeeRegex is not a valid pattern"); }
  if (!V.keywordCategories || typeof V.keywordCategories !== "object" || Object.values(V.keywordCategories).some((x) => typeof x !== "string")) errs.push("venmo.keywordCategories must map words to category names");
  const F = s.simplefin || {};
  num(F.startDaysBack, "simplefin.startDaysBack", 1, 365); num(F.cacheHours, "simplefin.cacheHours", 0, 168);
  return errs;
}

export class SettingsStore {
  constructor(file) { this.file = file; }
  get() {
    let over = {};
    if (fs.existsSync(this.file)) over = JSON.parse(fs.readFileSync(this.file, "utf8"));
    return deepMerge(structuredClone(DEFAULT_SETTINGS), over); // clone: callers may mutate the result
  }
  set(s) {
    const errs = validateSettings(s);
    if (errs.length) { const e = new Error(errs.join("; ")); e.status = 400; throw e; }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(s, null, 2));
    return s;
  }
}
