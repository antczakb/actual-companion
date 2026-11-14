import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseAccessUrl, fetchSimpleFIN, toTables, getSimpleFIN } from "../src/lib/simplefin.js";

const payload = {
  errors: ["Connection to Example Bank may need attention"],
  accounts: [{
    org: { domain: "examplebank.com", name: "Example Bank", "sfin-url": "https://bank.example/sfin" }, id: "ACT-1", name: "Checking", currency: "USD",
    balance: "1234.56", "available-balance": "1200.00", "balance-date": 1763000000,
    transactions: [
      { id: "T1", posted: 1762900000, amount: "-42.50", description: "VENMO PAYMENT 1234", extra: { category: "transfer", memo: "x" } },
      { id: "T2", posted: 0, amount: "-5.00", description: "PENDING THING", pending: true, transacted_at: 1762950000 },
    ],
  }],
};

function server(handler) {
  return new Promise((res) => { const s = http.createServer(handler); s.listen(0, "127.0.0.1", () => res(s)); });
}

test("access URL credentials move into a Basic header and out of the URL", () => {
  const { base, auth } = parseAccessUrl("https://user%40x:p%3Fss@bridge.example/simplefin/");
  assert.equal(base, "https://bridge.example/simplefin");
  assert.equal(auth, "Basic " + Buffer.from("user@x:p?ss").toString("base64"));
});

test("fetch sends auth + date params; tables expose every field, nested ones dotted", async () => {
  let seen;
  const s = await server((req, res) => { seen = { url: req.url, auth: req.headers.authorization }; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(payload)); });
  const port = s.address().port;
  const data = await fetchSimpleFIN({ accessUrl: `http://u:p@127.0.0.1:${port}/simplefin`, startDate: "2026-08-01", endDate: "2026-11-01" });
  s.close();
  assert.match(seen.url, /^\/simplefin\/accounts\?start-date=\d+&end-date=\d+&pending=1$/);
  assert.equal(seen.auth, "Basic " + Buffer.from("u:p").toString("base64"));
  const t = toTables(data);
  assert.deepEqual(t.errors, payload.errors);
  assert.equal(t.transactions.rows.length, 2);
  assert.ok(t.transactions.columns.includes("extra.category") && t.transactions.columns.includes("extra.memo"));
  assert.equal(t.transactions.rows[0].id, "T1"); // newest posted first; pending (posted 0) last
  const t1 = t.transactions.rows.find((r) => r.id === "T1");
  assert.equal(t1["extra.category"], "transfer"); assert.equal(t1.posted_iso, new Date(1762900000 * 1000).toISOString()); assert.equal(t1.institution, "Example Bank");
  const t2 = t.transactions.rows.find((r) => r.id === "T2");
  assert.equal(t2.posted_iso, ""); assert.equal(t2.transacted_at_iso, new Date(1762950000 * 1000).toISOString());
  assert.ok(t.accounts.columns.includes("org.sfin-url") && t.accounts.columns.includes("balance-date_iso"));
  assert.equal(t.accounts.rows[0].transaction_count, 2);
});

test("HTTP errors are reported without leaking credentials", async () => {
  const s = await server((req, res) => { res.statusCode = 403; res.end("nope"); });
  const url = `http://secretuser:secretpass@127.0.0.1:${s.address().port}/simplefin`;
  await assert.rejects(fetchSimpleFIN({ accessUrl: url }), (e) => /403/.test(e.message) && !/secretpass|secretuser/.test(e.message));
  s.close();
});

test("cache is used inside the TTL and bypassed on refresh", async () => {
  let hits = 0;
  const s = await server((req, res) => { hits++; res.end(JSON.stringify(payload)); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sfin-"));
  const o = { accessUrl: `http://u:p@127.0.0.1:${s.address().port}/simplefin`, cachePath: path.join(dir, "c.json"), ttlHours: 6 };
  const a = await getSimpleFIN(o), b = await getSimpleFIN(o), c = await getSimpleFIN({ ...o, refresh: true });
  s.close();
  assert.equal(hits, 2); assert.equal(a.fromCache, false); assert.equal(b.fromCache, true); assert.equal(c.fromCache, false);
  assert.ok(!fs.readFileSync(o.cachePath, "utf8").includes("u:p@"));
});
