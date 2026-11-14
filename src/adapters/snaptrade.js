// SnapTrade via the official SDK. Written against the SDK's public README; the response shapes are read defensively
// because they differ between SDK versions. Use the "Show response shape" button if anything looks wrong.
import fs from "node:fs";
import path from "node:path";
import { normalizeSnapTrade } from "../lib/investments.js";

const unwrap = (r) => (r && typeof r === "object" && !Array.isArray(r) && "data" in r && r.data !== undefined ? r.data : r);

export function describeError(e) {
  const body = e?.responseBody ?? e?.response?.data ?? e?.body;
  const status = e?.status ?? e?.response?.status;
  return [e?.message || String(e), status ? `HTTP ${status}` : "", body ? JSON.stringify(body).slice(0, 300) : ""].filter(Boolean).join(" - ");
}

// Structure of a value with every actual value removed (only key names and types), safe to share when debugging.
export function shape(v, depth = 0) {
  if (v === null) return "null";
  if (Array.isArray(v)) return { _array: v.length, item: v.length ? shape(v[0], depth + 1) : "empty" };
  if (typeof v === "object") return depth >= 6 ? "object" : Object.fromEntries(Object.keys(v).map((k) => [k, shape(v[k], depth + 1)]));
  return typeof v;
}

export class SnapTradeAdapter {
  constructor({ clientId, consumerKey, userFile, userId = "household", loadSdk }) {
    Object.assign(this, { clientId, consumerKey, userFile, userId });
    this.loadSdk = loadSdk || (() => import("snaptrade-typescript-sdk"));
  }
  configured() { return !!(this.clientId && this.consumerKey); }
  async _sdk() {
    if (!this.sdk) {
      const m0 = await this.loadSdk();
      const m = m0.Snaptrade ? m0 : (m0.default || m0);
      
      if (m.SnaptradeAuth?.personalApiKey) {
        this.isPersonalKey = true;
        this.sdk = new m.Snaptrade({
          auth: m.SnaptradeAuth.personalApiKey({
            clientId: this.clientId,
            consumerKey: this.consumerKey,
          }),
        });
      } else if (m.SnaptradeAuth?.commercialApiKey) {
        this.sdk = new m.Snaptrade({
          auth: m.SnaptradeAuth.commercialApiKey({
            clientId: this.clientId,
            consumerKey: this.consumerKey,
          }),
        });
      } else {
        this.sdk = new m.Snaptrade({
          clientId: this.clientId,
          consumerKey: this.consumerKey,
        });
      }
    }
    return this.sdk;
  }
  _user() { return fs.existsSync(this.userFile) ? JSON.parse(fs.readFileSync(this.userFile, "utf8")) : null; }
  async _ensureUser() {
    let u = this._user();
    if (u) return u;
    const sdk = await this._sdk();
    if (this.isPersonalKey) return {};
    const r = unwrap(await sdk.authentication.registerSnapTradeUser({ userId: this.userId }));
    if (!r?.userSecret) throw new Error("SnapTrade did not return a user secret. If this user was registered before, delete it in the SnapTrade dashboard and try again.");
    u = { userId: r.userId || this.userId, userSecret: r.userSecret };
    fs.mkdirSync(path.dirname(this.userFile), { recursive: true });
    fs.writeFileSync(this.userFile, JSON.stringify(u), { mode: 0o600 });
    return u;
  }
  connected() { return !!this._user(); }

  async connectUrl() {
    try {
      const sdk = await this._sdk(), u = await this._ensureUser();
      const creds = await this._ensureUser();
      const r = unwrap(await sdk.authentication.loginSnapTradeUser(creds));
      const url = typeof r === "string" ? r : r?.redirectURI || r?.redirect_uri;
      if (!url) throw new Error("SnapTrade returned no connection URL.");
      return url;
    } catch (e) { throw new Error(describeError(e)); }
  }

  async _fetchRaw() {
    const sdk = await this._sdk(), u = await this._ensureUser();
    const creds = await this._ensureUser();
    const list = unwrap(await sdk.accountInformation.listUserAccounts(creds));
    const accounts = Array.isArray(list) ? list : list?.results || [];
    const out = [];
    for (const a of accounts) {
      const id = a.id ?? a.account_id, call = { accountId: id, ...creds };
      const ai = sdk.accountInformation;
      let balances = null, positions = null, holdings = null;
      if (ai.getUserAccountBalance) balances = unwrap(await ai.getUserAccountBalance(call));
      if (ai.getAllAccountPositions) positions = unwrap(await ai.getAllAccountPositions(call));
      else if (ai.getUserAccountPositions) positions = unwrap(await ai.getUserAccountPositions(call));
      if (!positions && ai.getUserHoldings) holdings = unwrap(await ai.getUserHoldings(call)); // deprecated; 410 for new customers
      out.push({ account: a, id, balances, positions, holdings });
    }
    return out;
  }
  async fetchAll() {
    try {
      const raw = await this._fetchRaw();
      const holds = {};
      for (const r of raw) {
        const h = r.holdings || {};
        const pos = r.positions;
        holds[r.id] = { ...h, positions: h.positions || (Array.isArray(pos) ? pos : pos?.results || pos?.positions || []), balances: r.balances ? (Array.isArray(r.balances) ? r.balances : [r.balances]) : h.balances || [] };
      }
      return normalizeSnapTrade(raw.map((r) => ({ ...r.account, id: r.id })), holds);
    } catch (e) { throw new Error(describeError(e)); }
  }
  // Key names and types only - no balances, names or ids - so it can be shared when something does not parse.
  async responseShape() {
    try { const raw = await this._fetchRaw(); return raw.slice(0, 2).map((r) => shape({ account: r.account, balances: r.balances, positions: r.positions, holdings: r.holdings })); }
    catch (e) { throw new Error(describeError(e)); }
  }
}
