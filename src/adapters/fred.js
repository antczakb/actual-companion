// FRED (St. Louis Fed) data: free with an API key from fredaccount.stlouisfed.org. Used for house price indexes.
export class FredAdapter {
  constructor({ apiKey, fetchImpl = fetch, timeoutMs = 15000 } = {}) { this.apiKey = apiKey; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; }
  configured() { return !!this.apiKey; }
  // Latest numeric observation on or before `onOrBefore` (YYYY-MM-DD) or the newest one: {date, value}
  async observation(series, onOrBefore = null) {
    if (!this.configured()) throw new Error("FRED is not configured (set FRED_API_KEY; the key is free from the St. Louis Fed).");
    if (!/^[A-Za-z0-9_]{2,40}$/.test(series || "")) throw new Error("The index series ID looks wrong. It is letters and digits such as USSTHPI.");
    const q = new URLSearchParams({ series_id: series, api_key: this.apiKey, file_type: "json", sort_order: "desc", limit: "6" });
    if (onOrBefore) q.set("observation_end", onOrBefore);
    let res;
    try { res = await this.fetchImpl(`https://api.stlouisfed.org/fred/series/observations?${q}`, { signal: AbortSignal.timeout(this.timeoutMs) }); }
    catch (e) { throw new Error(`Could not reach FRED: ${e.cause?.code || e.message}`); }
    if (res.status === 400) throw new Error("FRED rejected the request. Check the series ID and API key.");
    if (!res.ok) throw new Error(`FRED returned HTTP ${res.status}.`);
    const j = await res.json(), hit = (j.observations || []).find((o) => Number.isFinite(parseFloat(o.value)));
    if (!hit) throw new Error(onOrBefore ? `FRED has no value for ${series} on or before ${onOrBefore}.` : `FRED returned no values for ${series}.`);
    return { date: hit.date, value: parseFloat(hit.value) };
  }
}
