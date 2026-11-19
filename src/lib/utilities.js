// Utility bills and usage (electric, water, natural gas). Importers turn provider downloads into bills and daily usage;
// UtilityStore keeps them; view() builds the tables, charts data and year-over-year flags.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseCSV } from "./csv.js";

export const UTILITIES = {
  electric: { label: "Electric", unit: "kWh", provider: "Duke Energy" },
  water: { label: "Water", unit: "CCF", provider: "City of Raleigh" },
  gas: { label: "Natural gas", unit: "therms", provider: "Enbridge Gas" },
};
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const p2 = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${p2(m)}-${p2(d)}`;
const mdy = (s) => { const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || ""); return m ? iso(m[3], +m[1], +m[2]) : null; };
const num = (s) => { const n = parseFloat(String(s ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : null; };
const bad = (m) => Object.assign(new Error(m), { status: 400 });

// ---- Green Button (ESPI) XML: 15-minute meter readings -> daily totals in the home time zone. ----
export function parseGreenButtonXml(xml, { timeZone = "America/New_York" } = {}) {
  const uom = /<(?:espi:)?uom>(\d+)<\/(?:espi:)?uom>/.exec(xml)?.[1], pow = +(/<(?:espi:)?powerOfTenMultiplier>(-?\d+)</.exec(xml)?.[1] || 0);
  if (!/IntervalReading/.test(xml)) throw bad("That XML has no meter readings (no IntervalReading entries). Is it a Green Button usage file?");
  // ESPI uom 72 = watt-hours. Anything else is kept in its own unit, unconverted.
  const factor = uom === "72" || !uom ? Math.pow(10, pow) / 1000 : Math.pow(10, pow), unit = uom === "72" || !uom ? "kWh" : `uom ${uom}`;
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const re = /<(?:espi:)?start>(\d+)<\/(?:espi:)?start>\s*<\/(?:espi:)?timePeriod>\s*<(?:espi:)?value>(-?\d+(?:\.\d+)?)</g;
  const days = new Map(); let n = 0, m;
  while ((m = re.exec(xml))) { const d = fmt.format(new Date(+m[1] * 1000)); days.set(d, (days.get(d) || 0) + +m[2] * factor); n++; }
  const daily = [...days].map(([date, usage]) => ({ date, usage: Math.round(usage * 1000) / 1000 })).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!daily.length) throw bad("No readings could be read from that XML.");
  return { daily, unit, intervals: n };
}

// ---- CSV: Duke's "Usage History" billing-cycle export, or a generic one (gas) matched by header words. ----
function periodFromText(t) {
  const m = /^\s*([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\s*(?:-|to|–)\s*([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\s*$/.exec(t || "");
  if (!m) return null;
  const sm = MONTHS[m[1].toLowerCase()], em = MONTHS[m[3].toLowerCase()]; if (!sm || !em) return null;
  const ey = +m[5], sy = sm > em ? ey - 1 : ey;
  return { periodStart: iso(sy, sm, +m[2]), periodEnd: iso(ey, em, +m[4]) };
}
const anyDate = (t) => { const a = mdy(t); if (a) return a; const m = /(\d{4})-(\d{2})-(\d{2})/.exec(t || ""); return m ? m[0] : null; };
export function parseUtilityCsv(text, utility) {
  const rows = parseCSV(text), U = UTILITIES[utility];
  if (!U) throw bad("Unknown utility.");
  let hi = rows.findIndex((r) => r.some((c) => /billing cycle|period|bill date|read date|^date$|service|start|from/i.test(c.trim())) && r.some((c) => /kwh|therm|ccf|usage|consumption|volume|amount|charge|cost|total/i.test(c)));
  if (hi < 0) throw bad("I could not find a header row with a billing period and a usage or amount column.");
  const head = rows[hi].map((c) => c.trim().toLowerCase());
  const col = (re, skip = []) => head.findIndex((c, i) => re.test(c) && !skip.includes(i));
  const iPer = col(/billing cycle|service period|^period/), iStart = col(/start|from/), iEnd = col(/end|to\b|read date|bill date|^date/);
  const iUse = col(/total.*(kwh|therm|ccf|ccf)|(kwh|therms?|ccf|consumption|usage|volume)(?!.*average)(?!.*avg)/), iAvg = col(/average.*(kwh|therm|ccf)|avg/), iAmt = col(/amount|charge|cost|bill total|total bill|total due|\$/), iTmp = col(/temp/);
  const bills = [];
  for (const r of rows.slice(hi + 1)) {
    if (!r.length || r.every((c) => !c.trim())) continue;
    let per = iPer >= 0 ? periodFromText(r[iPer]) : null;
    if (!per && iStart >= 0 && iEnd >= 0) { const s = anyDate(r[iStart]), e = anyDate(r[iEnd]); if (s && e) per = { periodStart: s, periodEnd: e }; }
    if (!per && iEnd >= 0) { const e = anyDate(r[iEnd]); if (e) per = { periodStart: null, periodEnd: e }; }
    if (!per) continue;
    const usage = iUse >= 0 ? num(r[iUse]) : null, amount = iAmt >= 0 ? num(r[iAmt]) : null;
    if (usage == null && amount == null) continue;
    bills.push({ utility, ...per, usage, amount, unit: U.unit, avgPerDay: iAvg >= 0 ? num(r[iAvg]) : null, tempF: iTmp >= 0 ? num(r[iTmp]) : null });
  }
  if (!bills.length) throw bad("No billing rows could be read from that CSV.");
  return { bills };
}

// ---- City of Raleigh water bill (text from the PDF) ----
export function parseRaleighWaterText(text) {
  if (!/CITY OF RALEIGH/i.test(text)) return null;
  const pick = (re) => re.exec(text)?.[1];
  const billDate = mdy(pick(/Bill Date\s+(\S+)/)), dueDate = mdy(pick(/Due Date\s+(\S+)/)), payThis = num(pick(/Pay This Amount\s+\$?([\d,]+\.\d\d)/)), metered = num(pick(/Metered Total\s+\$?([\d,]+\.\d\d)/)), activity = num(pick(/Current Activity\s+\$?([\d,]+\.\d\d)/));
  const svc = [...text.matchAll(/(\d{5,})\s+([\d.]+)\s+(\d\d\/\d\d\/\d{4})\s+to\s+(\d\d\/\d\d\/\d{4})\s+\d+\s+\d+\s+(\d+)/g)];
  if (!svc.length || !billDate) throw bad("This looks like a Raleigh bill, but I could not find the service period and usage lines.");
  const ccf = svc.reduce((s, m) => s + +m[5], 0), avgGal = svc.reduce((s, m) => s + +m[2], 0);
  return { utility: "water", periodStart: mdy(svc[0][3]), periodEnd: mdy(svc[0][4]), billDate, dueDate, usage: ccf, unit: "CCF", amount: metered ?? activity ?? payThis, totalDue: payThis, avgPerDay: Math.round(avgGal * 10) / 10, gallons: Math.round(ccf * 748), note: payThis != null && metered != null && Math.abs(payThis - metered) > 0.005 ? "Bill total includes other charges (deposit, fees or previous balance)." : null };
}

const run = promisify(execFile);
export async function pdfToText(buf) {
  const tmp = path.join(os.tmpdir(), `util-${process.pid}-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, buf);
  try { const { stdout } = await run("pdftotext", ["-layout", tmp, "-"], { maxBuffer: 20 * 1024 * 1024 }); return stdout; }
  catch (e) { throw bad(e.code === "ENOENT" ? "Reading PDFs needs pdftotext. On the server run: apt-get install -y poppler-utils" : `Could not read that PDF: ${e.message}`); }
  finally { fs.rmSync(tmp, { force: true }); }
}

