// Thin wrapper over @actual-app/api. Everything the app needs from Actual goes through these methods,
// so the rest of the code never touches the SDK and can be tested with a fake. Amounts leave here in dollars.
import fs from "node:fs";
import { diagnoseUrl } from "../lib/diagnose.js";
const cents = (n) => (n == null ? 0 : n / 100);

export class ActualAdapter {
  constructor({ serverUrl, password, syncId, budgetPassword, dataDir, loadApi, diagnose = diagnoseUrl }) {
    serverUrl = serverUrl && serverUrl.replace(/\/+$/, ""); Object.assign(this, { serverUrl, password, syncId, budgetPassword, dataDir }); this._diagnose = diagnose;
    this.loadApi = loadApi || (() => import("@actual-app/api"));
    this._ready = null; this._chain = Promise.resolve(); this._lastSync = 0;
  }
  configured() { return !!(this.serverUrl && this.password && this.syncId); }

  _init() {
    if (!this._ready) {
      this._ready = (async () => {
        if (this.dataDir) fs.mkdirSync(this.dataDir, { recursive: true }); // the Actual API scans this folder and fails if it is missing
        const m = await this.loadApi();
        this.api = m.default?.init ? m.default : m;
        await this.api.init({ dataDir: this.dataDir, serverURL: this.serverUrl, password: this.password });
        await this.api.downloadBudget(this.syncId, this.budgetPassword ? { password: this.budgetPassword } : undefined);
      })().catch(async (e) => {
        this._ready = null;
        if (/network-failure/i.test(e?.message || "")) {
          const d = await this._diagnose(this.serverUrl);
          throw new Error(`Could not reach the Actual server. ${d.message}${d.ok ? " The server answers, so also check the address is the Actual server itself, not a proxy page." : ""}`);
        }
        throw e;
      });
    }
    return this._ready;
  }
  // One call at a time; sync from the server at most once a minute for reads.
  _run(fn, { write = false } = {}) {
    const job = this._chain.then(async () => {
      if (!this.configured()) throw new Error("Actual is not configured (set ACTUAL_SERVER_URL, ACTUAL_PASSWORD, ACTUAL_SYNC_ID).");
      await this._init();
      if (Date.now() - this._lastSync > 60000) { await this.api.sync(); this._lastSync = Date.now(); }
      const r = await fn(this.api);
      if (write) { await this.api.sync(); this._lastSync = Date.now(); }
      return r;
    });
    this._chain = job.catch(() => {});
    return job;
  }

  getAccounts() {
    return this._run(async (api) => {
      const list = await api.getAccounts();
      return Promise.all(list.map(async (a) => ({ id: a.id, name: a.name, offbudget: !!a.offbudget, closed: !!a.closed, balance: cents(await api.getAccountBalance(a.id)) })));
    });
  }
  getCategories() {
    return this._run(async (api) => {
      const groups = await api.getCategoryGroups();
      return groups.flatMap((g) => (g.categories || []).map((c) => ({
        id: c.id, name: c.name, groupId: g.id, groupName: g.name, isIncome: !!(c.is_income ?? g.is_income), hidden: !!(c.hidden || g.hidden),
      })));
    });
  }
  getPayees() { return this._run((api) => api.getPayees()); }
  getTransactions(startDate, endDate) {
    return this._run(async (api) => {
      const [accounts, payees] = await Promise.all([api.getAccounts(), api.getPayees()]);
      const payeeById = new Map(payees.map((p) => [p.id, p]));
      const out = [];
      for (const a of accounts) {
        const rows = await api.getTransactions(a.id, startDate, endDate);
        const base = (t, parent) => {
          const p = payeeById.get((parent || t).payee);
          return { id: t.id, accountId: a.id, accountName: a.name, date: (parent || t).date, amount: cents(t.amount), payeeId: (parent || t).payee || null,
            payeeName: p?.name || "", importedPayee: (parent || t).imported_payee || "", notes: (parent || t).notes || "",
            categoryId: t.category || null, transferAcctId: p?.transfer_acct || null };
        };
        for (const t of rows) {
          if (t.subtransactions?.length) t.subtransactions.forEach((s) => out.push(base(s, t)));
          else if (t.is_parent) continue; // flat shape: children arrive as their own rows
          else out.push(base(t, null));
        }
      }
      return out;
    });
  }
  // Map of categoryId -> budgeted dollars for a month (null if the API call is unavailable).
  getBudgetMonth(month) {
    return this._run(async (api) => {
      const b = await api.getBudgetMonth(month);
      const m = new Map();
      for (const g of b.categoryGroups || []) for (const c of g.categories || []) m.set(c.id, cents(c.budgeted));
      return m;
    });
  }
  async findOrCreatePayee(name) {
    return this._run(async (api) => {
      const payees = await api.getPayees();
      const hit = payees.find((p) => p.name.toLowerCase() === name.toLowerCase() && !p.transfer_acct);
      return hit ? hit.id : api.createPayee({ name });
    }, { write: true });
  }
  updateTransaction(id, fields) {
    return this._run((api) => api.updateTransaction(id, fields), { write: true });
  }
  async shutdown() { if (this.api) await this.api.shutdown(); }
}
