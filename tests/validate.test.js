// Run: node tests/validate.test.js
const assert = require('assert');
const { BN_PATTERN, NR_ACCT_PATTERN, sanitizeBN, isValidSIN } = require('../js/validate.js');

// SIN Luhn
assert(isValidSIN('046454286'));
assert(isValidSIN('130692544'));
assert(isValidSIN('000000000'));           // CRA placeholder
assert(!isValidSIN('123456789'));          // fails checksum
assert(!isValidSIN('046454287'));          // one digit off
assert(!isValidSIN('04645428'));           // 8 digits
assert(!isValidSIN('0464542860'));         // 10 digits

// BN: 9-digit root expands, everything else must already be 15 valid chars
assert.strictEqual(sanitizeBN('123456789'), '123456789RT0001');
assert.strictEqual(sanitizeBN('123-456-789', 'RZ'), '123456789RZ0001');
assert.strictEqual(sanitizeBN(' 123456789rp0001 '), '123456789RP0001');
assert(BN_PATTERN.test(sanitizeBN('123456789RT0001')));
assert(!BN_PATTERN.test(sanitizeBN('123456789RT001')));   // 14 chars — hard stop, no padding
assert(!BN_PATTERN.test(sanitizeBN('12345678')));         // short root — hard stop
assert(!BN_PATTERN.test(sanitizeBN('ABCDEFGHIJKLMNO')));  // 15 chars, wrong shape

// NR account number
assert(NR_ACCT_PATTERN.test('NRA123456'));
assert(!NR_ACCT_PATTERN.test('NR123456'));

console.log('validate.test.js: all passed');
