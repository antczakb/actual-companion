// Tracked assets whose value is not a bank balance: the house, vehicles, a camper. Values are dated entries, entered by hand
// or recorded from a linked Actual account by the daily snapshot. History is kept, so you can see change over time.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { validateEstimate } from "./estimate.js";

export const ASSET_TYPES = ["home", "vehicle", "camper", "other"];
const MAX_ASSETS = 100, MAX_VALUES = 5000;
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "") && !Number.isNaN(Date.parse(d + "T00:00:00Z"));

export class AssetStore {
  constructor(file) { this.file = file; }
  _read() { try { const d = JSON.parse(fs.readFileSync(this.file, "utf8")); return Array.isArray(d.assets) ? d : { assets: [] }; } catch { return { assets: [] }; } }
  _write(d) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const tmp = this.file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(d)); fs.renameSync(tmp, this.file); }
  list() { return this._read().assets; }
  upsert({ id, name, type, actualAccount, watchId = null, valueRegex = "", estimate = null, lookupUrl = "", remind = true }) {
    const n = String(name || "").trim();
    if (!n || n.length > 60) throw bad("Give the asset a name (up to 60 characters).");
    if (!ASSET_TYPES.includes(type)) throw bad(`Type must be one of: ${ASSET_TYPES.join(", ")}.`);
    const d = this._read(), link = actualAccount ? String(actualAccount) : null;
    if (d.assets.some((a) => a.id !== id && a.name.toLowerCase() === n.toLowerCase())) throw bad(`There is already an asset named "${n}".`);
    let a = id && d.assets.find((x) => x.id === id);
    if (id && !a) throw bad("Asset not found.");
    if (!a) { if (d.assets.length >= MAX_ASSETS) throw bad(`Limit of ${MAX_ASSETS} assets reached.`); a = { id: crypto.randomUUID().slice(0, 8), values: [] }; d.assets.push(a); }
    const rx = String(valueRegex || "").trim();
    if (rx) { try { new RegExp(rx); } catch { throw bad("The value pattern is not a valid regular expression."); } }
    const lu = String(lookupUrl || "").trim();
    if (lu && !/^https?:\/\/[^\s]+$/i.test(lu)) throw bad("The lookup link must start with http:// or https://.");
    Object.assign(a, { lookupUrl: lu, remind: remind !== false, name: n, type, actualAccount: link, watchId: watchId || null, valueRegex: rx, estimate: validateEstimate(estimate) });
    this._write(d); return a;
  }
  setValue(id, { date, value, note = "", source = "manual" }) {
    if (!isDate(date)) throw bad("Date must look like 2026-11-16.");
    const v = Number(value);
    if (value === "" || value == null || !Number.isFinite(v) || v < 0) throw bad("Value must be a number, zero or more.");
    const d = this._read(), a = d.assets.find((x) => x.id === id);
    if (!a) throw bad("Asset not found.");
    a.values = a.values.filter((x) => x.date !== date);
    if (a.values.length >= MAX_VALUES) throw bad("Too many entries for this asset.");
    a.values.push({ date, value: Math.round(v * 100) / 100, note: String(note || "").slice(0, 200), source });
    a.values.sort((x, y) => x.date.localeCompare(y.date));
    this._write(d); return a;
  }
  setFetchStatus(id, status) { const d = this._read(), a = d.assets.find((x) => x.id === id); if (a) { a.lastFetch = status; this._write(d); } }
  removeValue(id, date) {
    const d = this._read(), a = d.assets.find((x) => x.id === id);
    if (!a) throw bad("Asset not found.");
    const n = a.values.filter((x) => x.date !== date);
    if (n.length === a.values.length) throw bad("No entry on that date.");
    a.values = n; this._write(d);
  }
  remove(id) { const d = this._read(), n = d.assets.filter((a) => a.id !== id); if (n.length === d.assets.length) return false; d.assets = n; this._write(d); return true; }

  // Per-asset summary plus a combined history (each asset's last known value carried forward, like the investment series).
  // Assets whose value should be re-checked by hand this month (not linked to Actual, reminders on, no hand-entered value yet this month).
  due(todayIso, reminderDay = 1) {
    const month = todayIso.slice(0, 7), day = +todayIso.slice(8, 10);
    if (day < reminderDay) return [];
    return this.list().filter((a) => a.remind !== false && !a.actualAccount && !a.values.some((v) => (v.source || "manual") !== "estimate" && v.date.slice(0, 7) === month))
      .map((a) => ({ id: a.id, name: a.name, type: a.type, lookupUrl: a.lookupUrl || "", lastManual: [...a.values].reverse().find((v) => (v.source || "manual") === "manual")?.date || null }));
  }
  view(todayIso) {
    const assets = this.list().map((a) => {
      const vals = a.values, cur = vals.at(-1) || null, prev = vals.length > 1 ? vals.at(-2) : null, first = vals[0] || null;
      const days = cur && todayIso ? Math.round((Date.parse(todayIso + "T00:00:00Z") - Date.parse(cur.date + "T00:00:00Z")) / 864e5) : null;
      return { id: a.id, name: a.name, type: a.type, actualAccount: a.actualAccount, lookupUrl: a.lookupUrl || "", remind: a.remind !== false, watchId: a.watchId || null, estimate: a.estimate || null, valueRegex: a.valueRegex || "", lastFetch: a.lastFetch || null, current: cur, changeSincePrevious: cur && prev ? cur.value - prev.value : null,
        changeSinceFirst: cur && first && vals.length > 1 ? cur.value - first.value : null, firstDate: first?.date || null, daysOld: days, values: vals };
    });
    const dates = [...new Set(assets.flatMap((a) => a.values.map((v) => v.date)))].sort();
    const last = new Map();
    const series = dates.map((date) => {
      for (const a of assets) { const v = a.values.find((x) => x.date === date); if (v) last.set(a.id, { name: a.name, balance: v.value }); }
      const parts = [...last.values()];
      return { date, total: parts.reduce((s, p) => s + p.balance, 0), parts };
    });
    return { assets, series };
  }
}
