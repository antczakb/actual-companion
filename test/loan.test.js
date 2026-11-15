import test from "node:test";
import assert from "node:assert/strict";
import { sizeLoan, pmtPerDollar } from "../src/lib/loan.js";

const mk = (cashes, reserve = 10000) => cashes.map((c, i) => ({ label: `2027-${String(i + 1).padStart(2, "0")}`, cash: c, reserve }));

// Independent check: build the loan month by month with a real balance schedule.
function simulate(months, L, p, draw) {
  const r = p.rate / 12, ioN = p.ioYears * 12, n = p.termYears * 12;
  const pmt = n ? (r === 0 ? L / n : (L * r) / (1 - Math.pow(1 + r, -n))) : 0;
  let bal = L, paid = 0;
  return months.map((m, i) => {
    const h = i + 1;
    if (h < draw) return m.cash;
    if (h === draw) return m.cash + L * (1 - p.feePct) - p.fixedFee;
    const k = h - draw;
    let pay = 0;
    if (k <= ioN) pay = bal * r;
    else if (k <= ioN + n) { const interest = bal * r; pay = pmt; bal -= pmt - interest; }
    paid += pay;
    return m.cash + L * (1 - p.feePct) - p.fixedFee - paid;
  });
}

const heloc = { name: "HELOC", rate: 0.08, ioYears: 10, termYears: 20, feePct: 0, fixedFee: 0, secured: true };
const loan5 = { name: "Personal", rate: 0.11, ioYears: 0, termYears: 5, feePct: 0.04, fixedFee: 250, secured: false };
const cashes = Array.from({ length: 36 }, (_, i) => 20000 + 1500 * i - (i >= 5 ? 60000 : 0));

for (const [prod, label] of [[heloc, "HELOC"], [loan5, "5-year personal loan with fees"]]) {
  test(`${label}: minimum loan keeps the floor and is tight`, () => {
    const months = mk(cashes);
    const base = { months, product: prod, cushion: 2000, protectReserve: true, homeValue: 900000, mortgage: 300000, maxLtv: 0.8 };
    const res = sizeLoan(base);
    const { minLoan, drawIndex } = res.summary;
    assert.ok(minLoan > 0);
    const floor = 12000;
    const ok = simulate(months, minLoan, prod, drawIndex).slice(drawIndex - 1).map((c) => c - floor);
    assert.ok(Math.min(...ok) > -1e-6, "at the minimum the floor holds in every month");
    assert.ok(Math.min(...ok) < 1e-6, "and binds exactly in at least one month");
    const bad = simulate(months, minLoan - 1, prod, drawIndex).slice(drawIndex - 1).map((c) => c - floor);
    assert.ok(Math.min(...bad) < 0, "one dollar less breaks the floor");
    // the module's own with-loan column agrees with the independent schedule
    const sim = simulate(months, res.summary.usedLoan, prod, drawIndex);
    // IO months match exactly; amortizing months match to the cent
    res.rows.forEach((r, i) => assert.ok(Math.abs(r.cashWithLoan - sim[i]) < 0.01, `row ${i}: ${r.cashWithLoan} vs ${sim[i]}`));
  });
}

test("amortizing payment repays the balance to zero", () => {
  const p = pmtPerDollar(0.0775, 15); let bal = 1;
  for (let i = 0; i < 180; i++) bal = bal * (1 + 0.0775 / 12) - p;
  assert.ok(Math.abs(bal) < 1e-9);
  assert.equal(pmtPerDollar(0, 5), 1 / 60);
});

test("no loan needed when cash stays above the floor", () => {
  const res = sizeLoan({ months: mk(Array(12).fill(50000)), product: heloc, cushion: 0 });
  assert.equal(res.summary.suggested, 0);
  assert.equal(res.summary.verdict.code, "none-needed");
});

test("suggestion rounds up to the requested step", () => {
  const months = mk(cashes);
  const a = sizeLoan({ months, product: heloc, cushion: 2000, roundTo: 1000, homeValue: 900000, mortgage: 300000 });
  assert.equal(a.summary.suggested % 1000, 0);
  assert.ok(a.summary.suggested >= a.summary.minLoan && a.summary.suggested - a.summary.minLoan < 1000);
});

test("infeasible when the payments themselves break the floor", () => {
  const cash = [0, 0, ...Array(28).fill(-10000)];
  const res = sizeLoan({ months: mk(cash, 0), product: { name: "Short", rate: 0.2, ioYears: 0, termYears: 1, feePct: 0, fixedFee: 0, secured: false }, protectReserve: false });
  assert.equal(res.summary.verdict.code, "infeasible");
});

test("equity cap blocks a secured product but not an unsecured one", () => {
  const months = mk(cashes);
  const secured = sizeLoan({ months, product: heloc, cushion: 2000, homeValue: 400000, mortgage: 310000, maxLtv: 0.8 });
  assert.equal(secured.summary.maxLoanByEquity, 10000);
  assert.equal(secured.summary.verdict.code, "equity");
  const unsecured = sizeLoan({ months, product: { ...heloc, secured: false }, cushion: 2000, homeValue: 400000, mortgage: 310000 });
  assert.notEqual(unsecured.summary.verdict.code, "equity");
});

test("draw month override and loan override are honoured", () => {
  const months = mk(cashes);
  const res = sizeLoan({ months, product: heloc, cushion: 2000, drawMonth: "2027-03", loanOverride: 50000, homeValue: 900000, mortgage: 300000 });
  assert.equal(res.summary.drawLabel, "2027-03");
  assert.equal(res.summary.usedLoan, 50000);
  assert.equal(res.rows[1].cashWithLoan, res.rows[1].cash); // before draw
  assert.ok(Math.abs(res.rows[2].cashWithLoan - (res.rows[2].cash + 50000)) < 1e-6); // draw month: proceeds, no payment yet
});

test("compareProducts recommends the cheapest product that works, none when none needed", async () => {
  const { compareProducts } = await import("../src/lib/loan.js");
  const months = Array.from({ length: 24 }, (_, i) => ({ label: `2027-${String((i % 12) + 1).padStart(2, "0")}`, cash: i < 3 ? 5000 : -20000 + i * 500, reserve: 1000 }));
  const prods = [{ name: "A", rate: 0.05, ioYears: 0, termYears: 5, feePct: 0, fixedFee: 0, secured: false }, { name: "B", rate: 0.12, ioYears: 0, termYears: 5, feePct: 0.05, fixedFee: 0, secured: false }];
  const rows = compareProducts({ months, protectReserve: true, cushion: 0, roundTo: 100 }, prods);
  const rec = rows.filter((r) => r.recommended);
  assert.ok(rec.length <= 1);
  if (rec.length) assert.equal(rec[0].verdict.code, "ok");
  const flat = compareProducts({ months: months.map((m) => ({ ...m, cash: 50000 })), protectReserve: true, cushion: 0, roundTo: 100 }, prods);
  assert.equal(flat.some((r) => r.recommended), false);
});
