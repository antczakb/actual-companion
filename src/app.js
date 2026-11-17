// Route handlers: pure functions of (request, dependencies) so they can be tested without a socket.
import { monthlyFlows, trailingAverages, buildProjection } from "./lib/flows.js";
import { sizeLoan, compareProducts } from "./lib/loan.js";
import { payoffPlans } from "./lib/payoff.js";
import { suggestBudget } from "./lib/suggest.js";
import { parseVenmoCSV, matchVenmo } from "./lib/venmo.js";
import { parseAmazonCSV, matchAmazon } from "./lib/amazon.js";
import { getSimpleFIN, toTables } from "./lib/simplefin.js";
import { diagnoseUrl } from "./lib/diagnose.js";
import { addMonths, currentMonth, lastDayOf } from "./lib/dates.js";
import { computeEstimate } from "./lib/estimate.js";
import { planExistingLoan } from "./lib/existing.js";
import { monthsBetween } from "./lib/flows.js";
import { ASSET_TYPES } from "./lib/assets.js";
import { extractValue, parseWatchId } from "./adapters/changedetection.js";
import { localDate } from "./lib/schedule.js";

const httpErr = (status, message) => Object.assign(new Error(message), { status });
const num = (v) => (v === undefined || v === "" || v === null ? null : Number.isFinite(+v) ? +v : null);

