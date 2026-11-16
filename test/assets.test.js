import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AssetStore } from "../src/lib/assets.js";
import { createSnapshotJob, SnapshotState, localDate } from "../src/lib/schedule.js";
import { createHandlers } from "../src/app.js";
import { SettingsStore } from "../src/config.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "assets-"));

test("assets: values keep history, same-day entry replaces, series carries values forward", () => {
  const s = new AssetStore(path.join(tmp(), "a.json"));
  const home = s.upsert({ name: "House", type: "home" }), rv = s.upsert({ name: "Camper", type: "camper" });
  s.setValue(home.id, { date: "2026-01-01", value: 600000 });
  s.setValue(rv.id, { date: "2026-02-01", value: 40000 });
  s.setValue(home.id, { date: "2026-03-01", value: 610000 });
  s.setValue(home.id, { date: "2026-03-01", value: 615000 }); // replaces
  const v = s.view("2026-03-11");
  assert.deepEqual(v.series.map((p) => [p.date, p.total]), [["2026-01-01", 600000], ["2026-02-01", 640000], ["2026-03-01", 655000]]);
  const h = v.assets.find((a) => a.name === "House");
  assert.equal(h.current.value, 615000); assert.equal(h.changeSincePrevious, 15000); assert.equal(h.daysOld, 10);
  s.removeValue(home.id, "2026-03-01");
  assert.equal(s.view("2026-03-11").assets.find((a) => a.name === "House").current.value, 600000);
});

test("assets: validation", () => {
  const s = new AssetStore(path.join(tmp(), "a.json"));
  assert.throws(() => s.upsert({ name: "", type: "home" }), /name/);
  assert.throws(() => s.upsert({ name: "X", type: "boat" }), /Type/);
  const a = s.upsert({ name: "Truck", type: "vehicle" });
  assert.throws(() => s.upsert({ name: "truck", type: "vehicle" }), /already/);
  assert.throws(() => s.setValue(a.id, { date: "tomorrow", value: 1 }), /Date/);
  assert.throws(() => s.setValue(a.id, { date: "2026-01-01", value: -5 }), /Value/);
  assert.throws(() => s.setValue(a.id, { date: "2026-01-01", value: "" }), /Value/);
});

test("schedule: runs once per local day after the set time, retries after a failure, respects enabled", async () => {
  const state = new SnapshotState(path.join(tmp(), "s.json"));
  let at = new Date(2026, 10, 16, 23, 54), calls = 0, fail = false, enabled = true;
  const job = createSnapshotJob({ run: async () => { calls++; if (fail) throw new Error("boom"); return { ok: 1 }; }, getSettings: () => ({ enabled, time: "23:55" }), state, now: () => at, log: {} });
  await job.tick(); assert.equal(calls, 0, "before the time");
  at = new Date(2026, 10, 16, 23, 55); fail = true; await job.tick(); assert.equal(calls, 1);
  assert.equal(state.read().lastError.message, "boom"); assert.equal(state.read().lastRunDate, undefined);
  fail = false; at = new Date(2026, 10, 16, 23, 56); await job.tick(); assert.equal(calls, 2, "retried");
  await job.tick(); assert.equal(calls, 2, "not twice in a day");
  assert.equal(state.read().lastRunDate, localDate(at));
  at = new Date(2026, 10, 17, 23, 56); enabled = false; await job.tick(); assert.equal(calls, 2, "disabled");
  enabled = true; await job.tick(); assert.equal(calls, 3, "next day");
});

test("runSnapshot records investments and values of Actual-linked assets", async () => {
  const dir = tmp(), recorded = [];
  const assets = new AssetStore(path.join(dir, "a.json")), home = assets.upsert({ name: "House", type: "home", actualAccount: "House (Actual)" }), car = assets.upsert({ name: "Car", type: "vehicle" });
  const h = createHandlers({
    actual: { getAccounts: async () => [{ id: "1", name: "House (Actual)", balance: 640000 }] },
    snaptrade: { configured: () => true, fetchAll: async () => [{ accountId: "x", name: "IRA", balance: 1000, source: "snaptrade" }] },
    store: { record: (d, a) => recorded.push([d, a.length]) }, settings: new SettingsStore(path.join(dir, "s.json")), scenarios: null, assets, snapshotState: new SnapshotState(path.join(dir, "st.json")), simplefin: {},
    now: () => new Date(2026, 10, 16, 23, 55),
  });
  const r = await h.runSnapshot();
  assert.deepEqual(recorded, [["2026-11-16", 1]]); assert.equal(r.investments, 1); assert.equal(r.assets, 1);
  assert.equal(assets.view("2026-11-16").assets.find((a) => a.id === home.id).current.value, 640000);
  assert.equal(assets.view("2026-11-16").assets.find((a) => a.id === car.id).current, null);
});
