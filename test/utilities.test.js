import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseGreenButtonXml, parseUtilityCsv, parseRaleighWaterText, importFile, UtilityStore, paymentsByMonth, paymentList, matchBillPayments } from "../src/lib/utilities.js";
import { createHandlers } from "../src/app.js";
import { createServer } from "../src/server.js";
import { SettingsStore } from "../src/config.js";
import { SnapshotStore } from "../src/lib/investments.js";
import { ScenarioStore } from "../src/lib/scenarios.js";
import { AssetStore } from "../src/lib/assets.js";
import { BalanceStore } from "../src/lib/networth.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ut-"));
// Made-up samples shaped like the real provider files.
const xml = (starts) => `<?xml version="1.0"?><atom:feed xmlns:espi="http://naesb.org/espi" xmlns:atom="http://www.w3.org/2005/Atom"><atom:entry><atom:content><espi:ReadingType><espi:intervalLength>900</espi:intervalLength><espi:powerOfTenMultiplier>0</espi:powerOfTenMultiplier><espi:uom>72</espi:uom></espi:ReadingType></atom:content></atom:entry><atom:entry><atom:content><espi:IntervalBlock>${starts.map(([s, v]) => `<espi:IntervalReading><espi:timePeriod><espi:duration>900</espi:duration><espi:start>${s}</espi:start></espi:timePeriod><espi:value>${v}</espi:value></espi:IntervalReading>`).join("")}</espi:IntervalBlock></atom:content></atom:entry></atom:feed>`;
const dukeCsv = `Account Information,,,
Account Name,Test Person,,
Meter Number,000,,
,,,
Usage History,,,
Billing Cycle Date,Total kWh Used per Billing Cycle,Average kWh per Billing Cycle,Average Billing Cycle Temp
"Dec 03 - Jan 02, 2025",659,21,36 F
"Nov 04 - Dec 01, 2025",628,22,40 F
"Dec 02 - Jan 02, 2026",737,23,38 F
,,,
`;
const water = `   Account Number   1
   CITY OF RALEIGH       Bill Date    09/26/2022
   Pay This Amount     $501.35
   Due Date            10/17/2022
  METER #          AVG GALLONS/DAY             SERVICE PERIOD               CURRENT READ               PREVIOUS READ                     USAGE
  13078910                1458.6            09/06/2022 to 09/26/2022             42                          3                             39
Metered Total      $401.35
Current Activity   $451.35
`;

test("Green Button XML: Wh to kWh, grouped by local day (America/New_York)", () => {
  // 2024-10-18 04:15Z and 05:15Z are 00:15 and 01:15 EDT on the 18th; 2024-10-19 03:45Z is 23:45 EDT on the 18th; 04:15Z on the 19th is the 19th.
  const r = parseGreenButtonXml(xml([[1729224900, 320], [1729228500, 180], [1729309500, 500], [1729311300, 1000]]));
  assert.equal(r.unit, "kWh");
  assert.deepEqual(r.daily, [{ date: "2024-10-18", usage: 1 }, { date: "2024-10-19", usage: 1 }]);
  assert.throws(() => parseGreenButtonXml("<a/>"), /no meter readings/);
});

test("Duke CSV: periods across a year end, no identity fields kept", () => {
  const { bills } = parseUtilityCsv(dukeCsv, "electric");
  assert.equal(bills.length, 3);
  assert.equal(bills[0].periodStart, "2024-12-03"); assert.equal(bills[0].periodEnd, "2025-01-02"); assert.equal(bills[0].usage, 659); assert.equal(bills[0].tempF, 36);
  assert.ok(!JSON.stringify(bills).includes("Test Person"));
});

test("generic gas CSV with start, end, therms and amount", () => {
  const csv = "Service Start,Service End,Therms Used,Amount Due\n10/05/2025,11/04/2025,22,$41.20\n11/05/2025,12/04/2025,48,$75.10\n";
  const { bills } = parseUtilityCsv(csv, "gas");
  assert.deepEqual(bills.map((b) => [b.periodStart, b.periodEnd, b.usage, b.amount]), [["2025-10-05", "2025-11-04", 22, 41.2], ["2025-11-05", "2025-12-04", 48, 75.1]]);
});

test("Raleigh water text", () => {
  const b = parseRaleighWaterText(water);
  assert.equal(b.usage, 39); assert.equal(b.amount, 401.35); assert.equal(b.totalDue, 501.35); assert.equal(b.periodEnd, "2022-09-26"); assert.equal(b.dueDate, "2022-10-17"); assert.equal(b.gallons, 29172);
  assert.equal(parseRaleighWaterText("some other bill"), null);
});

