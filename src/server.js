if (process.env.ACTUAL_INSECURE_TLS === "1") { process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; console.warn("WARNING: ACTUAL_INSECURE_TLS=1 - TLS certificates are NOT verified (affects every outbound HTTPS call from this app). Use only on a trusted LAN."); }
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createHandlers } from "./app.js";
import { SettingsStore } from "./config.js";
import { SnapshotStore } from "./lib/investments.js";
import { ScenarioStore } from "./lib/scenarios.js";
import { ActualAdapter } from "./adapters/actual.js";
import { SnapTradeAdapter } from "./adapters/snaptrade.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

export function checkAuth(header, password) {
  if (!header || !header.startsWith("Basic ")) return false;
  const given = Buffer.from(header.slice(6), "base64").toString();
  const pw = given.slice(given.indexOf(":") + 1);
  const a = crypto.createHash("sha256").update(pw).digest(), b = crypto.createHash("sha256").update(password).digest();
  return crypto.timingSafeEqual(a, b);
}

export function createServer({ handlers, password, publicDir = PUBLIC, maxBody = 5 * 1024 * 1024 }) {
  return http.createServer(async (req, res) => {
    const send = (status, body, type = "application/json; charset=utf-8", extra = {}) => {
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra });
      res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    try {
      if (password && !checkAuth(req.headers.authorization, password)) return send(401, "Authentication required", "text/plain", { "WWW-Authenticate": 'Basic realm="Actual companion"' });
      const url = new URL(req.url, "http://x");
      if (url.pathname.startsWith("/api/")) {
        const h = handlers[`${req.method} ${url.pathname}`];
        if (!h) return send(404, { error: "Not found" });
        let body = null;
        if (req.method === "POST" || req.method === "PUT") {
          const chunks = []; let n = 0;
          for await (const c of req) { n += c.length; if (n > maxBody) { req.resume(); return send(413, { error: "Request too large" }, undefined, { Connection: "close" }); } chunks.push(c); }
          try { body = JSON.parse(Buffer.concat(chunks).toString() || "null"); } catch { return send(400, { error: "Body must be JSON" }); }
        }
        return send(200, await h({ query: Object.fromEntries(url.searchParams), body }));
      }
      const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const file = path.join(publicDir, rel);
      if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, "Not found", "text/plain");
      return send(200, fs.readFileSync(file), MIME[path.extname(file)] || "application/octet-stream");
    } catch (e) {
      console.error(`${req.method} ${req.url}:`, e.message);
      send(e.status || 500, { error: e.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const E = process.env, dataDir = E.DATA_DIR || "./data";
  if (!E.APP_PASSWORD && E.ALLOW_NO_AUTH !== "1") { console.error("Set APP_PASSWORD (this app shows your finances). For local testing only: ALLOW_NO_AUTH=1."); process.exit(1); }
  const handlers = createHandlers({
    actual: new ActualAdapter({ serverUrl: E.ACTUAL_SERVER_URL, password: E.ACTUAL_PASSWORD, syncId: E.ACTUAL_SYNC_ID, budgetPassword: E.ACTUAL_BUDGET_PASSWORD, dataDir: path.join(dataDir, "actual-cache") }),
    snaptrade: new SnapTradeAdapter({ clientId: E.SNAPTRADE_CLIENT_ID, consumerKey: E.SNAPTRADE_CONSUMER_KEY, userFile: path.join(dataDir, "snaptrade-user.json") }),
    store: new SnapshotStore(path.join(dataDir, "investments.json")),
    settings: new SettingsStore(path.join(dataDir, "settings.json")),
    scenarios: new ScenarioStore(path.join(dataDir, "scenarios.json")),
    simplefin: { accessUrl: E.SIMPLEFIN_ACCESS_URL, cachePath: path.join(dataDir, "simplefin-cache.json") },
  });
  const port = +E.PORT || 3000;
  createServer({ handlers, password: E.APP_PASSWORD }).listen(port, E.HOST || "0.0.0.0", () => console.log(`Actual companion listening on :${port}`));
}
