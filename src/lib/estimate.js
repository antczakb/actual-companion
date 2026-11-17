// Value estimates that need no scraping: a house price index scales a known value; a depreciation rate ages a vehicle's value.
export const ESTIMATE_METHODS = ["index", "depreciation"];
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "") && !Number.isNaN(Date.parse(d + "T00:00:00Z"));

export function validateEstimate(e) {
  if (!e) return null;
  if (!ESTIMATE_METHODS.includes(e.method)) throw bad("Estimate method must be index or depreciation.");
  const baseValue = Number(e.baseValue);
  if (!Number.isFinite(baseValue) || baseValue <= 0) throw bad("Enter the known starting value (more than zero).");
  if (!isDate(e.baseDate)) throw bad("Enter the date of that starting value.");
  const out = { method: e.method, baseValue, baseDate: e.baseDate };
  if (e.method === "index") { if (!/^[A-Za-z0-9_]{2,40}$/.test(e.series || "")) throw bad("Enter the FRED series ID of a house price index, such as USSTHPI."); out.series = e.series.trim(); }
  else { const r = Number(e.annualRate); if (!Number.isFinite(r) || r < 0 || r > 0.6) throw bad("Yearly depreciation must be between 0 and 60 percent."); out.annualRate = r; }
  return out;
}

// fred: adapter with observation(series, onOrBefore?); today: 'YYYY-MM-DD'. Returns {value, detail}.
export async function computeEstimate(est, today, fred) {
  if (est.method === "depreciation") {
    const years = Math.max(0, (Date.parse(today + "T00:00:00Z") - Date.parse(est.baseDate + "T00:00:00Z")) / (365.25 * 864e5));
    return { value: Math.round(est.baseValue * Math.pow(1 - est.annualRate, years)), detail: `${(est.annualRate * 100).toFixed(1)}% a year for ${years.toFixed(1)} years` };
  }
  const [then, now] = await Promise.all([fred.observation(est.series, est.baseDate), fred.observation(est.series)]);
  return { value: Math.round(est.baseValue * (now.value / then.value)), detail: `${est.series} moved from ${then.value} (${then.date}) to ${now.value} (${now.date}), ${(((now.value / then.value) - 1) * 100).toFixed(1)}%` };
}
