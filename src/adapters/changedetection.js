// Reads the latest text snapshot of a changedetection.io watch and pulls a dollar value out of it.
// The watch itself (URL, CSS selector, browser fetch) is configured in changedetection.io; this only reads the result.
export const DEFAULT_VALUE_REGEX = String.raw`\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)`;

export function extractValue(text, regex) {
  let re;
  try { re = new RegExp(regex || DEFAULT_VALUE_REGEX, "i"); } catch { throw new Error("The value pattern is not a valid regular expression."); }
  const m = String(text || "").match(re);
  if (!m) return null;
  const raw = (m[1] ?? m[0]).replace(/[^0-9.]/g, "");
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : null;
}

// Accepts a bare UUID or a pasted changedetection URL such as http://host:5000/edit/<uuid> or /preview/<uuid>.
export function parseWatchId(s) {
  const m = String(s || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0].toLowerCase() : null;
}

export class ChangeDetectionAdapter {
  constructor({ baseUrl, apiKey, fetchImpl = fetch, timeoutMs = 15000 } = {}) { this.baseUrl = (baseUrl || "").replace(/\/+$/, ""); this.apiKey = apiKey; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; }
  configured() { return !!(this.baseUrl && this.apiKey); }
  async latestText(watchId) {
    if (!this.configured()) throw new Error("changedetection.io is not configured (set CHANGEDETECTION_URL and CHANGEDETECTION_API_KEY).");
    let res;
    try { res = await this.fetchImpl(`${this.baseUrl}/api/v1/watch/${watchId}/history/latest`, { headers: { "x-api-key": this.apiKey }, signal: AbortSignal.timeout(this.timeoutMs) }); }
    catch (e) { throw new Error(`Could not reach changedetection.io at ${this.baseUrl}: ${e.cause?.code || e.message}`); }
    if (res.status === 401 || res.status === 403) throw new Error("changedetection.io rejected the API key.");
    if (res.status === 404) throw new Error("changedetection.io has no snapshot for that watch yet (wrong ID, or it has not been checked).");
    if (!res.ok) throw new Error(`changedetection.io returned HTTP ${res.status}.`);
    return res.text();
  }
}
