// Plain DOM, no framework. Text is always inserted with textContent, never as HTML.
const $ = (id) => document.getElementById(id);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, ""); else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const usd = (n, d = 0) => (n == null || n === "" || Number.isNaN(+n) ? "" : (n < 0 ? "-$" : "$") + Math.abs(+n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
// replaceChildren that accepts nested arrays and skips null/false
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
const pct = (n) => (n == null ? "n/a" : Math.round(n * 100) + "%");

async function api(path, opts) {
  const r = await fetch(path, opts && opts.body ? { method: opts.method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts.body) } : opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
async function busy(btn, el, fn) {
  btn.disabled = true; el.replaceChildren(h("div", { class: "mute" }, "Working..."));
  try { await fn(); } catch (e) { el.replaceChildren(h("div", { class: "err" }, e.message)); } finally { btn.disabled = false; }
}
function table(cols, rows, { rowClass, maxRows = 2000 } = {}) {
  const shown = rows.slice(0, maxRows);
  const t = h("table", {}, h("thead", {}, h("tr", {}, cols.map((c) => h("th", { class: c.num ? "n" : "" }, c.label)))),
    h("tbody", {}, shown.map((r) => h("tr", { class: rowClass ? rowClass(r) : "" }, cols.map((c) => h("td", { class: c.num ? "n" : "" }, c.render ? c.render(r) : (r[c.key] ?? "")))))));
  return h("div", {}, h("div", { class: "tablewrap" }, t), rows.length > maxRows ? h("div", { class: "mute" }, `Showing first ${maxRows} of ${rows.length} rows.`) : null);
}
function lineChart(series, labels, { money = true } = {}) {
  const W = 900, H = 260, L = 64, R = 12, T = 12, B = 26;
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  if (!all.length) return h("div", { class: "mute" }, "No data yet.");
  let lo = Math.min(...all), hi = Math.max(...all); if (lo === hi) { lo -= 1; hi += 1; }
  const X = (i) => L + (labels.length < 2 ? 0 : (i / (labels.length - 1)) * (W - L - R)), Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ns = "http://www.w3.org/2000/svg", el = (n, a, txt) => { const e = document.createElementNS(ns, n); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); if (txt != null) e.textContent = txt; return e; };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img" });
  for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4, y = Y(v); svg.append(el("line", { x1: L, x2: W - R, y1: y, y2: y, stroke: "currentColor", "stroke-opacity": ".12" }), el("text", { x: L - 6, y: y + 4, "text-anchor": "end", "font-size": 11, fill: "currentColor", "fill-opacity": ".7" }, money ? usd(v) : Math.round(v))); }
  const step = Math.max(1, Math.ceil(labels.length / 8));
  labels.forEach((l, i) => { if (i % step === 0) svg.append(el("text", { x: X(i), y: H - 6, "text-anchor": "middle", "font-size": 11, fill: "currentColor", "fill-opacity": ".7" }, l)); });
  if (lo < 0 && hi > 0) svg.append(el("line", { x1: L, x2: W - R, y1: Y(0), y2: Y(0), stroke: "currentColor", "stroke-opacity": ".45" }));
  for (const s of series) {
    const pts = s.values.map((v, i) => (v == null ? null : `${X(i)},${Y(v)}`)).filter(Boolean).join(" ");
    svg.append(el("polyline", { points: pts, fill: "none", stroke: s.color, "stroke-width": 2, ...(s.dash ? { "stroke-dasharray": "6 4" } : {}) }));
    if (labels.length === 1) svg.append(el("circle", { cx: X(0), cy: Y(s.values[0]), r: 4, fill: s.color }));
  }
  return h("div", {}, svg, h("div", { class: "legend" }, series.map((s) => h("span", {}, h("i", { style: `background:${s.color}` }), s.name))));
}
function download(name, text, type) { const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove(); }
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// ---------- Loan ----------
async function loanTab() {
  const root = $("loan"), out = h("div"), prods = (await api("/api/settings")).loan.products.map((p) => p.name);
  const f = { product: h("select", {}, prods.map((p) => h("option", {}, p))), loan: h("input", { type: "number", placeholder: "blank = suggested" }), draw: h("input", { type: "month" }),
    protect: h("select", {}, h("option", { value: "Y" }, "Yes"), h("option", { value: "N" }, "No")), cushion: h("input", { type: "number", placeholder: "from Settings" }) };
  const go = h("button", { class: "act" }, "Size the loan");
  async function run() {
    await busy(go, out, async () => {
      const q = new URLSearchParams({ product: f.product.value, protect: f.protect.value });
      if (f.loan.value) q.set("loan", f.loan.value); if (f.draw.value) q.set("draw", f.draw.value); if (f.cushion.value) q.set("cushion", f.cushion.value);
      const r = await api("/api/loan?" + q), s = r.summary, a = r.assumptions;
      const kp = (v, l) => h("div", { class: "kpi" }, h("b", {}, v), h("span", {}, l));
      fill(out,
        r.warnings.map((w) => h("div", { class: "warn" }, w)),
        h("div", { class: "verdict " + s.verdict.code }, s.verdict.text),
        h("div", { class: "kpis" },
          kp(usd(s.suggested), "Suggested loan (rounded up)"), kp(usd(s.minLoan), "Minimum that keeps the floor"), kp(s.maxLoanByCashFlow == null ? "No limit" : usd(s.maxLoanByCashFlow), "Max your cash flow can repay"),
          kp(usd(s.maxLoanByEquity), "Max by home equity"), kp(s.drawLabel || "n/a", "Draw month"), kp(s.firstBelowLabel || "None", "First month below floor"),
          kp(usd(s.worstShortfall), "Worst gap without a loan"), kp(usd(s.paymentInterestOnly) + " / " + usd(s.paymentRepayment), "Payment: interest-only / repayment"),
          kp(pct(s.paymentPctOfSurplus), "Highest payment vs. monthly surplus"), kp(pct(s.combinedLtv), "Combined LTV"), kp(usd(s.totalInterest), "Total interest"), kp(usd(s.upfrontFees), "Upfront fees")),
        h("div", { class: "card mute" }, `Starting cash ${usd(a.cashToday)} (${a.cashAccounts.join(", ") || "no accounts"}) · income ${usd(a.monthlyIncome)}/mo · spending ${usd(a.monthlyExpenses)}/mo · to investments/debt ${usd(a.monthlyInvesting)}/mo · surplus ${usd(a.monthlySurplus)}/mo · based on ${a.monthsOfHistory} month(s) of history`),
        lineChart([{ name: "Cash, no loan", color: "#888", dash: true, values: r.rows.map((x) => x.cash) }, { name: "Cash, with loan", color: "#1f5fbf", values: r.rows.map((x) => x.cashWithLoan) }, { name: "Reserve target", color: "#c55a11", dash: true, values: r.rows.map((x) => x.reserve) }], r.rows.map((x) => x.label)),
        h("h2", {}, "Product comparison (each re-sized for its own terms)"),
        table([{ label: "Product", key: "name" }, { label: "Needed", num: 1, render: (x) => usd(x.suggested) }, { label: "Pmt IO", num: 1, render: (x) => usd(x.paymentInterestOnly) }, { label: "Pmt repay", num: 1, render: (x) => usd(x.paymentRepayment) },
          { label: "Interest", num: 1, render: (x) => usd(x.totalInterest) }, { label: "Fees", num: 1, render: (x) => usd(x.upfrontFees) }, { label: "Total cost", num: 1, render: (x) => usd(x.totalCostOfBorrowing) }, { label: "Verdict", render: (x) => x.verdictText }], r.comparison),
        h("h2", {}, "Month by month"),
        table([{ label: "Month", key: "label" }, { label: "Cash, no loan", num: 1, render: (x) => usd(x.cash) }, { label: "Purchases", num: 1, render: (x) => usd(x.purchases) }, { label: "Reserve", num: 1, render: (x) => usd(x.reserve) },
          { label: "Cash, with loan", num: 1, render: (x) => usd(x.cashWithLoan) }, { label: "Loan payment", num: 1, render: (x) => usd(x.loanPayment) }, { label: "No loan", key: "statusNoLoan" }, { label: "With loan", key: "statusWithLoan" }], r.rows,
          { rowClass: (x) => (x.statusWithLoan === "SHORTFALL" ? "bad" : "") }));
    });
  }
  go.addEventListener("click", run);
  root.append(h("div", { class: "card" }, h("div", { class: "row" },
    h("label", {}, "Product", f.product), h("label", {}, "Loan override ($)", f.loan), h("label", {}, "Draw month override", f.draw), h("label", {}, "Protect reserve?", f.protect), h("label", {}, "Cushion ($)", f.cushion), go),
    h("div", { class: "mute", style: "margin-top:8px" }, "Starting cash, income and spending come from Actual. Home value, mortgage, loan products and planned purchases are in Settings.")), out);
  run();
}

// ---------- Budget ----------
function budgetTab() {
  const root = $("budget"), out = h("div"), month = h("input", { type: "month" }), go = h("button", { class: "act" }, "Suggest");
  async function run() {
    await busy(go, out, async () => {
      const r = await api("/api/budget" + (month.value ? "?month=" + month.value : ""));
      if (!month.value) month.value = r.month;
      const lines = r.rows.filter((x) => x.template && x.flag !== "ok").map((x) => `${x.group} / ${x.category}: ${x.template}`).join("\n");
      fill(out,
        r.notes.map((n) => h("div", { class: "warn" }, n)),
        h("div", { class: "card mute" }, `Based on ${r.window[0]} to ${r.window[1]}. Suggested total ${usd(r.totals.suggested)} vs. current ${usd(r.totals.current)}. Average income ${usd(r.averageIncome)}/mo. Nothing is changed in Actual; this is a report.`),
        h("div", { class: "row" }, h("button", { class: "alt", onclick: () => navigator.clipboard.writeText(lines).then(() => alert("Copied " + lines.split("\n").filter(Boolean).length + " template lines. Paste each into the category's notes in Actual.")) }, "Copy template lines for categories that differ")),
        table([{ label: "Group", key: "group" }, { label: "Category", key: "category" }, { label: "Current", num: 1, render: (x) => usd(x.current) }, { label: "Suggested", num: 1, render: (x) => usd(x.suggested) }, { label: "Difference", num: 1, render: (x) => (x.difference == null ? "" : usd(x.difference)) },
          { label: "Avg 12m", num: 1, render: (x) => usd(x.average12) }, { label: "Avg 3m", num: 1, render: (x) => usd(x.average3) }, { label: "Months at $0", num: 1, key: "zeroMonths" }, { label: "Method", key: "method" }, { label: "Why", key: "reason" }, { label: "Action", key: "flag" }], r.rows, { rowClass: (x) => "flag-" + x.flag }));
    });
  }
  go.addEventListener("click", run);
  root.append(h("div", { class: "card" }, h("div", { class: "row" }, h("label", {}, "Month to budget", month), go)), out);
}

// ---------- Investments ----------
function investTab() {
  const root = $("invest"), out = h("div"), refresh = h("button", { class: "act" }, "Refresh from SnapTrade"), connect = h("button", { class: "alt" }, "Connect a brokerage");
  async function load() {
    const r = await api("/api/investments");
    const total = r.accounts.reduce((s, a) => s + a.balance, 0);
    fill(out,
      !r.configured ? h("div", { class: "warn" }, "SnapTrade is not configured. Set SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY (see README).") : null,
      h("div", { class: "kpis" }, h("div", { class: "kpi" }, h("b", {}, usd(total)), h("span", {}, "Total, latest snapshots")), h("div", { class: "kpi" }, h("b", {}, r.accounts.length), h("span", {}, "Accounts"))),
      r.series.length ? lineChart([{ name: "Total investments", color: "#1f5fbf", values: r.series.map((x) => x.total) }], r.series.map((x) => x.date)) : h("div", { class: "mute" }, "No snapshots yet. Connect a brokerage, then refresh."),
      h("h2", {}, "Accounts"), table([{ label: "Account", key: "name" }, { label: "Institution", key: "institution" }, { label: "As of", key: "date" }, { label: "Balance", num: 1, render: (x) => usd(x.balance, 2) }, { label: "Cash", num: 1, render: (x) => usd(x.cash, 2) }], r.accounts),
      h("h2", {}, "Holdings (all accounts)"), table([{ label: "Symbol", key: "symbol" }, { label: "Description", key: "description" }, { label: "Units", num: 1, render: (x) => x.units.toLocaleString("en-US", { maximumFractionDigits: 4 }) }, { label: "Value", num: 1, render: (x) => usd(x.value, 2) }, { label: "Accounts", render: (x) => x.accounts.join(", ") }], r.holdings));
  }
  refresh.addEventListener("click", async () => { refresh.disabled = true; try { const r = await api("/api/investments/refresh", { body: {} }); await load(); out.prepend(h("div", { class: "mute" }, `Recorded ${r.recorded} account(s) for ${r.date}.`)); } catch (e) { out.prepend(h("div", { class: "err" }, e.message)); } finally { refresh.disabled = false; } });
  connect.addEventListener("click", async () => { try { const r = await api("/api/snaptrade/connect"); window.open(r.url, "_blank", "noopener"); } catch (e) { out.prepend(h("div", { class: "err" }, e.message)); } });
  const shapeBtn = h("button", { class: "alt" }, "Show response shape");
  shapeBtn.addEventListener("click", async () => { try { out.prepend(h("pre", { class: "card", style: "overflow:auto;max-height:300px" }, JSON.stringify(await api("/api/snaptrade/shape"), null, 1))); } catch (e) { out.prepend(h("div", { class: "err" }, e.message)); } });
  root.append(h("div", { class: "card" }, h("div", { class: "row" }, connect, refresh, shapeBtn, h("span", { class: "mute" }, "Snapshots are stored by this app, not in Actual. Refresh as often as you like; one snapshot per account per day is kept."))), out);
  load().catch((e) => fill(out, h("div", { class: "err" }, e.message)));
}

// ---------- SimpleFIN ----------
function simplefinTab() {
  const root = $("simplefin"), out = h("div"), go = h("button", { class: "act" }, "Load (cached)"), force = h("button", { class: "alt" }, "Fetch fresh from SimpleFIN");
  async function run(fresh) {
    await busy(fresh ? force : go, out, async () => {
      const r = await api("/api/simplefin" + (fresh ? "?refresh=1" : ""));
      const tcols = (t) => t.columns.map((c) => ({ label: c, render: (x) => (x[c] === undefined || x[c] === null ? "" : String(x[c])) }));
      const filter = h("input", { placeholder: "Filter transactions (any column)" }), holder = h("div");
      const draw = () => { const q = filter.value.toLowerCase(); holder.replaceChildren(table(tcols(r.transactions), q ? r.transactions.rows.filter((x) => Object.values(x).some((v) => String(v).toLowerCase().includes(q))) : r.transactions.rows, { maxRows: 1000 })); };
      filter.addEventListener("input", draw); draw();
      const dl = (rows, cols, name) => download(name, [cols.join(","), ...rows.map((x) => cols.map((c) => csvCell(x[c])).join(","))].join("\n"), "text/csv");
      fill(out,
        h("div", { class: "mute" }, `Fetched ${r.fetchedAt}${r.fromCache ? " (from cache; SimpleFIN limits how often you can pull)" : ""}. ${r.transactions.rows.length} transactions, every field SimpleFIN sent is a column.`),
        r.errors.map((e) => h("div", { class: "warn" }, "SimpleFIN says: " + e)),
        h("h2", {}, "Accounts"), table(tcols(r.accounts), r.accounts.rows),
        h("h2", {}, "Transactions"), h("div", { class: "row" }, filter, h("button", { class: "alt", onclick: () => dl(r.transactions.rows, r.transactions.columns, "simplefin-transactions.csv") }, "Download CSV")), holder);
    });
  }
  go.addEventListener("click", () => run(false)); force.addEventListener("click", () => run(true));
  root.append(h("div", { class: "card" }, h("div", { class: "row" }, go, force, h("span", { class: "mute" }, "Shows the raw data so you can see what SimpleFIN actually provides for each account, including anything extra for Venmo."))), out);
}

// ---------- Venmo ----------
function venmoTab() {
  const root = $("venmo"), out = h("div"), file = h("input", { type: "file", accept: ".csv,text/csv" }), area = h("textarea", { rows: 4, placeholder: "...or paste the CSV text here", style: "width:100%" }), go = h("button", { class: "act" }, "Preview matches");
  let csv = "";
  file.addEventListener("change", async () => { const f = file.files[0]; if (f) { csv = await f.text(); area.value = ""; } });
  async function preview() {
    const text = area.value.trim() || csv; if (!text) { fill(out, h("div", { class: "err" }, "Choose a Venmo statement CSV first.")); return; }
    await busy(go, out, async () => {
      const r = await api("/api/venmo/preview", { body: { csv: text } }), c = r.counts;
      const picks = new Map(), cats = new Map();
      const apply = h("button", { class: "act" }, "Apply selected to Actual"), msg = h("div");
      const rows = r.matched.map((m) => {
        const cb = h("input", { type: "checkbox", checked: true }); picks.set(m.venmoId, cb);
        const sel = h("select", { disabled: m.keepsExistingCategory }, h("option", { value: "" }, m.keepsExistingCategory ? "(keeps existing)" : "(none)"), r.categories.map((k) => h("option", { value: k.id, selected: k.id === m.categoryId }, k.name))); cats.set(m.venmoId, sel);
        return h("tr", {}, h("td", {}, cb), h("td", {}, m.bankDate), h("td", { class: "n" }, usd(m.amount, 2)), h("td", {}, m.bankPayee), h("td", {}, m.payee || m.type), h("td", {}, m.venmoNote), h("td", {}, sel), h("td", { class: "mute" }, m.categorySource), h("td", { class: "mute" }, m.daysApart + " d"));
      });
      apply.addEventListener("click", async () => {
        const ids = [...picks].filter(([, cb]) => cb.checked).map(([id]) => id), overrides = {};
        for (const id of ids) { const v = cats.get(id).value; const m = r.matched.find((x) => x.venmoId === id); if (v && v !== m.categoryId && !cats.get(id).disabled) overrides[id] = v; if (!m.categoryId && v) overrides[id] = v; }
        if (!ids.length) return;
        if (!confirm(`Update ${ids.length} transaction(s) in Actual? This sets the payee and notes (and category where empty).`)) return;
        apply.disabled = true;
        try { const res = await api("/api/venmo/apply", { body: { csv: text, venmoIds: ids, categoryOverrides: overrides } }); msg.replaceChildren(h("div", {}, `Updated ${res.updated} transaction(s).` + (res.skipped.length ? ` ${res.skipped.length} skipped.` : ""))); } catch (e) { msg.replaceChildren(h("div", { class: "err" }, e.message)); } finally { apply.disabled = false; }
      });
      fill(out,
        h("div", { class: "card mute" }, `${c.statementRows} statement rows: ${c.matched} matched to bank transactions, ${c.unmatchedVenmo} with no bank match, ${c.alreadyApplied} already applied earlier${c.skippedStatus ? `, ${c.skippedStatus} not completed` : ""}. ${c.unmatchedBank} Venmo-looking bank transaction(s) have no statement row.`),
        r.matched.length ? h("div", {}, h("div", { class: "tablewrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["", "Bank date", "Amount", "Bank shows", "Payee to set", "Venmo note", "Category", "Why", "Apart"].map((x) => h("th", {}, x)))), h("tbody", {}, rows))), h("div", { class: "row", style: "margin:10px 0" }, apply), msg) : null,
        r.unmatchedVenmo.length ? [h("h2", {}, "In the statement, no bank match"), table([{ label: "Date", key: "date" }, { label: "Amount", num: 1, render: (x) => usd(x.amount, 2) }, { label: "Who", key: "counterparty" }, { label: "Note", key: "note" }, { label: "Type", key: "type" }, { label: "Reason", key: "reason" }], r.unmatchedVenmo)] : null,
        r.unmatchedBank.length ? [h("h2", {}, "In the bank, no statement row (download the next month's statement?)"), table([{ label: "Date", key: "date" }, { label: "Amount", num: 1, render: (x) => usd(x.amount, 2) }, { label: "Bank shows", key: "payee" }, { label: "Account", key: "account" }], r.unmatchedBank)] : null);
    });
  }
  go.addEventListener("click", preview);
  root.append(h("div", { class: "card" }, h("div", { class: "mute", style: "margin-bottom:8px" }, "On venmo.com: Statements, pick a month, Download CSV. Preview shows what would change; nothing is written until you press Apply."), h("div", { class: "row" }, file, go), area), out);
}

// ---------- Settings ----------
function settingsTab() {
  const root = $("settings"), ta = h("textarea", { class: "json", spellcheck: "false" }), msg = h("div"), save = h("button", { class: "act" }, "Save settings");
  api("/api/settings").then((s) => (ta.value = JSON.stringify(s, null, 2)));
  save.addEventListener("click", async () => { try { ta.value = JSON.stringify(await api("/api/settings", { method: "PUT", body: JSON.parse(ta.value) }), null, 2); msg.replaceChildren(h("div", {}, "Saved.")); } catch (e) { msg.replaceChildren(h("div", { class: "err" }, e.message)); } });
  root.append(h("div", { class: "card mute" }, "Loan products, home value, planned purchases ({\"month\":\"2027-06\",\"amount\":60000,\"name\":\"Kitchen\"}), reserve and tolerance settings. Rates are decimals (0.08 = 8%)."), ta, h("div", { class: "row", style: "margin:10px 0" }, save), msg);
}

// ---------- shell ----------
const loaded = {};
const inits = { loan: loanTab, budget: budgetTab, invest: investTab, simplefin: simplefinTab, venmo: venmoTab, settings: settingsTab };
async function show(name) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll("main section").forEach((s) => (s.hidden = s.id !== name));
  if (!loaded[name]) { loaded[name] = true; try { await inits[name](); } catch (e) { $(name).append(h("div", { class: "err" }, e.message)); } }
}
$("tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.tab); });
api("/api/status").then((s) => { $("status").textContent = `Actual ${s.actual ? "configured" : "NOT configured"} · SimpleFIN ${s.simplefin ? "on" : "off"} · SnapTrade ${s.snaptrade ? (s.snaptradeConnected ? "connected" : "not connected") : "off"}`; }).catch(() => {});
show("loan");
