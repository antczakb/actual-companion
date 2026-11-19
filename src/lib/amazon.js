// Amazon order history -> bank transaction matching, so Amazon charges get item names in the notes and a better category.
// Accepts the "Request My Data" export (Retail.OrderHistory.*.csv) or a similar order-history CSV from a browser extension.
// Columns are found by name (case-insensitive, several spellings), so a slightly different export still works.
import { parseCSV } from "./csv.js";
import { parseMoney } from "./venmo.js";
import { daysBetween } from "./dates.js";

const ALIASES = {
  orderId: ["order id", "orderid", "order number", "order #"],
  orderDate: ["order date", "date ordered", "order placed", "date"],
  shipDate: ["ship date", "shipment date", "date shipped", "delivery date"],
  name: ["product name", "item name", "title", "items", "item", "description"],
  qty: ["quantity", "qty"],
  unit: ["unit price", "item price", "price"],
  unitTax: ["unit price tax", "item tax", "tax"],
  shipping: ["shipping charge", "shipping", "shipping and handling"],
  discount: ["total discounts", "discount", "promotion"],
  owed: ["total owed", "item total", "total charged", "total", "amount", "grand total"],
  status: ["order status", "status"],
  payment: ["payment instrument type", "payment method"],
  department: ["department", "product category", "item category", "amazon category", "category", "product group", "product type"],
};
const norm = (s) => String(s || "").trim().toLowerCase();

export function parseAmazonCSV(text) {
  const rows = parseCSV(text);
  let hi = -1, map = null;
  for (let i = 0; i < Math.min(rows.length, 15) && hi < 0; i++) {
    const head = rows[i].map(norm), find = (k) => { for (const a of ALIASES[k]) { const j = head.indexOf(a); if (j >= 0) return j; } return -1; };
    const m = Object.fromEntries(Object.keys(ALIASES).map((k) => [k, find(k)]));
    if (m.orderId >= 0 && m.orderDate >= 0 && m.name >= 0) { hi = i; map = m; }
  }
  if (hi < 0) {
    const seen = (rows[0] || []).map((c) => c.trim()).filter(Boolean).slice(0, 40).join(", ");
    throw new Error(`This does not look like an Amazon order history CSV (need columns for order ID, order date and product name). Columns found: ${seen || "none"}.`);
  }
  const items = [], skipped = [];
  for (const r of rows.slice(hi + 1)) {
    const g = (k) => (map[k] >= 0 ? (r[map[k]] ?? "").trim() : "");
    const orderId = g("orderId"), od = g("orderDate");
    if (!orderId || !/^\d{4}-\d{2}-\d{2}/.test(od) && !/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(od)) continue;
    const qty = Math.max(1, parseInt(g("qty"), 10) || 1);
    let amount = parseMoney(g("owed"));
    if (amount == null || amount === 0) {
      const unit = parseMoney(g("unit"));
      amount = unit == null ? null : unit * qty + (parseMoney(g("unitTax")) || 0) + (parseMoney(g("shipping")) || 0) - Math.abs(parseMoney(g("discount")) || 0);
    }
    const status = g("status");
    const item = { orderId, date: isoDate(od), shipDate: g("shipDate") ? isoDate(g("shipDate")) : null, name: g("name").replace(/\s+/g, " "), qty, amount, status, payment: g("payment"), department: g("department") };
    if (amount == null || Number.isNaN(amount)) { skipped.push({ ...item, reason: "no amount" }); continue; }
    if (/cancel|return|refund/i.test(status)) { skipped.push({ ...item, reason: `status ${status}` }); continue; }
    items.push(item);
  }
  return { items, skipped, columns: rows[hi].map((c) => c.trim()).filter(Boolean), hasDepartment: map.department >= 0 };
}

