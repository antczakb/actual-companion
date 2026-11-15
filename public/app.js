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

function addMonthsJs(ym, n) { const [y, m] = ym.split("-").map(Number), t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; }
// ---------- Loan ----------
const VERDICT_LABEL = { ok: "Works", "none-needed": "Not needed", caution: "Caution", equity: "Not enough home equity", infeasible: "Payments too high" };
async function loanTab() {
  const root = $("loan"), out = h("div"), msg = h("div");
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
      purchases.length ? h("div", { class: "tablewrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["What", "Month", "Amount ($)", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, purchases.map((p, i) => h("tr", {},
          h("td", {}, inp("text", p.name, (e) => (p.name = e.value), { placeholder: "e.g. Kitchen remodel" })),
          h("td", {}, inp("month", p.month, (e) => (p.month = e.value))),
          h("td", {}, inp("number", p.amount, (e) => { p.amount = e.value === "" ? 0 : +e.value; }, { min: 0 })),
          h("td", {}, h("button", { class: "alt", onclick: () => { purchases.splice(i, 1); drawPurchases(); } }, "Remove"))))))) :
        h("div", { class: "mute" }, "None yet. Add the large purchases you expect to pay for in cash."),
      h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "alt", onclick: () => { purchases.push({ name: "", month: nextMonth(3), amount: 0 }); drawPurchases(); } }, "+ Add purchase"), h("span", { class: "mute" }, purchases.length ? `Total planned: ${usd(total)}` : "")));
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
    const sync = () => { const a = accts.find((x) => x.name === sel.value); num.disabled = !!sel.value; num.value = a ? (liability ? Math.abs(a.balance) : Math.max(0, a.balance)) : customVal; };
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
    fill(prBox, h("div", { class: "tablewrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Loan", "Rate %", "Interest-only yrs", "Repay term yrs", "Fee %", "Fixed fee $", "Secured by home", ""].map((x) => h("th", {}, x)))),
      h("tbody", {}, products.map((p, i) => h("tr", {},
        h("td", {}, inp("text", p.name, (e) => (p.name = e.value))),
        h("td", {}, inp("number", Math.round(p.rate * 1e6) / 1e4, (e) => (p.rate = +e.value / 100), { min: 0 })),
        h("td", {}, inp("number", p.ioYears, (e) => (p.ioYears = +e.value), { min: 0 })),
        h("td", {}, inp("number", p.termYears, (e) => (p.termYears = +e.value), { min: 0 })),
        h("td", {}, inp("number", Math.round(p.feePct * 1e6) / 1e4, (e) => (p.feePct = +e.value / 100), { min: 0 })),
        h("td", {}, inp("number", p.fixedFee, (e) => (p.fixedFee = +e.value), { min: 0 })),
        h("td", {}, (() => { const c = h("input", { type: "checkbox" }); c.checked = !!p.secured; c.addEventListener("change", () => (p.secured = c.checked)); return c; })()),
        h("td", {}, products.length > 1 ? h("button", { class: "alt", onclick: () => { products.splice(i, 1); drawProducts(); } }, "Remove") : null)))))),
      h("div", { style: "margin-top:8px" }, h("button", { class: "alt", onclick: () => { products.push({ name: "New loan", rate: 0.08, ioYears: 0, termYears: 10, feePct: 0, fixedFee: 0, secured: false }); drawProducts(); } }, "+ Add loan")));
  }

  const go = h("button", { class: "act" }, "Save and calculate");
  const saveName = h("input", { type: "text", class: "in", placeholder: "Scenario name, e.g. Kitchen + car 2027", style: "min-width:280px" }), saveBtn = h("button", { class: "alt" }, "Save scenario");
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
      fill(scenOut, h("h2", {}, "Comparison"), table([{ label: "", render: (x) => h("b", {}, x.k) }, ...recs.map((r, i) => ({ label: r.name, render: (x) => x.v[i] }))], keys.map((k) => ({ k, v: vals.map((v) => v[k]) }))));
    });
    fill(scenBox, h("h2", {}, "Saved scenarios"),
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
    fill(scenOut, h("h2", {}, `${r.name} (saved ${when(r.savedAt)})`),
      h("div", { class: "card mute" }, `Purchases: ${cur}. Cash then ${usd(a.cashToday)}, income ${usd(a.monthlyIncome)}/mo, spending ${usd(a.monthlyExpenses)}/mo. Home ${usd(r.result.resolved.homeValue.value)}, mortgage ${usd(r.result.resolved.mortgage.value)}. These are the numbers as saved; use Load to re-run with today's data.`),
      table([{ label: "Loan", render: (x) => h("span", {}, x.recommended ? "★ " : "", x.name) }, { label: "Borrow", num: 1, render: (x) => usd(x.suggested) }, { label: "Payment: interest-only / repay", num: 1, render: (x) => usd(x.paymentInterestOnly) + " / " + usd(x.paymentRepayment) },
        { label: "Interest", num: 1, render: (x) => usd(x.totalInterest) }, { label: "Fees", num: 1, render: (x) => usd(x.upfrontFees) }, { label: "Total cost", num: 1, render: (x) => usd(x.totalCostOfBorrowing) }, { label: "Result", render: (x) => VERDICT_LABEL[x.verdict.code] || x.verdict.code }], r.result.comparison),
      lineChart([{ name: "Cash, no loan", color: "#888", dash: true, values: r.result.series.map((x) => x.cash) }, { name: `Cash, with ${r.result.selected.product}`, color: "#1f5fbf", values: r.result.series.map((x) => x.cashWithLoan) }, { name: "Reserve target", color: "#c55a11", dash: true, values: r.result.series.map((x) => x.reserve) }], r.result.series.map((x) => x.label)));
  }
  const adv = { loan: inp("number", "", () => {}, { min: 0, placeholder: "blank = suggested" }), draw: inp("month", "", () => {}) };

  async function save() {
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
    const s = r.summary, a = r.assumptions, kp = (v, l) => h("div", { class: "kpi" }, h("b", {}, v), h("span", {}, l));
    const rec = r.comparison.find((x) => x.recommended);
    fill(out,
      r.warnings.map((w) => h("div", { class: "warn" }, w)),
      h("h2", {}, "4. Result"),
      h("div", { class: "card mute" }, `Starting cash ${usd(a.cashToday)} (${a.cashAccounts.join(", ") || "no accounts"}) · income ${usd(a.monthlyIncome)}/mo · spending ${usd(a.monthlyExpenses)}/mo · to investments/debt ${usd(a.monthlyInvesting)}/mo · surplus ${usd(a.monthlySurplus)}/mo · based on ${a.monthsOfHistory} month(s) of history`),
      s.verdict.code === "none-needed" ? h("div", { class: "verdict none-needed" }, s.verdict.text) :
        h("div", { class: "verdict " + (rec ? "ok" : "caution") }, rec ? `Lowest-cost loan that works: ${rec.name}, borrow about ${usd(rec.suggested)} (total cost ${usd(rec.totalCostOfBorrowing)}).` : "None of these loans works as set up. See the Result column, then change a purchase, a loan, or your cushion."),
      h("h2", {}, "Which loan? Each one is sized for its own terms"),
      table([{ label: "Loan", render: (x) => h("span", {}, x.recommended ? "★ " : "", x.name) }, { label: "Borrow", num: 1, render: (x) => usd(x.suggested) }, { label: "Payment: interest-only / repay", num: 1, render: (x) => usd(x.paymentInterestOnly) + " / " + usd(x.paymentRepayment) },
        { label: "Interest", num: 1, render: (x) => usd(x.totalInterest) }, { label: "Fees", num: 1, render: (x) => usd(x.upfrontFees) }, { label: "Total cost", num: 1, render: (x) => usd(x.totalCostOfBorrowing) },
        { label: "Result", render: (x) => VERDICT_LABEL[x.verdict.code] || x.verdict.code }, { label: "", render: (x) => (x.name === selected ? h("b", {}, "Showing below") : h("button", { class: "alt", onclick: () => { selected = x.name; calc(false); } }, "Show details")) }], r.comparison,
        { rowClass: (x) => (x.name === selected ? "sel" : "") }),
      h("div", { class: "mute" }, "★ = cheapest loan whose payments still keep your cash above the floor. Total cost = interest + fees over the whole term."),
      h("div", { class: "card row" }, saveName, saveBtn, h("span", { class: "mute" }, "Saves your current inputs and this result so you can compare later.")),
      h("h2", {}, `Details: ${s.product}`),
      h("div", { class: "verdict " + s.verdict.code }, s.verdict.text),
      h("div", { class: "kpis" },
        kp(usd(s.suggested), "Suggested loan (rounded up)"), kp(usd(s.minLoan), "Minimum that keeps the floor"), kp(s.maxLoanByCashFlow == null ? "No limit" : usd(s.maxLoanByCashFlow), "Max your cash flow can repay"),
        kp(usd(s.maxLoanByEquity), "Max by home equity"), kp(s.drawLabel || "n/a", "Draw month"), kp(s.firstBelowLabel || "None", "First month below floor"),
        kp(usd(s.worstShortfall), "Worst gap without a loan"), kp(usd(s.paymentInterestOnly) + " / " + usd(s.paymentRepayment), "Payment: interest-only / repayment"),
        kp(pct(s.paymentPctOfSurplus), "Highest payment vs. monthly surplus"), kp(pct(s.combinedLtv), "Combined LTV")),
      lineChart([{ name: "Cash, no loan", color: "#888", dash: true, values: r.rows.map((x) => x.cash) }, { name: "Cash, with loan", color: "#1f5fbf", values: r.rows.map((x) => x.cashWithLoan) }, { name: "Reserve target", color: "#c55a11", dash: true, values: r.rows.map((x) => x.reserve) }], r.rows.map((x) => x.label)),
      payoffSection(r),
      h("h2", {}, "Month by month"),
      table([{ label: "Month", key: "label" }, { label: "Cash, no loan", num: 1, render: (x) => usd(x.cash) }, { label: "Purchases", num: 1, render: (x) => usd(x.purchases) }, { label: "Reserve", num: 1, render: (x) => usd(x.reserve) },
        { label: "Cash, with loan", num: 1, render: (x) => usd(x.cashWithLoan) }, { label: "Loan payment", num: 1, render: (x) => usd(x.loanPayment) }, { label: "No loan", key: "statusNoLoan" }, { label: "With loan", key: "statusWithLoan" }], r.rows,
        { rowClass: (x) => (x.statusWithLoan === "SHORTFALL" ? "bad" : "") }));
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
      h("h2", {}, "Payoff strategies (inside your budget)"),
      h("div", { class: "card mute" }, `Payments may use up to ${usd(po.budgetCap)}/month (${Math.round((r.payoff.budgetCap / Math.max(1, r.assumptions.monthlySurplus)) * 100)}% of your ${usd(r.assumptions.monthlySurplus)} surplus), and cash must stay above your floor through the look-ahead window. Payoff times count from the draw month${start ? " (" + start + ")" : ""}.`),
      best && best.key !== "minimum" ? h("div", { class: "verdict ok" }, `Best within budget: ${best.name.toLowerCase()}. Pay ${usd(best.payment)}/month, done by ${best.paidOffBy} (${yrs(best.months)}), saving ${usd(best.interestSaved)} in interest.`) :
        h("div", { class: "verdict caution" }, min.withinBudget ? "No faster payoff fits inside your budget and cash floor, so the minimum payments are the practical choice (you can still pay extra whenever cash allows)." :
          `Even the minimum payment (${usd(min.payment)}/month) is above your budget share (${usd(po.budgetCap)}/month) or would push cash under the floor. Try a longer-term loan from the comparison table, a smaller purchase, or a higher share in step 2.`),
      table([{ label: "Strategy", render: (x) => h("span", {}, x.key === po.bestKey ? "★ " : "", x.name) }, { label: "Monthly payment", num: 1, render: (x) => usd(x.payment) }, { label: "Paid off by", render: (x) => `${x.paidOffBy || ""} (${yrs(x.months)})` },
        { label: "Interest", num: 1, render: (x) => usd(x.totalInterest) }, { label: "Saved vs. minimum", num: 1, render: (x) => usd(x.interestSaved) }, { label: "Total cost", num: 1, render: (x) => usd(x.totalCost) },
        { label: "% of surplus", num: 1, render: (x) => pct(x.pctOfSurplus) }, { label: "Cash stays above floor", render: (x) => (x.floorOk ? "Yes" : "No") }, { label: "Within budget", render: (x) => (x.withinBudget ? "Yes" : "No") }], po.plans,
        { rowClass: (x) => (x.withinBudget ? (x.key === po.bestKey ? "sel" : "") : "bad") }),
      h("div", { class: "mute" }, "Payoff plans use a fixed payment from the first month after the draw; the last payment is smaller. Total cost = interest + fees. Rows in red are over budget or would push cash under the floor."),
      lineChart(curves.map((c) => ({ name: c.name, color: c.color, dash: c.dash, values: Array.from({ length: len }, (_, i) => (i < c.p.balances.length ? c.p.balances[i] : 0)) })), Array.from({ length: len }, (_, i) => (start ? addMonthsJs(start, i + 1) : String(i + 1)))),
    ];
  }
  go.addEventListener("click", () => calc(true));
  const field = (label, el, hint) => h("label", {}, label, el, hint ? h("small", { class: "mute" }, hint) : null);
  drawPurchases(); drawProducts();
  root.append(
    h("div", { class: "card mute" }, "Blue boxes are inputs. Work top to bottom: list what you plan to buy, check your home and cash assumptions, check the loan terms, then press Save and calculate. Your cash, income and spending are read from Actual."),
    h("h2", {}, "1. Planned large purchases"), h("div", { class: "card" }, pBox),
    h("h2", {}, "2. Your situation"),
    h("div", { class: "card" }, acctNote ? h("div", { class: "warn" }, acctNote) : h("div", { class: "mute", style: "margin-bottom:8px" }, "Pick an Actual account to use its current balance (a mortgage shows as a positive amount owed), or choose Custom value and type a number."), h("div", { class: "row" },
      field("Home value: Actual account", src.homeValue.sel), field("Home value ($)", src.homeValue.num), field("Mortgage: Actual account", src.mortgage.sel), field("Mortgage balance ($)", src.mortgage.num),
      field("Other liens: Actual account", src.otherLiens.sel), field("Other liens ($)", src.otherLiens.num), field("Max combined LTV (%)", f.maxLtv, "usually 80-85"),
      field("Keep a reserve?", f.protect, "reserve = months of spending"), field("Reserve (months)", f.reserveMonths), field("Extra cushion ($)", f.cushion), field("Look ahead (months)", f.horizon), field("Max share of monthly surplus for loan payments (%)", f.payoffPct, "used for payoff strategies")),
      h("details", { style: "margin-top:10px" }, h("summary", { class: "mute" }, "Override what Actual says (monthly $)"), h("div", { class: "row", style: "margin-top:8px" }, field("Income", f.income), field("Spending", f.expenses), field("To investments/debt", f.investing)))),
    h("h2", {}, "3. Loans to compare"), h("div", { class: "card" }, prBox, h("div", { class: "mute", style: "margin-top:6px" }, "Rate and fee are percentages. Interest-only years: payments are interest only before the repayment term starts (a HELOC draw period).")),
    h("div", { class: "row", style: "margin:12px 0" }, go,
      h("details", {}, h("summary", { class: "mute" }, "Try a specific amount or draw month"), h("div", { class: "row", style: "margin-top:8px" }, field("Loan amount ($)", adv.loan), field("Draw month", adv.draw)))),
    msg, out, scenBox, scenOut);
  drawScenarios().catch((e) => fill(scenBox, h("div", { class: "err" }, e.message)));
  if (purchases.length) calc(true); // saves too, so suggested accounts shown above are what the result uses
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
  const shapeBox = h("div");
  const showShape = (...kids) => { shapeBox.replaceChildren(...kids); };
  shapeBtn.addEventListener("click", async () => {
    shapeBtn.disabled = true; showShape(h("div", { class: "mute" }, "Working..."));
    try {
      const r = await api("/api/snaptrade/shape");
      showShape(h("div", { class: "card" }, h("div", { class: "row" }, h("b", {}, "SnapTrade response shape (names and types only)"), h("button", { class: "alt", onclick: () => showShape() }, "Close")), h("pre", { style: "overflow:auto;max-height:300px;margin:8px 0 0" }, JSON.stringify(r, null, 1))));
    } catch (e) { showShape(h("div", { class: "err" }, e.message), h("button", { class: "alt", onclick: () => showShape() }, "Close")); } finally { shapeBtn.disabled = false; }
  });
  root.append(h("div", { class: "card" }, h("div", { class: "row" }, connect, refresh, shapeBtn, h("span", { class: "mute" }, "Snapshots are stored by this app, not in Actual. Refresh as often as you like; one snapshot per account per day is kept."))), shapeBox, out);
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
  const chk = h("button", { class: "alt" }, "Test connection to Actual"), chkOut = h("span", { class: "mute" });
  chk.addEventListener("click", async () => { chk.disabled = true; chkOut.textContent = "Testing..."; try { const r = await api("/api/actual/check"); chkOut.textContent = r.message; chkOut.className = r.ok ? "" : "err"; } catch (e) { chkOut.textContent = e.message; chkOut.className = "err"; } finally { chk.disabled = false; } });
  root.append(h("div", { class: "card row" }, chk, chkOut), h("div", { class: "card mute" }, "Loan products, home value, planned purchases ({\"month\":\"2027-06\",\"amount\":60000,\"name\":\"Kitchen\"}), reserve and tolerance settings. Rates are decimals (0.08 = 8%)."), ta, h("div", { class: "row", style: "margin:10px 0" }, save), msg);
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
