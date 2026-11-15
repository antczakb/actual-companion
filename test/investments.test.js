import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SnapshotStore, normalizeSnapTrade } from "../src/lib/investments.js";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "inv-")), "inv.json");

test("snapshots: same-day record replaces, latest and carried-forward series, holdings roll up", () => {
  const f = tmp(); const s = new SnapshotStore(f);
  s.record("2026-11-01", [{ accountId: "a", name: "IRA", balance: 1000, holdings: [{ symbol: "VTI", units: 4, value: 1000 }] }, { accountId: "b", name: "Brokerage", balance: 500, holdings: [{ symbol: "VTI", units: 2, value: 500 }] }]);
  s.record("2026-11-08", [{ accountId: "a", name: "IRA", balance: 1100, holdings: [{ symbol: "VTI", units: 4, value: 1100 }] }]);
  s.record("2026-11-08", [{ accountId: "a", name: "IRA", balance: 1200, holdings: [{ symbol: "VTI", units: 4, value: 1200 }] }]); // replaces
  assert.deepEqual(s.series().map((x) => [x.date, x.total]), [["2026-11-01", 1500], ["2026-11-08", 1700]]);
  assert.deepEqual(s.series()[1].parts, [{ name: "IRA", balance: 1200 }, { name: "Brokerage", balance: 500 }]);
  assert.equal(s.latest().length, 2);
  assert.deepEqual(s.holdings().map((h) => [h.symbol, h.units, h.value]), [["VTI", 6, 1700]]);
  assert.equal(new SnapshotStore(f).data.snapshots.length, 3); // persisted
});

test("SnapTrade normalizing handles nested symbol shapes, cash and totals", () => {
  const accounts = [{ id: "acc1", name: "Roth IRA", institution_name: "Fidelity", balance: { total: { amount: 5000, currency: "USD" } } }, { id: "acc2", name: "Taxable", institution_name: "Schwab" }];
  const holds = {
    acc1: { positions: [{ symbol: { symbol: { symbol: "VTI", description: "Vanguard Total Market" } }, units: 10, price: 250 }, { symbol: { symbol: "AAPL" }, units: 2.5, price: 200 }], balances: [{ cash: 100 }] },
    acc2: { positions: [{ symbol: { raw_symbol: "BND" }, units: 1, price: 70 }], balances: [{ cash: 30 }] },
  };
  const [a, b] = normalizeSnapTrade(accounts, holds);
  assert.equal(a.balance, 5000); assert.equal(a.holdings[0].symbol, "VTI"); assert.equal(a.holdings[0].value, 2500); assert.equal(a.holdings[1].symbol, "AAPL"); assert.equal(a.holdings[1].value, 500); assert.equal(a.cash, 100);
  assert.equal(b.balance, 100); // no reported total: positions + cash
  assert.equal(b.institution, "Schwab");
});
