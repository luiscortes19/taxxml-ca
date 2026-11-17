// Strict typed validation: every column is checked against its CRA type (codes, amounts, postal codes, dates, IDs,
// lengths), in the Step 2 editor as soon as the file opens or a cell is edited, and Generate is blocked on any error.
const assert = require('assert');
const { createApp, XLSX } = require('./harness');
const V = require('../js/validate.js');

const q = v => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csv = rows => Buffer.from(rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n');
const xlsx = rows => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'S'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); };
const plain = v => JSON.parse(JSON.stringify(v));

// A valid row per return, by our column key; tests overlay one or more values
const BASE = {
  T4: { empe_snm: 'Doe', empe_gvn_nm: 'John', sin: '046454286', empt_incamt: '100', empt_prov_cd: 'ON' },
  T1204: { vendor_name: 'Acme Corp', vendor_bn: '123456789RT0001', amount: '100', biz_type: 'Corporation', svc_only: 'Yes' },
  T5018: { rcpnt_name: 'BuildIt Inc', rcpnt_bn: '123456789RZ0001', sbctrcr_amt: '100', rcpnt_type: 'Corporation' },
  NR4: { rcpnt_name: 'John Smith', rcpnt_type: 'Individual', fssn_nbr: 'X1', tx_cntry_cd: 'USA', inc_1_tcd: '06', crcy_1_cd: 'CAD', gro_1_incamt: '100' },
};

// Opens a one-row file whose headers are our column keys, mapped one to one (drop: keys to leave out of the file)
function open(rt, values = {}, { drop = [], bytes, now = '2026-11-15T10:00' } = {}) {
  const row = { ...BASE[rt], ...values };
  drop.forEach(k => delete row[k]);
  const keys = Object.keys(row);
  const a = createApp({ returnType: rt, now });
  a.loadFile(bytes ? 't.xlsx' : 't.csv', bytes ? bytes(keys, row) : csv([keys, keys.map(k => row[k])]));
  a.run(`columnMap = {}; getReturnConfig().fields.forEach(f => { columnMap[f.key] = ${JSON.stringify(keys)}.indexOf(f.key); }); refreshEditor()`);
  a.col = k => keys.indexOf(k);
  a.issues = () => plain(a.run('validateRows()'));
  a.errs = (field) => a.issues().filter(i => i.severity === 'error' && (!field || i.field === field));
  a.warns = (field) => a.issues().filter(i => i.severity === 'warning' && (!field || i.field === field));
  a.xml = () => { a.setDetails({ 'tax-year': now.startsWith('2027') ? '2026' : '2025' }); return a.generate(); };
  return a;
}
const errsFor = (rt, field, value, opts) => open(rt, { [field]: value }, opts).errs(field);
const ok = (rt, field, value, opts) => { const e = errsFor(rt, field, value, opts); assert.deepStrictEqual(e, [], `${rt}.${field} ${JSON.stringify(value)} should be accepted: ${JSON.stringify(e)}`); };
const bad = (rt, field, value, re, opts) => {
  const e = errsFor(rt, field, value, opts);
  assert.strictEqual(e.length, 1, `${rt}.${field} ${JSON.stringify(value)} should be one error: ${JSON.stringify(e)}`);
  if (re) assert(re.test(e[0].message), `${rt}.${field} ${JSON.stringify(value)}: ${e[0].message}`);
  return e[0].message;
};

// ---- the base rows are clean ----
for (const rt of Object.keys(BASE)) assert.deepStrictEqual(open(rt).issues(), [], `${rt} base row`);

