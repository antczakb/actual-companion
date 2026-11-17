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

import { extractValue, parseWatchId, ChangeDetectionAdapter } from "../src/adapters/changedetection.js";

test("changedetection: value extraction and watch id parsing", () => {
  assert.equal(extractValue("Zestimate\n$641,250\nRent $2,900", null), 641250);
  assert.equal(extractValue("Value: 29,500 USD", String.raw`Value:\s*([0-9,]+)`), 29500);
  assert.equal(extractValue("nothing here", null), null);
  assert.throws(() => extractValue("x", "("), /regular expression/);
  assert.equal(parseWatchId("http://cd:5000/edit/4F1C2A9E-1234-4abc-8def-0123456789ab?x=1"), "4f1c2a9e-1234-4abc-8def-0123456789ab");
  assert.equal(parseWatchId("not an id"), null);
});

test("changedetection: adapter errors are readable", async () => {
  const mk = (status, body = "") => new ChangeDetectionAdapter({ baseUrl: "http://cd:5000/", apiKey: "k", fetchImpl: async (u, o) => { assert.equal(o.headers["x-api-key"], "k"); assert.match(u, /^http:\/\/cd:5000\/api\/v1\/watch\/abc\/history\/latest$/); return { status, ok: status < 300, text: async () => body }; } });
  assert.equal(await mk(200, "$5").latestText("abc"), "$5");
  await assert.rejects(mk(403).latestText("abc"), /rejected the API key/);
  await assert.rejects(mk(404).latestText("abc"), /no snapshot/);
  await assert.rejects(new ChangeDetectionAdapter({}).latestText("abc"), /not configured/);
});

test("fetching a watched value: records it, holds back a wild jump, reports a missing number", async () => {
  const dir = tmp(), assets = new AssetStore(path.join(dir, "a.json")); let text = "Home value $641,000";
  const a = assets.upsert({ name: "House", type: "home", watchId: "4f1c2a9e-1234-4abc-8def-0123456789ab" });
  assets.setValue(a.id, { date: "2026-10-01", value: 630000 });
  const h = createHandlers({ actual: {}, snaptrade: null, store: {}, settings: new SettingsStore(path.join(dir, "s.json")), scenarios: null, assets, snapshotState: null, simplefin: {},
    changedetection: { configured: () => true, latestText: async () => text }, now: () => new Date(2026, 10, 16, 23, 55) });
  assert.equal((await h["POST /api/assets/fetch"]({ body: { id: a.id } })).value, 641000);
  assert.equal(assets.view("2026-11-16").assets[0].current.source, "changedetection");
  text = "Home value $64,100"; // scraper grabbed a wrong number
  await assert.rejects(h["POST /api/assets/fetch"]({ body: { id: a.id } }), /not saved/);
  assert.equal(assets.view("2026-11-16").assets[0].current.value, 641000);
  assert.equal(assets.view("2026-11-16").assets[0].lastFetch.ok, false);
  text = "no numbers"; await assert.rejects(h["POST /api/assets/fetch"]({ body: { id: a.id } }), /No dollar amount/);
  await assert.rejects(h["POST /api/assets"]({ body: { name: "X", type: "home", watchId: "nope" } }), /watch ID/);
});

import { computeEstimate, validateEstimate } from "../src/lib/estimate.js";
import { FredAdapter } from "../src/adapters/fred.js";

test("estimates: depreciation ages a value, index scales it, validation is strict", async () => {
  const dep = validateEstimate({ method: "depreciation", baseValue: 30000, baseDate: "2025-11-16", annualRate: 0.15 });
  assert.equal((await computeEstimate(dep, "2026-11-16", null)).value, Math.round(30000 * Math.pow(0.85, 365 / 365.25)));
  const fred = { observation: async (s, on) => (on ? { date: "2025-10-01", value: 400 } : { date: "2026-07-01", value: 420 }) };
  const idx = validateEstimate({ method: "index", baseValue: 600000, baseDate: "2025-11-01", series: "USSTHPI" });
  const r = await computeEstimate(idx, "2026-11-16", fred);
  assert.equal(r.value, 630000); assert.match(r.detail, /5\.0%/);
  assert.equal(validateEstimate(null), null);
  assert.throws(() => validateEstimate({ method: "magic" }), /method/);
  assert.throws(() => validateEstimate({ method: "index", baseValue: 1, baseDate: "2025-01-01", series: "bad id!" }), /series/);
  assert.throws(() => validateEstimate({ method: "depreciation", baseValue: 1, baseDate: "2025-01-01", annualRate: 2 }), /depreciation/);
});

test("fred adapter: picks the newest numeric value, skips missing dots, readable errors", async () => {
  const mk = (status, body) => new FredAdapter({ apiKey: "k", fetchImpl: async (u) => { assert.match(u, /series_id=USSTHPI/); return { status, ok: status < 300, json: async () => body }; } });
  assert.deepEqual(await mk(200, { observations: [{ date: "2026-10-01", value: "." }, { date: "2026-07-01", value: "401.5" }] }).observation("USSTHPI"), { date: "2026-07-01", value: 401.5 });
  await assert.rejects(mk(400, {}).observation("USSTHPI"), /rejected/);
  await assert.rejects(mk(200, { observations: [] }).observation("USSTHPI"), /no values/);
  await assert.rejects(new FredAdapter({}).observation("USSTHPI"), /not configured/);
  await assert.rejects(mk(200, {}).observation("bad id"), /looks wrong/);
});

test("estimate recorded on demand and by the nightly job only when the last estimate is a week old", async () => {
  const dir = tmp(), assets = new AssetStore(path.join(dir, "a.json"));
  const a = assets.upsert({ name: "Truck", type: "vehicle", estimate: { method: "depreciation", baseValue: 30000, baseDate: "2026-01-01", annualRate: 0.12 } });
  let day = 16;
  const h = createHandlers({ actual: {}, snaptrade: null, store: {}, settings: new SettingsStore(path.join(dir, "s.json")), scenarios: null, assets, snapshotState: null, simplefin: {}, fred: null, now: () => new Date(2026, 10, day, 23, 55) });
  const r = await h["POST /api/assets/estimate"]({ body: { id: a.id } });
  assert.ok(r.value > 25000 && r.value < 27500);
  assert.equal(assets.view("2026-11-16").assets[0].current.source, "estimate");
  const s1 = await h.runSnapshot(); assert.equal(s1.assets, 0, "same week: not recorded again");
  day = 24; const s2 = await h.runSnapshot(); assert.equal(s2.assets, 1);
  assert.equal(assets.view("2026-11-24").assets[0].values.length, 2);
});
