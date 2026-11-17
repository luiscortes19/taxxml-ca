/* ============================================================
   TaxXML.ca — Pure validation helpers (no DOM).
   Loaded before app.js in the browser; required by tests/validate.test.js in Node.
   ============================================================ */

// CRA bnType: 9 digits + 2-letter program code + 4-digit account (e.g. 123456789RT0001)
const BN_PATTERN = /^\d{9}[A-Z]{2}\d{4}$/;
// CRA nrType: Non-Resident account number, 3 letters + 6 digits (e.g. NRA123456)
const NR_ACCT_PATTERN = /^[A-Z]{3}\d{6}$/;
// CRA trustType: trust account number, 1 letter + 8 digits (e.g. T12345678)
const TRUST_PATTERN = /^[A-Z]\d{8}$/;
// T619 sbmt_ref_id: up to 8 letters or digits, no spaces, hyphens or special characters (T619 2027 spec)
const SUBMISSION_REF_PATTERN = /^[A-Za-z0-9]{1,8}$/;
// T619 RepID (Represent a Client): up to 7 letters or digits
const REPID_PATTERN = /^[A-Z0-9]{1,7}$/;

function cleanBN(raw) {
  return String(raw || '').toUpperCase().trim().replace(/[-\s]/g, '');
}

// Expands a bare 9-digit BN root with the given program account (RT0001, RZ0001...).
// Anything else is returned cleaned but otherwise untouched — caller must check BN_PATTERN.
function sanitizeBN(raw, program = 'RT') {
  const bn = cleanBN(raw);
  return /^\d{9}$/.test(bn) ? bn + program + '0001' : bn;
}