export function createHandlers(d) {
  const { actual, snaptrade, store, settings, simplefin, scenarios, assets, snapshotState, changedetection, fred, now = () => new Date() } = d;
  const month0 = () => currentMonth(now());
  const today = () => localDate(now());

  async function loadFlows(trailing) {
    const start = `${addMonths(month0(), -trailing)}-01`;
    const [accounts, categories, txns] = await Promise.all([actual.getAccounts(), actual.getCategories(), actual.getTransactions(start, today())]);
    return { accounts, categories, txns, flows: monthlyFlows(txns, accounts, categories), start };
  }

  async function computeLoan(query) {
      const s = settings.get(), L = s.loan, P = s.projection;
      const { accounts, flows } = await loadFlows(P.trailingMonths);
      const avg = trailingAverages(flows, month0(), P.trailingMonths);
      const pick = (o, a) => (o != null ? o : a);
      const income = pick(P.incomeOverride, avg.income), expenses = pick(P.expensesOverride, avg.expenses), investing = pick(P.investingOverride, avg.investing);
      const cashAccts = accounts.filter((a) => !a.offbudget && !a.closed && (!P.cashAccounts.length || P.cashAccounts.includes(a.name)));
      const cash0 = cashAccts.reduce((t, a) => t + a.balance, 0);
      const byName = new Map(accounts.map((a) => [a.name, a]));
      const warnings = [];
      const resolve = (label, custom, accountName, liability) => {
        if (accountName) {
          const a = byName.get(accountName);
          if (a) return { value: liability ? Math.abs(a.balance) : Math.max(0, a.balance), source: accountName };
          warnings.push(`${label}: account "${accountName}" was not found in Actual, so the custom value is used.`);
        }
        return { value: custom || 0, source: "custom" };
      };
      const home = resolve("Home value", L.homeValue, L.homeValueAccount, false), mort = resolve("Mortgage", L.mortgage, L.mortgageAccount, true), liens = resolve("Other liens", L.otherLiens, L.otherLiensAccount, true);
      // Existing loans you plan to pay off: cash out in the payoff month, the monthly payment comes back after.
      const existing = (P.existingLoans || []).map((x) => {
        const bal = resolve(`Existing loan "${x.name}"`, +x.balance, x.balanceAccount, true);
        const plan = planExistingLoan({ balance: bal.value, rate: +x.rate || 0, payment: +x.payment || 0, payoffAmount: x.payoffAmount == null ? null : +x.payoffAmount, paymentInSpending: x.paymentInSpending !== false }, monthsBetween(month0(), x.payoffMonth));
        if (monthsBetween(month0(), x.payoffMonth) < 0) warnings.push(`Existing loan "${x.name}": the payoff month is in the past, so it is treated as paid off this month.`);
        return { name: x.name, payoffMonth: x.payoffMonth < month0() ? month0() : x.payoffMonth, balance: bal.value, balanceSource: bal.source, rate: +x.rate || 0, payment: +x.payment || 0, ...plan };
      });
      const common = { startMonth: month0(), horizon: L.horizonMonths, cash0, income, expenses, investing,
        incomeGrowthPct: P.incomeGrowthPct, expenseInflationPct: P.expenseInflationPct, reserveMonths: P.reserveMonths, reserveFixed: P.reserveFixed, purchases: P.purchases, bonuses: P.bonuses || [],
        payoffs: existing.map((e) => ({ month: e.payoffMonth, amount: e.payoffAmount, freed: e.freedPayment, name: e.name })) };
      const months = buildProjection(common);
      const product = L.products.find((p) => p.name === (query.product || L.product));
      if (!product) throw httpErr(400, "Unknown loan product.");
      const base = {
        months, protectReserve: query.protect ? query.protect === "Y" : L.protectReserve, cushion: num(query.cushion) ?? L.cushion, roundTo: L.roundTo,
        maxLtv: L.maxLtv, homeValue: home.value, mortgage: mort.value, otherLiens: liens.value,
        drawMonth: query.draw || null, monthlyIncome: income, monthlySurplus: income - expenses - investing,
      };
      const result = sizeLoan({ ...base, product, loanOverride: num(query.loan) });
      const payoff = payoffPlans({ loan: result.summary.usedLoan, product, monthlySurplus: income - expenses - investing, budgetPct: L.payoffBudgetPct, rows: result.rows, draw: result.summary.drawIndex, drawLabel: result.summary.drawLabel });
      if (avg.monthsUsed < 3) warnings.push(`Only ${avg.monthsUsed} month(s) of transactions found to estimate income and spending; set overrides in Settings or wait for more data.`);
      if (!home.value) warnings.push("Home value is 0, so secured products show no equity room. Choose an Actual account or enter a value in step 2.");
      if (!P.purchases.length) warnings.push("No planned purchases entered in step 1; the projection only shows your baseline cash flow.");
      const withFastest = (row, prod) => {
        const res = sizeLoan({ ...base, product: prod, loanOverride: num(query.loan) });
        const pp = payoffPlans({ loan: res.summary.usedLoan, product: prod, monthlySurplus: income - expenses - investing, budgetPct: L.payoffBudgetPct, rows: res.rows, draw: res.summary.drawIndex, drawLabel: res.summary.drawLabel });
        const min = pp.plans.find((x) => x.key === "minimum"), fast = pp.plans.find((x) => x.key === pp.fastestKey);
        const pick = (x) => x && { name: x.name, months: x.months, payment: x.payment, paidOffBy: x.paidOffBy, totalInterest: x.totalInterest, totalCost: x.totalCost, interestSaved: x.interestSaved };
        return { ...row, fullTerm: pick(min) || null, fastest: pick(fast) || null };
      };
      // Job-loss stress test: the same projection with income cut, run with and without the loan you are looking at.
      const J = P.jobLoss;
      let stress = null;
      if (J?.enabled && /^\d{4}-\d{2}$/.test(J.startMonth || "")) {
        const sm = buildProjection({ ...common, jobLoss: { startMonth: J.startMonth, months: +J.months || 0, incomePct: +J.incomePct || 0, severance: +J.severance || 0, expenseCutPct: +J.expenseCutPct || 0, pauseInvesting: !!J.pauseInvesting } });
        const used = result.summary.usedLoan || 0;
        const sr = sizeLoan({ ...base, product, months: sm, loanOverride: used, drawMonth: used ? result.summary.drawLabel : null });
        const startIdx = sm.findIndex((m) => m.jobLoss);
        const stat = (rows, key) => {
          if (!rows.length) return null;
          const min = rows.reduce((a, r) => (r[key] < a[key] ? r : a), rows[0]), neg = rows.findIndex((r) => r[key] < 0), below = rows.filter((r) => r[key] < r.reserve).length;
          return { lowestCash: Math.round(min[key]), lowestMonth: min.label, firstNegativeMonth: neg >= 0 ? rows[neg].label : null, runwayMonths: neg >= 0 && startIdx >= 0 ? Math.max(0, neg - startIdx) : null, monthsBelowReserve: below };
        };
        const fromJob = startIdx >= 0 ? sr.rows.slice(startIdx) : [];
        stress = { scenario: J, startMonthInHorizon: startIdx >= 0, loan: used, noLoan: stat(fromJob, "cash"), withLoan: used ? stat(fromJob, "cashWithLoan") : null,
          rows: sr.rows.map((r) => ({ label: r.label, cash: Math.round(r.cash), cashWithLoan: Math.round(r.cashWithLoan), reserve: Math.round(r.reserve), jobLoss: !!sm.find((m) => m.label === r.label)?.jobLoss })) };
        if (startIdx < 0) warnings.push("The job-loss start month is outside the look-ahead window, so the stress test shows nothing. Move it earlier or look ahead further.");
      }
      return {
        existing, stress,
        resolved: { homeValue: home, mortgage: mort, otherLiens: liens },
        assumptions: { cashToday: cash0, cashAccounts: cashAccts.map((a) => a.name), monthlyIncome: income, monthlyExpenses: expenses, monthlyInvesting: investing, monthlySurplus: income - expenses - investing, monthsOfHistory: avg.monthsUsed },
        payoff, summary: result.summary, rows: result.rows, comparison: compareProducts(base, L.products).map((c, i) => withFastest(c, L.products[i])), warnings, products: L.products.map((p) => p.name),
      };
  }

  const routes = {
    "GET /api/status": async () => ({
      actual: actual.configured(), simplefin: !!simplefin.accessUrl, snaptrade: !!snaptrade?.configured(), snaptradeConnected: !!snaptrade?.connected?.(),
    }),

    "GET /api/actual/check": async () => (actual.serverUrl ? diagnoseUrl(actual.serverUrl) : { ok: null, message: "Not available." }),

    "GET /api/settings": async () => settings.get(),
    "PUT /api/settings": async ({ body }) => settings.set(body),

    "GET /api/loan": async ({ query }) => computeLoan(query),

    "GET /api/accounts": async () => (await actual.getAccounts()).filter((x) => !x.closed).map((x) => ({ name: x.name, balance: x.balance, offbudget: x.offbudget })).sort((x, y) => x.name.localeCompare(y.name)),

    "GET /api/scenarios": async () => scenarios.list().map((r) => ({ id: r.id, name: r.name, savedAt: r.savedAt, plannedTotal: r.result.plannedTotal, recommended: r.result.recommended, borrow: r.result.borrow, totalCost: r.result.totalCost })),
    "GET /api/scenario": async ({ query }) => scenarios.get(query.id) || Promise.reject(httpErr(404, "Scenario not found.")),
    "POST /api/scenarios": async ({ body }) => {
      const name = String(body?.name || "").trim().slice(0, 80);
      if (!name) throw httpErr(400, "Give the scenario a name.");
      const r = await computeLoan({}), sel = r.summary, s = settings.get();
      const rec = r.comparison.find((x) => x.recommended);
      return scenarios.add({
        name, inputs: { loan: s.loan, projection: s.projection },
        result: {
          plannedTotal: s.projection.purchases.reduce((t, p) => t + (+p.amount || 0), 0), recommended: rec?.name || null, borrow: rec?.suggested ?? null, totalCost: rec?.totalCostOfBorrowing ?? null,
          assumptions: r.assumptions, resolved: r.resolved, comparison: r.comparison, selected: sel,
          series: r.rows.map((x) => ({ label: x.label, cash: x.cash, cashWithLoan: x.cashWithLoan, reserve: x.reserve })),
        },
      });
    },
    "POST /api/scenarios/load": async ({ body }) => {
      const r = scenarios.get(body?.id);
      if (!r) throw httpErr(404, "Scenario not found.");
      const s = settings.get();
      return settings.set({ ...s, loan: { ...s.loan, ...r.inputs.loan }, projection: { ...s.projection, ...r.inputs.projection } });
    },
    "POST /api/scenarios/delete": async ({ body }) => { if (!scenarios.remove(body?.id)) throw httpErr(404, "Scenario not found."); return { ok: true }; },

    "GET /api/budget": async ({ query }) => {
      const s = settings.get().budget;
      const month = /^\d{4}-\d{2}$/.test(query.month || "") ? query.month : month0();
      const start = `${addMonths(month, -s.trailingMonths)}-01`;
      const [accounts, categories, txns] = await Promise.all([actual.getAccounts(), actual.getCategories(), actual.getTransactions(start, lastDayOf(addMonths(month, -1)))]);
      let currentBudget = new Map(), note = null;
      try { currentBudget = await actual.getBudgetMonth(month); } catch (e) { note = `Could not read the current budget for ${month}: ${e.message}`; }
      const r = suggestBudget({ txns, accounts, categories, month, currentBudget, trailing: s.trailingMonths, tolerancePct: s.tolerancePct, toleranceDollars: s.toleranceDollars,
        excludeGroups: s.excludeGroups, excludeCategories: s.excludeCategories });
      const uncat = txns.filter((t) => !t.categoryId && !t.transferAcctId && !accounts.find((a) => a.id === t.accountId)?.offbudget);
      if (uncat.length) r.notes.push(`${uncat.length} uncategorized transaction(s) in the window are not counted in any suggestion.`);
      if (note) r.notes.push(note);
      return r;
    },

    "GET /api/investments": async () => ({
      configured: !!snaptrade?.configured(), connected: !!snaptrade?.connected?.(),
      accounts: store.latest(), series: store.series(), holdings: store.holdings(),
    }),
    "POST /api/investments/refresh": async () => {
      if (!snaptrade?.configured()) throw httpErr(400, "SnapTrade is not configured (set SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY).");
      const accts = await snaptrade.fetchAll();
      if (!accts.length) throw httpErr(400, "SnapTrade returned no accounts. Connect a brokerage first (Connect button).");
      store.record(today(), accts);
      return { recorded: accts.length, date: today() };
    },
    "GET /api/snaptrade/connect": async () => {
      if (!snaptrade?.configured()) throw httpErr(400, "SnapTrade is not configured.");
      return { url: await snaptrade.connectUrl() };
    },

    "GET /api/snaptrade/shape": async () => {
      if (!snaptrade?.configured()) throw httpErr(400, "SnapTrade is not configured.");
      return { note: "Key names and types only; no values.", accounts: await snaptrade.responseShape() };
    },

    "GET /api/simplefin": async ({ query }) => {
      const s = settings.get().simplefin;
      const r = await getSimpleFIN({ accessUrl: simplefin.accessUrl, cachePath: simplefin.cachePath, ttlHours: s.cacheHours, refresh: query.refresh === "1",
        startDaysBack: s.startDaysBack, fetchImpl: simplefin.fetchImpl || fetch, now: now() });
      return { fetchedAt: r.fetchedAt, fromCache: r.fromCache, ...toTables(r.data) };
    },

    "POST /api/venmo/preview": async ({ body }) => (await venmoMatch(body.csv)).view,
    "POST /api/venmo/apply": async ({ body }) => {
      const ids = new Set((body.venmoIds || []).map(String));
      if (!ids.size) throw httpErr(400, "Nothing selected.");
      const { result } = await venmoMatch(body.csv);
      const overrides = body.categoryOverrides || {};
      const done = [], skipped = [];
      for (const m of result.matched) {
        if (!ids.has(m.venmo.id)) continue;
        const fields = { notes: m.proposal.notes };
        const cat = overrides[m.venmo.id] ?? m.proposal.categoryId;
        if (cat && !m.bank.categoryId) fields.category = cat;
        if (m.proposal.payeeName) fields.payee = await actual.findOrCreatePayee(m.proposal.payeeName);
        await actual.updateTransaction(m.bank.id, fields);
        done.push(m.venmo.id);
      }
      for (const id of ids) if (!done.includes(id)) skipped.push(id);
      return { updated: done.length, skipped };
    },

    "POST /api/amazon/preview": async ({ body }) => (await amazonMatch(body?.csv)).view,
    "POST /api/amazon/apply": async ({ body }) => {
      const keys = new Set((body.keys || []).map(String));
      if (!keys.size) throw httpErr(400, "Nothing selected.");
      const { result } = await amazonMatch(body.csv);
      const overrides = body.categoryOverrides || {}, done = [];
      for (const m of result.matched) {
        if (!keys.has(m.charge.key)) continue;
        const fields = { notes: m.proposal.notes };
        const cat = overrides[m.charge.key] ?? m.proposal.categoryId;
        if (cat && (!m.bank.categoryId || body.replaceCategory || overrides[m.charge.key])) fields.category = cat;
        await actual.updateTransaction(m.bank.id, fields);
        done.push(m.charge.key);
      }
      return { updated: done.length, skipped: [...keys].filter((k) => !done.includes(k)) };
    },

    "GET /api/assets": async () => ({ types: ASSET_TYPES, changedetection: !!changedetection?.configured(), fred: !!fred?.configured(), ...assets.view(today()) }),
    "POST /api/assets": async ({ body }) => {
      const b = body || {};
      if (b.watchId && !parseWatchId(b.watchId)) throw httpErr(400, "That does not look like a changedetection.io watch ID. Paste the UUID or the watch's edit URL.");
      return assets.upsert({ ...b, watchId: b.watchId ? parseWatchId(b.watchId) : null });
    },
    "POST /api/assets/estimate": async ({ body }) => {
      const a = assets.list().find((x) => x.id === body?.id);
      if (!a?.estimate) throw httpErr(a ? 400 : 404, a ? "This asset has no estimate set up." : "Asset not found.");
      const r = await recordEstimate(a);
      if (!r.ok) throw httpErr(400, r.message);
      return r;
    },
    "POST /api/assets/fetch": async ({ body }) => {
      const a = assets.list().find((x) => x.id === body?.id);
      if (!a) throw httpErr(404, "Asset not found.");
      if (!a.watchId) throw httpErr(400, "This asset has no changedetection.io watch.");
      const r = await fetchWatchedValue(a);
      if (!r.ok) throw httpErr(400, r.message);
      return r;
    },
    "POST /api/assets/value": async ({ body }) => { assets.setValue(body?.id, { date: body?.date || today(), value: body?.value, note: body?.note }); return { ok: true }; },
    "POST /api/assets/value/delete": async ({ body }) => { assets.removeValue(body?.id, body?.date); return { ok: true }; },
    "POST /api/assets/delete": async ({ body }) => { if (!assets.remove(body?.id)) throw httpErr(404, "Asset not found."); return { ok: true }; },

    "GET /api/snapshot/status": async () => ({ ...settings.get().snapshots, ...snapshotState.read(), serverTime: now().toString() }),
    "POST /api/snapshot/run": async () => runSnapshot(),
  };

  // Read a value from the asset's changedetection.io watch. A reading that jumps more than maxJumpPct from the last value is
  // NOT recorded (a scraper that grabbed the wrong number should not rewrite your history); it is reported for you to check.
  async function fetchWatchedValue(a) {
    const date = today(), maxJump = 0.25, stamp = (ok, message) => { assets.setFetchStatus(a.id, { at: now().toISOString(), ok, message }); return { ok, message }; };
    try {
      if (!changedetection?.configured()) return stamp(false, "changedetection.io is not configured on the server.");
      const text = await changedetection.latestText(a.watchId), v = extractValue(text, a.valueRegex);
      if (v == null) return stamp(false, "No dollar amount found in the latest snapshot. Check the watch's selector or set a value pattern.");
      const last = a.values.at(-1);
      if (last && last.value > 0 && Math.abs(v - last.value) / last.value > maxJump)
        return stamp(false, `Read ${v.toLocaleString("en-US")}, which differs from the last value (${last.value.toLocaleString("en-US")}) by more than ${maxJump * 100}%, so it was not saved. If it is right, enter it by hand.`);
      assets.setValue(a.id, { date, value: v, note: "From changedetection.io", source: "changedetection" });
      return { ...stamp(true, `read ${v.toLocaleString("en-US")}`), recorded: true, value: v, date };
    } catch (e) { return stamp(false, e.message); }
  }

  async function recordEstimate(a, { onlyIfStale = false } = {}) {
    const date = today(), lastEst = [...a.values].reverse().find((v) => v.source === "estimate");
    if (onlyIfStale && lastEst && (Date.parse(date + "T00:00:00Z") - Date.parse(lastEst.date + "T00:00:00Z")) / 864e5 < 7) return { ok: true, message: "estimate is recent", recorded: false };
    try {
      const { value, detail } = await computeEstimate(a.estimate, date, fred);
      assets.setValue(a.id, { date, value, note: `Estimate: ${detail}`, source: "estimate" });
      return { ok: true, message: `estimated ${value.toLocaleString("en-US")} (${detail})`, recorded: true, value, date };
    } catch (e) { return { ok: false, message: e.message }; }
  }

  // End-of-day snapshot: investment balances from SnapTrade, plus today's balance for assets linked to an Actual account.
  async function runSnapshot() {
    const date = today(), out = { date, investments: 0, assets: 0, notes: [] };
    if (snaptrade?.configured()) {
      try { const accts = await snaptrade.fetchAll(); if (accts.length) { store.record(date, accts); out.investments = accts.length; } else out.notes.push("SnapTrade returned no accounts."); }
      catch (e) { out.notes.push(`SnapTrade: ${e.message}`); }
    } else out.notes.push("SnapTrade not configured; investments skipped.");
    for (const a of assets.list().filter((x) => x.watchId)) { const r = await fetchWatchedValue(a); out.notes.push(`${a.name}: ${r.message}`); if (r.ok && r.recorded) out.assets++; }
    for (const a of assets.list().filter((x) => x.estimate && !x.actualAccount && !x.watchId)) { const r = await recordEstimate(a, { onlyIfStale: true }); if (r.recorded || !r.ok) out.notes.push(`${a.name}: ${r.message}`); if (r.recorded) out.assets++; }
    const linked = assets.list().filter((a) => a.actualAccount);
    if (linked.length) {
      try {
        const accts = await actual.getAccounts();
        for (const a of linked) {
          const acct = accts.find((x) => x.name === a.actualAccount);
          if (!acct) { out.notes.push(`Actual account "${a.actualAccount}" for ${a.name} was not found.`); continue; }
          assets.setValue(a.id, { date, value: Math.abs(acct.balance), source: "actual" }); out.assets++;
        }
      } catch (e) { out.notes.push(`Actual: ${e.message}`); }
    }
    return out;
  }
  Object.defineProperty(routes, "runSnapshot", { value: runSnapshot, enumerable: false });
  return routes;

  async function amazonMatch(csv) {
    if (!csv || typeof csv !== "string") throw httpErr(400, "No CSV text received.");
    const a = settings.get().amazon;
    let parsed;
    try { parsed = parseAmazonCSV(csv); } catch (e) { throw httpErr(400, e.message); }
    if (!parsed.items.length) throw httpErr(400, "No orders found in that CSV.");
    const dates = parsed.items.map((r) => r.shipDate || r.date).sort();
    const pad = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
    const [bank, categories, accounts] = await Promise.all([actual.getTransactions(pad(dates[0], -a.dayWindow - 1), pad(dates.at(-1), a.dayWindow + 1)), actual.getCategories(), actual.getAccounts()]);
    const result = matchAmazon(parsed.items, bank, categories, { windowDays: a.dayWindow, payeeRegex: a.payeeRegex, keywordCategories: a.keywordCategories });
    const catName = new Map(categories.map((c) => [c.id, `${c.groupName}: ${c.name}`])), acctName = new Map(accounts.map((x) => [x.id, x.name]));
    const itemsText = (c) => c.items.map((i) => i.name).join(" | ");
    const view = {
      counts: { itemRows: parsed.items.length, matched: result.matched.length, unmatchedOrders: result.unmatchedOrders.length, unmatchedBank: result.unmatchedBank.length, alreadyApplied: result.alreadyApplied, skipped: parsed.skipped.length },
      matched: result.matched.map((m) => ({
        key: m.charge.key, bankDate: m.bank.date, daysApart: m.daysApart, amount: -m.bank.amount, bankAccount: acctName.get(m.bank.accountId) || "", bankPayee: m.bank.importedPayee || m.bank.payeeName,
        items: m.charge.items.map((i) => ({ name: i.name, qty: i.qty, amount: i.amount })), notes: m.proposal.notes, categoryId: m.proposal.categoryId, category: m.proposal.categoryId ? catName.get(m.proposal.categoryId) : "",
        categorySource: m.proposal.categorySource || "", keepsExistingCategory: !!m.bank.categoryId, existingCategory: m.bank.categoryId ? catName.get(m.bank.categoryId) || "" : "", mixed: !!m.proposal.mixed,
      })),
      unmatchedOrders: result.unmatchedOrders.map((o) => ({ key: o.key, date: o.date, amount: o.amount, items: itemsText(o), reason: o.reason })),
      unmatchedBank: result.unmatchedBank.map((b) => ({ date: b.date, amount: -b.amount, payee: b.importedPayee || b.payeeName, account: acctName.get(b.accountId) || "" })),
      categories: categories.filter((c) => !c.isIncome && !c.hidden).map((c) => ({ id: c.id, name: `${c.groupName}: ${c.name}` })),
    };
    return { result, view };
  }

  async function venmoMatch(csv) {
    if (!csv || typeof csv !== "string") throw httpErr(400, "No CSV text received.");
    const v = settings.get().venmo;
    let parsed;
    try { parsed = parseVenmoCSV(csv); } catch (e) { throw httpErr(400, e.message); }
    if (!parsed.rows.length) throw httpErr(400, "No completed transactions found in that CSV.");
    const dates = parsed.rows.map((r) => r.date).sort();
    const pad = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
    // bank history for category learning goes back further than the statement window
    const [bank, categories, accounts] = await Promise.all([
      actual.getTransactions(addMonths(dates[0].slice(0, 7), -12) + "-01", pad(dates.at(-1), v.dayWindow + 1)), actual.getCategories(), actual.getAccounts(),
    ]);
    const result = matchVenmo(parsed.rows, bank, categories, { windowDays: v.dayWindow, payeeRegex: v.payeeRegex, keywordCategories: v.keywordCategories });
    const catName = new Map(categories.map((c) => [c.id, `${c.groupName}: ${c.name}`]));
    const acctName = new Map(accounts.map((a) => [a.id, a.name]));
    const view = {
      counts: { statementRows: parsed.rows.length, matched: result.matched.length, unmatchedVenmo: result.unmatchedVenmo.length, unmatchedBank: result.unmatchedBank.length, alreadyApplied: result.alreadyApplied, skippedStatus: parsed.skipped.length },
      matched: result.matched.map((m) => ({
        venmoId: m.venmo.id, venmoDate: m.venmo.date, bankDate: m.bank.date, daysApart: m.daysApart, amount: m.venmo.amount, type: m.venmo.type,
        bankAccount: acctName.get(m.bank.accountId) || "", bankPayee: m.bank.importedPayee || m.bank.payeeName, venmoNote: m.venmo.note,
        payee: m.proposal.payeeName, notes: m.proposal.notes, categoryId: m.proposal.categoryId, category: m.proposal.categoryId ? catName.get(m.proposal.categoryId) : "",
        categorySource: m.proposal.categorySource || "", keepsExistingCategory: !!m.bank.categoryId,
      })),
      unmatchedVenmo: result.unmatchedVenmo.map((r) => ({ venmoId: r.id, date: r.date, amount: r.amount, counterparty: r.counterparty, note: r.note, type: r.type, reason: r.reason })),
      unmatchedBank: result.unmatchedBank.map((b) => ({ date: b.date, amount: b.amount, payee: b.importedPayee || b.payeeName, account: acctName.get(b.accountId) || "" })),
      skipped: parsed.skipped.map((r) => ({ venmoId: r.id, date: r.date, amount: r.amount, reason: r.reason })),
      categories: categories.filter((c) => !c.isIncome && !c.hidden).map((c) => ({ id: c.id, name: `${c.groupName}: ${c.name}` })),
    };
    return { result, view };
  }
}
