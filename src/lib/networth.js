// Net worth from SimpleFIN account balances (one snapshot per account per day, kept here, not in Actual)
// plus the values on the Assets tab (home, vehicles, camper).
import fs from "node:fs";
import path from "node:path";

export const KINDS = ["cash", "investment", "credit", "loan", "other-asset", "ignore"];
export const KIND_LABEL = { cash: "Cash (checking, savings)", investment: "Investments and retirement", credit: "Credit card", loan: "Loan or mortgage", "other-asset": "Other asset", ignore: "Ignore (leave out)" };
const LIABILITY = new Set(["credit", "loan"]);
const GROUP_NAME = { cash: "Cash", investment: "Investments", "other-asset": "Other assets", credit: "Credit cards", loan: "Loans and mortgage", property: "Home, vehicles, camper" };

// A first guess so you only correct the exceptions. Order matters: loans before cash.
export function guessKind(name = "", org = "") {
  const t = `${name} ${org}`.toLowerCase();
  if (/mortgage|heloc|home equity|auto loan|car loan|student loan|\bloan\b|line of credit/.test(t)) return "loan";
  if (/credit card|\bcard\b|visa|mastercard|amex|american express|discover|sapphire|freedom|platinum card/.test(t)) return "credit";
  if (/401\(?k\)?|403\(?b\)?|\bira\b|roth|brokerage|retirement|\bhsa\b|invest|stock|fidelity|vanguard|schwab|etrade|e\*trade|robinhood|pension|529/.test(t)) return "investment";
  return "cash";
}

// What an account counts for: liabilities are always negative (banks disagree on the sign), assets keep their sign.
export const effective = (kind, balance) => (kind === "ignore" ? 0 : LIABILITY.has(kind) ? -Math.abs(balance) : balance);

export class BalanceStore {
  constructor(file) { this.file = file; this.data = { balances: [] }; try { this.data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* new */ } if (!Array.isArray(this.data.balances)) this.data = { balances: [] }; }
  _save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const t = this.file + ".tmp"; fs.writeFileSync(t, JSON.stringify(this.data)); fs.renameSync(t, this.file); }
  // accounts: [{id, name, org, balance, currency}] ; replaces the same account on the same date
  record(date, accounts) {
    for (const a of accounts) {
      if (!Number.isFinite(a.balance)) continue;
      this.data.balances = this.data.balances.filter((b) => !(b.date === date && b.id === a.id));
      this.data.balances.push({ date, id: a.id, name: a.name, org: a.org || "", balance: a.balance, currency: a.currency || "USD" });
    }
    this.data.balances.sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
    this._save();
  }
  latest() { const m = new Map(); for (const b of this.data.balances) m.set(b.id, b); return [...m.values()]; }

  // kinds: {accountId: kind}; assetSeries: AssetStore.view().series (total + per-asset parts by date).
  view(kinds, assetSeries = []) {
    const kindOf = (b) => kinds[b.id] || guessKind(b.name, b.org);
    const accounts = this.latest().map((b) => ({ id: b.id, name: b.name, org: b.org, date: b.date, balance: b.balance, kind: kindOf(b), confirmed: !!kinds[b.id], counted: effective(kindOf(b), b.balance) }));
    const dates = [...new Set([...this.data.balances.map((b) => b.date), ...assetSeries.map((p) => p.date)])].sort();
    const lastAcct = new Map(), lastAsset = { total: null };
    const byDate = new Map(); for (const b of this.data.balances) { if (!byDate.has(b.date)) byDate.set(b.date, []); byDate.get(b.date).push(b); }
    const assetByDate = new Map(assetSeries.map((p) => [p.date, p.total]));
    const series = dates.map((date) => {
      for (const b of byDate.get(date) || []) lastAcct.set(b.id, b);
      if (assetByDate.has(date)) lastAsset.total = assetByDate.get(date);
      const g = {};
      for (const b of lastAcct.values()) { const k = kindOf(b); if (k === "ignore") continue; g[k] = (g[k] || 0) + effective(k, b.balance); }
      if (lastAsset.total != null) g.property = lastAsset.total;
      const parts = Object.entries(g).map(([k, v]) => ({ name: GROUP_NAME[k], balance: v })).sort((a, b) => b.balance - a.balance);
      return { date, total: parts.reduce((s, p) => s + p.balance, 0), parts };
    });
    const latestAssets = assetSeries.at(-1)?.total ?? null, groups = {};
    for (const a of accounts) if (a.kind !== "ignore") groups[a.kind] = (groups[a.kind] || 0) + a.counted;
    if (latestAssets != null) groups.property = latestAssets;
    const rows = Object.entries(groups).map(([k, v]) => ({ kind: k, name: GROUP_NAME[k], total: v })).sort((a, b) => b.total - a.total);
    const assets = rows.filter((r) => r.total > 0).reduce((s, r) => s + r.total, 0), debts = rows.filter((r) => r.total < 0).reduce((s, r) => s + r.total, 0);
    return { accounts, groups: rows, netWorth: assets + debts, assets, debts, series, unconfirmed: accounts.filter((a) => !a.confirmed).length };
  }
}

// SimpleFIN /accounts payload -> [{id, name, org, balance, currency}]
export function balancesFromSimpleFIN(data) {
  return (data.accounts || []).map((a) => ({ id: String(a.id), name: String(a.name || a.id), org: String(a.org?.name ?? a.org?.domain ?? ""), balance: parseFloat(a.balance), currency: a.currency || "USD" })).filter((a) => Number.isFinite(a.balance));
}
