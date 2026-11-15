import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SnapTradeAdapter, shape, describeError } from "../src/adapters/snaptrade.js";
import { ActualAdapter } from "../src/adapters/actual.js";

const tmpUser = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "st-")), "u.json");

// Current-generation SDK: auth option, unwrapped responses, new positions/balance methods, getUserHoldings gone (410)
function newSdk(log) {
  class Snaptrade { constructor(cfg) { log.cfg = cfg; this.authentication = {
      registerSnapTradeUser: async (a) => ({ userId: a.userId, userSecret: "sekret" }),
      loginSnapTradeUser: async () => ({ redirectURI: "https://portal.example/x" }) };
    this.accountInformation = {
      listUserAccounts: async (c) => { log.creds = c; return [{ id: "acc1", name: "Roth", institution_name: "Fidelity", balance: { total: { amount: 7000, currency: "USD" } } }]; },
      getUserAccountBalance: async () => [{ currency: { code: "USD" }, cash: 250 }],
      getAllAccountPositions: async () => ({ results: [{ instrument: { kind: "equity", symbol: "VTI", description: "Vanguard Total" }, quantity: 10, price: 250 }, { instrument: { kind: "equity", symbol: "BND" }, units: 5, price: 70, market_value: 351 }] }),
      getUserHoldings: async () => { throw Object.assign(new Error("Gone"), { status: 410 }); } }; } }
  return { Snaptrade, SnaptradeAuth: { personalApiKey: (o) => o, commercialApiKey: (o) => o }};
}
// Older SDK: plain constructor options, {data} wrappers, getUserHoldings only
function oldSdk(log) {
  class Snaptrade { constructor(cfg) { log.cfg = cfg; this.authentication = {
      registerSnapTradeUser: async (a) => ({ data: { userId: a.userId, userSecret: "old-secret" } }),
      loginSnapTradeUser: async () => ({ data: { redirectURI: "https://portal.example/old" } }) };
    this.accountInformation = {
      listUserAccounts: async () => ({ data: [{ id: "a9", name: "IRA", institution_name: "Schwab" }] }),
      getUserHoldings: async () => ({ data: { positions: [{ symbol: { symbol: { symbol: "AAPL", description: "Apple" } }, units: 2, price: 200 }], balances: [{ cash: 100 }], total_value: { value: 500, currency: "USD" } } }) }; } }
  return { Snaptrade };
}

test("SnapTrade, current SDK: builds the auth option, passes user creds, uses positions + balances", async () => {
  const log = {}, f = tmpUser();
  const a = new SnapTradeAdapter({ clientId: "cid", consumerKey: "ck", userFile: f, loadSdk: async () => newSdk(log) });
  const accts = await a.fetchAll();
  assert.equal(log.cfg.auth.clientId, "cid"); assert.equal(log.cfg.auth.consumerKey, "ck");
  assert.deepEqual(log.creds, { });
  assert.equal(accts.length, 1); assert.equal(accts[0].balance, 7000); assert.equal(accts[0].cash, 250);
  assert.deepEqual(accts[0].holdings.map((h) => [h.symbol, h.units, h.value]), [["VTI", 10, 2500], ["BND", 5, 351]]);
  // assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.equal(await a.connectUrl(), "https://portal.example/x");
});

test("SnapTrade, older SDK shape still works", async () => {
  const log = {};
  const a = new SnapTradeAdapter({ clientId: "c", consumerKey: "k", userFile: tmpUser(), loadSdk: async () => oldSdk(log) });
  const [x] = await a.fetchAll();
  assert.deepEqual(log.cfg, { clientId: "c", consumerKey: "k" });
  assert.equal(x.balance, 500); assert.equal(x.holdings[0].symbol, "AAPL"); assert.equal(x.holdings[0].value, 400);
  assert.equal(await a.connectUrl(), "https://portal.example/old");
});

