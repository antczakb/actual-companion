// Venmo statement CSV -> bank transaction matching.
import { parseCSV } from "./csv.js";
import { daysBetween } from "./dates.js";

export function parseMoney(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;
  const neg = /^-|^\(|-\s*\$/.test(t);
  const num = parseFloat(t.replace(/[^0-9.]/g, ""));
  if (Number.isNaN(num)) return null;
  return neg ? -num : num;
}

export function parseVenmoCSV(text) {
  const rows = parseCSV(text);
  const hi = rows.findIndex((r) => r.some((c) => c.trim() === "Datetime") && r.some((c) => c.trim() === "Note"));
  if (hi < 0) throw new Error("This does not look like a Venmo statement CSV (no header row with Datetime and Note).");
  const head = rows[hi].map((c) => c.trim());
  const col = (name) => head.indexOf(name);
  const C = { id: col("ID"), dt: col("Datetime"), type: col("Type"), status: col("Status"), note: col("Note"), from: col("From"), to: col("To"),
    amt: col("Amount (total)"), fee: col("Amount (fee)"), fund: col("Funding Source"), dest: col("Destination") };
  if (C.amt < 0 || C.dt < 0) throw new Error("Venmo CSV is missing the Datetime or Amount (total) column.");
  const out = [], skipped = [];
  for (const r of rows.slice(hi + 1)) {
    const g = (i) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const id = g(C.id), dt = g(C.dt);
    if (!id || !/^\d{4}-\d{2}-\d{2}/.test(dt)) continue; // blank lines, balance rows, disclaimers
    const amount = parseMoney(g(C.amt));
    if (amount == null) continue;
    const row = { id, date: dt.slice(0, 10), datetime: dt, type: g(C.type), status: g(C.status), note: g(C.note), from: g(C.from), to: g(C.to),
      amount, fee: parseMoney(g(C.fee)) || 0, funding: g(C.fund), destination: g(C.dest) };
    row.isTransfer = /transfer/i.test(row.type);
    row.direction = amount < 0 ? "out" : "in";
    row.counterparty = row.isTransfer ? "" : (row.direction === "out" ? row.to : row.from);
    row.fromBalance = /venmo balance/i.test(row.funding) && !row.isTransfer;
    if (row.status && !/^complete/i.test(row.status)) { skipped.push({ ...row, reason: `status ${row.status}` }); continue; }
    out.push(row);
  }
  return { rows: out, skipped };
}

const cents = (x) => Math.round(x * 100);
const mostCommon = (arr) => { const m = new Map(); arr.forEach((x) => m.set(x, (m.get(x) || 0) + 1)); let best = null, n = 0; for (const [k, v] of m) if (v > n) { best = k; n = v; } return { value: best, count: n, total: arr.length }; };

// bank: [{id, date, amount, payeeName, importedPayee, notes, categoryId}], categories: [{id, name}]
export function matchVenmo(venmoRows, bank, categories, opts = {}) {
  const { windowDays = 5, payeeRegex = "venmo", keywordCategories = {} } = opts;
  const re = new RegExp(payeeRegex, "i");
  const marker = (id) => `[venmo:${id}]`;
  const applied = new Set();
  for (const b of bank) for (const m of (b.notes || "").matchAll(/\[venmo:(\d+)\]/g)) applied.add(m[1]);
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const candidates = bank.filter((b) => re.test(`${b.payeeName || ""} ${b.importedPayee || ""} ${b.notes || ""}`) && !/\[venmo:\d+\]/.test(b.notes || ""));

  const todo = [], already = [];
  for (const v of venmoRows) (applied.has(v.id) ? already : todo).push(v);

  const pairs = [];
  todo.forEach((v, i) => {
    if (v.fromBalance) return;
    const want = cents(v.isTransfer ? -v.amount : v.amount);
    candidates.forEach((b, j) => {
      if (cents(b.amount) !== want) return;
      const d = Math.abs(daysBetween(b.date, v.date));
      if (d <= windowDays) pairs.push({ i, j, d });
    });
  });
  pairs.sort((a, b) => a.d - b.d || a.i - b.i || a.j - b.j);
  const usedV = new Set(), usedB = new Set(), matched = [];
  for (const p of pairs) {
    if (usedV.has(p.i) || usedB.has(p.j)) continue;
    usedV.add(p.i); usedB.add(p.j);
    matched.push({ venmo: todo[p.i], bank: candidates[p.j], daysApart: p.d });
  }

  // category suggestions: bank history by counterparty name, then note keywords
  const histBy = new Map();
  for (const b of bank) if (b.categoryId && b.payeeName) { const k = b.payeeName.toLowerCase(); if (!histBy.has(k)) histBy.set(k, []); histBy.get(k).push(b.categoryId); }
  for (const m of matched) {
    const v = m.venmo, b = m.bank;
    let categoryId = null, source = null;
    if (v.isTransfer) { categoryId = b.categoryId || null; source = categoryId ? "existing" : null; }
    else if (b.categoryId) { categoryId = b.categoryId; source = "existing"; }
    else {
      const h = histBy.get((v.counterparty || "").toLowerCase());
      if (h) { const mc = mostCommon(h); if (mc.count / mc.total >= 0.6) { categoryId = mc.value; source = `history (${mc.count} of ${mc.total} past payments)`; } }
      if (!categoryId) for (const [kw, cname] of Object.entries(keywordCategories)) {
        if (v.note && v.note.toLowerCase().includes(kw.toLowerCase()) && catByName.has(cname.toLowerCase())) { categoryId = catByName.get(cname.toLowerCase()); source = `note keyword "${kw}"`; break; }
      }
    }
    const verb = v.direction === "out" ? "to" : "from";
    const text = v.isTransfer ? `Venmo ${v.type.toLowerCase()} ${marker(v.id)}` : `Venmo ${verb} ${v.counterparty}${v.note ? ": " + v.note : ""} ${marker(v.id)}`;
    m.proposal = { payeeName: v.isTransfer ? null : v.counterparty, notes: text, categoryId, categorySource: source };
  }
  const unmatchedVenmo = todo.filter((_, i) => !usedV.has(i)).map((v) => ({
    ...v, reason: v.fromBalance ? "Paid from Venmo balance, so no bank transaction exists" : "No bank transaction with the same amount within the date window",
  }));
  const unmatchedBank = candidates.filter((_, j) => !usedB.has(j));
  return { matched, unmatchedVenmo, unmatchedBank, alreadyApplied: already.length };
}
