// Loan sizing: the workbook's Loan_Planner rule, ported.
// For every month h >= draw:  F(h) + L*K(h) - fixedFee >= 0
//   F(h) = ending cash without the loan - floor,  K(h) = 1 - fee% - cumulative payments per $1.
// K > 0 gives a lower bound on L, K < 0 an upper bound.
const EPS = 1e-9;

export function pmtPerDollar(rate, years) {
  const n = Math.round(years * 12);
  if (n <= 0) return 0;
  const r = rate / 12;
  return r === 0 ? 1 / n : r / (1 - Math.pow(1 + r, -n));
}

export function sizeLoan(inp) {
  const {
    months, product, protectReserve = true, cushion = 0, roundTo = 0,
    maxLtv = 0.8, homeValue = 0, mortgage = 0, otherLiens = 0,
    drawMonth = null, loanOverride = null, monthlyIncome = 0, monthlySurplus = 0,
  } = inp;
  const io = product.ioYears || 0, term = product.termYears || 0;
  const fee = product.feePct || 0, fixed = product.fixedFee || 0;
  const ioPay = product.rate / 12;
  const repPay = pmtPerDollar(product.rate, term);
  const secured = !!product.secured;

  const F = months.map((m) => m.cash - ((protectReserve ? m.reserve : 0) + cushion));
  const firstBelow = F.findIndex((f) => f < 0); // 0-based, -1 none
  let draw = null; // 1-based
  if (drawMonth != null) {
    const i = typeof drawMonth === "number" ? drawMonth - 1 : months.findIndex((m) => m.label === drawMonth);
    if (i >= 0 && i < months.length) draw = i + 1;
  }
  if (draw == null) draw = firstBelow >= 0 ? firstBelow + 1 : (loanOverride != null ? 1 : null);

  let cum = 0;
  const lowers = [], uppers = [];
  const rows = months.map((m, i) => {
    const h = i + 1;
    let pay = 0;
    if (draw != null && h > draw) {
      const k = h - draw;
      if (k <= io * 12) pay = ioPay;
      else if (k <= (io + term) * 12) pay = repPay;
    }
    cum += pay;
    const K = 1 - fee - cum;
    let lower = null, upper = null;
    if (draw != null && h >= draw) {
      if (K > EPS) lower = (fixed - F[i]) / K;
      else if (K < -EPS) upper = (fixed - F[i]) / K;
    }
    if (lower != null) lowers.push(lower);
    if (upper != null) uppers.push(upper);
    return { ...m, h, floor: m.cash - F[i], headroom: F[i], payPerDollar: pay, cumPayPerDollar: cum, netPerDollar: K, lower, upper };
  });

  const minLoan = Math.max(0, ...lowers);
  const sugg = minLoan <= 0 ? 0 : roundTo > 0 ? Math.ceil(minLoan / roundTo - 1e-9) * roundTo : Math.ceil(minLoan - 1e-9);
  const maxCash = uppers.length ? Math.max(0, Math.min(...uppers)) : null;
  const maxEquity = Math.max(0, maxLtv * homeValue - mortgage - otherLiens);
  const used = loanOverride != null ? loanOverride : sugg;
  const worst = Math.max(0, -Math.min(...F));
  const worstIdx = worst > 0 ? F.indexOf(Math.min(...F)) : -1;

  for (const r of rows) {
    const on = draw != null && r.h >= draw && used > 0;
    r.cashWithLoan = r.cash + (on ? used * r.netPerDollar - fixed : 0);
    r.headroomWithLoan = r.cashWithLoan - r.reserve;
    r.statusWithLoan = r.cashWithLoan < 0 ? "SHORTFALL" : r.headroomWithLoan < 0 ? "Below reserve" : "OK";
    r.statusNoLoan = r.cash < 0 ? "SHORTFALL" : r.cash - r.reserve < 0 ? "Below reserve" : "OK";
    r.loanPayment = used > 0 ? used * r.payPerDollar : 0;
  }

  let check = "OK";
  if (used < minLoan - 0.5) check = `Below the minimum needed ($${Math.round(minLoan).toLocaleString("en-US")}) - cash dips under your floor`;
  else if (maxCash != null && used > maxCash + 0.5) check = "Above what your cash flow can repay while keeping the floor";
  else if (secured && used > maxEquity + 0.5) check = "Above the home-equity limit";

  const pio = used * ioPay, prep = used * repPay;
  const maxPay = Math.max(pio, prep);
  const money = (x) => "$" + Math.round(x).toLocaleString("en-US");
  let verdict;
  if (worst === 0 && loanOverride == null) verdict = { code: "none-needed", text: "No loan needed - cash stays above your floor through every planned purchase." };
  else if (maxCash != null && minLoan > maxCash) verdict = { code: "infeasible", text: "A loan cannot close this gap - the payments themselves push cash below your floor. Delay or shrink a purchase, or try a longer term or lower rate." };
  else if (secured && minLoan > maxEquity) verdict = { code: "equity", text: `The gap (${money(minLoan)}) is larger than your home equity allows (${money(maxEquity)}). Delay or shrink a purchase, or use an unsecured product.` };
  else {
    const drawLabel = draw != null ? months[draw - 1].label : "n/a";
    const cltv = homeValue > 0 ? (mortgage + otherLiens + used) / homeValue : null;
    verdict = {
      code: check === "OK" ? "ok" : "caution",
      text: `${check === "OK" ? "" : "CAUTION - " + check + ". "}Borrow about ${money(used)} (${product.name}), drawn ${drawLabel}. Highest payment ${money(maxPay)}/mo` +
        `${monthlySurplus > 0 ? " = " + Math.round((maxPay / monthlySurplus) * 100) + "% of your monthly surplus" : ""}. Combined LTV ${cltv == null ? "n/a (set home value)" : Math.round(cltv * 100) + "%"}.`,
    };
  }

  return {
    rows,
    summary: {
      verdict, check, product: product.name, drawIndex: draw, drawLabel: draw != null ? months[draw - 1].label : null,
      firstBelowLabel: firstBelow >= 0 ? months[firstBelow].label : null,
      worstShortfall: worst, worstMonth: worstIdx >= 0 ? months[worstIdx].label : null,
      minLoan, suggested: sugg, usedLoan: used, maxLoanByCashFlow: maxCash, maxLoanByEquity: maxEquity,
      paymentInterestOnly: pio, paymentRepayment: prep,
      paymentPctOfSurplus: monthlySurplus > 0 ? maxPay / monthlySurplus : null,
      paymentPctOfIncome: monthlyIncome > 0 ? maxPay / monthlyIncome : null,
      combinedLtv: homeValue > 0 ? (mortgage + otherLiens + used) / homeValue : null,
      lowestHeadroomWithLoan: Math.min(...rows.map((r) => r.headroomWithLoan)),
      totalInterest: used * (io * 12 * ioPay + term * 12 * repPay - 1),
      upfrontFees: used > 0 ? used * fee + fixed : 0,
      totalCostOfBorrowing: used * (io * 12 * ioPay + term * 12 * repPay - 1) + (used > 0 ? used * fee + fixed : 0),
    },
  };
}

// Compare every product at the loan size computed for each (re-sized per product).
export function compareProducts(base, products) {
  return products.map((p) => {
    const r = sizeLoan({ ...base, product: p, loanOverride: base.loanOverride ?? null });
    return { name: p.name, secured: !!p.secured, ...r.summary, verdictText: r.summary.verdict.text };
  });
}