function isoDate(s) {
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return `${y}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
}

const cents = (x) => Math.round(x * 100);
const sum = (a) => a.reduce((s, x) => s + x, 0);

// Amazon charges a card per shipment, so group an order's items by ship date; also keep the whole order as a fallback.
export function groupCharges(items) {
  const byOrder = new Map();
  for (const it of items) { if (!byOrder.has(it.orderId)) byOrder.set(it.orderId, []); byOrder.get(it.orderId).push(it); }
  const shipments = [], orders = [];
  for (const [orderId, list] of byOrder) {
    const by = new Map();
    for (const it of list) { const k = it.shipDate || it.date; if (!by.has(k)) by.set(k, []); by.get(k).push(it); }
    const multi = by.size > 1;
    for (const [date, its] of by) shipments.push({ key: multi ? `${orderId}@${date}` : orderId, orderId, date, items: its, amount: sum(its.map((i) => i.amount)) });
    orders.push({ key: orderId, orderId, date: list.map((i) => i.shipDate || i.date).sort().at(-1), items: list, amount: sum(list.map((i) => i.amount)), shipmentKeys: [...by.keys()].map((d) => (multi ? `${orderId}@${d}` : orderId)) });
  }
  return { shipments, orders };
}

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const shortName = (s) => clip(s.replace(/\s*[,|(\-–].*$/, "").trim() || s, 48);

// bank: [{id, date, amount, payeeName, importedPayee, notes, categoryId, accountId}]. Amazon charges are negative in the bank.
export function matchAmazon(items, bank, categories, opts = {}) {
  const { windowDays = 7, payeeRegex = "amazon|amzn", keywordCategories = {}, departmentCategories = {} } = opts;
  const re = new RegExp(payeeRegex, "i");
  const applied = new Set();
  for (const b of bank) for (const m of (b.notes || "").matchAll(/\[amzn:([^\]]+)\]/g)) applied.add(m[1]);
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const candidates = bank.filter((b) => b.amount < 0 && re.test(`${b.payeeName || ""} ${b.importedPayee || ""} ${b.notes || ""}`) && !/\[amzn:/.test(b.notes || ""));
  const { shipments, orders } = groupCharges(items);
  const todoS = shipments.filter((s) => !applied.has(s.key)), already = shipments.length - todoS.length;

  const usedB = new Set(), usedS = new Set(), matched = [];
  const pass = (groups) => {
    const pairs = [];
    groups.forEach((g, i) => candidates.forEach((b, j) => { if (cents(-b.amount) === cents(g.amount)) { const d = Math.abs(daysBetween(b.date, g.date)); if (d <= windowDays) pairs.push({ i, j, d }); } }));
    pairs.sort((a, b) => a.d - b.d || a.i - b.i || a.j - b.j);
    const usedG = new Set();
    for (const p of pairs) {
      const g = groups[p.i];
      if (usedG.has(p.i) || usedB.has(p.j) || g.shipmentKeys?.some((k) => usedS.has(k))) continue;
      usedG.add(p.i); usedB.add(p.j);
      (g.shipmentKeys || [g.key]).forEach((k) => usedS.add(k));
      matched.push({ charge: g, bank: candidates[p.j], daysApart: p.d });
    }
  };
  pass(todoS);
  // an order paid in one charge across several shipments
  pass(orders.filter((o) => o.shipmentKeys.length > 1 && o.shipmentKeys.every((k) => !usedS.has(k) && !applied.has(k))));

  const kw = Object.entries(keywordCategories).filter(([k, c]) => k.trim() && catByName.has(String(c).toLowerCase()));
  for (const m of matched) {
    const c = m.charge, b = m.bank, hits = new Map();
    for (const it of c.items) for (const [word, cname] of kw) if (it.name.toLowerCase().includes(word.toLowerCase())) { const id = catByName.get(cname.toLowerCase()); const h = hits.get(id) || { amount: 0, word }; h.amount += it.amount; hits.set(id, h); break; }
    // Amazon's own department for the item (when the file has one), mapped to an Actual category by the user. Item keywords win; then department.
    const dep = new Map();
    for (const it of c.items) { const cname = it.department && departmentCategories[it.department] && catByName.get(String(departmentCategories[it.department]).toLowerCase()); if (cname) { const d = dep.get(cname) || { amount: 0, department: it.department }; d.amount += it.amount; dep.set(cname, d); } }
    const ranked = [...hits].sort((x, y) => y[1].amount - x[1].amount), rankedDep = [...dep].sort((x, y) => y[1].amount - x[1].amount);
    let categoryId = null, source = null;
    if (!ranked.length && rankedDep.length) { categoryId = rankedDep[0][0]; source = `Amazon department "${rankedDep[0][1].department}"` + (rankedDep.length > 1 ? `; also matched ${rankedDep.length - 1} other department(s), pick manually if this order is mixed` : ""); }
    else if (ranked.length) { categoryId = ranked[0][0]; source = `item keyword "${ranked[0][1].word}"` + (ranked.length > 1 ? `; also matched ${ranked.length - 1} other category(ies), pick manually if this order is mixed` : ""); }
    else if (b.categoryId) { categoryId = b.categoryId; source = "existing"; }
    const names = c.items.map((i) => shortName(i.name) + (i.qty > 1 ? ` x${i.qty}` : ""));
    const list = names.length > 3 ? `${names.slice(0, 3).join("; ")} (+${names.length - 3} more)` : names.join("; ");
    m.departments = [...new Set(c.items.map((i) => i.department).filter(Boolean))];
    m.proposal = { notes: clip(`Amazon: ${list}`, 170) + ` [amzn:${c.key}]`, categoryId, categorySource: source, mixed: ranked.length > 1 || (!ranked.length && rankedDep.length > 1) };
  }
  const unmatchedOrders = todoS.filter((s) => !usedS.has(s.key)).map((s) => ({ ...s, reason: "No Amazon-looking bank charge with the same amount within the date window (gift card, points, split payment, or not yet posted?)" }));
  const unmatchedBank = candidates.filter((_, j) => !usedB.has(j));
  return { matched, unmatchedOrders, unmatchedBank, alreadyApplied: already };
}
