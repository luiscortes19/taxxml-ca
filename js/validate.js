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

if (typeof module !== 'undefined') module.exports = { BN_PATTERN, NR_ACCT_PATTERN, cleanBN, sanitizeBN, isValidSIN };
