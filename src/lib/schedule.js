// Runs the end-of-day snapshot once per local day at a configured time (default 23:55 in the server's time zone).
import fs from "node:fs";
import path from "node:path";

export const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const localTime = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export class SnapshotState {
  constructor(file) { this.file = file; }
  read() { try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { return {}; } }
  write(s) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(s)); }
}

// tick() is exported for tests; start() wires it to a timer.
export function createSnapshotJob({ run, getSettings, state, now = () => new Date(), log = console }) {
  let running = false;
  async function tick() {
    const cfg = getSettings();
    if (!cfg?.enabled || running) return null;
    const n = now(), day = localDate(n), st = state.read();
    if (st.lastRunDate === day || localTime(n) < cfg.time) return null;
    running = true;
    try {
      const result = await run();
      state.write({ lastRunDate: day, lastRunAt: n.toISOString(), lastResult: result, lastError: null });
      log.log?.(`Daily snapshot ${day}: ${JSON.stringify(result)}`);
      return result;
    } catch (e) {
      // keep lastRunDate unchanged so the next tick retries; record why
      state.write({ ...st, lastError: { at: n.toISOString(), message: e.message } });
      log.error?.(`Daily snapshot failed: ${e.message}`);
      return null;
    } finally { running = false; }
  }
  return { tick, start(ms = 60000) { const t = setInterval(() => tick().catch(() => {}), ms); t.unref?.(); tick().catch(() => {}); return t; } };
}
