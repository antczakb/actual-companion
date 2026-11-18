import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHandlers } from "../src/app.js";
import { SettingsStore } from "../src/config.js";
import { SnapshotStore } from "../src/lib/investments.js";
import { ScenarioStore } from "../src/lib/scenarios.js";
import { AssetStore } from "../src/lib/assets.js";
import { BalanceStore, guessKind, effective, balancesFromSimpleFIN } from "../src/lib/networth.js";
import { FakeActual } from "./fakes.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "nw-"));

test("guessKind and effective signs", () => {
  assert.equal(guessKind("Home Mortgage", "Bank"), "loan");
  assert.equal(guessKind("Sapphire Preferred", "Chase"), "credit");
  assert.equal(guessKind("Roth IRA", "Fidelity"), "investment");
  assert.equal(guessKind("Everyday Checking", "Credit Union"), "cash");
  assert.equal(effective("credit", 500), -500);
  assert.equal(effective("loan", -900), -900);
  assert.equal(effective("cash", 10), 10);
  assert.equal(effective("ignore", 10), 0);
});

test("balances view: groups, net worth, series, same-day replace", () => {
  const b = new BalanceStore(path.join(tmp(), "b.json"));
  b.record("2026-10-01", [{ id: "a", name: "Checking", balance: 1000 }, { id: "c", name: "Visa card", balance: 300 }]);
  b.record("2026-10-02", [{ id: "a", name: "Checking", balance: 1500 }]);
  b.record("2026-10-02", [{ id: "a", name: "Checking", balance: 2000 }]);
  const v = b.view({}, [{ date: "2026-10-01", total: 400000, parts: [] }]);
  assert.equal(v.netWorth, 2000 - 300 + 400000);
  assert.equal(v.debts, -300);
  assert.equal(v.series.length, 2);
  assert.equal(v.series[1].total, 2000 - 300 + 400000); // card carried forward, home carried forward
  assert.equal(v.unconfirmed, 2);
  const w = b.view({ c: "ignore" });
  assert.equal(w.netWorth, 2000);
  assert.equal(w.unconfirmed, 1);
});

test("balancesFromSimpleFIN", () => {
  const r = balancesFromSimpleFIN({ accounts: [{ id: 1, name: "X", org: { name: "B" }, balance: "12.5" }, { id: 2, name: "bad", balance: "n/a" }] });
  assert.deepEqual(r, [{ id: "1", name: "X", org: "B", balance: 12.5, currency: "USD" }]);
});

test("positionsHistory: bought, sold, opened, closed per account", () => {
  const s = new SnapshotStore(path.join(tmp(), "i.json"));
  const h = (sym, units, price) => ({ symbol: sym, description: sym, units, price, value: units * price });
  s.record("2026-10-01", [{ accountId: "x", name: "IRA", balance: 0, holdings: [h("VTI", 10, 100), h("OLD", 5, 10)] }]);
  s.record("2026-10-02", [{ accountId: "x", name: "IRA", balance: 0, holdings: [h("VTI", 12, 100), h("NEW", 3, 20)] }]);
  s.record("2026-10-03", [{ accountId: "x", name: "IRA", balance: 0, holdings: [h("VTI", 11, 100), h("NEW", 3, 20)] }]);
  const { activity, positions } = s.positionsHistory();
  const w = (sym, what) => activity.find((a) => a.symbol === sym && a.what === what);
  assert.ok(w("VTI", "Bought")); assert.ok(w("VTI", "Sold")); assert.ok(w("NEW", "Opened")); assert.ok(w("OLD", "Closed"));
  assert.equal(w("VTI", "Bought").change, 2);
  assert.equal(positions.find((p) => p.symbol === "VTI").history.length, 3);
});

function mk(fetchImpl) {
  const dir = tmp();
  const balances = new BalanceStore(path.join(dir, "b.json"));
  const settings = new SettingsStore(path.join(dir, "s.json"));
  const d = { actual: new FakeActual({ accounts: [], categories: [], txns: [], budget: new Map(), payees: [] }), snaptrade: null, store: new SnapshotStore(path.join(dir, "i.json")), settings, scenarios: new ScenarioStore(path.join(dir, "sc.json")), balances, assets: new AssetStore(path.join(dir, "a.json")), simplefin: { accessUrl: "http://u:p@x/simplefin", fetchImpl }, now: () => new Date("2026-11-14T12:00:00Z") };
  return { h: createHandlers(d), balances };
}
const sf = async () => ({ ok: true, json: async () => ({ errors: [], accounts: [{ id: "A", name: "Savings", org: { name: "Bank" }, balance: "500.00" }, { id: "B", name: "Visa card", org: { name: "Bank" }, balance: "-200.00" }] }) });

test("networth routes: refresh, view, classify", async () => {
  const { h } = mk(sf);
  const r = await h["POST /api/networth/refresh"]({});
  assert.equal(r.accounts, 2);
  let v = await h["GET /api/networth"]({});
  assert.equal(v.netWorth, 300);
  await h["POST /api/networth/kinds"]({ body: { id: "B", kind: "ignore" } });
  v = await h["GET /api/networth"]({});
  assert.equal(v.netWorth, 500);
  await assert.rejects(h["POST /api/networth/kinds"]({ body: { id: "B", kind: "bogus" } }), /Kind must be/);
});

test("runSnapshot also records SimpleFIN balances", async () => {
  const { h, balances } = mk(sf);
  await h.runSnapshot();
  assert.equal(balances.latest().length, 2);
});

test("assets count toward net worth even before any SimpleFIN balances", () => {
  const v = new BalanceStore(path.join(tmp(), "b.json")).view({}, [{ date: "2026-10-01", total: 700000, parts: [] }]);
  assert.equal(v.netWorth, 700000);
  assert.equal(v.groups[0].name, "Home, vehicles, camper");
  assert.equal(v.series.length, 1);
});
