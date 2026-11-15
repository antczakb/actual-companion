// Saved loan scenarios: a snapshot of the inputs plus the result as it looked when saved.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MAX = 200;
export class ScenarioStore {
  constructor(file) { this.file = file; }
  _read() { try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { return []; } }
  _write(list) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(list)); fs.renameSync(tmp, this.file);
  }
  list() { return this._read().sort((a, b) => b.savedAt.localeCompare(a.savedAt)); }
  get(id) { return this._read().find((r) => r.id === id) || null; }
  add(rec) {
    const list = this._read();
    if (list.length >= MAX) { const e = new Error(`Limit of ${MAX} saved scenarios reached. Delete some first.`); e.status = 400; throw e; }
    const out = { id: crypto.randomUUID().slice(0, 8), savedAt: new Date().toISOString(), ...rec };
    list.push(out); this._write(list); return out;
  }
  remove(id) { const list = this._read(), n = list.filter((r) => r.id !== id); if (n.length === list.length) return false; this._write(n); return true; }
}
