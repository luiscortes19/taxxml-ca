/* ============================================================
   TaxXML.ca — Pure validation helpers (no DOM).
   Loaded before app.js in the browser; required by tests/validate.test.js in Node.
   ============================================================ */

// CRA bnType: 9 digits + 2-letter program code + 4-digit account (e.g. 123456789RT0001)
const BN_PATTERN = /^\d{9}[A-Z]{2}\d{4}$/;
// CRA nrType: Non-Resident account number, 3 letters + 6 digits (e.g. NRA123456)
const NR_ACCT_PATTERN = /^[A-Z]{3}\d{6}$/;

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

// SheetJS cell fix-up, run on every cell before sheet_to_json. A numeric cell whose text is all digits keeps
// that text: always for CSV (the file says exactly what was typed), and for XLSX when the number doesn't
// round-trip (a 000000000 cell format, a >15-digit ID that lost precision). XLSX numbers shown as plain
// digits stay numbers so padIdNumber can repair a dropped SIN zero. parseFloat reads digit text the same as
// the number, and other amounts aren't digits-only ("50000.00", "1,234.56"), so amounts are unaffected.
function keepDigitText(cell, fromText = false) {
  if (cell && cell.t === 'n' && typeof cell.w === 'string') {
    const w = cell.w.trim();
    if (/^\d+$/.test(w) && (fromText || String(cell.v) !== w)) { cell.t = 's'; cell.v = w; }
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

if (typeof module !== 'undefined') module.exports = { BN_PATTERN, NR_ACCT_PATTERN, cleanBN, sanitizeBN, isValidSIN, keepDigitText, padIdNumber, sinDigits };