// Work out what a file is and return { bills?, daily?, unit?, utility, what }.
export async function importFile(name, buf, { timeZone, utilityHint } = {}) {
  const lower = String(name || "").toLowerCase(), head = buf.subarray(0, 4).toString("latin1");
  if (lower.endsWith(".xml") || /^\s*<\?xml/.test(buf.subarray(0, 100).toString("utf8"))) {
    const r = parseGreenButtonXml(buf.toString("utf8"), { timeZone });
    return { utility: "electric", daily: r.daily, unit: r.unit, what: `${r.daily.length} days of ${r.unit} from ${r.intervals.toLocaleString("en-US")} meter readings` };
  }
  if (head === "%PDF" || lower.endsWith(".pdf")) {
    const text = await pdfToText(buf), w = parseRaleighWaterText(text);
    if (w) return { utility: "water", bills: [w], what: "1 water bill" };
    throw bad("I don't recognise this bill layout yet. Only Raleigh water PDFs are supported so far; send a text copy of this one (name, address and account number removed) to add it.");
  }
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const text = buf.toString("utf8"), utility = utilityHint || (/billing cycle date|kwh/i.test(text) ? "electric" : /therm|ccf|enbridge|gas/i.test(text) ? "gas" : null);
    if (!utility) throw bad("I couldn't tell whether this CSV is electric, water or gas. Pick the utility and upload it again.");
    const r = parseUtilityCsv(text, utility);
    return { utility, bills: r.bills, what: `${r.bills.length} billing periods` };
  }
  throw bad("Upload a .xml (Duke Green Button), .csv or .pdf file.");
}

