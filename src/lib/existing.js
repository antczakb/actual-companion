// Paying off a loan you already have: what it costs on the payoff month, what monthly payment it frees up, and the interest avoided.
const cap = 1200;
export const balanceAfter = (balance, annualRate, payment, n) => {
  const r = annualRate / 12; let b = balance;
  for (let i = 0; i < n && b > 0.005; i++) b = Math.max(0, b * (1 + r) - payment);
  return b;
};
// Months and interest to finish the loan from this balance on the regular schedule (payment below interest = never).
export function remainingPlan(balance, annualRate, payment) {
  const r = annualRate / 12; let b = balance, interest = 0, m = 0;
  if (b <= 0.005) return { months: 0, interest: 0 };
  if (payment <= b * r + 0.005) return { months: Infinity, interest: Infinity };
  while (b > 0.005 && m < cap) { const i = b * r; interest += i; b = b * (1 + r) - payment; m++; if (b < 0) { b = 0; } }
  return { months: m, interest };
}
// loan: {name, balance (today), rate (0.065), payment (monthly), payoffMonth 'YYYY-MM', payoffAmount (null = auto), paymentInSpending}
// monthsToPayoff: whole months from today's month to the payoff month (payments made before then). Returns numbers for the projection.
export function planExistingLoan(loan, monthsToPayoff) {
  const n = Math.max(0, monthsToPayoff), auto = balanceAfter(loan.balance, loan.rate, loan.payment, n);
  const amount = loan.payoffAmount != null ? loan.payoffAmount : auto;
  const rest = remainingPlan(auto, loan.rate, loan.payment);
  return {
    payoffAmount: Math.round(amount * 100) / 100, auto: loan.payoffAmount == null, balanceAtPayoff: Math.round(auto * 100) / 100,
    freedPayment: auto > 0.005 && loan.paymentInSpending !== false ? loan.payment : 0,
    monthsOfPaymentsAvoided: rest.months, interestAvoided: Number.isFinite(rest.interest) ? Math.round(rest.interest * 100) / 100 : null,
  };
}
