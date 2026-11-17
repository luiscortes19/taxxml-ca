// Row error/warning messages (the <li>s under Generate and in Step 4's warnings box), and the XML (as a hash) when it
// generates, must stay exactly as before the table editor: tests/fixtures/row-messages.golden.json was recorded from
// the pre-editor generate*XML functions.
// Regenerate (only when a message change is intended): UPDATE_GOLDENS=1 node tests/row-messages.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createApp, XLSX } = require('./harness');

const GOLDEN = path.join(__dirname, 'fixtures', 'row-messages.golden.json');
const csv = rows => Buffer.from(rows.map(r => r.join(',')).join('\r\n') + '\r\n');
const xlsx = rows => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'S'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); };
const NOW_1_26_3 = '2026-11-15T10:00', NOW_1_27_1 = '2027-01-15T10:00';

const T4H = ['Last Name', 'First Name', 'SIN', 'Box 14 - Employment Income', 'Province of Employment', 'Address'];
const T1204H = ['Vendor Name', 'Vendor BN', 'Amount Paid', 'Business Type', 'Service Payments Only', 'Address'];
const T5018H = ['Subcontractor Name', 'Subcontractor BN/SIN', 'Total Construction Payments', 'Recipient Type', 'Address'];
const NR4H = ['Recipient Name', 'Recipient Type', 'Foreign Tax ID', 'Country of Residence', 'Income Code', 'Currency', 'Gross Income', 'Tax Withheld', 'Exemption Code', 'Canadian Tax ID'];

const CASES = {
  T4_errors: ['T4', 'e.csv', csv([T4H, ['Doe', 'John', '46454286', '100', 'ON', ''], ['Roe', 'Jane', '123456789', '100', 'ON', ''],
    ['Poe', '', '1.5e8', '1', '', ''], ['', 'Solo', '12345678901', '1', 'BC', ''], ['Ok', 'Fine', '046454286', '1', 'ON', '']])],
  T4_warnings: ['T4', 'w.csv', csv([T4H, ['Doe', 'John', '', '100', 'ON', ''], ['Roe', 'Jane', '046454286', '100', '', ''],
    ['Poe', 'Ann', '130692544', '1', 'XX', '1 Main St / Halifax NS B3H 1A1'], ['', 'Solo', '130692544', '1', '', '']])],
  T4_xlsx_number: ['T4', 'n.xlsx', xlsx([T4H, ['Doe', 'John', 46454286, 100, 'ON', ''], ['Roe', 'Jane', 130692544, 100, 'ON', '']])],
  T4_xlsx_short: ['T4', 's.xlsx', xlsx([T4H, ['Moe', 'Max', 1234567, 100, 'ON', '']])],
  T1204_errors: ['T1204', 'e.csv', csv([T1204H, ['Acme', '123456789RT0001', '10', 'Llc', 'yes', ''], ['Jo Doe', '46454286', '10', 'Individual', 'yes', ''],
    ['Beta Corp', '12345', '10', 'Corporation', 'no', ''], ['', '', '10', 'Corporation', 'no', ''], ['Gamma', '', '10', '', 'no', '']])],
  T1204_warnings: ['T1204', 'w.csv', csv([T1204H, ['Jo Doe', '', '10', 'Individual', 'yes', ''], ['Beta Corp', '', '10', 'Corporation', 'no', ''],
    ['Gamma Inc', '123456789', '10', '3', 'no', ''], ['Delta', '123456789RT0001', '10', 'Partnership', 'yes', '']])],
  T5018_errors: ['T5018', 'e.csv', csv([T5018H, ['Jo Doe', '46454286', '10', 'Individual', ''], ['Beta Corp', '12345', '10', 'Corporation', ''],
    ['Gamma', '12345678', '10', '', '']])],
  T5018_warnings: ['T5018', 'w.csv', csv([T5018H, ['Jo Doe', '', '10', 'Individual', ''], ['Beta Corp', '', '10', 'Corporation', ''],
    ['Gamma Inc', '123456789', '10', 'corp', ''], ['Delta', '123456789RZ0001', '10', 'partnership', '']])],
  NR4_errors_1_26_3: ['NR4', 'e.csv', csv([NR4H, ['', 'Individual', 'X1', 'USA', '', '', '1', '', '', ''], ['Al', 'Alien', 'X1', 'Narnia', 'ABC', 'US', '1', '', 'AB', ''],
    ['Bo', 'Corporation', '', 'GBR', '11', 'GBP', '1', '', '', ''], ['Cy', '3', 'X'.repeat(21), 'US', '1', 'CAD', '1', '', '', '']]), NOW_1_26_3],
  NR4_errors_1_27_1: ['NR4', 'e.csv', csv([NR4H, ['Al', 'Individual', 'X1', 'USA', '11', 'USD', '1', '', '', 'BADID'], ['Bo', 'Corporation', 'X2', 'USA', '11', 'USD', '1', '', '', '046454286']]), NOW_1_27_1],
  NR4_number_fssn: ['NR4', 'n.xlsx', xlsx([NR4H, ['Al', 'Individual', 12345678901234567890, 'USA', '11', 'USD', 1, '', '', '']]), NOW_1_26_3],
  NR4_warnings_1_26_3: ['NR4', 'w.csv', csv([NR4H, ['Al', 'Individual', 'X1', 'USA', '11', 'USD', '1', '', '', ''], ['Bo', 'Corporation', 'X2', 'USA', '11', 'CAD', '1', '', '', '']]), NOW_1_26_3],
};

const items = html => [...String(html).matchAll(/<li>(.*?)<\/li>/g)].map(m => m[1]);
function messages([rt, name, bytes, now = NOW_1_26_3]) {
  const app = createApp({ returnType: rt, now });
  app.loadFile(name, bytes);
  app.setDetails({ 'tax-year': now === NOW_1_27_1 ? '2026' : '2025' });
  const xml = app.generate();
  return { xmlSha1: xml ? crypto.createHash('sha1').update(xml).digest('hex') : null, errors: items(app.errors()), warnings: xml ? items(app.el('warnings-box').innerHTML) : [] };
}

const got = Object.fromEntries(Object.entries(CASES).map(([k, c]) => [k, messages(c)]));
if (process.env.UPDATE_GOLDENS) fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 2) + '\n');
const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
for (const k of Object.keys(CASES)) assert.deepStrictEqual(got[k], want[k], `${k}: row messages changed`);
// the recording must actually exercise errors and warnings for every return
for (const rt of ['T4', 'T1204', 'T5018', 'NR4']) {
  assert(Object.entries(want).some(([k, v]) => k.startsWith(rt) && v.errors.length >= 2), `${rt} errors recorded`);
  assert(Object.entries(want).some(([k, v]) => k.startsWith(rt) && v.warnings.length >= 1), `${rt} warnings recorded`);
}
console.log(`row-messages.test.js: ${Object.keys(CASES).length} cases word-for-word unchanged`);
