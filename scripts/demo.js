// Preview the UI with made-up data and no credentials:  node scripts/demo.js  then open http://localhost:3100
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHandlers } from "../src/app.js";
import { createServer } from "../src/server.js";
import { SettingsStore } from "../src/config.js";
import { SnapshotStore } from "../src/lib/investments.js";
import { UtilityStore } from "../src/lib/utilities.js";
import { BalanceStore } from "../src/lib/networth.js";
import { AssetStore } from "../src/lib/assets.js";
import { SnapshotState } from "../src/lib/schedule.js";
import { ScenarioStore } from "../src/lib/scenarios.js";
import { FakeActual } from "../test/fakes.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-"));
const now = new Date();
const ym = (back) => { const t = now.getFullYear() * 12 + now.getMonth() - back; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const txns = [];
const dago = (k) => new Date(Date.now() - k * 864e5).toISOString().slice(0, 10);
[[3, -53.5, "Amazon"], [9, -42.8, "Amazon"], [14, -27.99, "Amazon"], [20, -18.2, "Amazon"]].forEach(([k, amt, nm], i) => txns.push({ id: `az${i}`, accountId: "chk", date: dago(k), amount: amt, categoryId: i === 1 ? "groc" : null, transferAcctId: null, payeeName: nm, importedPayee: "AMZN Mktp US*" + i, notes: "" }));
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
  categories: [{ id: "uel", name: "Electric", groupName: "Utilities", isIncome: false }, { id: "uwa", name: "Water", groupName: "Utilities", isIncome: false }, { id: "uga", name: "Natural gas", groupName: "Utilities", isIncome: false }, { id: "pay", name: "Paycheck", groupName: "Income", isIncome: true }, { id: "groc", name: "Groceries", groupName: "Food", isIncome: false }, { id: "rent", name: "Mortgage", groupName: "Housing", isIncome: false }, { id: "gift", name: "Gifts", groupName: "Fun", isIncome: false }, { id: "dine", name: "Dining", groupName: "Food", isIncome: false }],
  txns, budget: new Map([["groc", 600], ["rent", 2900]]), payees: [],
});
const settings = new SettingsStore(path.join(dir, "settings.json"));
const s = settings.get(); 
s.networth.kinds = { S7: "ignore" };
s.amazon.keywordCategories = { filter: "Mortgage", "dog food": "Groceries", gift: "Gifts" };
s.projection.existingLoans = [{ name: "Truck loan", balanceAccount: null, balance: 21500, rate: 0.069, payment: 480, payoffMonth: ym(-8), payoffAmount: null, paymentInSpending: true }];
s.projection.jobLoss = { enabled: true, startMonth: ym(-4), months: 8, incomePct: 0.25, severance: 8000, expenseCutPct: 10, pauseInvesting: true };
s.projection.bonuses = [{ name: "Annual bonus", month: ym(-2), amount: 12000, repeat: "yearly" }];
s.projection.purchases = [{ month: ym(-5), amount: 85000, name: "Kitchen remodel" }, { month: ym(-14), amount: 30000, name: "Car" }];
settings.set(s);
const sample = { errors: [], accounts: [{ org: { name: "Demo Bank", domain: "demo.example" }, id: "ACT-1", name: "Checking", currency: "USD", balance: "24000.00", "available-balance": "23900.00", "balance-date": Math.floor(Date.now() / 1000),
  transactions: [{ id: "T1", posted: Math.floor(Date.now() / 1000) - 86400, amount: "-45.00", description: "VENMO PAYMENT 99", extra: { category: "transfer" } }, { id: "T2", posted: 0, amount: "-9.99", description: "PENDING", pending: true }] }] };
const invStore = new SnapshotStore(path.join(dir, "inv.json"));
{ let ira = 52000, brk = 18000; for (let k = 14; k >= 0; k--) { const d = new Date(now.getTime() - k * 14 * 864e5).toISOString().slice(0, 10); ira = ira * (1 + Math.sin(k * 1.7) * 0.02 + 0.006) + 400; brk = brk * (1 + Math.cos(k * 1.3) * 0.025 + 0.004);
  const px = (base, a) => Math.round(base * (1 + Math.sin(k * a) * 0.04) * 100) / 100, hd = (symbol, description, units, price) => ({ symbol, description, units, price, value: Math.round(units * price * 100) / 100 });
  const vti = 120 + (k < 9 ? 6 : 0) + (k < 3 ? 4 : 0), vxus = k < 6 ? 90 : 70, aapl = k < 11 ? 25 : 0, nvda = k > 4 ? 30 : 12;
  invStore.record(d, [{ accountId: "ira", name: "Roth IRA", institution: "Demo Brokerage", balance: Math.round(ira), cash: 200, holdings: [hd("VTI", "Vanguard Total Stock Market ETF", vti, px(280, 1.1)), hd("VXUS", "Vanguard Total International ETF", vxus, px(62, 0.9))] }, { accountId: "brk", name: "Taxable", institution: "Demo Brokerage", balance: Math.round(brk), cash: 50, holdings: [hd("AAPL", "Apple Inc.", aapl, px(225, 1.3)), hd("NVDA", "NVIDIA Corp.", nvda, px(140, 0.7))].filter((x) => x.units > 0) }]); } }
