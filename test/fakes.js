// In-memory stand-in for ActualAdapter, same interface.
export class FakeActual {
  constructor(d) { this.d = d; this.updates = []; this.payeesCreated = []; }
  configured() { return true; }
  async getAccounts() { return this.d.accounts; }
  async getCategories() { return this.d.categories; }
  async getPayees() { return this.d.payees || []; }
  async getTransactions(s, e) { return this.d.txns.filter((t) => t.date >= s && t.date <= e); }
  async getBudgetMonth() { return this.d.budget || new Map(); }
  async findOrCreatePayee(name) { const hit = (this.d.payees || []).find((p) => p.name === name); if (hit) return hit.id; this.payeesCreated.push(name); return "new-" + name; }
  async updateTransaction(id, f) { this.updates.push({ id, ...f }); }
}
