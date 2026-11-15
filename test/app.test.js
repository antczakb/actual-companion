import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHandlers } from "../src/app.js";
import { createServer } from "../src/server.js";
import { SettingsStore } from "../src/config.js";
import { SnapshotStore } from "../src/lib/investments.js";
import { ScenarioStore } from "../src/lib/scenarios.js";
import { FakeActual } from "./fakes.js";

const NOW = new Date("2026-11-14T12:00:00Z");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "app-"));
const months = Array.from({ length: 12 }, (_, i) => { const t = 2025 * 12 + 10 + i; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; }); // 2025-11..2026-10

function data() {
  const txns = [];
  months.forEach((m, i) => {
    txns.push({ id: `p${i}`, accountId: "chk", date: `${m}-01`, amount: 6000, categoryId: "pay", transferAcctId: null, payeeName: "Employer", importedPayee: "", notes: "" });
    txns.push({ id: `g${i}`, accountId: "chk", date: `${m}-05`, amount: -700, categoryId: "groc", transferAcctId: null, payeeName: "Grocer", importedPayee: "", notes: "" });
    txns.push({ id: `r${i}`, accountId: "chk", date: `${m}-06`, amount: -3000, categoryId: "rent", transferAcctId: null, payeeName: "Landlord", importedPayee: "", notes: "" });
    txns.push({ id: `i${i}`, accountId: "chk", date: `${m}-07`, amount: -300, categoryId: null, transferAcctId: "brk", payeeName: "Transfer", importedPayee: "", notes: "" });
  });
  txns.push({ id: "vb1", accountId: "chk", date: "2026-10-05", amount: -42.5, categoryId: null, transferAcctId: null, payeeName: "Venmo", importedPayee: "VENMO PAYMENT", notes: "" });
  return {
    accounts: [{ id: "chk", name: "Checking", offbudget: false, closed: false, balance: 20000 }, { id: "brk", name: "Brokerage", offbudget: true, closed: false, balance: 90000 }],
    categories: [{ id: "pay", name: "Paycheck", groupName: "Income", isIncome: true }, { id: "groc", name: "Groceries", groupName: "Food", isIncome: false }, { id: "rent", name: "Rent", groupName: "Housing", isIncome: false }, { id: "dine", name: "Dining", groupName: "Food", isIncome: false }],
    txns, budget: new Map([["groc", 600], ["rent", 3000]]), payees: [],
  };
}
function make(over = {}) {
  const dir = tmp(), actual = new FakeActual(data());
  const settings = new SettingsStore(path.join(dir, "s.json"));
  const h = createHandlers({ actual, snaptrade: null, store: new SnapshotStore(path.join(dir, "i.json")), settings, scenarios: new ScenarioStore(path.join(dir, "sc.json")), simplefin: { accessUrl: null }, now: () => NOW, ...over });
  return { h, actual, settings, dir };
}

test("loan: assumptions come from Actual, purchase triggers a recommendation", async () => {
  const { h, settings } = make();
  const s = settings.get();
  s.loan.homeValue = 800000; s.loan.mortgage = 300000;
  s.projection.purchases = [{ month: "2027-03", amount: 90000, name: "Kitchen" }];
  settings.set(s);
  const r = await h["GET /api/loan"]({ query: {} });
  assert.equal(r.assumptions.cashToday, 20000);
  assert.equal(r.assumptions.monthlyIncome, 6000);
  // 3700 of categorized spend, plus the one uncategorized $42.50 Venmo debit spread over 12 months
  assert.ok(Math.abs(r.assumptions.monthlyExpenses - (3700 + 42.5 / 12)) < 1e-9);
  assert.equal(r.assumptions.monthlyInvesting, 300);
  assert.ok(Math.abs(r.assumptions.monthlySurplus - (2000 - 42.5 / 12)) < 1e-9);
  assert.ok(r.summary.suggested > 0 && r.summary.suggested % 1000 === 0);
  assert.equal(r.comparison.length, 3);
  assert.ok(r.rows.length === 60);
  const o = await h["GET /api/loan"]({ query: { loan: "50000", product: "Personal loan", draw: "2027-03" } });
  assert.equal(o.summary.usedLoan, 50000); assert.equal(o.summary.drawLabel, "2027-03");
  assert.equal(r.warnings.length, 0);
});