// SIN = 9 digits passing the Luhn checksum. 000000000 (CRA "no SIN" placeholder) passes.
function isValidSIN(sin) {
  if (!/^\d{9}$/.test(sin)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(sin[i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

// SheetJS cell fix-up, run on every cell before sheet_to_json. For CSV every numeric cell keeps its text: the
// file says exactly what was typed, and SheetJS's guesses are wrong for us ("--5" becomes the date 37012,
// "12,34,5" becomes 12345), so the amount and ID checks see the real text. For XLSX a number keeps its digits
// only when they don't round-trip (a 000000000 cell format, a >15-digit ID that lost precision); numbers shown
// as plain digits stay numbers so padIdNumber can repair a dropped SIN zero.
function keepDigitText(cell, fromText = false) {
  if (cell && cell.t === 'n' && typeof cell.w === 'string') {
    const w = cell.w.trim();
    if (fromText || (/^\d+$/.test(w) && String(cell.v) !== w)) { cell.t = 's'; cell.v = w; }
  }
  return cell;
}

// Excel stores SIN 046454286 / BN root 012345678 as the number 46454286. Restore the zero only for
// whole numbers of 7–8 digits; anything else comes back untouched for validation to reject.
function padIdNumber(raw) {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1e6 && raw < 1e8
    ? String(raw).padStart(9, '0') : raw;
}

// Spreadsheet SIN cell -> the digits to validate. Separators are stripped, but a decimal or
// scientific-notation value is returned as-is so it fails instead of becoming different digits.
function sinDigits(raw) {
  const s = String(padIdNumber(raw)).trim();
  return /^\d+\.\d*$|^\d(\.\d+)?e[+-]?\d+$/i.test(s) ? s : s.replace(/\D/g, '');
}

// ---- Field types (source: CRA XML schemas 1-26-3 and 1-27-1, simple.xsd; tests/xsd-types.test.js checks them) ----
// provinceType: the 13 provinces and territories, US and ZZ (another country). The schema also takes these old
// aliases, which we don't offer: AL (Alberta), LB (Labrador), MA (Manitoba), NF (Newfoundland), NN (Nunavut),
// PQ / QU (Quebec), SA (Saskatchewan).
const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
const T4_PROVINCE_CODES = [...PROVINCES, 'US', 'ZZ'];
const LEGACY_PROVINCE_CODES = ['AL', 'LB', 'MA', 'NF', 'NN', 'PQ', 'QU', 'SA'];
// NR4 foreign address ste_cd, forcesProvinceStateType: provinces + stateType (US states and territories) + forcesProvType
const NR4_STATE_CODES = [...T4_PROVINCE_CODES,
  ...'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR AS FM GU MH MP PW VI'.split(' '),
  'AA', 'AE', 'AP'];

// Trimmed, upper-case code as the file gets it ('bc ' -> 'BC')
function normCode(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

// Dollar amount cell -> { value: number | null (blank), error: null | 'not_amount' | 'negative' | 'decimals' | 'too_big' }.
// digits: digits before the decimal point allowed by the box's decimalNType (decimal10Type -> 8). CRA amounts are
// unsigned, with cents. Text may have a leading $ and comma thousands separators: 1234, 1,234.56, $1234.5.
function parseMoney(raw, digits) {
  let value;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { value: null, error: 'not_amount' };
    value = raw;
  } else {
    const s = String(raw ?? '').trim();
    if (!s) return { value: null, error: null };
    const m = /^(-?)\$?\s*(\d+|\d{1,3}(?:,\d{3})+)?(?:\.(\d*))?$/.exec(s);
    if (!m || (!m[2] && !m[3])) return { value: null, error: 'not_amount' };
    if ((m[3] || '').length > 2) return { value: null, error: 'decimals' };
    value = Number((m[2] || '0').replace(/,/g, '') + '.' + (m[3] || '0')) * (m[1] ? -1 : 1);
  }
  if (value < 0) return { value: null, error: 'negative' };
  if (Math.abs(Math.round(value * 100) - value * 100) > 1e-6) return { value: null, error: 'decimals' };
  value = Math.round(value * 100) / 100;
  if (value >= 10 ** digits) return { value: null, error: 'too_big' };
  return { value, error: null };
}

// Display only: 1234.5 -> '1,234.50'
function formatMoney(n) {
  return n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// pcType postal / ZIP code as the file gets it (spaces out, upper case): '' when blank, null when it isn't one
function foreignPostal(raw) {
  const v = String(raw ?? '').replace(/\s/g, '').toUpperCase();
  return !v || /^[A-Z0-9-]{1,10}$/.test(v) ? v : null;
}

// Canadian postal code A1A 1A1 (space optional, any case)
const CA_POSTAL_PATTERN = /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i;

// yearType: 1966-2099
function isTaxYear(y) {
  return /^(?:20\d{2}|196[6-9]|19[7-9]\d)$/.test(String(y).trim());
}

function isRealDate(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === +y && t.getUTCMonth() === m - 1 && t.getUTCDate() === +d;
}

// ---- Filing season ----
// Information returns filed in a year are normally for the year before (Jan-Feb 2027 -> tax year 2026).
function defaultTaxYear(now = new Date()) {
  return now.getFullYear() - 1;
}

// CRA XML schema to build for on `now`: the 2026 T619 version (1-26-3) "is accepted for processing until December 22,
// 2026"; the 2027 version (1-27-1) "will be accepted starting January 11, 2027". IFT is closed in between, so from
// Dec 22 a file can only be filed under 1-27-1. Source:
// https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/xml-specs.html
// ponytail: one hard-coded cutover; add the next one when CRA publishes the 2028 package
function targetSchema(now = new Date()) {
  return now >= new Date(2026, 11, 22) ? '1-27-1' : '1-26-3';
}

// Suggested sbmt_ref_id: return type + month letter (A = Jan) + day + hour, cut to 8. T4 on Jan 15 at 9am -> T4A1509.
function defaultSubmissionRef(rt, now = new Date()) {
  const two = n => String(n).padStart(2, '0');
  return (rt + 'ABCDEFGHIJKL'[now.getMonth()] + two(now.getDate()) + two(now.getHours())).slice(0, 8);
}

// Next ref ID for a resubmission: the last character steps through 0-9 then A-Z (Z wraps to 0), so it stays valid.
function nextSubmissionRef(ref) {
  const SEQ = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const i = SEQ.indexOf(ref.slice(-1).toUpperCase());
  return i < 0 ? ref : ref.slice(0, -1) + SEQ[(i + 1) % SEQ.length];
}

// T619 <TransmitterAccountNumber> child for a cleaned account number, or null if it's none of CRA's forms
// (complex.xsd TransmitterAccountNumberType). bn9 is only for My Business Account sign-ins (T619 2027 spec).
function transmitterAccountTag(acct) {
  if (BN_PATTERN.test(acct)) return 'bn15';
  if (/^\d{9}$/.test(acct)) return 'bn9';
  if (TRUST_PATTERN.test(acct)) return 'trust';
  if (NR_ACCT_PATTERN.test(acct)) return 'nr4';
  return null;
}

// NR4 box 13 (schema 1-27-1 <CIN>): the recipient's Canadian tax ID -> [tag, value], or null if it isn't one.
// Blank -> <sin_ttn_itn>000000000</sin_ttn_itn>, as CRA's NR4 2027 spec instructs. Source:
// https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/t619-2027/nr4-2027.html
function nr4CIN(raw) {
  const v = cleanBN(padIdNumber(raw));
  if (!v) return ['sin_ttn_itn', '000000000'];
  if (/^\d{9}$/.test(v)) return ['sin_ttn_itn', v];
  if (BN_PATTERN.test(v)) return ['bn', v];
  if (TRUST_PATTERN.test(v)) return ['trust', v];
  return null;
}

if (typeof module !== 'undefined') module.exports = { PROVINCES, T4_PROVINCE_CODES, LEGACY_PROVINCE_CODES, NR4_STATE_CODES, normCode, parseMoney, formatMoney,
  foreignPostal, CA_POSTAL_PATTERN, isTaxYear, isRealDate, BN_PATTERN, NR_ACCT_PATTERN, TRUST_PATTERN, SUBMISSION_REF_PATTERN, REPID_PATTERN, cleanBN, sanitizeBN, isValidSIN, keepDigitText, padIdNumber, sinDigits,
  defaultTaxYear, targetSchema, defaultSubmissionRef, nextSubmissionRef, transmitterAccountTag, nr4CIN };