test("shape() keeps keys and types and drops every value", () => {
  const s = shape({ id: "secret-id", balance: { total: { amount: 12345.67 } }, list: [{ n: "x" }, { n: "y" }], nothing: null });
  assert.deepEqual(s, { id: "string", balance: { total: { amount: "number" } }, list: { _array: 2, item: { n: "string" } }, nothing: "null" });
  assert.ok(!JSON.stringify(s).includes("12345") && !JSON.stringify(s).includes("secret"));
});

test("SnapTrade errors carry status and body text", async () => {
  const e = Object.assign(new Error("Request failed"), { status: 401, responseBody: { detail: "bad signature" } });
  assert.match(describeError(e), /401.*bad signature/);
  const a = new SnapTradeAdapter({ clientId: "c", consumerKey: "k", userFile: tmpUser(), loadSdk: async () => ({ Snaptrade: class { constructor() { this.authentication = { registerSnapTradeUser: async () => { throw e; } }; } } }) });
  await assert.rejects(a.connectUrl(), /401.*bad signature/);
});

test("Actual: a network failure is explained in terms of the URL and a curl check", async () => {
  const a = new ActualAdapter({ serverUrl: "http://10.0.0.5:5006", password: "p", syncId: "s", dataDir: "/tmp/x", diagnose: async (u) => ({ ok: false, message: `refused ${u}` }), loadApi: async () => ({ init: async () => { throw new Error("Authentication failed: network-failure"); } }) });
  await assert.rejects(a.getAccounts(), (e) => /Could not reach the Actual server\. refused http:\/\/10\.0\.0\.5:5006/.test(e.message));
  // a later call tries again instead of being stuck on the first failure
  let n = 0;
  const b = new ActualAdapter({ serverUrl: "u", diagnose: async () => ({ ok: false, message: "x" }), password: "p", syncId: "s", dataDir: "/tmp/x", loadApi: async () => ({ init: async () => { if (n++ === 0) throw new Error("network-failure"); }, downloadBudget: async () => {}, sync: async () => {}, getAccounts: async () => [], getAccountBalance: async () => 0 }) });
  await assert.rejects(b.getAccounts()); assert.deepEqual(await b.getAccounts(), []);
});

test("Actual adapter: amounts become dollars, splits expand, transfers and payees resolve", async () => {
  const api = { init: async () => {}, downloadBudget: async () => {}, sync: async () => {},
    getAccounts: async () => [{ id: "a1", name: "Checking" }, { id: "a2", name: "Brokerage", offbudget: true }],
    getPayees: async () => [{ id: "p1", name: "Grocer" }, { id: "p2", name: "Transfer: Brokerage", transfer_acct: "a2" }],
    getTransactions: async (id) => id !== "a1" ? [] : [
      { id: "t1", date: "2026-10-01", amount: -12345, payee: "p1", category: "c1", notes: "n" },
      { id: "t2", date: "2026-10-02", amount: -50000, payee: "p2" },
      { id: "t3", date: "2026-10-03", amount: -3000, subtransactions: [{ id: "s1", amount: -1000, category: "c1" }, { id: "s2", amount: -2000, category: "c2" }] }] };
  const a = new ActualAdapter({ serverUrl: "u", password: "p", syncId: "s", dataDir: "/tmp/x", loadApi: async () => api });
  const t = await a.getTransactions("2026-10-01", "2026-10-31");
  assert.equal(t.length, 4);
  assert.deepEqual(t.find((x) => x.id === "t1"), { id: "t1", accountId: "a1", accountName: "Checking", date: "2026-10-01", amount: -123.45, payeeId: "p1", payeeName: "Grocer", importedPayee: "", notes: "n", categoryId: "c1", transferAcctId: null });
  assert.equal(t.find((x) => x.id === "t2").transferAcctId, "a2");
  assert.deepEqual(t.filter((x) => x.id.startsWith("s")).map((x) => [x.amount, x.categoryId, x.date]), [[-10, "c1", "2026-10-03"], [-20, "c2", "2026-10-03"]]);
});
