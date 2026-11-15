// Route handlers: pure functions of (request, dependencies) so they can be tested without a socket.
import { monthlyFlows, trailingAverages, buildProjection } from "./lib/flows.js";
import { sizeLoan, compareProducts } from "./lib/loan.js";
import { payoffPlans } from "./lib/payoff.js";
import { suggestBudget } from "./lib/suggest.js";
import { parseVenmoCSV, matchVenmo } from "./lib/venmo.js";
import { getSimpleFIN, toTables } from "./lib/simplefin.js";
import { diagnoseUrl } from "./lib/diagnose.js";
import { addMonths, currentMonth, lastDayOf } from "./lib/dates.js";

const httpErr = (status, message) => Object.assign(new Error(message), { status });
const num = (v) => (v === undefined || v === "" || v === null ? null : Number.isFinite(+v) ? +v : null);

export function createHandlers(d) {
  const { actual, snaptrade, store, settings, simplefin, scenarios, now = () => new Date() } = d;
  const month0 = () => currentMonth(now());
  const today = () => now().toISOString().slice(0, 10);

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
      const months = buildProjection({ startMonth: month0(), horizon: L.horizonMonths, cash0, income, expenses, investing,
        incomeGrowthPct: P.incomeGrowthPct, expenseInflationPct: P.expenseInflationPct, reserveMonths: P.reserveMonths, reserveFixed: P.reserveFixed, purchases: P.purchases, bonuses: P.bonuses || [] });
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
      return {
        resolved: { homeValue: home, mortgage: mort, otherLiens: liens },
        assumptions: { cashToday: cash0, cashAccounts: cashAccts.map((a) => a.name), monthlyIncome: income, monthlyExpenses: expenses, monthlyInvesting: investing, monthlySurplus: income - expenses - investing, monthsOfHistory: avg.monthsUsed },
        payoff, summary: result.summary, rows: result.rows, comparison: compareProducts(base, L.products), warnings, products: L.products.map((p) => p.name),
      };
  }

  return {
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
  };

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
