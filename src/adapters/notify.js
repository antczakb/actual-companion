// Optional push notification: POSTs plain text to NOTIFY_URL (works with ntfy topics, e.g. https://ntfy.sh/your-private-topic or your own server).
export class NotifyAdapter {
  constructor({ url, fetchImpl = fetch, timeoutMs = 10000 } = {}) { this.url = url; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; }
  configured() { return /^https?:\/\//i.test(this.url || ""); }
  async send(title, message) {
    const res = await this.fetchImpl(this.url, { method: "POST", body: message, headers: { Title: title, "Content-Type": "text/plain; charset=utf-8" }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`notification service returned HTTP ${res.status}`);
  }
}
