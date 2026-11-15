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
  return h("div", {}, h("div", { class: "mute" }, "Tap or hover the chart to pick a snapshot; the dashed rings are the snapshots before and after it."), svg, detail, h("h2", {}, "Snapshots over time"), h("div", { class: "tablewrap stackwrap" }, t));
}
function download(name, text, type) { const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove(); }
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function addMonthsJs(ym, n) { const [y, m] = ym.split("-").map(Number), t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; }
// ---------- Loan ----------
const TIPS = {
  purchases: "Large cash purchases you expect. Each one is subtracted from your projected cash in the month you pick. Loans are sized to cover the months where cash would otherwise fall below your floor.",
  situation: "Your cash, income, spending and investing come from Actual: cash is the balance of your on-budget accounts today; income, spending and investing are the average of the last 12 months of transactions (transfers to off-budget accounts count as investing, transfers between on-budget accounts are ignored).",
  homeValue: "Used for the equity limit on loans secured by your home: maximum loan = max combined LTV x home value - mortgage - other liens. Pick an Actual account to use its current balance, or type a value.",
  maxLtv: "Maximum combined loan-to-value a lender allows: (mortgage + other liens + new loan) / home value. 80-85% is typical for home equity products.",
  reserve: "The reserve is a cash buffer you want to keep: reserve months x your monthly spending. Your floor = reserve (if kept) + extra cushion. Loans are sized so cash never drops below the floor.",
  cushion: "Extra dollars kept above the reserve. The floor = reserve + this cushion.",
  horizon: "How many months ahead to project cash. Loan sizing and payoff checks only look this far.",
  payoffPct: "The most you are willing to spend on loan payments each month, as a share of your monthly surplus (income - spending - investing). Payoff strategies above this are marked over budget.",
  loans: "Each loan is sized separately using its own rate, interest-only period, term and fees. Rate and fee are percentages. The interest-only period is a draw period where you pay only interest (typical for a HELOC).",
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
  const purchases = S.projection.purchases.map((p) => ({ ...p })), products = S.loan.products.map((p) => ({ ...p }));
  const nextMonth = (k) => { const d = new Date(); d.setMonth(d.getMonth() + k); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
  const inp = (type, val, on, extra = {}) => { const e = h("input", { type, class: "in", step: "any", value: val ?? "", ...extra }); e.addEventListener("input", () => on(e)); return e; };
  const numOrNull = (e) => (e.value === "" ? null : Number(e.value));

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
        { label: "Interest", num: 1, tip: TIPS.interest, render: (x) => usd(x.totalInterest) }, { label: "Fees", num: 1, tip: TIPS.fees, render: (x) => usd(x.upfrontFees) }, { label: "Total cost", num: 1, tip: TIPS.totalCost, render: (x) => usd(x.totalCostOfBorrowing) },
        { label: "Result", tip: TIPS.result, render: (x) => pill(x.verdict.code, VERDICT_LABEL) }, { label: "", render: (x) => (x.name === selected ? h("b", { class: "mute" }, "Showing below") : h("button", { class: "alt", onclick: () => { selected = x.name; calc(false); } }, "Show details")) }], r.comparison,
        { rowClass: (x) => (x.name === selected ? "sel" : "") }),
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
      lineChart([{ name: "Cash, no loan", color: "#888", dash: true, values: r.rows.map((x) => x.cash) }, { name: "Cash, with loan", color: "#1f5fbf", values: r.rows.map((x) => x.cashWithLoan) }, { name: "Reserve target", color: "#c55a11", dash: true, values: r.rows.map((x) => x.reserve) }], r.rows.map((x) => x.label)),
      payoffSection(r),
      stepH(null, "Month by month"),
      table([{ label: "Month", key: "label" }, { label: "Cash, no loan", num: 1, render: (x) => usd(x.cash) }, { label: "Purchases", num: 1, render: (x) => usd(x.purchases) }, { label: "Reserve", num: 1, tip: "Reserve target = reserve months x that month's spending (or your fixed amount).", render: (x) => usd(x.reserve) },
        { label: "Cash, with loan", num: 1, tip: "Cash without the loan + (loan x (1 - fee % - payments so far per $1) - fixed fee).", render: (x) => usd(x.cashWithLoan) }, { label: "Loan payment", num: 1, render: (x) => usd(x.loanPayment) }, { label: "No loan", key: "statusNoLoan" }, { label: "With loan", key: "statusWithLoan" }], r.rows,
        { stack: false, rowClass: (x) => (x.statusWithLoan === "SHORTFALL" ? "bad" : "") }));
  }

  function payoffSection(r) {
    const po = r.payoff;
    if (!po || !po.plans.length) return null;
    const best = po.plans.find((p) => p.key === po.bestKey), min = po.plans.find((p) => p.key === "minimum");
    const yrs = (m) => (m % 12 === 0 ? m / 12 + " yr" : (m / 12).toFixed(1) + " yr");
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
  drawPurchases(); drawProducts();
  root.append(
    h("div", { class: "intro" }, h("b", {}, "Plan a large purchase."), " Blue boxes are inputs; everything else is calculated. Your cash, income and spending are read from Actual. Hover or tap the ", tip("Like this: an explanation of how the number is worked out."), " marks to see how each number is calculated."),
    stepH(1, "Planned large purchases", TIPS.purchases), h("div", { class: "card" }, pBox),
    stepH(2, "Your situation", TIPS.situation),
    h("div", { class: "card" }, acctNote ? h("div", { class: "warn" }, acctNote) : h("div", { class: "mute note" }, "Pick an Actual account to use its current balance (a mortgage shows as a positive amount owed), or choose Custom value and type a number."), h("div", { class: "row fields" },
      field("Home value: account", src.homeValue.sel, null, TIPS.homeValue), field("Home value ($)", src.homeValue.num), field("Mortgage: account", src.mortgage.sel), field("Mortgage balance ($)", src.mortgage.num),
      field("Other liens: account", src.otherLiens.sel), field("Other liens ($)", src.otherLiens.num), field("Max combined LTV (%)", f.maxLtv, "usually 80-85", TIPS.maxLtv),
      field("Keep a reserve?", f.protect, null, TIPS.reserve), field("Reserve (months)", f.reserveMonths), field("Extra cushion ($)", f.cushion, null, TIPS.cushion), field("Look ahead (months)", f.horizon, null, TIPS.horizon), field("Payment cap (% of surplus)", f.payoffPct, "for payoff strategies", TIPS.payoffPct)),
      h("details", { class: "more" }, h("summary", {}, "Override what Actual says (monthly $)"), h("div", { class: "row fields" }, field("Income", f.income), field("Spending", f.expenses), field("To investments/debt", f.investing)))),
    stepH(3, "Loans to compare", TIPS.loans), h("div", { class: "card" }, prBox, h("div", { class: "mute note" }, "Rate and fee are percentages. Interest-only years: payments are interest only before the repayment term starts (a HELOC draw period).")),
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
  settingsBar(root, { extra: () => h("div", { class: "row actions" }, shapeBtn, h("span", { class: "mute" }, "Diagnostic: shows the names and types of fields SnapTrade returns (no balances or account numbers), useful if a brokerage looks wrong.")) });
  root.append(h("div", { class: "card" }, h("div", { class: "row" }, connect, refresh, h("span", { class: "mute" }, "Snapshots are stored by this app, not in Actual. Refresh as often as you like; one snapshot per account per day is kept."))), shapeBox, out);
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
// "Test connection to Actual" button, used in the settings of the tabs that read Actual.
function actualCheck() {
  const chk = h("button", { class: "alt" }, "Test connection to Actual"), out = h("span", { class: "mute" });
  chk.addEventListener("click", async () => { chk.disabled = true; out.textContent = "Testing..."; out.className = "mute"; try { const r = await api("/api/actual/check"); out.textContent = r.message; out.className = r.ok ? "ok" : "err"; } catch (e) { out.textContent = e.message; out.className = "err"; } finally { chk.disabled = false; } });
  return h("div", { class: "row actions" }, chk, out);
}

// ---------- shell ----------
const loaded = {};
const inits = { loan: loanTab, budget: budgetTab, invest: investTab, simplefin: simplefinTab, venmo: venmoTab };
async function show(name) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll("main section").forEach((s) => (s.hidden = s.id !== name));
  if (!loaded[name]) { loaded[name] = true; try { await inits[name](); } catch (e) { $(name).append(h("div", { class: "err" }, e.message)); } }
}
$("tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.tab); });
api("/api/status").then((s) => { $("status").textContent = `Actual ${s.actual ? "configured" : "NOT configured"} · SimpleFIN ${s.simplefin ? "on" : "off"} · SnapTrade ${s.snaptrade ? (s.snaptradeConnected ? "connected" : "not connected") : "off"}`; }).catch(() => {});
show("loan");