test("loan: warns when there is no home value, purchases or history", async () => {
  const { h } = make();
  const r = await h["GET /api/loan"]({ query: {} });
  assert.ok(r.warnings.some((w) => /Home value/.test(w)) && r.warnings.some((w) => /planned purchases/.test(w)));
});

test("budget: suggestions compare against the current month's budget", async () => {
  const { h } = make();
  const r = await h["GET /api/budget"]({ query: { month: "2026-11" } });
  const g = r.rows.find((x) => x.category === "Groceries");
  assert.equal(g.suggested, 700); assert.equal(g.current, 600); assert.equal(g.flag, "raise");
  assert.equal(r.rows.find((x) => x.category === "Rent").flag, "ok");
  assert.ok(r.notes.some((n) => /uncategorized/.test(n)));
});

const CSV = `Account Statement,,,,,,,,,,,,,
,ID,Datetime,Type,Status,Note,From,To,Amount (total),Amount (fee),Funding Source,Destination
,9001,2026-10-03T12:00:00,Payment,Complete,pizza,Brad,Sam Lee,- $42.50,,Chase Checking,
`;

test("venmo: preview matches, apply writes only what was selected and is idempotent", async () => {
  const { h, actual } = make();
  const p = await h["POST /api/venmo/preview"]({ body: { csv: CSV } });
  assert.equal(p.counts.matched, 1); assert.equal(p.matched[0].payee, "Sam Lee"); assert.equal(p.matched[0].daysApart, 2);
  assert.equal(actual.updates.length, 0, "preview must not write");
  const none = await h["POST /api/venmo/apply"]({ body: { csv: CSV, venmoIds: ["no-such"] } });
  assert.equal(none.updated, 0); assert.equal(actual.updates.length, 0);
  const a = await h["POST /api/venmo/apply"]({ body: { csv: CSV, venmoIds: ["9001"], categoryOverrides: { 9001: "dine" } } });
  assert.equal(a.updated, 1);
  assert.deepEqual(actual.updates[0], { id: "vb1", notes: "Venmo to Sam Lee: pizza [venmo:9001]", category: "dine", payee: "new-Sam Lee" });
  await assert.rejects(h["POST /api/venmo/apply"]({ body: { csv: CSV, venmoIds: [] } }), /Nothing selected/);
  await assert.rejects(h["POST /api/venmo/preview"]({ body: { csv: "garbage" } }), /Venmo statement/);
});

test("investments: refresh without SnapTrade configured is a clear error; store round trip", async () => {
  const { h } = make();
  await assert.rejects(h["POST /api/investments/refresh"]({}), /not configured/);
  const snap = { configured: () => true, connected: () => true, fetchAll: async () => [{ accountId: "a", name: "IRA", institution: "X", balance: 1234, holdings: [] }] };
  const m = make({ snaptrade: snap });
  const r = await m.h["POST /api/investments/refresh"]({});
  assert.equal(r.recorded, 1);
  const inv = await m.h["GET /api/investments"]();
  assert.equal(inv.series[0].total, 1234); assert.equal(inv.series[0].date, "2026-11-14");
});

test("settings: invalid values are rejected, valid ones persist", async () => {
  const { h, settings } = make();
  const s = settings.get(); s.loan.maxLtv = 5;
  await assert.rejects(h["PUT /api/settings"]({ body: s }), /maxLtv/);
  s.loan.maxLtv = 0.75; await h["PUT /api/settings"]({ body: s });
  assert.equal(settings.get().loan.maxLtv, 0.75);
});

test("server: auth required, routes, traversal blocked, body limit", async () => {
  const { h } = make();
  const pub = tmp(); fs.writeFileSync(path.join(pub, "index.html"), "<h1>hi</h1>"); fs.writeFileSync(path.join(tmp(), "secret.txt"), "x");
  const srv = createServer({ handlers: h, password: "pw", publicDir: pub, maxBody: 100 });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const call = (opts, body) => new Promise((resolve, reject) => { const r = http.request({ host: "127.0.0.1", port, ...opts }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode, body: b })); }); r.on("error", reject); if (body) r.write(body); r.end(); });
  const auth = { Authorization: "Basic " + Buffer.from("me:pw").toString("base64") };
  assert.equal((await call({ path: "/api/status" })).status, 401);
  assert.equal((await call({ path: "/api/status", headers: { Authorization: "Basic " + Buffer.from("me:bad").toString("base64") } })).status, 401);
  const ok = await call({ path: "/api/status", headers: auth });
  assert.equal(ok.status, 200); assert.equal(JSON.parse(ok.body).actual, true);
  assert.equal((await call({ path: "/", headers: auth })).body, "<h1>hi</h1>");
  assert.equal((await call({ path: "/../secret.txt", headers: auth })).status, 404);
  assert.equal((await call({ path: "/%2e%2e/secret.txt", headers: auth })).status, 404);
  assert.equal((await call({ path: "/api/nope", headers: auth })).status, 404);
  assert.equal((await call({ method: "POST", path: "/api/venmo/preview", headers: { ...auth, "Content-Type": "application/json" } }, "x".repeat(500))).status, 413);
  srv.closeAllConnections?.(); srv.close();
});

