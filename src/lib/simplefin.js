// SimpleFIN Bridge client + flattening of every field into table rows.
import fs from "node:fs";
import path from "node:path";

export function parseAccessUrl(accessUrl) {
  const u = new URL(accessUrl.trim());
  const auth = "Basic " + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64");
  u.username = ""; u.password = "";
  return { base: u.toString().replace(/\/$/, ""), auth };
}

export async function fetchSimpleFIN({ accessUrl, startDate, endDate, pending = true, fetchImpl = fetch }) {
  const { base, auth } = parseAccessUrl(accessUrl);
  const q = new URLSearchParams();
  if (startDate) q.set("start-date", String(Math.floor(Date.parse(startDate + "T00:00:00Z") / 1000)));
  if (endDate) q.set("end-date", String(Math.floor(Date.parse(endDate + "T23:59:59Z") / 1000)));
  if (pending) q.set("pending", "1");
  const res = await fetchImpl(`${base}/accounts?${q}`, { headers: { Authorization: auth, Accept: "application/json" } });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`SimpleFIN returned HTTP ${res.status}${res.status === 403 ? " (access token revoked or wrong)" : res.status === 402 ? " (subscription needs attention)" : ""}: ${body}`);
  }
  return res.json();
}

const DATE_FIELDS = new Set(["posted", "transacted_at", "balance-date", "balance_date"]);
export function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}
const iso = (n) => (typeof n === "number" && n > 0 ? new Date(n * 1000).toISOString() : "");
function addIso(row) {
  for (const k of Object.keys(row)) {
    const leaf = k.split(".").pop();
    if (DATE_FIELDS.has(leaf) && typeof row[k] === "number") row[`${k}_iso`] = iso(row[k]);
  }
  return row;
}

// Every key SimpleFIN sent becomes a column; common ones first.
export function toTables(data) {
  const accounts = [], transactions = [];
  for (const a of data.accounts || []) {
    const { transactions: txns = [], ...rest } = a;
    accounts.push(addIso({ ...flatten(rest), transaction_count: txns.length }));
    for (const t of txns) {
      transactions.push(addIso({ account_id: a.id, account_name: a.name, institution: a.org?.name ?? a.org?.domain ?? "", ...flatten(t) }));
    }
  }
  transactions.sort((x, y) => (y.posted || 0) - (x.posted || 0));
  const cols = (rows, first) => {
    const all = new Set(); rows.forEach((r) => Object.keys(r).forEach((k) => all.add(k)));
    const head = first.filter((k) => all.has(k));
    return [...head, ...[...all].filter((k) => !head.includes(k)).sort()];
  };
  return {
    errors: data.errors || [],
    accounts: { columns: cols(accounts, ["org.name", "name", "id", "balance", "available-balance", "currency", "balance-date_iso", "transaction_count"]), rows: accounts },
    transactions: { columns: cols(transactions, ["posted_iso", "institution", "account_name", "description", "amount", "pending", "id", "transacted_at_iso"]), rows: transactions },
  };
}

export async function getSimpleFIN({ accessUrl, cachePath, ttlHours = 6, refresh = false, startDaysBack = 90, fetchImpl = fetch, now = new Date() }) {
  if (!accessUrl) throw new Error("SIMPLEFIN_ACCESS_URL is not set.");
  if (!refresh && cachePath && fs.existsSync(cachePath)) {
    const c = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if ((now - new Date(c.fetchedAt)) / 36e5 < ttlHours) return { ...c, fromCache: true };
  }
  const start = new Date(now.getTime() - startDaysBack * 864e5).toISOString().slice(0, 10);
  const data = await fetchSimpleFIN({ accessUrl, startDate: start, endDate: now.toISOString().slice(0, 10), fetchImpl });
  const c = { fetchedAt: now.toISOString(), data };
  if (cachePath) { fs.mkdirSync(path.dirname(cachePath), { recursive: true }); fs.writeFileSync(cachePath, JSON.stringify(c)); }
  return { ...c, fromCache: false };
}
