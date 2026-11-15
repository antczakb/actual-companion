// Works out WHY a server URL is unreachable, in terms a person can act on.
const HINTS = {
  ECONNREFUSED: (u) => `The machine answered but nothing is listening on that port (connection refused). Check the port in ${u}; on the Actual host run: ss -tlnp | grep -E '5006|:80|:443'`,
  ENOTFOUND: (u) => `The name in ${u} does not resolve from this container. Use the server's IP address, or fix DNS for this container (pct set <id> --nameserver <your DNS>).`,
  EAI_AGAIN: (u) => `DNS lookup for ${u} timed out from this container. Use the server's IP address, or fix this container's DNS.`,
  ETIMEDOUT: (u) => `No reply from ${u}: a firewall is probably dropping the traffic, or the port is wrong.`,
  UND_ERR_CONNECT_TIMEOUT: (u) => `No reply from ${u}: a firewall is probably dropping the traffic, or the port is wrong.`,
  EHOSTUNREACH: (u) => `No route to ${u} from this container (different network or VLAN?).`,
  UND_ERR_SOCKET: (u) => `${u} accepted the connection and then closed it without replying. That usually means the port speaks HTTPS but you used http:// (or the reverse). Try the other scheme.`,
  ECONNRESET: (u) => `The connection to ${u} was reset. If you used https against a plain-http port (or the reverse), switch the scheme.`,
  EPROTO: (u) => `TLS handshake failed for ${u}. If this port is plain http, use http:// instead of https://.`,
  ERR_SSL_WRONG_VERSION_NUMBER: (u) => `${u} is not speaking TLS. Use http:// for this port.`,
};
const CERT = new Set(["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_GET_ISSUER_CERT"]);

export async function diagnoseUrl(url, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (!url) return { ok: false, code: "NO_URL", message: "ACTUAL_SERVER_URL is not set." };
  if (!/^https?:\/\//i.test(url)) return { ok: false, code: "BAD_URL", message: `ACTUAL_SERVER_URL must start with http:// or https:// (got "${url}").` };
  try {
    const r = await fetchImpl(url.replace(/\/$/, "") + "/info", { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    return { ok: true, status: r.status, message: `Reached ${url} (HTTP ${r.status}).` };
  } catch (e) {
    const code = e?.cause?.code || e?.code || (e?.name === "TimeoutError" ? "ETIMEDOUT" : "UNKNOWN");
    if (CERT.has(code)) return { ok: false, code, message: `The server's TLS certificate is not trusted by this container (${code}). Give Node your CA: copy the CA certificate into the container and add NODE_EXTRA_CA_CERTS=/path/to/ca.pem to /etc/actual-companion.env, or, for a LAN-only server, set ACTUAL_INSECURE_TLS=1 (see README).` };
    if (["UND_ERR_SOCKET", "ECONNRESET", "EPROTO", "ERR_SSL_WRONG_VERSION_NUMBER"].includes(code)) {
      const other = url.startsWith("http://") ? "https://" + url.slice(7) : "http://" + url.slice(8);
      try {
        const r = await fetchImpl(other.replace(/\/$/, "") + "/info", { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
        return { ok: false, code, suggest: other, message: `${url} does not work, but ${other} answers (HTTP ${r.status}). Change ACTUAL_SERVER_URL to ${other}` };
      } catch (e2) {
        const c2 = e2?.cause?.code || e2?.code;
        if (CERT.has(c2)) return { ok: false, code: c2, suggest: other, message: `${url} is not the right scheme: this port serves HTTPS, but its certificate is not trusted by this container (${c2}). Use ${other} and either trust the certificate (see README, "Trusting the Actual certificate") or set ACTUAL_INSECURE_TLS=1 for a LAN-only server.` };
      }
    }
    const h = HINTS[code];
    return { ok: false, code, message: h ? h(url) : `Could not connect to ${url} (${code}${e?.cause?.message ? ": " + e.cause.message : e?.message ? ": " + e.message : ""}).` };
  }
}
