// Preview the UI with made-up data and no credentials:  node scripts/demo.js  then open http://localhost:3100
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHandlers } from "../src/app.js";
import { createServer } from "../src/server.js";
import { SettingsStore } from "../src/config.js";
import { SnapshotStore } from "../src/lib/investments.js";
import { ScenarioStore } from "../src/lib/scenarios.js";
import { FakeActual } from "../test/fakes.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-"));
const now = new Date();
const ym = (back) => { const t = now.getFullYear() * 12 + now.getMonth() - back; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const txns = [];
for (let b = 1; b <= 14; b++) {
  const m = ym(b);
  txns.push({ id: `p${b}`, accountId: "chk", date: `${m}-01`, amount: 6400, categoryId: "pay", transferAcctId: null, payeeName: "Employer", importedPayee: "", notes: "" });
  txns.push({ id: `g${b}`, accountId: "chk", date: `${m}-05`, amount: -(650 + (b % 4) * 30), categoryId: "groc", transferAcctId: null, payeeName: "Grocer", importedPayee: "", notes: "" });
  txns.push({ id: `r${b}`, accountId: "chk", date: `${m}-06`, amount: -2900, categoryId: "rent", transferAcctId: null, payeeName: "Mortgage", importedPayee: "", notes: "" });
  txns.push({ id: `v${b}`, accountId: "chk", date: `${m}-10`, amount: -(40 + b), categoryId: null, transferAcctId: null, payeeName: "Venmo", importedPayee: "VENMO PAYMENT", notes: "" });
  txns.push({ id: `i${b}`, accountId: "chk", date: `${m}-12`, amount: -400, categoryId: null, transferAcctId: "brk", payeeName: "Transfer", importedPayee: "", notes: "" });
  if (b % 5 === 0) txns.push({ id: `d${b}`, accountId: "chk", date: `${m}-20`, amount: -380, categoryId: "gift", transferAcctId: null, payeeName: "Shop", importedPayee: "", notes: "" });
}
const actual = new FakeActual({
  accounts: [{ id: "chk", name: "Checking", offbudget: false, closed: false, balance: 24000 }, { id: "brk", name: "Brokerage", offbudget: true, closed: false, balance: 90000 }, { id: "hs", name: "House", offbudget: true, closed: false, balance: 640000 }, { id: "mg", name: "Home Mortgage", offbudget: true, closed: false, balance: -286500 }],
  categories: [{ id: "pay", name: "Paycheck", groupName: "Income", isIncome: true }, { id: "groc", name: "Groceries", groupName: "Food", isIncome: false }, { id: "rent", name: "Mortgage", groupName: "Housing", isIncome: false }, { id: "gift", name: "Gifts", groupName: "Fun", isIncome: false }, { id: "dine", name: "Dining", groupName: "Food", isIncome: false }],
  txns, budget: new Map([["groc", 600], ["rent", 2900]]), payees: [],
});
const settings = new SettingsStore(path.join(dir, "settings.json"));
const s = settings.get(); 
s.projection.purchases = [{ month: ym(-5), amount: 85000, name: "Kitchen remodel" }, { month: ym(-14), amount: 30000, name: "Car" }];
settings.set(s);
const sample = { errors: [], accounts: [{ org: { name: "Demo Bank", domain: "demo.example" }, id: "ACT-1", name: "Checking", currency: "USD", balance: "24000.00", "available-balance": "23900.00", "balance-date": Math.floor(Date.now() / 1000),
  transactions: [{ id: "T1", posted: Math.floor(Date.now() / 1000) - 86400, amount: "-45.00", description: "VENMO PAYMENT 99", extra: { category: "transfer" } }, { id: "T2", posted: 0, amount: "-9.99", description: "PENDING", pending: true }] }] };
const invStore = new SnapshotStore(path.join(dir, "inv.json"));
{ let ira = 52000, brk = 18000; for (let k = 14; k >= 0; k--) { const d = new Date(now.getTime() - k * 14 * 864e5).toISOString().slice(0, 10); ira = ira * (1 + Math.sin(k * 1.7) * 0.02 + 0.006) + 400; brk = brk * (1 + Math.cos(k * 1.3) * 0.025 + 0.004);
  invStore.record(d, [{ accountId: "ira", name: "Roth IRA", institution: "Demo Brokerage", balance: Math.round(ira), cash: 200, holdings: [] }, { accountId: "brk", name: "Taxable", institution: "Demo Brokerage", balance: Math.round(brk), cash: 50, holdings: [] }]); } }
const handlers = createHandlers({ actual, snaptrade: null, store: invStore, settings, scenarios: new ScenarioStore(path.join(dir, "scenarios.json")),
  simplefin: { accessUrl: "http://demo:demo@127.0.0.1/simplefin", fetchImpl: async () => ({ ok: true, json: async () => sample }) } });
const port = +process.env.PORT || 3100;
createServer({ handlers, password: null }).listen(port, "127.0.0.1", () => console.log(`Demo (made-up data) on http://127.0.0.1:${port}`));
