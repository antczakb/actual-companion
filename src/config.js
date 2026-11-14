import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SETTINGS = {
  loan: {
    product: "HELOC", protectReserve: true, cushion: 2000, roundTo: 1000, maxLtv: 0.8,
    homeValue: 0, mortgage: 0, otherLiens: 0, horizonMonths: 60,
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
  },
  budget: { trailingMonths: 12, tolerancePct: 0.1, toleranceDollars: 10, excludeGroups: [], excludeCategories: [] },
  venmo: { dayWindow: 5, payeeRegex: "venmo", keywordCategories: {} },
  simplefin: { startDaysBack: 90, cacheHours: 6 },
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
  num(L.maxLtv, "loan.maxLtv", 0, 1); num(L.horizonMonths, "loan.horizonMonths", 6, 120); num(L.cushion, "loan.cushion", 0); num(L.roundTo, "loan.roundTo", 0);
  for (const k of ["homeValue", "mortgage", "otherLiens"]) num(L[k], `loan.${k}`, 0);
  (s.projection?.purchases || []).forEach((p, i) => { if (!/^\d{4}-\d{2}$/.test(p.month || "")) errs.push(`projection.purchases[${i}].month must look like 2027-06`); num(+p.amount, `projection.purchases[${i}].amount`, 0); });
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
