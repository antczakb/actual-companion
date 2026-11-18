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
const yrs = (m) => (m % 12 === 0 ? m / 12 + " yr" : (m / 12).toFixed(1) + " yr");
const pct = (n) => (n == null ? "n/a" : Math.round(n * 100) + "%");

// Explanations: hover (desktop) or tap (phone) any "i" mark or underlined column heading.
const tip = (text) => h("span", { class: "tip", tabindex: "0", role: "button", "aria-label": "How this is calculated", "data-tip": text }, "i");
(function setupTips() {
  const box = h("div", { id: "tipbox", role: "tooltip", hidden: true }); document.body.append(box);
  let cur = null;
  const show = (el) => {
    const t = el.getAttribute("data-tip"); if (!t) return;
    cur = el; box.textContent = t; box.hidden = false;
    const r = el.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight;
    const x = Math.min(Math.max(8, r.left + r.width / 2 - bw / 2), innerWidth - bw - 8); let y = r.bottom + 8;
    if (y + bh > innerHeight - 8) y = Math.max(8, r.top - bh - 8);
    box.style.left = x + "px"; box.style.top = y + "px";
  };
  const hide = () => { box.hidden = true; cur = null; };
  document.addEventListener("mouseover", (e) => { if (!matchMedia("(hover: hover)").matches) return; /* phones send a fake mouseover after a tap */ const el = e.target.closest && e.target.closest("[data-tip]"); if (el && el !== cur) show(el); else if (!el && cur) hide(); });
  document.addEventListener("focusin", (e) => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el) show(el); });
  document.addEventListener("focusout", hide);
  document.addEventListener("click", (e) => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el) show(el); else hide(); });
  addEventListener("scroll", hide, { passive: true });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
})();
const pill = (code, labels) => h("span", { class: "pill " + code }, (labels || {})[code] || code);
const stepH = (n, text, tipText) => h("h2", { class: "step" }, n ? h("span", { class: "badge" }, n) : null, text, tipText ? tip(tipText) : null);
const how = (...paras) => h("details", { class: "how" }, h("summary", {}, "How this is calculated"), paras.map((p) => h("p", {}, p)));

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
function table(cols, rows, { rowClass, maxRows = 2000, stack } = {}) {
  const shown = rows.slice(0, maxRows), st = stack ?? (cols.length <= 9 && rows.length <= 40); // phones: small tables become one card per row
  const t = h("table", { class: st ? "stack" : "" }, h("thead", {}, h("tr", {}, cols.map((c) => h("th", { class: (c.num ? "n " : "") + (c.tip ? "hastip" : ""), "data-tip": c.tip || null }, c.label)))),
    h("tbody", {}, shown.map((r) => h("tr", { class: rowClass ? rowClass(r) : "" }, cols.map((c) => h("td", { class: c.num ? "n" : "", "data-label": c.label }, c.render ? c.render(r) : (r[c.key] ?? "")))))));
  return h("div", {}, h("div", { class: "tablewrap" + (st ? " stackwrap" : "") }, t), rows.length > maxRows ? h("div", { class: "mute" }, `Showing first ${maxRows} of ${rows.length} rows.`) : null);
}
// Hover/tap tooltip for charts: shows the label and every series' value at the nearest point. xs = pixel x of each point in viewBox units.
function chartHover(wrap, svg, W, xs, rows, hi) {
  const tipEl = h("div", { class: "charttip", hidden: true }), guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
  guide.setAttribute("stroke", "currentColor"); guide.setAttribute("stroke-opacity", ".35"); guide.setAttribute("stroke-dasharray", "3 3"); guide.setAttribute("y1", hi.T); guide.setAttribute("y2", hi.bottom); guide.style.display = "none"; guide.style.pointerEvents = "none";
  svg.append(guide); wrap.style.position = "relative"; wrap.append(tipEl);
  const near = (ev) => { const r = svg.getBoundingClientRect(), x = ((ev.clientX - r.left) / r.width) * W; let b = 0, bd = Infinity; xs.forEach((px, i) => { const d = Math.abs(px - x); if (d < bd) { bd = d; b = i; } }); return { i: b, r }; };
  const move = (ev) => {
    const { i, r } = near(ev), row = rows(i);
    guide.setAttribute("x1", xs[i]); guide.setAttribute("x2", xs[i]); guide.style.display = "";
    fill(tipEl, h("b", {}, row.title), row.lines.map((l) => h("div", {}, h("i", { style: `background:${l.color}` }), h("span", {}, l.name), h("b", {}, l.value))));
    tipEl.hidden = false;
    const px = (xs[i] / W) * r.width, w = tipEl.offsetWidth; tipEl.style.left = Math.min(Math.max(0, px + 12), Math.max(0, r.width - w)) + "px"; tipEl.style.top = "8px";
    if (px + 12 + w > r.width) tipEl.style.left = Math.max(0, px - w - 12) + "px";
  };
  const off = () => { tipEl.hidden = true; guide.style.display = "none"; };
  svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move); svg.addEventListener("pointerleave", off);
  svg.addEventListener("pointerup", (ev) => { if (ev.pointerType !== "mouse") setTimeout(off, 2500); });
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
  const wrap = h("div", {}, svg, h("div", { class: "legend" }, series.map((s) => h("span", {}, h("i", { style: `background:${s.color}` }), s.name))));
  const fmt = (v) => (v == null ? "n/a" : money ? usd(v) : String(Math.round(v * 100) / 100));
  chartHover(wrap, svg, W, labels.map((_, i) => X(i)), (i) => ({ title: labels[i], lines: series.filter((s) => s.values[i] != null).map((s) => ({ name: s.name, color: s.color, value: fmt(s.values[i]) })) }), { T, bottom: H - B });
  svg.style.touchAction = "pan-y";
  return wrap;
}
// Interactive history chart: tap/click/hover (or use arrow keys / Prev / Next) to select a point and see its change
// against the point before, the point after, and the first point. points: [{date, total, parts:[{name,balance}]}]
function historyChart(points) {
  const W = 900, H = 280, L = 70, R = 16, T = 16, B = 28, n = points.length, vals = points.map((p) => p.total);
  let lo = Math.min(...vals), hi = Math.max(...vals); if (lo === hi) { lo -= 1; hi += 1; } const padY = (hi - lo) * 0.08; lo -= padY; hi += padY;
  const X = (i) => L + (n < 2 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R)), Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ns = "http://www.w3.org/2000/svg", el = (t, a, txt) => { const e = document.createElementNS(ns, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); if (txt != null) e.textContent = txt; return e; };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart interactive", role: "group", tabindex: "0", "aria-label": "Investment history. Use left and right arrow keys to move between points." });
  for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4, y = Y(v); svg.append(el("line", { x1: L, x2: W - R, y1: y, y2: y, stroke: "currentColor", "stroke-opacity": ".12" }), el("text", { x: L - 6, y: y + 4, "text-anchor": "end", "font-size": 11, fill: "currentColor", "fill-opacity": ".7" }, usd(v))); }
  const step = Math.max(1, Math.ceil(n / 7));
  points.forEach((p, i) => { if (i % step === 0) svg.append(el("text", { x: X(i), y: H - 8, "text-anchor": "middle", "font-size": 11, fill: "currentColor", "fill-opacity": ".7" }, p.date.slice(2))); });
  svg.append(el("polyline", { points: points.map((p, i) => `${X(i)},${Y(p.total)}`).join(" "), fill: "none", stroke: "#1f5fbf", "stroke-width": 2 }));
  const dots = points.map((p, i) => { const c = el("circle", { cx: X(i), cy: Y(p.total), r: n > 60 ? 2 : 3.5, fill: "#1f5fbf" }); svg.append(c); return c; });
  const guide = el("line", { y1: T, y2: H - B, stroke: "currentColor", "stroke-opacity": ".35", "stroke-dasharray": "3 3" }), ring = el("circle", { r: 7, fill: "none", stroke: "#c55a11", "stroke-width": 2.5 });
  const ringPrev = el("circle", { r: 5.5, fill: "none", stroke: "#888", "stroke-width": 1.5, "stroke-dasharray": "2 2" }), ringNext = el("circle", { r: 5.5, fill: "none", stroke: "#888", "stroke-width": 1.5, "stroke-dasharray": "2 2" });
  const lblPrev = el("text", { "font-size": 11, "text-anchor": "middle", "font-weight": 600 }), lblNext = el("text", { "font-size": 11, "text-anchor": "middle", "font-weight": 600 });
  svg.append(guide, ringPrev, ringNext, ring, lblPrev, lblNext);

  const sgn = (v) => (v >= 0 ? "+" : "-") + usd(Math.abs(v)), sp = (a, b) => (b ? ((a / b) * 100).toFixed(1).replace(/^(?!-)/, "+") + "%" : "n/a");
  const col = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
  const detail = h("div", { class: "card hist-detail", "aria-live": "polite" }), tbody = h("tbody");
  const prevB = h("button", { class: "alt", "aria-label": "Previous snapshot" }, "\u25C0 Prev"), nextB = h("button", { class: "alt", "aria-label": "Next snapshot" }, "Next \u25B6");
  const stat = (label, delta, base, note) => h("div", { class: "hstat" }, h("span", { class: "mute" }, label), delta == null ? h("b", { class: "mute" }, "none") : h("b", { class: col(delta) }, sgn(delta), " ", h("small", {}, `(${sp(delta, base)})`)), note ? h("small", { class: "mute" }, note) : null);
  const rowsEls = points.map((p, i) => {
    const d = i ? p.total - points[i - 1].total : null, run = p.total - points[0].total;
    const tr = h("tr", { class: "pick", tabindex: "-1" }, h("td", { "data-label": "Date" }, p.date), h("td", { class: "n", "data-label": "Total" }, usd(p.total)), h("td", { class: "n " + (d == null ? "" : col(d)), "data-label": "Change vs previous" }, d == null ? "" : `${sgn(d)} (${sp(d, points[i - 1].total)})`), h("td", { class: "n " + col(run), "data-label": "Change since first" }, i ? `${sgn(run)} (${sp(run, points[0].total)})` : ""));
    tr.addEventListener("click", () => select(i, true)); return tr;
  });
  tbody.append(...rowsEls.slice().reverse());
  let sel = n - 1;
  function select(i, scroll) {
    sel = Math.max(0, Math.min(n - 1, i)); const p = points[sel], pv = points[sel - 1], nx = points[sel + 1];
    guide.setAttribute("x1", X(sel)); guide.setAttribute("x2", X(sel)); ring.setAttribute("cx", X(sel)); ring.setAttribute("cy", Y(p.total));
    for (const [r, l, q, j] of [[ringPrev, lblPrev, pv, sel - 1], [ringNext, lblNext, nx, sel + 1]]) {
      r.style.display = l.style.display = q ? "" : "none";
      if (q) { r.setAttribute("cx", X(j)); r.setAttribute("cy", Y(q.total)); const d = q === pv ? p.total - q.total : q.total - p.total; l.textContent = sgn(d); l.setAttribute("x", Math.min(Math.max(X(j), L + 20), W - R - 20)); l.setAttribute("y", Y(q.total) + (q.total >= p.total ? -11 : 18)); l.setAttribute("fill", d > 0 ? "#1a7f37" : d < 0 ? "#c0362c" : "currentColor"); }
    }
    prevB.disabled = sel === 0; nextB.disabled = sel === n - 1;
    const parts = (p.parts || []).slice().sort((a, b) => b.balance - a.balance), pparts = new Map(((pv && pv.parts) || []).map((x) => [x.name, x.balance]));
    fill(detail,
      h("div", { class: "row" }, h("b", { class: "hdate" }, p.date), h("b", { class: "hval" }, usd(p.total)), h("span", { class: "mute" }, `Snapshot ${sel + 1} of ${n}`), h("span", { style: "flex:1" }), prevB, nextB),
      h("div", { class: "hstats" },
        stat("vs previous snapshot", pv ? p.total - pv.total : null, pv && pv.total, pv ? `${pv.date}: ${usd(pv.total)}` : "This is the first snapshot"),
        stat("vs next snapshot", nx ? nx.total - p.total : null, p.total, nx ? `${nx.date}: ${usd(nx.total)} (change from here)` : "This is the latest snapshot"),
        stat("since first snapshot", sel ? p.total - points[0].total : null, points[0].total, sel ? `from ${points[0].date}: ${usd(points[0].total)}` : "Starting point")),
      parts.length > 1 ? h("div", { class: "hparts" }, parts.map((x) => { const d = pparts.has(x.name) ? x.balance - pparts.get(x.name) : null; return h("div", {}, h("span", {}, x.name), h("b", {}, usd(x.balance)), d == null ? null : h("small", { class: col(d) }, sgn(d))); })) : null);
    rowsEls.forEach((r, k) => r.classList.toggle("sel", k === sel));
    if (scroll) svg.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  const idxAt = (ev) => { const r = svg.getBoundingClientRect(), x = ((ev.clientX - r.left) / r.width) * W; let best = 0, bd = Infinity; for (let i = 0; i < n; i++) { const d = Math.abs(X(i) - x); if (d < bd) { bd = d; best = i; } } return best; };
  let down = false;
  svg.addEventListener("pointerdown", (ev) => { down = true; try { svg.setPointerCapture(ev.pointerId); } catch {} select(idxAt(ev)); });
  svg.addEventListener("pointermove", (ev) => { if (down || ev.pointerType === "mouse") select(idxAt(ev)); });
  svg.addEventListener("pointerup", () => { down = false; }); svg.addEventListener("pointercancel", () => { down = false; });
  svg.addEventListener("keydown", (ev) => { const m = { ArrowLeft: -1, ArrowRight: 1, Home: -n, End: n }[ev.key]; if (m) { ev.preventDefault(); select(m === -n ? 0 : m === n ? n - 1 : sel + m); } });
  prevB.addEventListener("click", () => select(sel - 1)); nextB.addEventListener("click", () => select(sel + 1));
  select(n - 1);
  const t = h("table", { class: "stack" }, h("thead", {}, h("tr", {}, ["Date", "Total", "Change vs previous", "Change since first"].map((c, k) => h("th", { class: k ? "n" : "" }, c)))), tbody);
  const chartWrap = h("div", {}, svg);
  chartHover(chartWrap, svg, W, points.map((_, i) => X(i)), (i) => ({ title: points[i].date, lines: [{ name: "Total", color: "#1f5fbf", value: usd(points[i].total) }] }), { T, bottom: H - B });
  return h("div", {}, h("div", { class: "mute" }, "Tap or hover the chart to pick a snapshot; the dashed rings are the snapshots before and after it."), chartWrap, detail, h("h2", {}, "Snapshots over time"), h("div", { class: "tablewrap stackwrap" }, t));
}
function existingSection(r) {
  if (!r.existing?.length) return null;
  return [stepH(null, "Existing loans you would pay off", TIPS.existing), table([
    { label: "Loan", key: "name" }, { label: "Balance today", num: 1, render: (x) => usd(x.balance) }, { label: "Pay off in", key: "payoffMonth" },
    { label: "Payoff amount", num: 1, render: (x) => usd(x.payoffAmount) + (x.auto ? " (calculated)" : "") }, { label: "Payment freed / month", num: 1, render: (x) => (x.freedPayment ? usd(x.freedPayment) : "none") },
    { label: "Payments avoided", num: 1, render: (x) => (Number.isFinite(x.monthsOfPaymentsAvoided) ? x.monthsOfPaymentsAvoided + " mo" : "never ends") }, { label: "Interest avoided", num: 1, render: (x) => (x.interestAvoided == null ? "n/a" : usd(x.interestAvoided)) },
  ], r.existing), h("div", { class: "mute note" }, "The payoff amount is included in the cash projection and in sizing a new loan. Paying it off removes the monthly payment from the payoff month on.")];
}
function stressSection(r) {
  const st = r.stress; if (!st || !st.startMonthInHorizon) return null;
  const J = st.scenario, one = (s) => s && [s.lowestCash < 0 ? h("b", { class: "down" }, usd(s.lowestCash)) : usd(s.lowestCash), s.lowestMonth, s.firstNegativeMonth ? `${s.firstNegativeMonth} (${s.runwayMonths} mo in)` : "never", String(s.monthsBelowReserve)];
  const rows = [["No new loan", one(st.noLoan)], st.withLoan ? [`With the ${usd(st.loan)} loan`, one(st.withLoan)] : null].filter((x) => x[1]);
  const worst = st.withLoan || st.noLoan;
  const verdict = worst.firstNegativeMonth ? `Cash would run out in ${worst.firstNegativeMonth}, ${worst.runwayMonths} month(s) after the job loss${st.withLoan ? " even with the loan" : ""}.` : `Cash stays above zero through the whole window (lowest ${usd(worst.lowestCash)} in ${worst.lowestMonth})${worst.monthsBelowReserve ? `, but it spends ${worst.monthsBelowReserve} month(s) below your reserve target` : ""}.`;
  const out = st.rows, labels = out.map((x) => x.label);
  return [stepH(null, `Job loss stress test (from ${J.startMonth}, ${J.months ? J.months + " months" : "rest of window"})`, TIPS.jobloss),
    h("div", { class: "verdict " + (worst.firstNegativeMonth ? "caution" : "ok") }, verdict),
    table([{ label: "", render: (x) => h("b", {}, x[0]) }, { label: "Lowest cash", num: 1, render: (x) => x[1][0] }, { label: "In month", render: (x) => x[1][1] }, { label: "Cash runs out", render: (x) => x[1][2] }, { label: "Months under reserve", num: 1, render: (x) => x[1][3] }], rows),
    lineChart([{ name: "Cash, normal", color: "#888", dash: true, values: r.rows.map((x) => x.cash) }, { name: "Cash, job loss, no loan", color: "#c0362c", values: out.map((x) => x.cash) }, ...(st.withLoan ? [{ name: "Cash, job loss, with loan", color: "#1f5fbf", values: out.map((x) => x.cashWithLoan) }] : []), { name: "Reserve target", color: "#c55a11", dash: true, values: out.map((x) => x.reserve) }], labels)];
}
// Cash chart for the selected loan. Checkboxes add the cash line for each payoff strategy (paying the loan off faster uses more cash).
const PLAN_COLORS = ["#1c7a3d", "#8a3ffc", "#d12771", "#0b8a8a", "#b28600", "#6f4e37", "#111111"];
function cashChart(r) {
  const labels = r.rows.map((x) => x.label), plans = (r.payoff?.plans || []).filter((p) => p.cash);
  const base = [{ name: "Cash, no loan", color: "#888", dash: true, values: r.rows.map((x) => x.cash) }, { name: "Cash, with loan (minimum payments)", color: "#1f5fbf", values: r.rows.map((x) => x.cashWithLoan) }, { name: "Reserve target", color: "#c55a11", dash: true, values: r.rows.map((x) => x.reserve) }];
  const extra = plans.filter((p) => p.key !== "minimum").map((p, i) => ({ key: p.key, name: `Cash, ${p.name.toLowerCase()}`, color: PLAN_COLORS[i % PLAN_COLORS.length], values: p.cash }));
  if (!extra.length) return lineChart(base, labels);
  const on = new Set(extra.filter((e) => e.key === r.payoff.bestKey).map((e) => e.key)), box = h("div"), chart = h("div");
  const draw = () => fill(chart, lineChart([...base, ...extra.filter((e) => on.has(e.key))], labels));
  fill(box, h("div", { class: "chartopts" }, h("span", { class: "mute" }, "Also plot cash for:"), extra.map((e) => {
    const c = h("input", { type: "checkbox" }); c.checked = on.has(e.key);
    c.addEventListener("change", () => { c.checked ? on.add(e.key) : on.delete(e.key); draw(); });
    return h("label", { class: "chk" }, c, h("i", { style: `background:${e.color}` }), e.name.replace("Cash, ", "").replace(/^./, (m) => m.toUpperCase()));
  }), h("button", { class: "alt", onclick: () => { const all = on.size < extra.length; extra.forEach((e) => (all ? on.add(e.key) : on.delete(e.key))); box.querySelectorAll("input").forEach((c) => (c.checked = all)); draw(); } }, "All / none")));
  draw();
  return h("div", {}, box, chart);
}
function download(name, text, type) { const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove(); }
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function addMonthsJs(ym, n) { const [y, m] = ym.split("-").map(Number), t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; }
// ---------- Loan ----------
const TIPS = {
  existing: "Pay off a loan you already have (for example a car loan) in a month you choose. The payoff amount leaves your cash that month, which can make a new loan necessary; from then on the loan's monthly payment stops, so your cash flow improves. Leave Payoff amount blank and the app works out the remaining balance from your rate and payment. Tick \"In spending?\" if that payment already comes out of the accounts Actual averages for your spending; otherwise no monthly saving is counted.",
  jobloss: "A stress test, not a forecast. It re-runs your projection with a job loss: from the start month, only the share of income you enter keeps coming in (partner income, unemployment), spending drops by the percentage you enter, investing can pause, bonuses stop, and any severance arrives in the first month. Then it shows how low cash goes, when it would run out, and how the loan you are looking at changes that. Months out of work 0 means the rest of the look-ahead window.",
  bonuses: "Expected bonuses or other lump sums of cash coming in (after tax, as they land in your account). Each is added to projected cash in the month you pick. \"Every year\" repeats it every 12 months from that month. Your regular income already comes from Actual, so only enter bonuses that are NOT in your normal paychecks; a bonus you received in the last 12 months is already averaged into income.",
  purchases: "Large cash purchases you expect. Each one is subtracted from your projected cash in the month you pick. Loans are sized to cover the months where cash would otherwise fall below your floor.",
  situation: "Your cash, income, spending and investing come from Actual: cash is the balance of your on-budget accounts today; income, spending and investing are the average of the last 12 months of transactions (transfers to off-budget accounts count as investing, transfers between on-budget accounts are ignored).",
  homeValue: "Used for the equity limit on loans secured by your home: maximum loan = max combined LTV x home value - mortgage - other liens. Pick an Actual account to use its current balance, or type a value.",
  maxLtv: "Maximum combined loan-to-value a lender allows: (mortgage + other liens + new loan) / home value. 80-85% is typical for home equity products.",
  reserve: "The reserve is a cash buffer you want to keep: reserve months x your monthly spending. Your floor = reserve (if kept) + extra cushion. Loans are sized so cash never drops below the floor.",
  cushion: "Extra dollars kept above the reserve. The floor = reserve + this cushion.",
  horizon: "How many months ahead to project cash. Loan sizing and payoff checks only look this far.",
  payoffPct: "The most you are willing to spend on loan payments each month, as a share of your monthly surplus (income - spending - investing). Payoff strategies above this are marked over budget.",
  loans: "Each loan is sized separately using its own rate, interest-only period, term and fees. Rate and fee are percentages. The interest-only period is a draw period where you pay only interest (typical for a HELOC).",
  fastest: "The quickest fixed monthly payment that stays within your payoff budget (share of monthly surplus, set in step 2) and keeps cash above your floor in every projected month. Counted from the draw month. \"None fits budget\" means even the minimum payments are over budget or would push cash under the floor.",
  fastestCost: "Interest over the fastest payoff plus the up-front fees. Compare with Total cost, full term to see what paying it off early saves.",
  compare: "Each loan is sized for its own terms: the smallest amount that keeps cash above the floor in every month from the draw onward. Total cost = interest + fees over the whole term. The star marks the lowest total cost among loans that work.",
  borrow: "Smallest loan that keeps cash at or above your floor in every month from the draw month on, after fees and the payments already due, rounded up to the next $1,000.",
  payment: "Interest-only payment = loan x rate / 12. Repayment payment = loan x r / (1 - (1 + r)^-n), where r = rate / 12 and n = term in months.",
  interest: "Interest over the whole term = loan x (interest-only months x rate/12 + repay months x payment factor - 1).",
  fees: "Upfront fees = loan x fee % + fixed fee. The fee percentage is also subtracted from the cash you receive, which the sizing accounts for.",
  totalCost: "Interest + fees over the whole term. It does not include the principal you pay back.",
  result: "Works: the loan closes the gap and its payments keep cash above the floor. Caution: it works but exceeds a limit shown in the details. Not enough home equity: the gap is bigger than your equity allows. Payments too high: the payments themselves push cash below the floor.",
  suggested: "The loan amount used for the projection: the minimum that keeps the floor, rounded up to the next $1,000 (or your typed override).",
  minLoan: "The exact smallest loan, before rounding: the largest of (floor - cash + fixed fee) / (1 - fee % - payments per $1 so far) across the months from the draw on.",
  maxCash: "A bigger loan means bigger payments. This is the largest loan whose payments still keep cash above the floor in the later months. 'No limit' means payments never outrun the loan's cash within your look-ahead.",
  maxEquity: "Max combined LTV x home value - mortgage - other liens. Only applies to loans secured by your home.",
  draw: "The month the loan is drawn: the first month projected cash falls below your floor, unless you set a draw month.",
  firstBelow: "The first month, with no loan, when projected cash falls below your floor.",
  worstGap: "The largest amount cash falls short of your floor at any month without a loan.",
  pctSurplus: "Highest monthly payment / monthly surplus, where surplus = income - spending - investing.",
  ltv: "(mortgage + other liens + loan) / home value.",
  payoff: "A fixed payment that pays the loan off by a target date: balance x r / (1 - (1 + r)^-n) with n = months. Strategies are checked two ways: payment at most your budget share of monthly surplus, and projected cash with the extra payments never below your floor. 'Fastest that fits' is the largest payment that passes both.",
  saved: "Interest on the minimum schedule minus interest on this strategy.",
  floorOk: "Yes if projected cash, after the extra payments this strategy needs, stays at or above your floor in every month of the look-ahead window.",
  withinBudget: "Yes if the monthly payment is within your budget share of surplus and cash stays above the floor.",
  pctOfSurplus: "Monthly payment / monthly surplus.",
};
const VERDICT_LABEL = { ok: "Works", "none-needed": "Not needed", caution: "Caution", equity: "Not enough home equity", infeasible: "Payments too high" };
async function loanTab() {
  const root = $("loan"), out = h("div"), msg = h("div");
  settingsBar(root, { fields: [
    { path: "projection.cashAccounts", type: "accounts", label: "Accounts counted as cash", hint: "Leave all unticked to use every on-budget account.", tip: "Starting cash for the projection is the total balance of the accounts ticked here." },
    { path: "projection.trailingMonths", type: "number", label: "Months of history to average", tip: "Income, spending and investing are averaged over this many past months of Actual transactions." },
    { path: "projection.incomeGrowthPct", type: "number", label: "Income growth per year (%)" },
    { path: "projection.expenseInflationPct", type: "number", label: "Spending growth per year (%)" },
    { path: "projection.reserveFixed", type: "number", nullable: true, label: "Fixed reserve ($)", hint: "Blank = reserve months x spending (set in step 2).", tip: "If set, this dollar amount is the reserve instead of reserve months x monthly spending." },
    { path: "loan.roundTo", type: "number", label: "Round loan up to nearest ($)" },
  ], extra: actualCheck });
  let S = await api("/api/settings"), selected = S.loan.product, accts = [], acctNote = "";
  try { accts = await api("/api/accounts"); } catch (e) { acctNote = "Could not read accounts from Actual (" + e.message + "). Enter values by hand."; }
  const existingLoans = (S.projection.existingLoans || []).map((x) => ({ ...x })), jl = { ...S.projection.jobLoss }, bonuses = (S.projection.bonuses || []).map((b) => ({ ...b })), purchases = S.projection.purchases.map((p) => ({ ...p })), products = S.loan.products.map((p) => ({ ...p }));
  const nextMonth = (k) => { const d = new Date(); d.setMonth(d.getMonth() + k); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
  const inp = (type, val, on, extra = {}) => { const e = h("input", { type, class: "in", step: "any", value: val ?? "", ...extra }); e.addEventListener("input", () => on(e)); return e; };
  const numOrNull = (e) => (e.value === "" ? null : Number(e.value));

  // Expected bonuses (cash in)
  const bBox = h("div");
  function drawBonuses() {
    const yr = bonuses.reduce((t, b) => t + (+b.amount || 0), 0);
    fill(bBox,
      bonuses.length ? h("div", { class: "tablewrap stackwrap" }, h("table", { class: "stack" }, h("thead", {}, h("tr", {}, ["What", "Month", "Amount after tax ($)", "How often", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, bonuses.map((b, i) => {
          const rep = h("select", {}, h("option", { value: "once" }, "Once"), h("option", { value: "yearly" }, "Every year")); rep.value = b.repeat === "yearly" ? "yearly" : "once"; rep.addEventListener("change", () => (b.repeat = rep.value));
          return h("tr", {},
            h("td", { "data-label": "What" }, inp("text", b.name, (e) => (b.name = e.value), { placeholder: "e.g. Annual bonus" })),
            h("td", { "data-label": "Month" }, inp("month", b.month, (e) => (b.month = e.value))),
            h("td", { "data-label": "Amount after tax ($)" }, inp("number", b.amount, (e) => { b.amount = e.value === "" ? 0 : +e.value; }, { min: 0, inputmode: "decimal" })),
            h("td", { "data-label": "How often" }, rep),
            h("td", { "data-label": "" }, h("button", { class: "alt", onclick: () => { bonuses.splice(i, 1); drawBonuses(); } }, "Remove")));
        })))) : h("div", { class: "mute" }, "None yet. Add bonuses or other lump sums you expect to receive."),
      h("div", { class: "row actions" }, h("button", { class: "alt", onclick: () => { bonuses.push({ name: "", month: nextMonth(2), amount: 0, repeat: "once" }); drawBonuses(); } }, "+ Add bonus"), h("span", { class: "mute" }, bonuses.length ? `Listed: ${usd(yr)} (yearly ones repeat)` : "")));
  }

  // Existing loans to pay off
  const eBox = h("div");
  const syncExisting = () => existingLoans.forEach((x) => { if (x._src) { x.balanceAccount = x._src.account; x.balance = x._src.custom; } });
  function drawExisting() {
    const heads = ["Loan", "Balance today", "Rate %", "Payment / mo ($)", "Pay off in", "Payoff $ (blank = auto)", "In spending?", ""];
    const td = (i, ...k) => h("td", { "data-label": heads[i] }, k);
    fill(eBox, existingLoans.length ? h("div", { class: "tablewrap stackwrap" }, h("table", { class: "stack" }, h("thead", {}, h("tr", {}, heads.map((x) => h("th", {}, x)))),
      h("tbody", {}, existingLoans.map((x, i) => {
        x._src = srcField(x.balance, x.balanceAccount, true, null);
        const cb = h("input", { type: "checkbox" }); cb.checked = x.paymentInSpending !== false; cb.addEventListener("change", () => (x.paymentInSpending = cb.checked));
        return h("tr", {},
          td(0, inp("text", x.name, (e) => (x.name = e.value), { placeholder: "e.g. Truck loan" })), td(1, h("div", { class: "stackcell" }, x._src.sel, x._src.num)),
          td(2, inp("number", Math.round((x.rate || 0) * 1e6) / 1e4, (e) => (x.rate = +e.value / 100), { min: 0, inputmode: "decimal" })),
          td(3, inp("number", x.payment, (e) => (x.payment = +e.value || 0), { min: 0, inputmode: "decimal" })),
          td(4, inp("month", x.payoffMonth, (e) => (x.payoffMonth = e.value))),
          td(5, inp("number", x.payoffAmount, (e) => (x.payoffAmount = e.value === "" ? null : +e.value), { min: 0, placeholder: "auto", inputmode: "decimal" })),
          td(6, cb), td(7, h("button", { class: "alt", onclick: () => { syncExisting(); existingLoans.splice(i, 1); drawExisting(); } }, "Remove")));
      })))) : h("div", { class: "mute" }, "None yet. Add a loan you want to pay off early."),
      h("div", { class: "row actions" }, h("button", { class: "alt", onclick: () => { syncExisting(); existingLoans.push({ name: "", balance: 0, balanceAccount: null, rate: 0.06, payment: 0, payoffMonth: nextMonth(6), payoffAmount: null, paymentInSpending: true }); drawExisting(); } }, "+ Add loan to pay off")));
  }

  // Job loss stress test
  const jlOn = h("input", { type: "checkbox" }), jlPause = h("input", { type: "checkbox" });
  jlOn.checked = !!jl.enabled; jlPause.checked = jl.pauseInvesting !== false;
  const jf = { start: inp("month", jl.startMonth || nextMonth(3), () => {}), months: inp("number", jl.months ?? 6, () => {}, { min: 0 }), income: inp("number", Math.round((jl.incomePct || 0) * 100), () => {}, { min: 0, max: 100 }),
    sev: inp("number", jl.severance || 0, () => {}, { min: 0 }), cut: inp("number", jl.expenseCutPct ?? 10, () => {}, { min: 0, max: 100 }) };

  // Step 1: planned purchases
  const pBox = h("div");
  function drawPurchases() {
    const total = purchases.reduce((t, p) => t + (+p.amount || 0), 0);
    fill(pBox,
      purchases.length ? h("div", { class: "tablewrap stackwrap" }, h("table", { class: "stack" }, h("thead", {}, h("tr", {}, ["What", "Month", "Amount ($)", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, purchases.map((p, i) => h("tr", {},
          h("td", { "data-label": "What" }, inp("text", p.name, (e) => (p.name = e.value), { placeholder: "e.g. Kitchen remodel" })),
          h("td", { "data-label": "Month" }, inp("month", p.month, (e) => (p.month = e.value))),
          h("td", { "data-label": "Amount ($)" }, inp("number", p.amount, (e) => { p.amount = e.value === "" ? 0 : +e.value; }, { min: 0, inputmode: "decimal" })),
          h("td", { "data-label": "" }, h("button", { class: "alt", onclick: () => { purchases.splice(i, 1); drawPurchases(); } }, "Remove"))))))) :
        h("div", { class: "mute" }, "None yet. Add the large purchases you expect to pay for in cash."),
      h("div", { class: "row actions" }, h("button", { class: "alt", onclick: () => { purchases.push({ name: "", month: nextMonth(3), amount: 0 }); drawPurchases(); } }, "+ Add purchase"), h("span", { class: "mute" }, purchases.length ? `Total planned: ${usd(total)}` : "")));
  }

  // Step 2: your situation
  const L = S.loan, P = S.projection;
  // A dropdown of Actual accounts or "Custom value". Picking an account uses its live balance (absolute value for debts).
  const srcField = (custom, account, liability, guess) => {
    let customVal = custom || 0;
    if (!account && !custom && guess) account = (accts.find((a) => guess.test(a.name) && !(liability === false && /mortgage|loan|heloc/i.test(a.name))) || {}).name || null;
    const sel = h("select", { class: "in" }, h("option", { value: "" }, "Custom value"), accts.map((a) => h("option", { value: a.name }, `${a.name} (${usd(a.balance)})`)));
    if (account && !accts.some((a) => a.name === account)) sel.append(h("option", { value: account }, account + " (not found in Actual)"));
    const num = inp("number", customVal, (e) => { customVal = +e.value || 0; }, { min: 0 });
    const sync = () => {
      const a = accts.find((x) => x.name === sel.value);
      if (a) { num.type = "text"; num.value = usd(liability ? Math.abs(a.balance) : Math.max(0, a.balance)); num.disabled = true; } // shown as dollars, read-only
      else { num.type = "number"; num.value = customVal; num.disabled = false; }
    };
    sel.value = account || ""; sel.addEventListener("change", sync); sync();
    return { sel, num, get account() { return sel.value || null; }, get custom() { return customVal; } };
  };
  const src = {
    homeValue: srcField(L.homeValue, L.homeValueAccount, false, /house|home|property|real estate/i),
    mortgage: srcField(L.mortgage, L.mortgageAccount, true, /mortgage|home loan/i),
    otherLiens: srcField(L.otherLiens, L.otherLiensAccount, true, null),
  };
  const f = {
    maxLtv: inp("number", Math.round(L.maxLtv * 1000) / 10, () => {}, { min: 0, max: 100 }), cushion: inp("number", L.cushion, () => {}, { min: 0 }),
    payoffPct: inp("number", Math.round((L.payoffBudgetPct ?? 0.5) * 100), () => {}, { min: 0, max: 100 }),
    reserveMonths: inp("number", P.reserveMonths, () => {}, { min: 0 }), horizon: inp("number", L.horizonMonths, () => {}, { min: 6, max: 120 }),
    protect: h("select", { class: "in" }, h("option", { value: "Y" }, "Yes"), h("option", { value: "N" }, "No")),
    income: inp("number", P.incomeOverride, () => {}, { placeholder: "from Actual" }), expenses: inp("number", P.expensesOverride, () => {}, { placeholder: "from Actual" }), investing: inp("number", P.investingOverride, () => {}, { placeholder: "from Actual" }),
  };
  f.protect.value = L.protectReserve ? "Y" : "N";

  // Step 3: loan products
  const prBox = h("div");
  function drawProducts() {
    const heads = ["Loan", "Rate %", "Interest-only yrs", "Repay term yrs", "Fee %", "Fixed fee $", "Secured by home", ""];
    const td = (i, ...k) => h("td", { "data-label": heads[i] }, k);
    fill(prBox, h("div", { class: "tablewrap stackwrap" }, h("table", { class: "stack" }, h("thead", {}, h("tr", {}, heads.map((x) => h("th", {}, x)))),
      h("tbody", {}, products.map((p, i) => h("tr", {},
        td(0, inp("text", p.name, (e) => (p.name = e.value))),
        td(1, inp("number", Math.round(p.rate * 1e6) / 1e4, (e) => (p.rate = +e.value / 100), { min: 0, inputmode: "decimal" })),
        td(2, inp("number", p.ioYears, (e) => (p.ioYears = +e.value), { min: 0, inputmode: "decimal" })),
        td(3, inp("number", p.termYears, (e) => (p.termYears = +e.value), { min: 0, inputmode: "decimal" })),
        td(4, inp("number", Math.round(p.feePct * 1e6) / 1e4, (e) => (p.feePct = +e.value / 100), { min: 0, inputmode: "decimal" })),
        td(5, inp("number", p.fixedFee, (e) => (p.fixedFee = +e.value), { min: 0, inputmode: "decimal" })),
        td(6, (() => { const c = h("input", { type: "checkbox" }); c.checked = !!p.secured; c.addEventListener("change", () => (p.secured = c.checked)); return c; })()),
        td(7, products.length > 1 ? h("button", { class: "alt", onclick: () => { products.splice(i, 1); drawProducts(); } }, "Remove") : null)))))),
      h("div", { class: "actions" }, h("button", { class: "alt", onclick: () => { products.push({ name: "New loan", rate: 0.08, ioYears: 0, termYears: 10, feePct: 0, fixedFee: 0, secured: false }); drawProducts(); } }, "+ Add loan")));
  }

  const go = h("button", { class: "act" }, "Save and calculate");
  const saveName = h("input", { type: "text", class: "in", placeholder: "Scenario name, e.g. Kitchen + car 2027" }), saveBtn = h("button", { class: "alt" }, "Save scenario");
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    try { await save(); await api("/api/scenarios", { body: { name: saveName.value } }); saveName.value = ""; await drawScenarios(); scenBox.scrollIntoView({ behavior: "smooth" }); }
    catch (e) { fill(msg, h("div", { class: "err" }, e.message)); } finally { saveBtn.disabled = false; }
  });
  const scenBox = h("div"), scenOut = h("div"), picked = new Set();
  const when = (iso) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  async function drawScenarios() {
    const list = await api("/api/scenarios");
    const cmp = h("button", { class: "alt" }, "Compare selected");
    cmp.addEventListener("click", async () => {
      if (picked.size < 2) return fill(scenOut, h("div", { class: "warn" }, "Tick at least two scenarios."));
      const recs = await Promise.all([...picked].map((id) => api("/api/scenario?id=" + id)));
      const rows = (r) => { const rec = r.result.comparison.find((x) => x.recommended) || {}; return {
        "Saved": when(r.savedAt), "Planned purchases": usd(r.result.plannedTotal), "Recommended loan": r.result.recommended || "none", "Borrow": usd(rec.suggested), "Draw month": rec.drawLabel || "n/a",
        "Highest payment": rec.name ? usd(Math.max(rec.paymentInterestOnly, rec.paymentRepayment)) + "/mo" : "", "Interest": usd(rec.totalInterest), "Fees": usd(rec.upfrontFees), "Total cost": usd(rec.totalCostOfBorrowing),
        "Worst gap without a loan": usd(rec.worstShortfall ?? r.result.selected.worstShortfall), "Combined LTV": pct(rec.combinedLtv), "Home value used": usd(r.result.resolved.homeValue.value), "Mortgage used": usd(r.result.resolved.mortgage.value),
        "Monthly surplus": usd(r.result.assumptions.monthlySurplus) }; };
      const vals = recs.map(rows), keys = Object.keys(vals[0]);
      fill(scenOut, stepH(null, "Comparison"), table([{ label: "", render: (x) => h("b", {}, x.k) }, ...recs.map((r, i) => ({ label: r.name, render: (x) => x.v[i] }))], keys.map((k) => ({ k, v: vals.map((v) => v[k]) }))));
    });
    fill(scenBox, stepH(null, "Saved scenarios"),
      list.length ? [table([{ label: "", render: (x) => { const c = h("input", { type: "checkbox" }); c.checked = picked.has(x.id); c.addEventListener("change", () => (c.checked ? picked.add(x.id) : picked.delete(x.id))); return c; } },
        { label: "Name", key: "name" }, { label: "Saved", render: (x) => when(x.savedAt) }, { label: "Planned", num: 1, render: (x) => usd(x.plannedTotal) }, { label: "Recommended", render: (x) => x.recommended || "none" },
        { label: "Borrow", num: 1, render: (x) => usd(x.borrow) }, { label: "Total cost", num: 1, render: (x) => usd(x.totalCost) },
        { label: "", render: (x) => h("span", { class: "row" },
          h("button", { class: "alt", onclick: async () => { try { viewScenario(await api("/api/scenario?id=" + x.id)); } catch (e) { fill(scenOut, h("div", { class: "err" }, e.message)); } } }, "View"),
          h("button", { class: "alt", title: "Put these inputs back in the planner", onclick: async () => { try { await api("/api/scenarios/load", { body: { id: x.id } }); root.replaceChildren(); await loanTab(); } catch (e) { fill(scenOut, h("div", { class: "err" }, e.message)); } } }, "Load"),
          h("button", { class: "alt", onclick: async () => { if (confirm(`Delete "${x.name}"?`)) { await api("/api/scenarios/delete", { body: { id: x.id } }); picked.delete(x.id); drawScenarios(); fill(scenOut); } } }, "Delete")) }], list),
        h("div", { class: "row", style: "margin:8px 0" }, cmp)] : h("div", { class: "mute" }, "Nothing saved yet. After calculating, name the scenario and press Save scenario."));
  }
  function viewScenario(r) {
    const a = r.result.assumptions, cur = (r.inputs.projection.purchases || []).map((p) => `${p.name || "Purchase"} ${p.month} ${usd(p.amount)}`).join(" · ") || "none";
    fill(scenOut, stepH(null, `${r.name} (saved ${when(r.savedAt)})`),
      h("div", { class: "card mute" }, `Purchases: ${cur}. Cash then ${usd(a.cashToday)}, income ${usd(a.monthlyIncome)}/mo, spending ${usd(a.monthlyExpenses)}/mo. Home ${usd(r.result.resolved.homeValue.value)}, mortgage ${usd(r.result.resolved.mortgage.value)}. These are the numbers as saved; use Load to re-run with today's data.`),
      table([{ label: "Loan", render: (x) => h("span", {}, x.recommended ? "★ " : "", x.name) }, { label: "Borrow", num: 1, render: (x) => usd(x.suggested) }, { label: "Payment: interest-only / repay", num: 1, render: (x) => usd(x.paymentInterestOnly) + " / " + usd(x.paymentRepayment) },
        { label: "Interest", num: 1, render: (x) => usd(x.totalInterest) }, { label: "Fees", num: 1, render: (x) => usd(x.upfrontFees) }, { label: "Total cost", num: 1, render: (x) => usd(x.totalCostOfBorrowing) }, { label: "Result", tip: TIPS.result, render: (x) => pill(x.verdict.code, VERDICT_LABEL) }], r.result.comparison),
      lineChart([{ name: "Cash, no loan", color: "#888", dash: true, values: r.result.series.map((x) => x.cash) }, { name: `Cash, with ${r.result.selected.product}`, color: "#1f5fbf", values: r.result.series.map((x) => x.cashWithLoan) }, { name: "Reserve target", color: "#c55a11", dash: true, values: r.result.series.map((x) => x.reserve) }], r.result.series.map((x) => x.label)));
  }
  const adv = { loan: inp("number", "", () => {}, { min: 0, placeholder: "blank = suggested" }), draw: inp("month", "", () => {}) };

  async function save() {
    S = await api("/api/settings"); // pick up anything changed in this tab's Settings panel
    const s = structuredClone(S);
    s.projection.bonuses = bonuses.filter((b) => b.month || +b.amount).map((b) => ({ name: b.name || "", month: b.month, amount: +b.amount || 0, repeat: b.repeat === "yearly" ? "yearly" : "once" }));
    syncExisting();
    s.projection.existingLoans = existingLoans.filter((x) => (x.name || "").trim() || +x.balance || x.balanceAccount).map((x) => ({ name: (x.name || "").trim() || "Loan", balanceAccount: x.balanceAccount || null, balance: +x.balance || 0, rate: x.rate || 0, payment: +x.payment || 0, payoffMonth: x.payoffMonth, payoffAmount: x.payoffAmount == null ? null : +x.payoffAmount, paymentInSpending: x.paymentInSpending !== false }));
    s.projection.jobLoss = { enabled: jlOn.checked, startMonth: jf.start.value, months: Math.max(0, Math.round(+jf.months.value || 0)), incomePct: Math.min(1, Math.max(0, (+jf.income.value || 0) / 100)), severance: +jf.sev.value || 0, expenseCutPct: Math.min(100, Math.max(0, +jf.cut.value || 0)), pauseInvesting: jlPause.checked };
    s.projection.purchases = purchases.filter((p) => p.month || +p.amount).map((p) => ({ name: p.name || "", month: p.month, amount: +p.amount || 0 }));
    s.loan.products = products.map((p) => ({ ...p, name: (p.name || "").trim() }));
    if (!s.loan.products.some((p) => p.name === selected)) selected = s.loan.products[0].name;
    s.loan.product = selected;
    Object.assign(s.loan, { homeValue: src.homeValue.custom, mortgage: src.mortgage.custom, otherLiens: src.otherLiens.custom,
      homeValueAccount: src.homeValue.account, mortgageAccount: src.mortgage.account, otherLiensAccount: src.otherLiens.account, maxLtv: (+f.maxLtv.value || 0) / 100,
      cushion: +f.cushion.value || 0, payoffBudgetPct: Math.min(1, Math.max(0, (+f.payoffPct.value || 0) / 100)), horizonMonths: +f.horizon.value || 60, protectReserve: f.protect.value === "Y" });
    Object.assign(s.projection, { reserveMonths: +f.reserveMonths.value || 0, incomeOverride: numOrNull(f.income), expensesOverride: numOrNull(f.expenses), investingOverride: numOrNull(f.investing) });
    S = await api("/api/settings", { method: "PUT", body: s });
  }
  async function calc(doSave = true) {
    fill(msg);
    await busy(go, out, async () => {
      if (doSave) await save();
      const q = new URLSearchParams({ product: selected });
      if (adv.loan.value) q.set("loan", adv.loan.value); if (adv.draw.value) q.set("draw", adv.draw.value);
      render(await api("/api/loan?" + q));
    });
  }
  function render(r) {
    const s = r.summary, a = r.assumptions, kp = (v, l, t) => h("div", { class: "kpi" }, h("b", {}, v), h("span", {}, l, t ? tip(t) : null));
    const rec = r.comparison.find((x) => x.recommended);
    const hero = s.verdict.code === "none-needed" ? h("div", { class: "verdict hero none-needed" }, h("div", { class: "big" }, "No loan needed"), h("div", { class: "bigsub" }, s.verdict.text)) :
      rec ? h("div", { class: "verdict hero ok" }, h("div", { class: "big" }, `${rec.name}: borrow about ${usd(rec.suggested)}`), h("div", { class: "bigsub" }, `Lowest total cost of the loans that work: ${usd(rec.totalCostOfBorrowing)} in interest and fees. Highest payment ${usd(Math.max(rec.paymentInterestOnly, rec.paymentRepayment))} a month.`)) :
        h("div", { class: "verdict hero caution" }, h("div", { class: "big" }, "No loan works as set up"), h("div", { class: "bigsub" }, "See the Result column below, then change a purchase, a loan, or your cushion."));
    fill(out,
      r.warnings.map((w) => h("div", { class: "warn" }, w)),
      stepH(4, "Result"),
      hero,
      h("div", { class: "facts" },
        [["Cash today", usd(a.cashToday), `Balance of: ${a.cashAccounts.join(", ") || "no accounts"}`], ["Income / month", usd(a.monthlyIncome)], ["Spending / month", usd(a.monthlyExpenses)], ["To investments / debt", usd(a.monthlyInvesting)], ["Surplus / month", usd(a.monthlySurplus), "Income - spending - investing."]]
          .map(([l, v, t]) => h("div", { class: "fact" }, h("span", {}, l, t ? tip(t) : null), h("b", {}, v))), h("div", { class: "fact wide mute" }, `From ${a.monthsOfHistory} month(s) of Actual history`)),
      stepH(null, "Which loan?", TIPS.compare),
      table([{ label: "Loan", render: (x) => h("span", {}, x.recommended ? "\u2605 " : "", x.name) }, { label: "Borrow", num: 1, tip: TIPS.borrow, render: (x) => usd(x.suggested) }, { label: "Payment: interest-only / repay", num: 1, tip: TIPS.payment, render: (x) => usd(x.paymentInterestOnly) + " / " + usd(x.paymentRepayment) },
        { label: "Interest, full term", num: 1, tip: TIPS.interest, render: (x) => usd(x.totalInterest) }, { label: "Fees", num: 1, tip: TIPS.fees, render: (x) => usd(x.upfrontFees) }, { label: "Total cost, full term", num: 1, tip: TIPS.totalCost, render: (x) => usd(x.totalCostOfBorrowing) },
        { label: "Fastest payoff", tip: TIPS.fastest, render: (x) => (x.fastest ? `${yrs(x.fastest.months)} at ${usd(x.fastest.payment)}/mo` : x.suggested > 0 ? "None fits budget" : "") }, { label: "Total cost, fastest", num: 1, tip: TIPS.fastestCost, render: (x) => (x.fastest ? usd(x.fastest.totalCost) : "") },
        { label: "Result", tip: TIPS.result, render: (x) => pill(x.verdict.code, VERDICT_LABEL) }, { label: "", render: (x) => (x.name === selected ? h("b", { class: "mute" }, "Showing below") : h("button", { class: "alt", onclick: () => { selected = x.name; calc(false); } }, "Show details")) }], r.comparison,
        { stack: true, rowClass: (x) => (x.name === selected ? "sel" : "") }),
      h("div", { class: "mute note" }, "\u2605 = lowest total cost among the loans that work."),
      how("Each loan is sized separately. For every month from the draw month on, the app requires: cash without the loan + loan x (1 - fee % - payments made so far per $1 borrowed) - fixed fee >= your floor. The smallest loan that satisfies every month is the 'Borrow' amount, rounded up to the next $1,000.",
        "Interest-only payment = loan x rate / 12. Repayment = loan x r / (1 - (1 + r)^-n) with r = rate / 12 and n = term in months. Interest over the term = loan x (interest-only months x rate/12 + repay months x payment factor - 1). Total cost = interest + fees.",
        "Home-equity limit (secured loans) = max combined LTV x home value - mortgage - other liens."),
      h("div", { class: "card row savebar" }, saveName, saveBtn, h("span", { class: "mute" }, "Saves your current inputs and this result so you can compare later.")),
      stepH(null, `Details: ${s.product}`),
      h("div", { class: "verdict " + s.verdict.code }, s.verdict.text),
      h("div", { class: "kpis" },
        kp(usd(s.suggested), "Suggested loan", TIPS.suggested), kp(usd(s.minLoan), "Minimum that keeps the floor", TIPS.minLoan), kp(s.maxLoanByCashFlow == null ? "No limit" : usd(s.maxLoanByCashFlow), "Max your cash flow can repay", TIPS.maxCash),
        kp(usd(s.maxLoanByEquity), "Max by home equity", TIPS.maxEquity), kp(s.drawLabel || "n/a", "Draw month", TIPS.draw), kp(s.firstBelowLabel || "None", "First month below floor", TIPS.firstBelow),
        kp(usd(s.worstShortfall), "Worst gap without a loan", TIPS.worstGap), kp(usd(s.paymentInterestOnly) + " / " + usd(s.paymentRepayment), "Payment: interest-only / repay", TIPS.payment),
        kp(pct(s.paymentPctOfSurplus), "Highest payment vs. surplus", TIPS.pctSurplus), kp(pct(s.combinedLtv), "Combined LTV", TIPS.ltv)),
      cashChart(r),
      existingSection(r),
      payoffSection(r),
      stressSection(r),
      stepH(null, "Month by month"),
      table([{ label: "Month", key: "label" }, { label: "Cash, no loan", num: 1, render: (x) => usd(x.cash) }, { label: "Bonuses", num: 1, render: (x) => (x.bonuses ? usd(x.bonuses) : "") }, { label: "Purchases", num: 1, render: (x) => usd(x.purchases) }, { label: "Reserve", num: 1, tip: "Reserve target = reserve months x that month's spending (or your fixed amount).", render: (x) => usd(x.reserve) },
        { label: "Cash, with loan", num: 1, tip: "Cash without the loan + (loan x (1 - fee % - payments so far per $1) - fixed fee).", render: (x) => usd(x.cashWithLoan) }, { label: "Loan payment", num: 1, render: (x) => usd(x.loanPayment) }, { label: "No loan", key: "statusNoLoan" }, { label: "With loan", key: "statusWithLoan" }], r.rows,
        { stack: false, rowClass: (x) => (x.statusWithLoan === "SHORTFALL" ? "bad" : "") }));
  }

  function payoffSection(r) {
    const po = r.payoff;
    if (!po || !po.plans.length) return null;
    const best = po.plans.find((p) => p.key === po.bestKey), min = po.plans.find((p) => p.key === "minimum");
    const curves = [{ name: "Minimum payments", color: "#888", dash: true, p: min }, best && best.key !== "minimum" ? { name: best.name, color: "#1c7a3d", p: best } : null].filter(Boolean);
    const len = Math.max(...curves.map((c) => c.p.balances.length));
    const start = r.summary.drawLabel;
    return [
      stepH(null, "Payoff strategies", TIPS.payoff),
      h("div", { class: "mute note" }, `Payments may use up to ${usd(po.budgetCap)} a month (${Math.round((po.budgetCap / Math.max(1, r.assumptions.monthlySurplus)) * 100)}% of your ${usd(r.assumptions.monthlySurplus)} surplus), and cash must stay above your floor. Payoff times count from the draw month${start ? " (" + start + ")" : ""}.`),
      best && best.key !== "minimum" ? h("div", { class: "verdict ok" }, `Best within budget: ${best.name.toLowerCase()}. Pay ${usd(best.payment)} a month, done by ${best.paidOffBy} (${yrs(best.months)}), saving ${usd(best.interestSaved)} in interest.`) :
        h("div", { class: "verdict caution" }, min.withinBudget ? "No faster payoff fits inside your budget and cash floor, so the minimum payments are the practical choice. You can still pay extra whenever cash allows." :
          `Even the minimum payment (${usd(min.payment)} a month) is above your budget share (${usd(po.budgetCap)} a month) or would push cash under the floor. Try a longer-term loan from the table above, a smaller purchase, or a higher share in step 2.`),
      table([{ label: "Strategy", render: (x) => h("span", {}, x.key === po.bestKey ? "\u2605 " : "", x.name) }, { label: "Monthly payment", num: 1, render: (x) => usd(x.payment) }, { label: "Paid off by", render: (x) => `${x.paidOffBy || ""} (${yrs(x.months)})` },
        { label: "Interest", num: 1, render: (x) => usd(x.totalInterest) }, { label: "Saved vs. minimum", num: 1, tip: TIPS.saved, render: (x) => usd(x.interestSaved) }, { label: "Total cost", num: 1, tip: TIPS.totalCost, render: (x) => usd(x.totalCost) },
        { label: "% of surplus", num: 1, tip: TIPS.pctOfSurplus, render: (x) => pct(x.pctOfSurplus) }, { label: "Cash stays above floor", tip: TIPS.floorOk, render: (x) => (x.floorOk ? "Yes" : "No") }, { label: "Within budget", tip: TIPS.withinBudget, render: (x) => (x.withinBudget ? "Yes" : "No") }], po.plans,
        { rowClass: (x) => (x.withinBudget ? (x.key === po.bestKey ? "sel" : "") : "bad") }),
      h("div", { class: "mute note" }, "Rows in red are over budget or would push cash under the floor. Each plan uses a fixed payment from the month after the draw; the last payment is smaller."),
      how("A fixed payment P pays off balance B at monthly rate r in n months when P = B x r / (1 - (1 + r)^-n). Going the other way, months = -ln(1 - r x B / P) / ln(1 + r).",
        "Within budget means two checks both pass: P <= your budget share x monthly surplus, and projected cash minus the extra payments (P minus the scheduled payment, accumulated month by month) stays at or above your floor.",
        "'Fastest that fits' searches for the largest fixed payment that passes both checks. Saved vs. minimum = interest on the minimum schedule - interest on the strategy."),
      lineChart(curves.map((c) => ({ name: c.name, color: c.color, dash: c.dash, values: Array.from({ length: len }, (_, i) => (i < c.p.balances.length ? c.p.balances[i] : 0)) })), Array.from({ length: len }, (_, i) => (start ? addMonthsJs(start, i + 1) : String(i + 1)))),
    ];
  }
  go.addEventListener("click", () => calc(true));
  const field = (label, el, hint, t) => h("label", {}, h("span", { class: "lbl" }, label, t ? tip(t) : null), el, hint ? h("small", { class: "mute" }, hint) : null);
  drawPurchases(); drawBonuses(); drawExisting(); drawProducts();
  root.append(
    h("div", { class: "intro" }, h("b", {}, "Plan a large purchase."), " Blue boxes are inputs; everything else is calculated. Your cash, income and spending are read from Actual. Hover or tap the ", tip("Like this: an explanation of how the number is worked out."), " marks to see how each number is calculated."),
    stepH(1, "Planned large purchases", TIPS.purchases), h("div", { class: "card" }, pBox),
    h("h3", {}, "Expected bonuses ", tip(TIPS.bonuses)), h("div", { class: "card" }, bBox),
    h("h3", {}, "Existing loans to pay off ", tip(TIPS.existing)), h("div", { class: "card" }, eBox),
    stepH(2, "Your situation", TIPS.situation),
    h("div", { class: "card" }, acctNote ? h("div", { class: "warn" }, acctNote) : h("div", { class: "mute note" }, "Pick an Actual account to use its current balance (a mortgage shows as a positive amount owed), or choose Custom value and type a number."), h("div", { class: "row fields" },
      field("Home value: account", src.homeValue.sel, null, TIPS.homeValue), field("Home value ($)", src.homeValue.num), field("Mortgage: account", src.mortgage.sel), field("Mortgage balance ($)", src.mortgage.num),
      field("Other liens: account", src.otherLiens.sel), field("Other liens ($)", src.otherLiens.num), field("Max combined LTV (%)", f.maxLtv, "usually 80-85", TIPS.maxLtv),
      field("Keep a reserve?", f.protect, null, TIPS.reserve), field("Reserve (months)", f.reserveMonths), field("Extra cushion ($)", f.cushion, null, TIPS.cushion), field("Look ahead (months)", f.horizon, null, TIPS.horizon), field("Payment cap (% of surplus)", f.payoffPct, "for payoff strategies", TIPS.payoffPct)),
      h("details", { class: "more" }, h("summary", {}, "Override what Actual says (monthly $)"), h("div", { class: "row fields" }, field("Income", f.income), field("Spending", f.expenses), field("To investments/debt", f.investing)))),
    stepH(3, "Loans to compare", TIPS.loans), h("div", { class: "card" }, prBox, h("div", { class: "mute note" }, "Rate and fee are percentages. Interest-only years: payments are interest only before the repayment term starts (a HELOC draw period).")),
    h("h3", {}, "Job loss stress test ", tip(TIPS.jobloss)), h("div", { class: "card" },
      h("label", { class: "check" }, jlOn, "Include a job-loss stress test in the results"),
      h("div", { class: "row fields" }, field("Job loss starts", jf.start), field("Months out of work (0 = rest of window)", jf.months), field("Income still coming in (% of normal)", jf.income, "partner pay, unemployment"), field("Severance after tax ($)", jf.sev), field("Spending cut (%)", jf.cut), h("label", { class: "check" }, jlPause, "Pause investing and debt transfers"))),
    h("div", { class: "row actions" }, go,
      h("details", { class: "more" }, h("summary", {}, "Try a specific amount or draw month"), h("div", { class: "row fields" }, field("Loan amount ($)", adv.loan), field("Draw month", adv.draw)))),
    msg, out, scenBox, scenOut);
  drawScenarios().catch((e) => fill(scenBox, h("div", { class: "err" }, e.message)));
  if (purchases.length) calc(true); // saves too, so suggested accounts shown above are what the result uses
}

// ---------- Budget ----------
function budgetTab() {
  settingsBar($("budget"), { fields: [
    { path: "budget.trailingMonths", type: "number", label: "Months of history" },
    { path: "budget.tolerancePct", type: "number", scale: 100, label: "Tolerance (%)", hint: "Differences smaller than this are marked OK.", tip: "A suggestion within this percentage (or the dollar amount below) of the current budget is marked OK rather than flagged." },
    { path: "budget.toleranceDollars", type: "number", label: "Tolerance ($)" },
    { path: "budget.excludeGroups", type: "list", label: "Skip these category groups" },
    { path: "budget.excludeCategories", type: "list", label: "Skip these categories" },
  ], extra: actualCheck });
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
      r.series.length ? historyChart(r.series) : h("div", { class: "mute" }, "No snapshots yet. Connect a brokerage, then refresh."),
      h("h2", {}, "Accounts"), table([{ label: "Account", key: "name" }, { label: "Institution", key: "institution" }, { label: "As of", key: "date" }, { label: "Balance", num: 1, render: (x) => usd(x.balance, 2) }, { label: "Cash", num: 1, render: (x) => usd(x.cash, 2) }], r.accounts),
      h("h2", {}, "Holdings (all accounts)"), table([{ label: "Symbol", key: "symbol" }, { label: "Description", key: "description" }, { label: "Units", num: 1, render: (x) => x.units.toLocaleString("en-US", { maximumFractionDigits: 4 }) }, { label: "Value", num: 1, render: (x) => usd(x.value, 2) }, { label: "Accounts", render: (x) => x.accounts.join(", ") }], r.holdings));
  }
  refresh.addEventListener("click", async () => { refresh.disabled = true; try { const r = await api("/api/investments/refresh", { body: {} }); await load(); out.prepend(h("div", { class: "mute" }, `Recorded ${r.recorded} account(s) for ${r.date}.`)); } catch (e) { out.prepend(h("div", { class: "err" }, e.message)); } finally { refresh.disabled = false; } });
  connect.addEventListener("click", async () => { try { const r = await api("/api/snaptrade/connect"); window.open(r.url, "_blank", "noopener"); } catch (e) { out.prepend(h("div", { class: "err" }, e.message)); } });
  const shapeBtn = h("button", { class: "alt" }, "Show response shape");
  const shapeBox = h("div");
  const showShape = (...kids) => { shapeBox.replaceChildren(...kids); };
  shapeBtn.addEventListener("click", async () => {
    shapeBtn.disabled = true; showShape(h("div", { class: "mute" }, "Working..."));
    try {
      const r = await api("/api/snaptrade/shape");
      showShape(h("div", { class: "card" }, h("div", { class: "row" }, h("b", {}, "SnapTrade response shape (names and types only)"), h("button", { class: "alt", onclick: () => showShape() }, "Close")), h("pre", { style: "overflow:auto;max-height:300px;margin:8px 0 0" }, JSON.stringify(r, null, 1))));
    } catch (e) { showShape(h("div", { class: "err" }, e.message), h("button", { class: "alt", onclick: () => showShape() }, "Close")); } finally { shapeBtn.disabled = false; }
  });
  const snapStatus = h("div", { class: "mute" });
  api("/api/snapshot/status").then((st) => {
    const when = st.lastRunAt ? new Date(st.lastRunAt).toLocaleString() : null;
    fill(snapStatus, st.enabled ? `Automatic snapshot runs every day at ${st.time} (server time).` : "Automatic daily snapshot is off.", " ", when ? `Last run: ${when}.` : "It has not run yet.", st.lastError ? ` Last attempt failed: ${st.lastError.message}` : "");
  }).catch(() => {});
  settingsBar(root, {
    fields: [
      { path: "snapshots.enabled", label: "Take a snapshot automatically every day", type: "bool", tip: "Once a day at the time below, the app reads your brokerage balances (SnapTrade) and the Actual accounts linked to your assets, and stores them. The server must be running at that time; if it is down, that day is skipped." },
      { path: "snapshots.time", label: "Time of day (server clock)", type: "time", hint: "Default 23:55. Uses the time zone of the container; set it with timedatectl set-timezone if it is wrong." },
    ],
    extra: () => h("div", {}, snapStatus, h("div", { class: "row actions" }, shapeBtn, h("span", { class: "mute" }, "Diagnostic: shows the names and types of fields SnapTrade returns (no balances or account numbers), useful if a brokerage looks wrong."))) });
  root.append(strategyBox(false), h("div", { class: "card" }, h("div", { class: "row" }, connect, refresh, h("span", { class: "mute" }, "Snapshots are stored by this app, not in Actual. Refresh as often as you like; one snapshot per account per day is kept. A snapshot is also taken automatically each night; see Settings."))), shapeBox, out);
  load().catch((e) => fill(out, h("div", { class: "err" }, e.message)));
}

// ---------- SimpleFIN ----------
function simplefinTab() {
  settingsBar($("simplefin"), { fields: [
    { path: "simplefin.startDaysBack", type: "number", label: "Days of history to fetch" },
    { path: "simplefin.cacheHours", type: "number", label: "Reuse the last fetch for (hours)", hint: "SimpleFIN limits how often you can pull.", tip: "Within this many hours the app shows the saved copy instead of calling SimpleFIN again." },
  ] });
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
  settingsBar($("venmo"), { fields: [
    { path: "venmo.dayWindow", type: "number", label: "Match within (days)", hint: "How far apart the bank and statement dates may be.", tip: "A Venmo statement row matches a bank transaction when the amounts are equal to the cent and the dates are within this many days." },
    { path: "venmo.payeeRegex", type: "text", label: "Bank payee pattern", hint: "Bank rows whose payee matches this are treated as Venmo.", tip: "A pattern (case-insensitive) matched against the bank payee name. 'venmo' catches payees containing that word." },
    { path: "venmo.keywordCategories", type: "kv", label: "Categorize by keyword", kvLabels: ["Word in the note", "Actual category name"], hint: "If a Venmo note contains the word, use that category when none is already set." },
  ], extra: actualCheck });
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

function amazonTab() {
  settingsBar($("amazon"), { fields: [
    { path: "amazon.dayWindow", type: "number", label: "Match within (days)", hint: "Amazon bills when an order ships, so allow a few days around the ship date.", tip: "An order (or one shipment of it) matches a bank charge when the total is equal to the cent and the dates are within this many days." },
    { path: "amazon.payeeRegex", type: "text", label: "Bank payee pattern", hint: "Bank rows whose payee matches this are treated as Amazon.", tip: "A pattern (case-insensitive) matched against the bank payee, imported payee and notes. 'amazon|amzn' catches AMZN Mktp, Amazon.com and Prime Video." },
    { path: "amazon.keywordCategories", type: "kv", label: "Categorize by item keyword", kvLabels: ["Word in the item name", "Actual category name"], hint: "If an item name contains the word, that order gets that category. With several items, the one that costs the most decides; you can change it before applying." },
  ], extra: actualCheck });
  const root = $("amazon"), out = h("div"), file = h("input", { type: "file", accept: ".csv,text/csv" }), area = h("textarea", { rows: 4, placeholder: "...or paste the CSV text here", style: "width:100%" }), go = h("button", { class: "act" }, "Preview matches");
  let csv = "";
  file.addEventListener("change", async () => { const f = file.files[0]; if (f) { csv = await f.text(); area.value = ""; } });
  async function preview() {
    const text = area.value.trim() || csv; if (!text) { fill(out, h("div", { class: "err" }, "Choose an Amazon order history CSV first.")); return; }
    await busy(go, out, async () => {
      const r = await api("/api/amazon/preview", { body: { csv: text } }), c = r.counts, picks = new Map(), cats = new Map();
      const apply = h("button", { class: "act" }, "Apply selected to Actual"), msg = h("div"), replace = h("input", { type: "checkbox" });
      const rows = r.matched.map((m) => {
        const cb = h("input", { type: "checkbox", checked: true }); picks.set(m.key, cb);
        const sel = h("select", {}, h("option", { value: "" }, m.keepsExistingCategory ? `(keep: ${m.existingCategory || "existing"})` : "(none)"), r.categories.map((k) => h("option", { value: k.id, selected: k.id === m.categoryId && (!m.keepsExistingCategory || m.categorySource !== "existing") }, k.name))); cats.set(m.key, sel);
        const items = h("div", {}, m.items.slice(0, 4).map((i) => h("div", {}, `${i.name.length > 70 ? i.name.slice(0, 69) + "…" : i.name}${i.qty > 1 ? " x" + i.qty : ""} `, h("span", { class: "mute" }, usd(i.amount, 2)))), m.items.length > 4 ? h("div", { class: "mute" }, `+${m.items.length - 4} more`) : null);
        return h("tr", {}, h("td", { "data-label": "Use" }, cb), h("td", { "data-label": "Bank date" }, m.bankDate), h("td", { class: "n", "data-label": "Amount" }, usd(m.amount, 2)), h("td", { "data-label": "Items" }, items), h("td", { "data-label": "Category" }, sel, m.mixed ? h("div", { class: "warn" }, "Mixed order") : null), h("td", { class: "mute", "data-label": "Why" }, m.categorySource));
      });
      apply.addEventListener("click", async () => {
        const keys = [...picks].filter(([, cb]) => cb.checked).map(([k]) => k), overrides = {};
        for (const k of keys) { const v = cats.get(k).value, m = r.matched.find((x) => x.key === k); if (v && v !== m.categoryId) overrides[k] = v; }
        if (!keys.length) return;
        if (!confirm(`Update ${keys.length} transaction(s) in Actual? This adds the item names to the notes and sets the category where you chose one.`)) return;
        apply.disabled = true;
        try { const res = await api("/api/amazon/apply", { body: { csv: text, keys, categoryOverrides: overrides, replaceCategory: replace.checked } }); msg.replaceChildren(h("div", {}, `Updated ${res.updated} transaction(s).` + (res.skipped.length ? ` ${res.skipped.length} skipped.` : ""))); } catch (e) { msg.replaceChildren(h("div", { class: "err" }, e.message)); } finally { apply.disabled = false; }
      });
      fill(out,
        h("div", { class: "card mute" }, `${c.itemRows} item rows: ${c.matched} charge(s) matched to bank transactions, ${c.unmatchedOrders} with no bank match, ${c.alreadyApplied} already applied earlier${c.skipped ? `, ${c.skipped} cancelled or returned items ignored` : ""}. ${c.unmatchedBank} Amazon-looking bank transaction(s) have no order in this file.`),
        r.matched.length ? h("div", {}, h("div", { class: "tablewrap stackwrap" }, h("table", { class: "stack" }, h("thead", {}, h("tr", {}, ["Use", "Bank date", "Amount", "Items", "Category", "Why"].map((x) => h("th", {}, x)))), h("tbody", {}, rows))),
          h("label", { class: "check", style: "margin:8px 0" }, replace, "Also replace a category Actual already set when I picked a different one"), h("div", { class: "row", style: "margin:10px 0" }, apply), msg) : null,
        r.unmatchedOrders.length ? [h("h2", {}, "In the orders file, no bank match"), table([{ label: "Date", key: "date" }, { label: "Amount", num: 1, render: (x) => usd(x.amount, 2) }, { label: "Items", key: "items" }, { label: "Reason", key: "reason" }], r.unmatchedOrders, { stack: r.unmatchedOrders.length < 30 })] : null,
        r.unmatchedBank.length ? [h("h2", {}, "In the bank, no order in this file (request a newer export?)"), table([{ label: "Date", key: "date" }, { label: "Amount", num: 1, render: (x) => usd(x.amount, 2) }, { label: "Bank shows", key: "payee" }, { label: "Account", key: "account" }], r.unmatchedBank)] : null);
    });
  }
  go.addEventListener("click", preview);
  root.append(h("div", { class: "card" }, h("div", { class: "mute", style: "margin-bottom:8px" }, "Amazon has no personal API, so this uses your order history file. Request it from Amazon (Account > Request My Data > Your Orders; it arrives by email and can take a few days) and upload Retail.OrderHistory.1.csv from the zip. A browser extension that exports order history to CSV also works. Preview shows what would change; nothing is written until you press Apply."), h("div", { class: "row" }, file, go), area), out);
}

// ---------- Per-tab settings ----------
// Each tab has its own "Settings" button that opens a form for the settings that tab uses.
// fields: {path, label, type: number|text|list|accounts|kv, scale?, nullable?, hint?, tip?, kvLabels?}
function settingsBar(root, { fields = [], extra = null, title = "Settings" } = {}) {
  const btn = h("button", { class: "alt gear", "aria-expanded": "false" }, "⚙ " + title), box = h("div", { class: "card settings", hidden: true });
  let built = false, readers = [];
  const getPath = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
  const setPath = (o, p, v) => { const ks = p.split("."), last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
  async function build() {
    const S = await api("/api/settings"); let accts = [];
    if (fields.some((f) => f.type === "accounts")) { try { accts = (await api("/api/accounts")).filter((a) => !a.offbudget); } catch { accts = []; } }
    readers = []; const msg = h("div"), grid = h("div", { class: "row fields" });
    for (const f of fields) {
      const v = getPath(S, f.path), scale = f.scale || 1; let el, read;
      if (f.type === "number") { el = h("input", { type: "number", class: "in", step: "any", inputmode: "decimal", value: v == null ? "" : Math.round(v * scale * 1e6) / 1e6, placeholder: f.nullable ? "none" : "" }); read = () => (el.value === "" ? (f.nullable ? null : 0) : Number(el.value) / scale); }
      else if (f.type === "text") { el = h("input", { type: "text", class: "in", value: v || "" }); read = () => el.value; }
      else if (f.type === "bool") { el = h("input", { type: "checkbox" }); el.checked = !!v; read = () => el.checked; }
      else if (f.type === "time") { el = h("input", { type: "time", class: "in", value: v || "" }); read = () => el.value; }
      else if (f.type === "list") { el = h("input", { type: "text", class: "in", value: (v || []).join(", "), placeholder: "separate with commas" }); read = () => el.value.split(",").map((x) => x.trim()).filter(Boolean); }
      else if (f.type === "accounts") {
        const chosen = new Set(v || []); const boxes = accts.map((a) => { const c = h("input", { type: "checkbox" }); c.checked = chosen.has(a.name); return { a, c }; });
        el = h("div", { class: "checks" }, boxes.length ? boxes.map(({ a, c }) => h("label", { class: "check" }, c, `${a.name} (${usd(a.balance)})`)) : h("span", { class: "mute" }, "No accounts available from Actual."));
        read = () => boxes.filter(({ c }) => c.checked).map(({ a }) => a.name);
      } else if (f.type === "kv") {
        const rows = Object.entries(v || {}).map(([k, val]) => ({ k, val })), holder = h("div", { class: "kv" });
        const draw = () => fill(holder, rows.map((r, i) => h("div", { class: "kvrow" }, h("input", { type: "text", class: "in", value: r.k, placeholder: f.kvLabels?.[0] || "word", oninput: (e) => (r.k = e.target.value) }), h("input", { type: "text", class: "in", value: r.val, placeholder: f.kvLabels?.[1] || "category", oninput: (e) => (r.val = e.target.value) }), h("button", { class: "alt", onclick: () => { rows.splice(i, 1); draw(); } }, "Remove"))),
          h("button", { class: "alt", onclick: () => { rows.push({ k: "", val: "" }); draw(); } }, "+ Add"));
        draw(); el = holder; read = () => Object.fromEntries(rows.filter((r) => r.k.trim() && r.val.trim()).map((r) => [r.k.trim(), r.val.trim()]));
      }
      readers.push([f.path, read]);
      grid.append(h("label", { class: "setfield" + (f.type === "accounts" || f.type === "kv" ? " wide" : "") }, h("span", { class: "lbl" }, f.label, f.tip ? tip(f.tip) : null), el, f.hint ? h("small", { class: "mute" }, f.hint) : null));
    }
    const save = h("button", { class: "act" }, "Save settings");
    save.addEventListener("click", async () => {
      save.disabled = true; fill(msg);
      try { const cur = await api("/api/settings"); for (const [path, read] of readers) setPath(cur, path, read()); await api("/api/settings", { method: "PUT", body: cur }); fill(msg, h("div", { class: "ok" }, "Saved. Run the calculation again to use the new values.")); }
      catch (e) { fill(msg, h("div", { class: "err" }, e.message)); } finally { save.disabled = false; }
    });
    fill(box, fields.length ? grid : null, extra ? extra() : null, fields.length ? h("div", { class: "row actions" }, save) : null, msg);
  }
  btn.addEventListener("click", async () => {
    const open = box.hidden; box.hidden = !open; btn.setAttribute("aria-expanded", String(open));
    if (open && !built) { built = true; try { await build(); } catch (e) { fill(box, h("div", { class: "err" }, e.message)); built = false; } }
  });
  root.append(h("div", { class: "toolbar" }, btn), box);
}

// ---------- Assets: house, vehicles, camper ----------
const ASSET_LABEL = { home: "Home", vehicle: "Vehicle", camper: "Camper / RV", other: "Other" };
function assetsTab() {
  const root = $("assets"), out = h("div"), today = new Date().toISOString().slice(0, 10);
  settingsBar(root, { fields: [
    { path: "reminders.enabled", label: "Remind me monthly to update values", type: "bool", tip: "A banner appears at the top of every page, starting on the reminder day, for each asset you have not updated by hand this month. If NOTIFY_URL is set on the server, a push is also sent that day and every 7 days while something is still due." },
    { path: "reminders.day", label: "Reminder day of the month (1-28)", type: "number" },
  ] });
  const field = (label, el) => h("label", { class: "setfield" }, h("span", { class: "lbl" }, label), el);
  const mk = (type, val, extra = {}) => h("input", { type, class: "in", step: "any", value: val ?? "", ...extra });
  let accounts = [], cdOn = false, fredOn = false, due = new Set();
  const acctSelect = (cur) => { const s = h("select", {}, h("option", { value: "" }, "None, I'll enter values by hand"), accounts.map((a) => h("option", { value: a.name }, `${a.name} (${usd(a.balance)})`))); s.value = cur || ""; return s; };
  const guard = (box, fn) => async () => { try { await fn(); } catch (e) { box.replaceChildren(h("div", { class: "err" }, e.message)); } };

  function assetForm(a, done) {
    const name = mk("text", a?.name, { placeholder: "e.g. Primary home" }), type = h("select", {}, Object.entries(ASSET_LABEL).map(([k, v]) => h("option", { value: k }, v))); type.value = a?.type || "home";
    const link = acctSelect(a?.actualAccount), watch = mk("text", a?.watchId, { placeholder: "Paste the watch ID or its edit URL" }), rx = mk("text", a?.valueRegex, { placeholder: "Optional, e.g. Zestimate[^$]*\\$([0-9,]+)" }), msg = h("div"), val = mk("number", "", { min: 0, inputmode: "decimal", placeholder: "Current value" });
    const lookup = mk("url", a?.lookupUrl, { placeholder: "Paste your Zillow, Redfin or KBB page" }), remindCb = h("input", { type: "checkbox" }); remindCb.checked = a ? a.remind !== false : true;
    const E = a?.estimate || {}, em = h("select", {}, h("option", { value: "" }, "No automatic estimate"), h("option", { value: "index" }, "House price index (FRED)"), h("option", { value: "depreciation" }, "Depreciation (vehicles, campers)")); em.value = E.method || "";
    const eBase = mk("number", E.baseValue, { min: 0, placeholder: "Known value ($)" }), eDate = mk("date", E.baseDate || today), eSeries = mk("text", E.series || "USSTHPI", { placeholder: "FRED series, e.g. USSTHPI" }), eRate = mk("number", E.annualRate != null ? Math.round(E.annualRate * 1000) / 10 : 12, { min: 0, max: 60, step: "0.1" });
    const eBox = h("div"), hint = (t) => h("small", { class: "mute", style: "display:block;margin:6px 0" }, t);
    const drawE = () => fill(eBox, em.value ? [h("div", { class: "row fields" }, field("Known value ($)", eBase), field("As of", eDate), em.value === "index" ? field("FRED index series", eSeries) : field("Yearly depreciation (%)", eRate)),
      hint(em.value === "index" ? (fredOn ? "A house price index scales your known value by how the index has moved since that date. FHFA publishes free indexes by state and metro area on FRED (search FRED for \"All-Transactions House Price Index\" and your area); USSTHPI is the US average. Indexes update quarterly." : "House price index estimates need a free FRED API key: set FRED_API_KEY on the server (see README).") : "Depreciation ages your known value at a steady yearly rate. It ignores mileage and condition, so replace it with a real quote when you have one.")] : null);
    em.addEventListener("change", drawE); drawE();
    const save = h("button", { class: "act" }, a ? "Save changes" : "Add asset");
    save.addEventListener("click", guard(msg, async () => {
      const rec = await api("/api/assets", { body: { id: a?.id, name: name.value, type: type.value, actualAccount: link.value || null, lookupUrl: lookup.value.trim(), remind: remindCb.checked, watchId: watch.value.trim() || null, valueRegex: rx.value.trim(), estimate: em.value ? { method: em.value, baseValue: +eBase.value, baseDate: eDate.value, series: eSeries.value.trim(), annualRate: (+eRate.value || 0) / 100 } : null } });
      if (!a && val.value !== "") await api("/api/assets/value", { body: { id: rec.id, date: today, value: +val.value, note: "Starting value" } });
      done();
    }));
    return h("div", { class: "card" }, h("div", { class: "row fields" }, field("Name", name), field("Type", type), field("Take the value from an Actual account", link), a ? null : field("Value today ($)", val)),
      h("div", { class: "row fields" }, field("Link to check the value (optional)", lookup), h("label", { class: "check" }, remindCb, "Remind me monthly")),
      h("div", { class: "row fields" }, field("changedetection.io watch (optional)", watch), field("Value pattern (optional)", rx)),
      h("div", { class: "row fields" }, field("Estimate automatically", em)), eBox,
      h("small", { class: "mute", style: "display:block;margin:6px 0" }, cdOn ? "Each night the app reads the watch's latest snapshot and takes the first dollar amount in it, or the first group of your pattern. A reading more than 25% away from the last value is held back for you to check." : "changedetection.io is not connected. Set CHANGEDETECTION_URL and CHANGEDETECTION_API_KEY on the server (see README) to use a watch."),
      h("small", { class: "mute", style: "display:block;margin-top:6px" }, "Linking to an Actual account records that account's balance in each nightly snapshot, so the value updates by itself. Without a link, type in a new value whenever you check Zillow, KBB or a dealer quote."),
      h("div", { class: "row actions" }, save, h("button", { class: "alt", onclick: done }, "Cancel")), msg);
  }

  function assetCard(a) {
    const msg = h("div"), cur = a.current, stale = a.daysOld != null && a.daysOld > 90 && !a.actualAccount;
    const val = mk("number", "", { min: 0, inputmode: "decimal", placeholder: "New value" }), date = mk("date", today), note = mk("text", "", { placeholder: "Note (optional), e.g. KBB trade-in" });
    const saveV = h("button", { class: "act" }, "Save value");
    saveV.addEventListener("click", guard(msg, async () => { await api("/api/assets/value", { body: { id: a.id, date: date.value, value: val.value === "" ? null : +val.value, note: note.value } }); await load(); }));
    const delta = (v, label) => (v == null ? null : h("span", { class: v >= 0 ? "up" : "down" }, `${v >= 0 ? "+" : "-"}${usd(Math.abs(v))} ${label}`));
    const hist = h("details", {}, h("summary", {}, `History (${a.values.length})`), table([{ label: "Date", key: "date" }, { label: "Value", num: 1, render: (x) => usd(x.value) }, { label: "Source", render: (x) => (x.source === "actual" ? "Actual account" : x.source === "changedetection" ? "changedetection.io" : x.source === "estimate" ? "Estimate" : "Entered by hand") }, { label: "Note", key: "note" },
      { label: "", render: (x) => h("button", { class: "alt", onclick: guard(msg, async () => { if (confirm(`Delete the ${x.date} entry?`)) { await api("/api/assets/value/delete", { body: { id: a.id, date: x.date } }); await load(); } }) }, "Delete") }], a.values.slice().reverse(), { stack: a.values.length < 30 }));
    const fetchB = a.watchId ? h("button", { class: "alt" }, "Fetch now") : null;
    fetchB?.addEventListener("click", guard(msg, async () => { fetchB.disabled = true; try { const r = await api("/api/assets/fetch", { body: { id: a.id } }); await load(); } finally { fetchB.disabled = false; } }));
    const lf = a.lastFetch ? h("div", { class: a.lastFetch.ok ? "mute" : "warn" }, `changedetection.io, ${new Date(a.lastFetch.at).toLocaleString()}: ${a.lastFetch.message}`) : null;
    const estB = a.estimate ? h("button", { class: "alt" }, "Estimate now") : null;
    estB?.addEventListener("click", guard(msg, async () => { estB.disabled = true; try { await api("/api/assets/estimate", { body: { id: a.id } }); await load(); } finally { estB.disabled = false; } }));
    const defaults = { home: [["Zillow", "https://www.zillow.com/"], ["Redfin", "https://www.redfin.com/"]], vehicle: [["Kelley Blue Book", "https://www.kbb.com/whats-my-car-worth/"]] }[a.type] || [];
    const links = h("div", { class: "row actions" }, a.lookupUrl ? h("a", { class: "btnlink", href: a.lookupUrl, target: "_blank", rel: "noopener noreferrer" }, "Open my page") : null,
      !a.lookupUrl ? defaults.map(([n, u]) => h("a", { class: "btnlink", href: u, target: "_blank", rel: "noopener noreferrer" }, n)) : null,
      !a.lookupUrl && defaults.length ? h("small", { class: "mute" }, "Tip: edit this asset and paste the exact page for your property or vehicle to open it in one click.") : null);
    const dueNow = due.has(a.id);
    const edit = h("button", { class: "alt", onclick: () => card.replaceWith(h("div", {}, assetForm(a, () => load()))) }, "Edit"), del = h("button", { class: "alt", onclick: guard(msg, async () => { if (confirm(`Remove ${a.name} and its history?`)) { await api("/api/assets/delete", { body: { id: a.id } }); await load(); } }) }, "Remove");
    const card = h("div", { class: "card asset" },
      h("div", { class: "row" }, h("b", { class: "hval" }, a.name), h("span", { class: "pill" }, ASSET_LABEL[a.type] || a.type), a.actualAccount ? h("span", { class: "mute" }, `from Actual: ${a.actualAccount}`) : null, h("span", { style: "flex:1" }), estB, fetchB, edit, del),
      cur ? h("div", { class: "row" }, h("b", { style: "font-size:1.5rem" }, usd(cur.value)), h("span", { class: "mute" }, `as of ${cur.date}${a.daysOld ? ` (${a.daysOld} days ago)` : ""}`), delta(a.changeSincePrevious, "since previous"), delta(a.changeSinceFirst, `since ${a.firstDate}`)) : h("div", { class: "mute" }, "No value yet. Enter one below."),
      lf,
      dueNow ? h("div", { class: "warn" }, "Due this month: look up the current value, then enter it below.") : null, links,
      stale ? h("div", { class: "warn" }, `This value is ${a.daysOld} days old. Update it so the history stays meaningful.`) : null,
      h("div", { class: "row fields" }, field("New value ($)", val), field("As of", date), field("Note", note)), h("div", { class: "row actions" }, saveV), msg, a.values.length ? hist : null);
    return card;
  }

  async function load() {
    const [r, accts] = await Promise.all([api("/api/assets"), api("/api/accounts").catch(() => [])]); accounts = accts; cdOn = r.changedetection; fredOn = r.fred; try { due = new Set((await api("/api/reminders")).items.map((x) => x.id)); } catch { due = new Set(); } refreshReminder();
    const total = r.assets.reduce((s, a) => s + (a.current ? a.current.value : 0), 0);
    const addBox = h("div"), addBtn = h("button", { class: "act", onclick: () => fill(addBox, assetForm(null, () => load())) }, "+ Add asset");
    fill(out,
      h("div", { class: "kpis" }, h("div", { class: "kpi" }, h("b", {}, usd(total)), h("span", {}, "Total, latest values")), h("div", { class: "kpi" }, h("b", {}, r.assets.length), h("span", {}, "Assets tracked"))),
      h("div", { class: "row actions" }, addBtn), addBox,
      !r.assets.length ? h("div", { class: "mute" }, "Add your house, vehicles and camper. Mortgage and loan balances stay in Actual; this tab tracks what the things are worth.") : null,
      r.series.length ? [h("h2", {}, "Value over time"), historyChart(r.series)] : null,
      r.assets.map(assetCard));
  }
  root.append(strategyBox(false), h("div", { class: "mute" }, "Track what your home, vehicles and camper are worth. Enter a value whenever you look one up, or link an asset to an Actual account and it updates in the nightly snapshot."), out);
  load().catch((e) => fill(out, h("div", { class: "err" }, e.message)));
}
// "Test connection to Actual" button, used in the settings of the tabs that read Actual.
function actualCheck() {
  const chk = h("button", { class: "alt" }, "Test connection to Actual"), out = h("span", { class: "mute" });
  chk.addEventListener("click", async () => { chk.disabled = true; out.textContent = "Testing..."; out.className = "mute"; try { const r = await api("/api/actual/check"); out.textContent = r.message; out.className = r.ok ? "ok" : "err"; } catch (e) { out.textContent = e.message; out.className = "err"; } finally { chk.disabled = false; } });
  return h("div", { class: "row actions" }, chk, out);
}

// ---------- how Invest, Assets and Actual fit together ----------
const STRATEGY = [
  ["Actual", "Day-to-day money: checking, savings, credit cards, your mortgage and loans, and your budget. The companion only reads it (and, if you press Apply, adds notes or categories to Venmo and Amazon transactions). It never changes balances."],
  ["Invest tab", "Brokerage balances read from SnapTrade (read-only) and saved here as a snapshot every night, so you get a history without keeping those accounts in Actual. If you do keep investment accounts in Actual as off-budget accounts, money you move into them counts as 'to investments / debt' in the Loan planner."],
  ["Assets tab", "Things with no bank feed: your home, vehicles and camper. Values are typed in (a monthly reminder asks), estimated from a price index or depreciation, or taken from an Actual account if you track the asset there."],
  ["Loan planner", "Reads cash, income, spending and your mortgage balance from Actual, and the home value from an Actual account or custom value. It does not yet use the Assets tab's home value automatically."],
  ["Net worth", "Investments (Invest) + assets (Assets) + cash (Actual) - debts (Actual). A combined net-worth page is not built yet."],
];
const strategyBox = (open = false) => h("details", { class: "strategy", open }, h("summary", {}, "How Invest, Assets and Actual fit together"), h("dl", {}, STRATEGY.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])));
(function tabHoverStrategy() { // hover a tab for about a second and a half to see the strategy; leave to hide it
  const box = h("div", { id: "stratbox", role: "tooltip", hidden: true }); document.body.append(box);
  let t = null;
  const hide = () => { clearTimeout(t); box.hidden = true; };
  document.addEventListener("mouseover", (e) => {
    if (!matchMedia("(hover: hover)").matches) return;
    const b = e.target.closest && e.target.closest("#tabs button");
    clearTimeout(t); if (!b || !["invest", "assets"].includes(b.dataset.tab)) { box.hidden = true; return; }
    t = setTimeout(() => { fill(box, h("b", {}, "How Invest, Assets and Actual fit together"), STRATEGY.map(([k, v]) => h("p", {}, h("b", {}, k + ": "), v))); box.hidden = false; const r = b.getBoundingClientRect(); box.style.left = Math.min(Math.max(8, r.left), innerWidth - box.offsetWidth - 8) + "px"; box.style.top = r.bottom + 8 + "px"; }, 1500);
  });
  document.addEventListener("mouseout", (e) => { if (!e.relatedTarget || !(e.relatedTarget.closest && e.relatedTarget.closest("#tabs button"))) hide(); });
  addEventListener("scroll", hide, { passive: true });
})();

// ---------- monthly reminder banner ----------
async function refreshReminder() {
  const el = $("reminder");
  try {
    const r = await api("/api/reminders");
    if (!r.count) { el.hidden = true; return; }
    el.hidden = false;
    fill(el, h("span", {}, `Time to update ${r.count === 1 ? "this value" : r.count + " values"}: ${r.items.map((i) => i.name).join(", ")}.`), h("button", { class: "alt", onclick: () => show("assets") }, "Open Assets"));
  } catch { el.hidden = true; }
}

// ---------- shell ----------
const loaded = {};
const inits = { loan: loanTab, budget: budgetTab, invest: investTab, assets: assetsTab, simplefin: simplefinTab, venmo: venmoTab, amazon: amazonTab };
async function show(name) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll("main section").forEach((s) => (s.hidden = s.id !== name));
  if (!loaded[name]) { loaded[name] = true; try { await inits[name](); } catch (e) { $(name).append(h("div", { class: "err" }, e.message)); } }
}
$("tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.tab); });
api("/api/status").then((s) => { if (s.version) $("ver").textContent = "v" + s.version; $("status").textContent = `Actual ${s.actual ? "configured" : "NOT configured"} · SimpleFIN ${s.simplefin ? "on" : "off"} · SnapTrade ${s.snaptrade ? (s.snaptradeConnected ? "connected" : "not connected") : "off"}`; }).catch(() => {});
show("loan");
refreshReminder();