const today = new Date(now).toISOString().slice(0, 10);
const utilities = new UtilityStore(path.join(dir, "utilities.json"));
{ const mo = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, bills = { electric: [], water: [], gas: [] };
  for (let k = 25; k >= 0; k--) { const e = new Date(Date.UTC(2026, 10 - k, 1)), y = e.getUTCFullYear(), m = e.getUTCMonth() + 1, sum = Math.max(0, Math.sin(((m - 3) / 12) * Math.PI * 2)), win = Math.max(0, -Math.sin(((m - 3) / 12) * Math.PI * 2)), boost = k < 4 && m >= 6 && m <= 8 ? 1.35 : 1;
    const kwh = Math.round((600 + sum * 1500 + win * 250) * boost), th = Math.round(12 + win * 70 + (k % 3));
    bills.electric.push({ utility: "electric", periodStart: mo(y, m, 2), periodEnd: mo(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1), usage: kwh, amount: Math.round((kwh * 0.128 + 14) * 100) / 100, unit: "kWh", avgPerDay: Math.round(kwh / 30), tempF: Math.round(58 + sum * 22 - win * 18) });
    bills.gas.push({ utility: "gas", periodStart: mo(y, m, 5), periodEnd: mo(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 4), usage: th, amount: Math.round((th * 1.18 + 16) * 100) / 100, unit: "therms" });
    const ccf = Math.round(9 + sum * 9 + (k % 4)); bills.water.push({ utility: "water", periodStart: mo(y, m, 8), periodEnd: mo(y, m, 28), billDate: mo(y, m, 28), usage: ccf, amount: Math.round((ccf * 9.4 + 22) * 100) / 100, unit: "CCF", avgPerDay: Math.round((ccf * 748) / 20) }); }
  for (const l of Object.values(bills)) utilities.addBills(l);
  const payee = { electric: "Duke Energy", water: "City of Raleigh", gas: "Enbridge Gas" };
  for (const [k, l] of Object.entries(bills)) for (const b of l) { const d = new Date(Date.parse(b.periodEnd + "T00:00:00Z") + (k === "water" ? 20 : 14) * 864e5).toISOString().slice(0, 10); if (d <= today) txns.push({ id: `u-${k}-${b.periodEnd}`, accountId: "chk", accountName: "Checking", date: d, amount: -b.amount, categoryId: { electric: "uel", water: "uwa", gas: "uga" }[k], transferAcctId: null, payeeName: payee[k], importedPayee: "", notes: k === "electric" ? "Autopay" : "" }); }
  const daily = []; for (let k = 120; k >= 1; k--) { const d = new Date(now.getTime() - k * 864e5); daily.push({ date: d.toISOString().slice(0, 10), usage: Math.round((22 + 18 * Math.abs(Math.sin(k / 9)) + (k % 7 === 0 ? 14 : 0)) * 10) / 10 }); } utilities.setDaily("electric", daily); }
const balances = new BalanceStore(path.join(dir, "balances.json"));
{ for (let k = 40; k >= 0; k -= 5) { const d = new Date(now.getTime() - k * 864e5).toISOString().slice(0, 10), w = Math.sin(k) * 400;
  balances.record(d, [{ id: "S1", name: "Everyday Checking", org: "Demo Bank", balance: 8200 + w }, { id: "S2", name: "High-yield Savings", org: "Demo Bank", balance: 31000 + (40 - k) * 60 }, { id: "S3", name: "Roth IRA", org: "Demo Brokerage", balance: 52000 + (40 - k) * 150 }, { id: "S4", name: "Taxable Brokerage", org: "Demo Brokerage", balance: 18000 + (40 - k) * 90 }, { id: "S5", name: "Rewards Visa card", org: "Demo Card", balance: -(2100 + w) }, { id: "S6", name: "Home Mortgage", org: "Demo Lender", balance: -(288000 - (40 - k) * 40) }, { id: "S7", name: "Primary home (mirror)", org: "Demo Bank", balance: 640000 }]); } }
const assets = new AssetStore(path.join(dir, "assets.json"));
{ const home = assets.upsert({ name: "Primary home", type: "home", actualAccount: "House" }), car = assets.upsert({ name: "2021 Tacoma", type: "vehicle" }), rv = assets.upsert({ name: "Travel camper", type: "camper" });
  const d = (k) => new Date(Date.now() - k * 864e5).toISOString().slice(0, 10);
  [[300, 600000], [200, 615000], [100, 628000], [10, 640000]].forEach(([k, v]) => assets.setValue(home.id, { date: d(k), value: v }));
  [[330, 34000], [150, 31500], [20, 30200]].forEach(([k, v]) => assets.setValue(car.id, { date: d(k), value: v, note: "KBB trade-in" }));
  [[400, 42000], [120, 38500]].forEach(([k, v]) => assets.setValue(rv.id, { date: d(k), value: v })); }
const handlers = createHandlers({ balances, utilities, version: JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version, assets, snapshotState: new SnapshotState(path.join(dir, "st.json")), actual, snaptrade: null, store: invStore, settings, scenarios: new ScenarioStore(path.join(dir, "scenarios.json")),
  simplefin: { accessUrl: "http://demo:demo@127.0.0.1/simplefin", fetchImpl: async () => ({ ok: true, json: async () => sample }) } });
const port = +process.env.PORT || 3100;
createServer({ handlers, password: null }).listen(port, "127.0.0.1", () => console.log(`Demo (made-up data) on http://127.0.0.1:${port}`));
