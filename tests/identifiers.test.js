// Identifier columns (SIN, BN, foreign tax ID, ZIP) must keep their leading zeros through CSV/XLSX parsing.
const assert = require('assert');
const { keepDigitText, padIdNumber, sinDigits, isValidSIN } = require('../js/validate.js');
const { createApp, XLSX } = require('./harness');

// ---- keepDigitText: numeric cell whose digits-only text doesn't round-trip keeps the text ----
const cell = (v, w) => keepDigitText({ t: 'n', v, w });
assert.deepStrictEqual(cell(46454286, '046454286'), { t: 's', v: '046454286', w: '046454286' });
assert.deepStrictEqual(cell(0, '000000000'), { t: 's', v: '000000000', w: '000000000' });
assert.deepStrictEqual(cell(1234, '01234'), { t: 's', v: '01234', w: '01234' });                 // US ZIP
assert.deepStrictEqual(cell(6, '06'), { t: 's', v: '06', w: '06' });                              // NR4 income code
assert.strictEqual(cell(1234567890123456800, '1234567890123456789').v, '1234567890123456789');   // >15 digits, lost precision
assert.strictEqual(cell(46454286, ' 046454286 ').v, '046454286');
// amounts and anything that round-trips stay numbers
assert.strictEqual(cell(5000, '5000').v, 5000);
assert.strictEqual(cell(130692544, '130692544').v, 130692544);
assert.strictEqual(cell(50000, '50000.00').v, 50000);
assert.strictEqual(cell(1234.56, '1,234.56').v, 1234.56);
assert.strictEqual(cell(100000, '1E5').v, 100000);
assert.strictEqual(cell(0.5, '0.50').v, 0.5);
assert.strictEqual(cell(-12, '-012').v, -12);
assert.strictEqual(keepDigitText({ t: 'n', v: 5 }).v, 5);                                        // no text at all
assert.deepStrictEqual(keepDigitText({ t: 's', v: '046454286', w: '046454286' }).v, '046454286');
assert.strictEqual(keepDigitText(undefined), undefined);
// CSV cells: digits-only text is kept as typed, even when it round-trips (no guessing at padding later)
assert.strictEqual(keepDigitText({ t: 'n', v: 46454286, w: '46454286' }, true).v, '46454286');
assert.strictEqual(keepDigitText({ t: 'n', v: 5000, w: '5000' }, true).v, '5000');
assert.strictEqual(keepDigitText({ t: 'n', v: 50000, w: '50000.00' }, true).v, 50000);
assert.strictEqual(keepDigitText({ t: 'n', v: 1234.56, w: '1,234.56' }, true).v, 1234.56);

// ---- padIdNumber: only whole 7–8 digit numbers get their zero(s) back ----
assert.strictEqual(padIdNumber(46454286), '046454286');
assert.strictEqual(padIdNumber(46454286.0), '046454286');
assert.strictEqual(padIdNumber(1234567), '001234567');
assert.strictEqual(padIdNumber(130692544), 130692544);      // already 9 digits
assert.strictEqual(padIdNumber(1304692544), 1304692544);    // 10 digits
assert.strictEqual(padIdNumber(123456), 123456);            // 6 digits: too short to guess
assert.strictEqual(padIdNumber(0), 0);
assert.strictEqual(padIdNumber(46454286.5), 46454286.5);    // not an integer
assert.strictEqual(padIdNumber(-4645428), -4645428);
assert.strictEqual(padIdNumber('46454286'), '46454286');    // text is never padded: it says 8 digits
assert.strictEqual(padIdNumber(''), '');

// ---- sinDigits: strip separators, never turn a decimal into other digits ----
assert.strictEqual(sinDigits('046454286'), '046454286');
assert.strictEqual(sinDigits(46454286), '046454286');
assert.strictEqual(sinDigits(' 046 454 286 '), '046454286');
assert.strictEqual(sinDigits('046-454-286'), '046454286');
assert.strictEqual(sinDigits(''), '');
assert.strictEqual(sinDigits(130692544), '130692544');
assert(!isValidSIN(sinDigits(46454286.5)));                 // would have been "464542865"
assert(!isValidSIN(sinDigits('46454286.0')));               // would have been "464542860"
assert(!isValidSIN(sinDigits('4.6454286E+08')));
assert(!isValidSIN(sinDigits(4.6454286e20)));
assert(!isValidSIN(sinDigits(1304692544)));                 // 10 digits
assert(isValidSIN(sinDigits('000000000')));

// ---- full pipeline: file bytes -> XML ----
const T4_HEAD = 'Last Name,First Name,SIN,Box 14 - Employment Income,Province of Employment';
const t4csv = sin => `${T4_HEAD}\r\nDoe,John,${sin},50000.00,ON\r\n`;
const enc = {
  'utf-16le BOM': s => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]),
  'utf-16be BOM': s => Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(s, 'utf16le').swap16()]),
  'utf-8 BOM': s => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(s)]),
  'utf-8': s => Buffer.from(s),
};
function run(rt, name, bytes) {
  const app = createApp({ returnType: rt });
  app.loadFile(name, bytes);
  app.setDetails();
  const xml = app.generate();
  return { xml, errors: app.errors(), warnings: app.el('warnings-box').innerHTML, app };
}
function xlsx(rows, tweak) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (tweak) tweak(ws);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

