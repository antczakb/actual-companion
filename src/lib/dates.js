export const pad = (n) => String(n).padStart(2, "0");
export const monthKey = (iso) => iso.slice(0, 7);
export function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
export const currentMonth = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
export function daysBetween(a, b) {
  return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5);
}
export const lastDayOf = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
};