test("store: replace by period, keep fields a later import lacks, year-over-year flag", () => {
  const s = new UtilityStore(path.join(tmp(), "u.json"));
  s.addBills([{ utility: "electric", periodStart: "2025-06-03", periodEnd: "2025-07-01", usage: 1000, amount: null }]);
  s.addBills([{ utility: "electric", periodStart: "2025-06-03", periodEnd: "2025-07-01", amount: 120 }]);
  const r = s.addBills([{ utility: "electric", periodStart: "2026-06-02", periodEnd: "2026-07-01", usage: 1500, amount: 190 }]);
  assert.deepEqual(r, { added: 1, updated: 0 });
  const v = s.view().electric;
  assert.equal(v.bills.length, 2); assert.equal(v.bills[0].usage, 1000); assert.equal(v.bills[0].amount, 120);
  assert.ok(Math.abs(v.bills[1].usagePctYoy - 0.5) < 1e-9); assert.equal(v.bills[1].flag, true); assert.equal(v.bills[0].flag, false);
  assert.ok(v.last12.perUnit > 0);
});

test("payments by month from Actual-style transactions", () => {
  const tx = [{ date: "2026-10-03", amount: -140.5, payeeName: "Duke Energy" }, { date: "2026-10-20", amount: -10, payeeName: "DUKE ENERGY PROGRESS" }, { date: "2026-10-04", amount: -50, payeeName: "Raleigh Water" }, { date: "2026-10-05", amount: 20, payeeName: "Duke Energy" }, { date: "2026-10-06", amount: -99, payeeName: "Duke Energy", transferAcctId: "x" }];
  assert.deepEqual(paymentsByMonth(tx, "duke"), [{ month: "2026-10", amount: 150.5 }]);
  assert.deepEqual(paymentsByMonth(tx, "((("), []);
});

test("upload route end to end through the HTTP server (raw body)", async () => {
  const dir = tmp();
  const handlers = createHandlers({ actual: { configured: () => false }, snaptrade: null, store: new SnapshotStore(path.join(dir, "i.json")), settings: new SettingsStore(path.join(dir, "s.json")), scenarios: new ScenarioStore(path.join(dir, "sc.json")), balances: new BalanceStore(path.join(dir, "b.json")), assets: new AssetStore(path.join(dir, "a.json")), utilities: new UtilityStore(path.join(dir, "u.json")), simplefin: {}, now: () => new Date("2026-11-14T12:00:00Z") });
  const srv = createServer({ handlers, password: "" }).listen(0); await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    let r = await fetch(`${base}/api/utilities/upload?name=duke.csv`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: dukeCsv });
    assert.equal(r.status, 200); assert.equal((await r.json()).added, 3);
    r = await fetch(`${base}/api/utilities/upload?name=duke.xml`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: xml([[1729224900, 320]]) });
    assert.equal((await r.json()).utility, "electric");
    r = await fetch(`${base}/api/utilities/upload?name=x.doc`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: "zzz" });
    assert.equal(r.status, 400);
    const v = await (await fetch(`${base}/api/utilities`)).json();
    assert.equal(v.utilities.electric.bills.length, 3); assert.equal(v.utilities.electric.daily.length, 1);
    assert.deepEqual(await (await fetch(`${base}/api/utilities/payments`)).json(), { configured: false, payments: {} });
  } finally { srv.close(); }
});

test("matchBillPayments: window after the period end, closest amount first, water uses the bill total too", () => {
  const tx = [{ date: "2026-10-03", amount: -140.5, payeeName: "Duke Energy", id: "a", accountId: "x" }, { date: "2026-10-30", amount: -300, payeeName: "Duke Energy", id: "b" }, { date: "2026-11-02", amount: -141, payeeName: "Duke Energy", id: "c" }, { date: "2027-02-01", amount: -140.5, payeeName: "Duke Energy", id: "d" }];
  const pays = paymentList(tx, "duke");
  assert.equal(pays[0].accountId, "x");
  assert.deepEqual(matchBillPayments({ periodEnd: "2026-10-01", amount: 140 }, pays), ["c", "a"].sort((x, y) => Math.abs(pays.find((p) => p.id === x).amount - 140) - Math.abs(pays.find((p) => p.id === y).amount - 140)));
  assert.deepEqual(matchBillPayments({ periodEnd: "2026-10-01", amount: 401.35, totalDue: 501.35 }, paymentList([{ date: "2026-10-10", amount: -501.35, payeeName: "Raleigh", id: "w" }], "raleigh")), ["w"]);
  assert.deepEqual(matchBillPayments({ periodEnd: "2026-10-01", amount: null }, pays), ["a", "b", "c"]);
});
