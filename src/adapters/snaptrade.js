// SnapTrade via the official SDK. Written from the SDK's documented method names; verify on first run (see README).
import fs from "node:fs";
import path from "node:path";
import { normalizeSnapTrade } from "../lib/investments.js";

export class SnapTradeAdapter {
  constructor({ clientId, consumerKey, userFile, userId = "household" }) { Object.assign(this, { clientId, consumerKey, userFile, userId }); }
  configured() { return !!(this.clientId && this.consumerKey); }
  async _sdk() {
    if (!this.sdk) {
      const m = await import("snaptrade-typescript-sdk");
      this.sdk = new m.Snaptrade({ clientId: this.clientId, consumerKey: this.consumerKey });
    }
    return this.sdk;
  }
  _user() { return fs.existsSync(this.userFile) ? JSON.parse(fs.readFileSync(this.userFile, "utf8")) : null; }
  async _ensureUser() {
    let u = this._user();
    if (u) return u;
    const sdk = await this._sdk();
    const r = await sdk.authentication.registerSnapTradeUser({ userId: this.userId });
    u = { userId: r.data.userId, userSecret: r.data.userSecret };
    fs.mkdirSync(path.dirname(this.userFile), { recursive: true });
    fs.writeFileSync(this.userFile, JSON.stringify(u), { mode: 0o600 });
    return u;
  }
  connected() { return !!this._user(); }
  // URL of SnapTrade's hosted portal where you link a brokerage. Open it in a browser.
  async connectUrl() {
    const sdk = await this._sdk(), u = await this._ensureUser();
    const r = await sdk.authentication.loginSnapTradeUser({ userId: u.userId, userSecret: u.userSecret });
    return r.data.redirectURI || r.data.redirect_uri;
  }
  async fetchAll() {
    const sdk = await this._sdk(), u = await this._ensureUser();
    const accounts = (await sdk.accountInformation.listUserAccounts({ userId: u.userId, userSecret: u.userSecret })).data;
    const holds = {};
    for (const a of accounts) holds[a.id] = (await sdk.accountInformation.getUserHoldings({ accountId: a.id, userId: u.userId, userSecret: u.userSecret })).data;
    return normalizeSnapTrade(accounts, holds);
  }
}