test("loan: home value and mortgage can come from Actual accounts", async () => {
  const { h, actual, settings } = make();
  actual.d.accounts.push({ id: "hs", name: "House", offbudget: true, closed: false, balance: 750000 }, { id: "mg", name: "Mortgage", offbudget: true, closed: false, balance: -310000 });
  const s = settings.get(); s.loan.homeValue = 1; s.loan.mortgage = 1; s.loan.homeValueAccount = "House"; s.loan.mortgageAccount = "Mortgage"; s.loan.otherLiensAccount = "Gone";
  settings.set(s);
  const r = await h["GET /api/loan"]({ query: {} });
  assert.deepEqual(r.resolved.homeValue, { value: 750000, source: "House" });
  assert.deepEqual(r.resolved.mortgage, { value: 310000, source: "Mortgage" });
  assert.equal(r.resolved.otherLiens.source, "custom");
  assert.ok(r.warnings.some((w) => /Gone/.test(w)));
  assert.equal(r.summary.maxLoanByEquity, 0.8 * 750000 - 310000);
  const accts = await h["GET /api/accounts"]({ query: {} });
  assert.ok(accts.some((a) => a.name === "Mortgage" && a.balance === -310000));
});

test("scenarios: save, list, view, load back into settings, delete", async () => {
  const { h, settings } = make();
  const s = settings.get(); s.loan.homeValue = 800000; s.loan.mortgage = 300000; s.projection.purchases = [{ month: "2027-03", amount: 90000, name: "Kitchen" }]; settings.set(s);
  await assert.rejects(h["POST /api/scenarios"]({ body: { name: " " } }), /name/i);
  const rec = await h["POST /api/scenarios"]({ body: { name: "Kitchen only" } });
  const list = await h["GET /api/scenarios"]({});
  assert.equal(list.length, 1); assert.equal(list[0].plannedTotal, 90000); assert.ok(list[0].recommended);
  const full = await h["GET /api/scenario"]({ query: { id: rec.id } });
  assert.equal(full.result.comparison.length, 3); assert.ok(full.result.series.length > 0);
  // change the planner, then load the saved scenario back
  const t = settings.get(); t.projection.purchases = []; t.loan.mortgage = 1; settings.set(t);
  await h["POST /api/scenarios/load"]({ body: { id: rec.id } });
  assert.equal(settings.get().projection.purchases[0].amount, 90000); assert.equal(settings.get().loan.mortgage, 300000);
  await h["POST /api/scenarios/delete"]({ body: { id: rec.id } });
  assert.equal((await h["GET /api/scenarios"]({})).length, 0);
  await assert.rejects(h["GET /api/scenario"]({ query: { id: "nope" } }), /not found/i);
});

test("loan: payoff strategies come back with the result", async () => {
  const { h, settings } = make();
  const s = settings.get(); s.loan.homeValue = 800000; s.loan.mortgage = 300000; s.loan.payoffBudgetPct = 0.5;
  s.projection.purchases = [{ month: "2027-03", amount: 90000, name: "Kitchen" }]; settings.set(s);
  const r = await h["GET /api/loan"]({ query: { product: "Personal loan" } });
  assert.ok(r.payoff.plans.length >= 2);
  assert.ok(Math.abs(r.payoff.budgetCap - 0.5 * r.assumptions.monthlySurplus) < 1e-6);
  const min = r.payoff.plans.find((p) => p.key === "minimum");
  assert.ok(Math.abs(min.totalInterest - r.summary.totalInterest) < 1);
  assert.ok(r.payoff.plans.every((p) => !p.balances || p.key === "minimum" || p.key === r.payoff.bestKey));
});
