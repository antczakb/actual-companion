// Snapshot store for investment balances/holdings (kept outside Actual's ledger), plus SnapTrade response normalizing.
import fs from "node:fs";
import path from "node:path";

export class SnapshotStore {
  constructor(file) { this.file = file; this.data = { snapshots: [] }; if (fs.existsSync(file)) this.data = JSON.parse(fs.readFileSync(file, "utf8")); }
  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data)); }
  // accounts: [{accountId, name, institution, balance, currency, holdings:[{symbol, description, units, price, value}]}]
  record(date, accounts, source = "snaptrade") {
    for (const a of accounts) {
      this.data.snapshots = this.data.snapshots.filter((s) => !(s.date === date && s.accountId === a.accountId && s.source === source));
      this.data.snapshots.push({ date, source, ...a });
    }
    this.data.snapshots.sort((x, y) => x.date.localeCompare(y.date) || x.accountId.localeCompare(y.accountId));
    this.save();
  }
  latest() {
    const m = new Map();
    for (const s of this.data.snapshots) m.set(`${s.source}:${s.accountId}`, s); // sorted ascending so the last wins
    return [...m.values()];
  }
  // total across accounts per date, carrying each account's last known value forward
  series() {
    const dates = [...new Set(this.data.snapshots.map((s) => s.date))].sort();
    const last = new Map();
    return dates.map((d) => {
      this.data.snapshots.filter((s) => s.date === d).forEach((s) => last.set(`${s.source}:${s.accountId}`, s.balance));
      return { date: d, total: [...last.values()].reduce((a, b) => a + b, 0) };
    });
  }
  holdings() {
    const m = new Map();
    for (const a of this.latest()) for (const h of a.holdings || []) {
      const k = h.symbol || h.description || "?";
      const e = m.get(k) || { symbol: k, description: h.description || "", units: 0, value: 0, accounts: [] };
      e.units += h.units || 0; e.value += h.value || 0; e.accounts.push(a.name);
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.value - a.value);
  }
}

// SnapTrade response shapes vary by SDK version and instrument type; read the known variants defensively.
const first = (...xs) => xs.find((x) => x !== undefined && x !== null && x !== "");
export function normalizeSnapTrade(accounts, holdingsByAccount) {
  return accounts.map((a) => {
    const id = a.id ?? a.account_id;
    const h = holdingsByAccount[id] || {};
    const list = Array.isArray(h.positions) ? h.positions : h.results || [];
    const positions = list.map((p) => {
      const sym = p.symbol?.symbol ?? p.symbol, ins = p.instrument || {};
      const ticker = first(typeof sym === "object" ? first(sym?.symbol, sym?.raw_symbol) : sym, ins.symbol, ins.raw_symbol, ins.ticker, "");
      const desc = first(p.symbol?.symbol?.description, p.symbol?.description, ins.description, ins.name, "");
      const units = Number(first(p.units, p.quantity, p.fractional_units, 0)), price = Number(first(p.price, p.last_price, ins.price, 0));
      const mv = first(p.market_value, p.value);
      return { symbol: String(ticker), description: String(desc), units, price, value: +(mv !== undefined ? Number(mv) : units * price).toFixed(2) };
    });
    const bal = Array.isArray(h.balances) ? h.balances : h.balances ? [h.balances] : [];
    const cash = bal.reduce((s, b) => s + Number(first(b.cash, b.amount, b.balance, 0)), 0);
    const total = first(h.total_value?.value, a.balance?.total?.amount);
    const computed = positions.reduce((s, p) => s + p.value, 0) + cash;
    return { accountId: id, name: a.name || a.institution_name || id, institution: a.institution_name || "", balance: Number(total ?? computed), currency: a.balance?.total?.currency || h.total_value?.currency || "USD", cash, holdings: positions };
  });
}