for (const [label, encode] of Object.entries(enc)) {
  const r = run('T4', 't4.csv', encode(t4csv('046454286')));
  assert.strictEqual(r.errors, '', `${label}: ${r.errors}`);
  assert(r.xml.includes('<sin>046454286</sin>'), `${label}: SIN lost its leading zero`);
  assert(r.xml.includes('<empt_incamt>50000.00</empt_incamt>'), `${label}: amount`);
}
// CRA "no SIN" placeholder typed as text survives (it used to become the number 0)
assert(run('T4', 't4.csv', enc['utf-8'](t4csv('000000000'))).xml.includes('<sin>000000000</sin>'));

// XLSX: SIN stored as the number 46454286 (General format) -> padded, with a warning to check it
{
  const r = run('T4', 't4.xlsx', xlsx([T4_HEAD.split(','), ['Doe', 'John', 46454286, 50000, 'ON']]));
  assert.strictEqual(r.errors, '', r.errors);
  assert(r.xml.includes('<sin>046454286</sin>'));
  assert(/leading zero/i.test(r.warnings), 'padding a SIN must be surfaced as a warning');
}
// XLSX: number with Excel's 000000000 custom format -> the displayed text is used, no warning needed
{
  const r = run('T4', 't4.xlsx', xlsx([T4_HEAD.split(','), ['Doe', 'John', 46454286, 50000, 'ON']], ws => { ws.C2.z = '000000000'; }));
  assert(r.xml.includes('<sin>046454286</sin>'), r.errors);
}
// XLSX: SIN stored as text keeps it
assert(run('T4', 't4.xlsx', xlsx([T4_HEAD.split(','), ['Doe', 'John', '046454286', 50000, 'ON']])).xml.includes('<sin>046454286</sin>'));
// XLSX: things that must NOT be padded or silently rewritten -> hard stop
for (const bad of [46454286.5, 1304692544, 4.6454286e20, 123456]) {
  const r = run('T4', 't4.xlsx', xlsx([T4_HEAD.split(','), ['Doe', 'John', bad, 50000, 'ON']]));
  assert.strictEqual(r.xml, '', `SIN ${bad} must block generation`);
  assert(/Row 2/.test(r.errors) && /SIN/.test(r.errors), r.errors);
}

// T1204 / T5018: BN root and individual SIN with leading zeros
{
  const csv = 'Vendor Name,Vendor BN,Amount Paid,Business Type,Service Payments,Address\r\n' +
              'Zero Corp,012345678RT0001,100.00,Corporation,yes,\r\n' +
              'Root Corp,012345678,200.00,Corporation,yes,\r\n' +
              'John Doe,046454286,300.00,Sole Proprietorship,yes,\r\n';
  const r = run('T1204', 't1204.csv', enc['utf-16le BOM'](csv));
  assert.strictEqual(r.errors, '', r.errors);
  assert.strictEqual((r.xml.match(/<rcpnt_bn>012345678RT0001<\/rcpnt_bn>/g) || []).length, 2);
  assert(r.xml.includes('<sin>046454286</sin>'));
}
{
  const head = ['Subcontractor Name', 'Subcontractor BN/SIN', 'Total Construction Payments', 'Recipient Type'];
  const r = run('T5018', 't5018.xlsx', xlsx([head, ['Root Corp', 12345678, 1000, 'Corporation'], ['Jane Plumber', 46454286, 500, 'Individual']]));
  assert.strictEqual(r.errors, '', r.errors);
  assert(r.xml.includes('<rcpnt_bn>012345678RZ0001</rcpnt_bn>'));
  assert(r.xml.includes('<sin>046454286</sin>'));
}

// NR4: foreign tax ID and ZIP code with leading zeros
{
  const csv = 'Recipient Name,Recipient Type,Foreign Tax ID,Country of Residence,Income Code,Currency,Gross Income,Tax Withheld,Exemption Code,Address,City,State/Province,Postal Code\r\n' +
              'John Smith,Individual,012345678,USA,06,CAD,5000.00,750.00,,1 Main St,Boston,MA,01234\r\n';
  const r = run('NR4', 'nr4.csv', enc['utf-8 BOM'](csv));
  assert.strictEqual(r.errors, '', r.errors);
  assert(r.xml.includes('<fssn_nbr>012345678</fssn_nbr>'));
  assert(r.xml.includes('<fgn_pstl_cd>01234</fgn_pstl_cd>'));
  assert(r.xml.includes('<inc_1_tcd>06</inc_1_tcd>'));
}
// NR4: a foreign tax ID Excel turned into a rounded number must block, not file garbage
{
  const head = ['Recipient Name', 'Recipient Type', 'Foreign Tax ID', 'Country of Residence', 'Gross Income'];
  const r = run('NR4', 'nr4.xlsx', xlsx([head, ['John Smith', 'Individual', 1.2345678901234568e21, 'USA', 100]]));
  assert.strictEqual(r.xml, '');
  assert(/Foreign Tax ID/.test(r.errors), r.errors);
}

console.log('identifiers.test.js: all passed');
