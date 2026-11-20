// Daily weather for the home location (Open-Meteo historical archive: free, no key), kept so utility bills can be
// compared with temperature, heating/cooling degree days and rain. Degrees F and inches.
import fs from "node:fs";
import path from "node:path";

const bad = (m) => Object.assign(new Error(m), { status: 502 });
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

export async function fetchDailyWeather({ lat, lon, start, end, timeZone = "America/New_York", fetchImpl = fetch }) {
  const q = new URLSearchParams({ latitude: String(lat), longitude: String(lon), start_date: start, end_date: end, daily: "temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum", temperature_unit: "fahrenheit", precipitation_unit: "inch", timezone: timeZone });
  let res; try { res = await fetchImpl(`https://archive-api.open-meteo.com/v1/archive?${q}`, { headers: { "User-Agent": "actual-companion", Accept: "application/json" } }); } catch (e) { throw bad(`Could not reach the weather service (archive-api.open-meteo.com): ${e.cause?.code || e.message}. The server needs outbound internet access to that host.`); }
  const text = await res.text(), snippet = text.replace(/\s+/g, " ").trim().slice(0, 160);
  let j = null; try { j = JSON.parse(text); } catch { /* handled below with the start of what came back */ }
  if (!res.ok) throw bad(j?.reason ? `Weather service said: ${j.reason}` : `The weather service answered HTTP ${res.status}${snippet ? `: ${snippet}` : ""}.`);
  if (!j) throw bad(`The weather service answered, but not with data (HTTP ${res.status}). It said: "${snippet || "(empty)"}". A proxy, firewall or DNS filter between this server and archive-api.open-meteo.com can cause this.`);
  const d = j?.daily;
  if (!d?.time) throw bad(j?.reason ? `Weather service: ${j.reason}` : "Unexpected answer from the weather service.");
  return d.time.map((date, i) => ({ date, tmean: d.temperature_2m_mean?.[i] ?? null, tmax: d.temperature_2m_max?.[i] ?? null, tmin: d.temperature_2m_min?.[i] ?? null, precip: d.precipitation_sum?.[i] ?? null })).filter((r) => r.tmean != null);
}

export class WeatherStore {
  constructor(file) { this.file = file; }
  _read() { try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { return { lat: null, lon: null, days: {} }; } }
  all() { const d = this._read(); return Object.entries(d.days).map(([date, v]) => ({ date, tmean: v[0], tmax: v[1], tmin: v[2], precip: v[3] })).sort((a, b) => (a.date < b.date ? -1 : 1)); }
  // A different location means the old days no longer apply.
  merge(rows, { lat, lon }) {
    let d = this._read(); if (d.lat !== lat || d.lon !== lon) d = { lat, lon, days: {} };
    for (const r of rows) d.days[r.date] = [r.tmean, r.tmax, r.tmin, r.precip];
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(d)); fs.renameSync(tmp, this.file);
    return Object.keys(d.days).length;
  }
  last() { const a = this.all(); return a.length ? a.at(-1).date : null; }
  // Fetch what is missing between the first bill and about a week ago (the archive lags a few days).
  async refresh({ lat, lon, from, today, timeZone, fetchImpl }) {
    const end = addDays(today, -6); if (!from || from > end) return { days: 0, total: this.all().length };
    const d = this._read(), same = d.lat === lat && d.lon === lon, have = same ? this.all() : [];
    const first = have.length ? have[0].date : null, last = have.length ? have.at(-1).date : null;
    const need = [];
    if (!have.length) need.push([from, end]); else { if (from < first) need.push([from, addDays(first, -1)]); if (last < end) need.push([addDays(last, 1), end]); }
    let got = 0, total = have.length;
    for (const [s0, e0] of need) for (let s = s0; s <= e0; s = addDays(s, 366)) { const e = addDays(s, 365) < e0 ? addDays(s, 365) : e0, rows = await fetchDailyWeather({ lat, lon, start: s, end: e, timeZone, fetchImpl }); got += rows.length; total = this.merge(rows, { lat, lon }); }
    return { days: got, total };
  }
}

// Weather over a date range (inclusive). coverage = share of days that have data.
export function summarizeWeather(days, start, end, base = 65) {
  if (!start || !end || end < start) return null;
  const span = Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 864e5) + 1;
  const rows = days.filter((r) => r.date >= start && r.date <= end);
  if (!rows.length) return null;
  const n = rows.length, sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  return { days: n, coverage: Math.min(1, n / span), avgTemp: sum((r) => r.tmean) / n, hdd: sum((r) => Math.max(0, base - r.tmean)), cdd: sum((r) => Math.max(0, r.tmean - base)), precip: sum((r) => r.precip || 0) };
}