// ---- T4 box 10 province of employment ----
const PROVS = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
assert.deepStrictEqual(V.PROVINCES, PROVS);
for (const c of [...PROVS, 'US', 'ZZ']) {
  ok('T4', 'empt_prov_cd', c);
  assert(open('T4', { empt_prov_cd: c }).xml().includes(`<empt_prov_cd>${c}</empt_prov_cd>`), c);
}
// decided: case and surrounding spaces don't matter (CRA's own schema takes "bc" too); the file gets the upper-case code
for (const v of ['bc', ' bc ', 'Bc', 'BC ']) {
  ok('T4', 'empt_prov_cd', v);
  assert(open('T4', { empt_prov_cd: v }).xml().includes('<empt_prov_cd>BC</empt_prov_cd>'), v);
}
for (const v of ['CAN', 'XX', 'Ontario', 'B C', 'ON1', 'PQ', 'NF', 'O.N.', '1']) bad('T4', 'empt_prov_cd', v, /isn't a province or territory code.*AB, BC, MB/);
assert(/"CAN"/.test(bad('T4', 'empt_prov_cd', 'CAN')), 'the bad value is quoted');
// blank in a column that's there: taken from the row's address if it has one (warning), else an error -- never a silent ON
bad('T4', 'empt_prov_cd', '', /province of employment is blank/);
bad('T4', 'empt_prov_cd', '  ', /province of employment is blank/);
{
  const a = open('T4', { empt_prov_cd: '', address: '9 Elm Rd / Halifax NS B3H 1A1' });
  assert.deepStrictEqual(a.errs(), []);
  assert.deepStrictEqual(a.warns('empt_prov_cd').map(w => w.message), ['Row 2: "John Doe" province of employment not specified, defaulting to NS']);
  assert(a.xml().includes('<empt_prov_cd>NS</empt_prov_cd>'));
}
// no province column at all: ON (or the address's province) with a warning, as before
{
  const a = open('T4', {}, { drop: ['empt_prov_cd'] });
  assert.deepStrictEqual(a.errs(), []);
  assert.deepStrictEqual(a.warns().map(w => w.message), ['Row 2: "John Doe" province of employment not specified, defaulting to ON']);
  assert(a.xml().includes('<empt_prov_cd>ON</empt_prov_cd>'));
}
// an invalid code is not replaced by the address's province any more
bad('T4', 'empt_prov_cd', 'XX', null, {});
assert.strictEqual(open('T4', { empt_prov_cd: 'XX', address: '9 Elm Rd / Halifax NS B3H 1A1' }).errs('empt_prov_cd').length, 1);

// ---- NR4 state / province of the foreign address ----
for (const c of V.NR4_STATE_CODES) ok('NR4', 'ste_cd', c);
for (const c of ['wa', ' ny ', 'AA', 'ON']) ok('NR4', 'ste_cd', c);
ok('NR4', 'ste_cd', '');
for (const v of ['XX', 'CAN', 'Washington', 'W A', 'PQ']) bad('NR4', 'ste_cd', v, /state or province code/);
assert(open('NR4', { ste_cd: 'wa', addr_l1: '1 Main St' }).xml().includes('<ste_cd>WA</ste_cd>'));

// ---- NR4 country of residence: 3 letters (CRA's schema has no list); US/CA are expanded ----
for (const v of ['USA', 'gbr', ' DEU ', 'US', 'ca']) ok('NR4', 'tx_cntry_cd', v);
assert(open('NR4', { tx_cntry_cd: 'us' }).xml().includes('<tx_cntry_cd>USA</tx_cntry_cd>'));
for (const v of ['XXXX', 'U1A', '', 'U S']) bad('NR4', 'tx_cntry_cd', v, /must be a 3-letter code/);

// ---- money: what's accepted, what's rejected, boundaries, display vs stored value ----
const MONEY_OK = [['1,234.56', '1234.56'], ['$1234.5', '1234.50'], ['1234', '1234.00'], ['0', null], ['0.00', null], ['$1,234', '1234.00'],
  ['  12.5 ', '12.50'], ['$ 12', '12.00'], ['.5', '0.50'], ['100.', '100.00'], ['1,000,000', '1000000.00']];
const MONEY_BAD = ['60000X', '1.2.3', '--5', '12,34,5', 'abc', '1e5', '$', '1,2345', '12 34', '$$5', '5$', '(12)', '+5', '0x10', 'Infinity', 'NaN'];
for (const [raw, xml] of MONEY_OK) {
  ok('T4', 'empt_incamt', raw);
  const out = open('T4', { empt_incamt: raw }).xml();
  if (xml) assert(out.includes(`<empt_incamt>${xml}</empt_incamt>`), `${raw} -> ${xml}`);
  else assert(!out.includes('<empt_incamt>'), `${raw}: a zero amount is left out, as before`);
}
for (const raw of MONEY_BAD) bad('T4', 'empt_incamt', raw, /isn't a dollar amount/);
// decided: an all-blank cell is no amount (0), like an empty cell, not an error
ok('T4', 'empt_incamt', ' ');
ok('T4', 'empt_incamt', '');
bad('T4', 'empt_incamt', '-5', /can't be negative/);
bad('T4', 'empt_incamt', '-0.01', /can't be negative/);
bad('T4', 'empt_incamt', '1.234', /more than 2 decimals/);
bad('T4', 'empt_incamt', '$1,234.567', /more than 2 decimals/);
assert(/Row 2, column "empt_incamt" \(John Doe\): Employment Income \(Box 14\) "60000X" isn't a dollar amount/.test(bad('T4', 'empt_incamt', '60000X')),
  'message names the row, column, person and box');
// every money column of every return: 0, the CRA maximum, max + 0.01, negative, 3 decimals
const cfg = createApp({ returnType: 'T4' }).run('RETURN_TYPES');
for (const [rt, c] of Object.entries(cfg)) {
  const money = c.fields.filter(f => f.type === 'money');
  assert(money.length >= 1, `${rt} has money columns`);
  for (const f of money) {
    const max = '9'.repeat(f.digits) + '.99';
    ok(rt, f.key, '0');
    ok(rt, f.key, max);
    ok(rt, f.key, '$' + Number(max).toLocaleString('en-CA', { minimumFractionDigits: 2 }));
    bad(rt, f.key, '1' + '0'.repeat(f.digits) + '.00', /over the CRA maximum/);
    bad(rt, f.key, '-1', /can't be negative/);
    bad(rt, f.key, '1.001', /more than 2 decimals/);
    bad(rt, f.key, '60000X', /isn't a dollar amount/);
  }
}
assert.deepStrictEqual(plain(cfg.T4.fields.filter(f => f.type === 'money').map(f => [f.key, f.digits])), [
  ['empt_incamt', 8], ['cpp_cntrb_amt', 4], ['cppe_cntrb_amt', 4], ['qpp_cntrb_amt', 4], ['empe_eip_amt', 4], ['rpp_cntrb_amt', 5],
  ['itx_ddct_amt', 8], ['ei_insu_ern_amt', 5], ['cpp_qpp_ern_amt', 7], ['unn_dues_amt', 7]]);
// Excel numbers: whole cents only, no negatives
{
  const num = v => (keys, row) => xlsx([keys, keys.map(k => (k === 'empt_incamt' ? v : row[k]))]);
  assert.deepStrictEqual(open('T4', {}, { bytes: num(60000) }).errs(), []);
  assert(open('T4', {}, { bytes: num(60000) }).xml().includes('<empt_incamt>60000.00</empt_incamt>'));
  assert(open('T4', {}, { bytes: num(1234.5) }).xml().includes('<empt_incamt>1234.50</empt_incamt>'));
  assert(/more than 2 decimals/.test(open('T4', {}, { bytes: num(1234.565) }).errs('empt_incamt')[0].message));
  assert(/can't be negative/.test(open('T4', {}, { bytes: num(-5) }).errs('empt_incamt')[0].message));
  assert(/over the CRA maximum/.test(open('T4', {}, { bytes: num(1e8) }).errs('empt_incamt')[0].message));
}
// parseMoney, pure
assert.deepStrictEqual(V.parseMoney('$1,234.5', 8), { value: 1234.5, error: null });
assert.deepStrictEqual(V.parseMoney('', 8), { value: null, error: null });
assert.deepStrictEqual(V.parseMoney(' ', 8), { value: null, error: null });
assert.deepStrictEqual(V.parseMoney(undefined, 8), { value: null, error: null });
for (const [raw, err] of [['60000X', 'not_amount'], ['-5', 'negative'], ['1.234', 'decimals'], ['100000000', 'too_big'], [-1, 'negative'], [0.125, 'decimals'], [NaN, 'not_amount']])
  assert.strictEqual(V.parseMoney(raw, 8).error, err, String(raw));
assert.strictEqual(V.formatMoney(1234.5), '1,234.50');
assert.strictEqual(V.formatMoney(99999999.99), '99,999,999.99');
// display: thousands separators and 2 decimals in the editor; the stored value and the XML are untouched
{
  const a = open('T4', { empt_incamt: '$60000.5' });
  const td = a.el('editor-tbody').innerHTML.match(new RegExp(`<td[^>]*data-c="${a.col('empt_incamt')}"[^>]*>([^<]*)</td>`))[1];
  assert.strictEqual(td, '60,000.50');
  assert.strictEqual(a.run(`parsedData[0][${a.col('empt_incamt')}]`), '$60000.5');
  assert(a.xml().includes('<empt_incamt>60000.50</empt_incamt>'));
  const b = open('T4', { empt_incamt: '60000X' });
  assert(b.el('editor-tbody').innerHTML.includes('>60000X</td>'), 'an invalid amount is shown as typed');
}

// ---- postal codes ----
for (const v of ['98101', 'SW1A 1AA', '10115', 'K1A-0B1', 'sw1a 1aa', '']) ok('NR4', 'fgn_pstl_cd', v);
for (const v of ['12345678901', 'AB#1', 'SW1A_1AA']) bad('NR4', 'fgn_pstl_cd', v, /postal or ZIP code/);
assert(open('NR4', { fgn_pstl_cd: 'sw1a 1aa', addr_l1: '1 High St' }).xml().includes('<fgn_pstl_cd>SW1A1AA</fgn_pstl_cd>'));
// payer's Canadian postal code in Step 3
const fieldErrors = a => a.created.filter(e => e.className === 'field-error').map(e => e.textContent);
for (const [v, good] of [['K1A 0B1', true], ['k1a0b1', true], ['K1A0B1', true], ['12345', false], ['K1A 0B', false], ['KKA 0B1', false]]) {
  const a = open('T1204');
  a.setDetails({ 'py-postal': v });
  const xml = a.generate();
  assert.strictEqual(!!xml, good, `payer postal ${v}: ${fieldErrors(a)}`);
  if (!good) assert(fieldErrors(a).some(m => /A1A 1A1/.test(m)), fieldErrors(a).join());
}

// ---- dates and years in Step 3 ----
for (const [d, m, y, good] of [['31', '12', '2025', true], ['29', '2', '2024', true], ['28', '2', '2025', true], ['29', '2', '2025', false],
  ['31', '4', '2025', false], ['0', '12', '2025', false], ['32', '1', '2025', false], ['15', '13', '2025', false], ['1', '1', '1965', false]]) {
  const a = open('T5018');
  a.setDetails({ 't5018-fiscal-day': d, 't5018-fiscal-month': m, 't5018-fiscal-year': y });
  assert.strictEqual(!!a.generate(), good, `${y}-${m}-${d}: ${fieldErrors(a)}`);
  if (!good) assert(fieldErrors(a).some(e => /real date/.test(e)), fieldErrors(a).join());
}
for (const [y, good] of [['2025', true], ['1966', true], ['1965', false], ['20251', false], ['25', false]]) {
  const a = open('T4');
  a.setDetails({ 'tax-year': y });
  assert.strictEqual(!!a.generate(), good, `tax year ${y}`);
  if (!good) assert(fieldErrors(a).some(e => /year/i.test(e)), fieldErrors(a).join());
}
assert(V.isRealDate(2024, 2, 29) && !V.isRealDate(2025, 2, 29) && !V.isRealDate(2025, 4, 31) && V.isRealDate(2025, 12, 31));

// ---- BN / account numbers / SIN ----
for (const [bn, good] of [['123456789RP0001', true], ['123456789rp0001', true], ['123456789RT0001', false], ['123456789RZ0001', false], ['123456789', false]]) {
  const a = open('T4');
  a.setDetails({ 'py-bn': bn });
  assert.strictEqual(!!a.generate(), good, `T4 employer ${bn}`);
  if (!good) assert(fieldErrors(a).some(e => /RP/.test(e)), fieldErrors(a).join());
}
ok('T4', 'sin', '046 454 286');
bad('T4', 'sin', '046454287', /checksum/);
bad('T4', 'sin', 'ABC', /not a whole number|digits/);
ok('T1204', 'vendor_bn', '123456789RT0001');
bad('T1204', 'vendor_bn', '123456789RT001', /BN .* is invalid/);
ok('T5018', 'rcpnt_bn', '123456789');
bad('T5018', 'rcpnt_bn', 'ABCDEFGHIJ', /BN .* is invalid/);
ok('NR4', 'fssn_nbr', 'X'.repeat(20));
bad('NR4', 'fssn_nbr', 'X'.repeat(21), /longer than 20/);

// ---- code lists ----
for (const v of ['Yes', 'no', 'Y', 'n', 'YES', '']) ok('T1204', 'svc_only', v);
for (const v of ['maybe', '1', 'si']) bad('T1204', 'svc_only', v, /Yes or No/);
assert(open('T1204', { svc_only: 'Y' }).xml().includes('<srvc_pay_amt>100.00</srvc_pay_amt>'));
assert(open('T1204', { svc_only: '' }).xml().includes('<mxd_gd_pay_amt>100.00</mxd_gd_pay_amt>'));
for (const v of ['Corporation', 'corp', 'Partnership', 'partnership', '3', '4', '']) ok('T5018', 'rcpnt_type', v);
for (const v of ['Llc', 'Trust', '2', 'inc']) bad('T5018', 'rcpnt_type', v, /recipient type .* isn't recognized/);
ok('T5018', 'rcpnt_type', 'Individual', {});
for (const v of ['06', '6', ' 02 ']) ok('NR4', 'inc_1_tcd', v);
for (const v of ['AB', '123', '6a']) bad('NR4', 'inc_1_tcd', v, /must be 2 digits/);
for (const v of ['CAD', 'usd', '']) ok('NR4', 'crcy_1_cd', v);
for (const v of ['US', 'U$D', 'DOLLARS']) bad('NR4', 'crcy_1_cd', v, /must be a 3-letter code/);
for (const v of ['A', 'h', '']) ok('NR4', 'tx_xmpt_1_cd', v);
bad('NR4', 'tx_xmpt_1_cd', 'AB', /must be 1 character/);
bad('NR4', 'tx_xmpt_1_cd', '1', /must be a letter/);
for (const v of ['Individual', 'joint', 'Corporation', 'Other', 'Government', '1', '5']) ok('NR4', 'rcpnt_type', v);
for (const v of ['Alien', '6', '']) bad('NR4', 'rcpnt_type', v, /recipient type .* isn't recognized/);
// T4 box 28 exemptions: optional columns, 0/1 (Yes/No), blank = not exempt (0, as before)
for (const k of ['cpp_qpp_xmpt_cd', 'ei_xmpt_cd']) {
  for (const v of ['0', '1', 'Yes', 'no', '']) ok('T4', k, v);
  for (const v of ['2', 'x', 'exempt']) bad('T4', k, v, /0 \(not exempt\) or 1 \(exempt\)/);
  assert(open('T4', { [k]: 'Yes' }).xml().includes(`<${k}>1</${k}>`));
  assert(open('T4', { [k]: '' }).xml().includes(`<${k}>0</${k}>`));
}

// ---- name and address lengths: at CRA's slip size no warning, one over -> warning that names the cut ----
const cut = (rt, field, n, extra = {}) => open(rt, { ...extra, [field]: 'A'.repeat(n) }).warns(field);
for (const [rt, field, n, extra] of [['T4', 'empe_snm', 20], ['T4', 'empe_gvn_nm', 12], ['T5018', 'rcpnt_name', 60], ['T1204', 'vendor_name', 60],
  ['NR4', 'addr_l1', 30], ['NR4', 'city', 28], ['NR4', 'rcpnt_name', 60, { rcpnt_type: 'Corporation' }]]) {
  assert.deepStrictEqual(cut(rt, field, n, extra), [], `${rt}.${field} at ${n}`);
  const w = cut(rt, field, n + 1, extra);
  assert.strictEqual(w.length, 1, `${rt}.${field} at ${n + 1}: ${JSON.stringify(w)}`);
  assert(new RegExp(`${n + 1} characters; the slip takes ${n}`).test(w[0].message), w[0].message);
  assert.strictEqual(open(rt, { ...extra, [field]: 'A'.repeat(n + 1) }).errs().length, 0, 'a long name never blocks');
}
{
  const line = 'B'.repeat(30);
  assert.deepStrictEqual(open('T4', { address: `${line} / Halifax NS B3H 1A1` }).warns('address'), []);
  const w = open('T4', { address: `${line}X / Halifax NS B3H 1A1` }).warns('address');
  assert.strictEqual(w.length, 1);
  assert(/31 characters; the slip takes 30/.test(w[0].message), w[0].message);
}

// ---- inline edits: break and fix, immediately; live preview while typing changes nothing ----
{
  const a = open('T4');
  const c = a.col('empt_prov_cd');
  a.run(`editCell(0, ${c}, 'CAN')`);
  assert.strictEqual(plain(a.run(`cellState(0, 'empt_prov_cd')`)).cls, 'cell-error');
  a.run(`editCell(0, ${c}, 'on')`);
  assert.strictEqual(plain(a.run(`cellState(0, 'empt_prov_cd')`)).cls, '');
  const m = a.col('empt_incamt');
  a.run(`editCell(0, ${m}, '60000X')`);
  assert.strictEqual(plain(a.run(`cellState(0, 'empt_incamt')`)).cls, 'cell-error');
  a.setDetails();
  assert.strictEqual(a.generate(), '', 'Generate blocked');
  a.run(`editCell(0, ${m}, '1,234.56')`);
  assert.strictEqual(plain(a.run(`cellState(0, 'empt_incamt')`)).cls, '');
  assert(a.generate().includes('<empt_incamt>1234.56</empt_incamt>'), 'an edited "1,234.56" is 1234.56, not 1');
  const before = a.events ? a.events.length : 0;
  const p = plain(a.run(`previewCell(0, ${m}, '12,34,5')`));
  assert.strictEqual(p.cls, 'cell-error');
  assert(/isn't a dollar amount/.test(p.msg), p.msg);
  assert.strictEqual(a.run(`parsedData[0][${m}]`), '1,234.56', 'preview does not change the data');
  assert.strictEqual(plain(a.run(`previewCell(0, ${m}, '99')`)).cls, '');
  assert.strictEqual(a.events ? a.events.length : 0, before);
}
// enum columns are edited with a labelled select of the valid codes; the current bad value stays visible
{
  const a = open('T4', { empt_prov_cd: 'CAN' });
  const html = a.run(`cellEditor(0, ${a.col('empt_prov_cd')})`);
  assert(/^<select[^>]*aria-label="[^"]+"/.test(html), html);
  const opts = [...html.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]);
  assert.deepStrictEqual(opts, ['CAN', ...PROVS, 'US', 'ZZ'], 'current invalid value first, then the codes');
  assert(/<option value="CAN" selected>CAN \(not valid\)<\/option>/.test(html), html);
  assert.strictEqual(a.run(`cellEditor(0, ${a.col('empt_incamt')})`), null, 'free-text columns are typed in');
  const n = open('NR4');
  assert(/<option value="Individual"/.test(n.run(`cellEditor(0, ${n.col('rcpnt_type')})`)));
  const t = open('T1204');
  assert.deepStrictEqual([...t.run(`cellEditor(0, ${t.col('svc_only')})`).matchAll(/<option value="([^"]*)"/g)].map(m => m[1]), ['Yes', 'No']);
}

// ---- Generate is blocked by any error, for every return; warnings never block ----
for (const [rt, field, value] of [['T4', 'empt_prov_cd', 'CAN'], ['T4', 'cpp_cntrb_amt', '1e5'], ['T1204', 'amount', '--5'], ['T1204', 'svc_only', 'maybe'],
  ['T5018', 'sbctrcr_amt', '12,34,5'], ['T5018', 'rcpnt_type', 'Llc'], ['NR4', 'ste_cd', 'XX'], ['NR4', 'gro_1_incamt', '$'], ['NR4', 'fgn_pstl_cd', 'AB#1']]) {
  const a = open(rt, { [field]: value });
  a.setDetails();
  assert.strictEqual(a.generate(), '', `${rt}.${field}=${value} blocks Generate`);
  assert(/Fix 1 problem/.test(a.errors()), a.errors());
}
{
  const a = open('T4', { empe_snm: 'A'.repeat(25) });
  assert(a.xml().includes(`<snm>${'A'.repeat(20)}</snm>`), 'warning only: file is made, name cut to 20');
}
// every issue field is one of our own keys (GA4 allowlist), never user text
{
  const a = open('NR4', { ste_cd: 'Secret', gro_1_incamt: 'Secret1', fgn_pstl_cd: 'Se#cret' });
  const allow = a.run('analyticsFieldAllowlist()');
  for (const i of a.issues()) assert(allow.has(i.field), i.field);
}
console.log('typed-validation.test.js: all passed');