// ---- storage ----
const MAX = 20000;
export class UtilityStore {
  constructor(file) { this.file = file; }
  _read() { try { const d = JSON.parse(fs.readFileSync(this.file, "utf8")); return { bills: d.bills || [], daily: d.daily || [] }; } catch { return { bills: [], daily: [] }; } }
  _write(d) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const tmp = this.file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(d)); fs.renameSync(tmp, this.file); }
  // Same utility + period end replaces; fields the new record lacks (e.g. dollars from a CSV that only has usage) are kept.
  addBills(list) {
    const d = this._read(); let added = 0, updated = 0;
    for (const b of list) {
      const i = d.bills.findIndex((x) => x.utility === b.utility && x.periodEnd === b.periodEnd);
      const clean = Object.fromEntries(Object.entries(b).filter(([, v]) => v != null));
      if (i >= 0) { d.bills[i] = { ...d.bills[i], ...clean }; updated++; } else { d.bills.push(clean); added++; }
    }
    d.bills.sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1));
    if (d.bills.length > MAX) d.bills = d.bills.slice(-MAX);
    this._write(d); return { added, updated };
  }
  setDaily(utility, rows) {
    const d = this._read(), have = new Map(d.daily.filter((x) => x.utility === utility).map((x) => [x.date, x]));
    let added = 0; for (const r of rows) { if (!have.has(r.date)) added++; have.set(r.date, { utility, date: r.date, usage: r.usage }); }
    d.daily = [...d.daily.filter((x) => x.utility !== utility), ...have.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    this._write(d); return { added, updated: rows.length - added };
  }
  remove(utility) { const d = this._read(); d.bills = d.bills.filter((x) => x.utility !== utility); d.daily = d.daily.filter((x) => x.utility !== utility); this._write(d); }
  view() {
    const d = this._read(), out = {};
    const daysMs = 864e5, t = (s) => Date.parse(s + "T00:00:00Z");
    for (const [key, U] of Object.entries(UTILITIES)) {
      const bills = d.bills.filter((b) => b.utility === key).map((b) => ({ ...b }));
      for (const b of bills) {
        const prev = bills.find((x) => x !== b && Math.abs(t(x.periodEnd) - (t(b.periodEnd) - 365 * daysMs)) <= 20 * daysMs);
        b.usagePctYoy = prev && prev.usage > 0 && b.usage != null ? b.usage / prev.usage - 1 : null;
        b.amountPctYoy = prev && prev.amount > 0 && b.amount != null ? b.amount / prev.amount - 1 : null;
        b.flag = (b.usagePctYoy != null && b.usagePctYoy >= 0.3) || (b.amountPctYoy != null && b.amountPctYoy >= 0.3);
        b.perUnit = b.amount != null && b.usage > 0 ? b.amount / b.usage : null;
      }
      const daily = d.daily.filter((x) => x.utility === key).map(({ date, usage }) => ({ date, usage }));
      const last = bills.slice(-12), sum = (k) => last.reduce((s, b) => s + (b[k] || 0), 0), withAmt = last.filter((b) => b.amount != null && b.usage > 0);
      out[key] = { ...U, key, bills, daily, last12: { periods: last.length, usage: sum("usage"), amount: last.some((b) => b.amount != null) ? sum("amount") : null, perUnit: withAmt.length ? withAmt.reduce((s, b) => s + b.amount, 0) / withAmt.reduce((s, b) => s + b.usage, 0) : null } };
    }
    return out;
  }
}

// Monthly totals paid to a utility, from Actual transactions whose payee matches a pattern (outflows only).
// How a payment is recognised: by payee name, by Actual category, either one, or both at once.
export const MATCH_MODES = ["payee", "category", "either", "both"];
export function paymentList(transactions, payeeRegex, { categoryIds = [], match = "payee" } = {}) {
  let re = null; try { if (payeeRegex) re = new RegExp(payeeRegex, "i"); } catch { return []; }
  const cats = new Set(categoryIds || []);
  const ok = (t) => { const p = !!re && re.test(`${t.payeeName || ""} ${t.importedPayee || ""}`), c = !!t.categoryId && cats.has(t.categoryId);
    return match === "category" ? c : match === "either" ? p || c : match === "both" ? p && c : p; };
  return transactions.filter((t) => t.amount < 0 && !t.transferAcctId && ok(t))
    .map((t) => ({ id: t.id, date: t.date, categoryId: t.categoryId || null, amount: Math.round(-t.amount * 100) / 100, payeeName: t.payeeName || t.importedPayee || "", accountId: t.accountId || null, accountName: t.accountName || "", notes: t.notes || "" }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
// Which payments probably settled a bill: dated from just before the period end to 50 days after, closest in amount first.
export function matchBillPayments(bill, payments) {
  const t = (d) => Date.parse(d + "T00:00:00Z"), lo = t(bill.periodEnd) - 5 * 864e5, hi = t(bill.periodEnd) + 50 * 864e5;
  const inWindow = payments.filter((p) => t(p.date) >= lo && t(p.date) <= hi), targets = [bill.amount, bill.totalDue].filter((v) => v != null);
  if (!targets.length) return inWindow.map((p) => p.id);
  const diff = (p) => Math.min(...targets.map((v) => Math.abs(p.amount - v)));
  return inWindow.filter((p) => diff(p) <= Math.max(5, 0.25 * Math.max(...targets))).sort((a, b) => diff(a) - diff(b)).map((p) => p.id);
}
export function paymentsByMonth(transactions, payeeRegex, opts) {
  const m = new Map();
  for (const t of paymentList(transactions, payeeRegex, opts)) { const k = t.date.slice(0, 7); m.set(k, (m.get(k) || 0) + t.amount); }
  return [...m].map(([month, amount]) => ({ month, amount: Math.round(amount * 100) / 100 })).sort((a, b) => (a.month < b.month ? -1 : 1));
}
