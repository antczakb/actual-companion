import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseUrl } from "../src/lib/diagnose.js";
const failing = (code, causeMsg) => async () => { const e = new TypeError("fetch failed"); e.cause = { code, message: causeMsg }; throw e; };
test("ok", async () => { const r = await diagnoseUrl("http://x:5006", { fetchImpl: async () => ({ status: 200 }) }); assert.equal(r.ok, true); });
test("refused", async () => { const r = await diagnoseUrl("http://x:5006", { fetchImpl: failing("ECONNREFUSED") }); assert.equal(r.code, "ECONNREFUSED"); assert.match(r.message, /nothing is listening/); });
test("dns", async () => { const r = await diagnoseUrl("https://financials.homelab/", { fetchImpl: failing("ENOTFOUND") }); assert.match(r.message, /does not resolve/); });
test("cert", async () => { const r = await diagnoseUrl("https://x", { fetchImpl: failing("SELF_SIGNED_CERT_IN_CHAIN") }); assert.match(r.message, /NODE_EXTRA_CA_CERTS/); });
test("timeout", async () => { const r = await diagnoseUrl("http://x", { fetchImpl: async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; } }); assert.equal(r.code, "ETIMEDOUT"); });
test("bad url", async () => { assert.equal((await diagnoseUrl("192.168.0.238:5006")).code, "BAD_URL"); });

test("empty reply on http suggests https", async () => {
  const f = async (u) => { if (u.startsWith("http://")) { const e = new TypeError("fetch failed"); e.cause = { code: "UND_ERR_SOCKET" }; throw e; } return { status: 200 }; };
  const r = await diagnoseUrl("http://1.2.3.4:5006", { fetchImpl: f }); assert.equal(r.suggest, "https://1.2.3.4:5006"); assert.match(r.message, /Change ACTUAL_SERVER_URL/);
});
test("empty reply on http, https cert untrusted", async () => {
  const f = async (u) => { const e = new TypeError("fetch failed"); e.cause = { code: u.startsWith("http://") ? "UND_ERR_SOCKET" : "DEPTH_ZERO_SELF_SIGNED_CERT" }; throw e; };
  const r = await diagnoseUrl("http://1.2.3.4:5006", { fetchImpl: f }); assert.match(r.message, /ACTUAL_INSECURE_TLS=1/);
});
