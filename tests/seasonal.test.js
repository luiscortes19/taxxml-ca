// Filing-season correctness: default tax year, target CRA schema, T619 transmitter account / RepID / submission
// reference ID, landing-page deep links (/?return=NR4#converter) and the return_selected source.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createApp, ROOT } = require('./harness');
const { defaultTaxYear, targetSchema, defaultSubmissionRef, nextSubmissionRef, transmitterAccountTag, nr4CIN } = require('../js/validate.js');

const d = s => new Date(s); // local time, like the browser
const csv = s => Buffer.from(s);
const T4_CSV = csv('Last Name,First Name,SIN,Employment Income\r\nDoe,John,046454286,100\r\n');
const fieldErrors = app => app.created.filter(e => e.className === 'field-error').map(e => e.textContent);

// ---- default tax year: the previous calendar year, all year round ----
for (const [now, year] of [
  ['2026-01-01T00:00', 2025], ['2026-02-28T12:00', 2025], ['2026-10-26T12:00', 2025], ['2026-12-31T23:59', 2025],
  ['2027-01-01T00:00', 2026], ['2027-01-11T09:00', 2026], ['2027-02-15T12:00', 2026], ['2027-02-28T23:59', 2026],
  ['2027-03-31T12:00', 2026], ['2027-12-31T23:59', 2026], ['2028-01-01T00:00', 2027],
]) assert.strictEqual(defaultTaxYear(d(now)), year, now);

// ---- target schema: 1-26-3 until CRA closes for the year-end (Dec 22 2026), 1-27-1 from then ----
for (const [now, schema] of [
  ['2026-01-15T12:00', '1-26-3'], ['2026-10-26T12:00', '1-26-3'], ['2026-12-21T23:59', '1-26-3'],
  ['2026-12-22T00:00', '1-27-1'], ['2027-01-11T00:00', '1-27-1'], ['2027-02-28T12:00', '1-27-1'],
]) assert.strictEqual(targetSchema(d(now)), schema, now);

// ---- submission reference ID: return type + month letter + day + hour, at most 8 letters/digits ----
{
  const now = d('2027-01-15T09:30');
  assert.deepStrictEqual(['T4', 'NR4', 'T5018', 'T1204'].map(rt => defaultSubmissionRef(rt, now)), ['T4A1509', 'NR4A1509', 'T5018A15', 'T1204A15']);
  assert.strictEqual(defaultSubmissionRef('T4', d('2026-10-26T14:05')), 'T4J2614');
  assert.strictEqual(defaultSubmissionRef('NR4', d('2026-12-01T00:00')), 'NR4L0100');
  for (const rt of ['T4', 'NR4', 'T5018', 'T1204']) for (const s of ['2026-01-01T00:00', '2026-12-31T23:59'])
    assert(/^[A-Za-z0-9]{1,8}$/.test(defaultSubmissionRef(rt, d(s))), `${rt} ${s}`);
  // restoring saved details bumps the last character and never makes it longer than 8 or non-alphanumeric
  for (const [from, to] of [['A1', 'A2'], ['T4A1509', 'T4A150A'], ['NR4A1509', 'NR4A150A'], ['TEST0Z', 'TEST00'], ['abc', 'abD'], ['B', 'C']])
    assert.strictEqual(nextSubmissionRef(from), to, from);
}

// ---- T619 transmitter account forms (complex.xsd TransmitterAccountNumberType; T619 2027 spec) ----
for (const [v, tag] of [['123456789RP0001', 'bn15'], ['123456789RZ0001', 'bn15'], ['123456789', 'bn9'], ['T12345678', 'trust'], ['NRA123456', 'nr4'],
                        ['12345678', null], ['123456789RP001', null], ['1234567890', null], ['T1234567', null], ['NR123456', null], ['AAA12345A', null], ['', null]])
  assert.strictEqual(transmitterAccountTag(v), tag, v);

// ---- NR4 box 13 Canadian tax ID ----
for (const [v, out] of [['', ['sin_ttn_itn', '000000000']], ['091 234 567', ['sin_ttn_itn', '091234567']], [91234567, ['sin_ttn_itn', '091234567']],
                        ['123456789rc0001', ['bn', '123456789RC0001']], ['t12345678', ['trust', 'T12345678']],
                        ['12345', null], ['123456789RC01', null], ['DE123456789', null]])
  assert.deepStrictEqual(nr4CIN(v), out, String(v));

// ---- the app defaults: tax year, T5018 fiscal year, submission ref ID, from the (pinned) clock ----
for (const [now, year] of [['2026-10-26T12:00', '2025'], ['2027-01-20T12:00', '2026'], ['2027-02-27T12:00', '2026']]) {
  for (const rt of ['T4', 'NR4', 'T5018', 'T1204']) {
    const app = createApp({ returnType: rt, now });
    assert.strictEqual(String(app.el('tax-year').value), year, `${rt} tax-year on ${now}`);
    assert.strictEqual(String(app.el('t5018-fiscal-year').value), year, `${rt} fiscal year on ${now}`);
    assert.strictEqual(app.el('tx-ref').value, defaultSubmissionRef(rt, d(now)), `${rt} ref on ${now}`);
    assert.strictEqual(app.el('tx-ref').placeholder, defaultSubmissionRef(rt, d(now)), `${rt} placeholder`);
  }
}
{ // the year stays editable and is what goes in the file
  const app = createApp({ returnType: 'T4', now: '2027-01-20T12:00' });
  app.loadFile('t4.csv', T4_CSV);
  app.setDetails({ 'tax-year': '2024' });
  assert(app.generate().includes('<tx_yr>2024</tx_yr>'));
}
{ // a suggested ref ID follows the return; one the user typed (or restored) is kept
  const app = createApp({ returnType: 'T4', now: '2027-01-20T12:00' });
  app.heroPicks.find(b => b.dataset.return === 'NR4').click();
  assert.strictEqual(app.el('tx-ref').value, 'NR4A2012');
  app.el('tx-ref').value = 'MYREF1';
  app.heroPicks.find(b => b.dataset.return === 'T5018').click();
  assert.strictEqual(app.el('tx-ref').value, 'MYREF1');
  assert.strictEqual(app.el('tx-ref').placeholder, 'T5018A20');
  app.run('clearFilingDetails()');
  assert.strictEqual(app.el('tx-ref').value, 'T5018A20', 'Start fresh puts the suggestion back');
}
{ // restored details: the saved ref is bumped; an empty saved ref leaves the suggestion alone
  const app = createApp({ returnType: 'T4', now: '2027-01-20T12:00', withStorage: { taxxml_filing_details: JSON.stringify({ 'tx-ref': 'NR4A1509', 'tx-name': 'Co' }) } });
  app.run('restoreFilingDetails()');
  assert.strictEqual(app.el('tx-ref').value, 'NR4A150A');
  const app2 = createApp({ returnType: 'T4', now: '2027-01-20T12:00', withStorage: { taxxml_filing_details: JSON.stringify({ 'tx-ref': '', 'tx-name': 'Co' }) } });
  app2.run('restoreFilingDetails()');
  assert.strictEqual(app2.el('tx-ref').value, 'T4A2012');
}

// ---- Step 3 validation of the transmitter account, RepID and submission ref ID ----
const tryDetails = overrides => {
  const app = createApp({ returnType: 'T4' });
  app.loadFile('t4.csv', T4_CSV);
  app.setDetails(overrides);
  return { xml: app.generate(), errors: fieldErrors(app) };
};
for (const ok of [{ 'tx-bn': '123456789RP0001' }, { 'tx-bn': '123456789 rp 0001' }, { 'tx-bn': '123456789' }, { 'tx-bn': 'T12345678' },
                  { 'tx-bn': 'NRA123456' }, { 'tx-bn': '', 'tx-repid': 'AB12CD3' }, { 'tx-bn': '123456789RP0001', 'tx-repid': 'ab12' },
                  { 'tx-ref': 'A' }, { 'tx-ref': 'abcd1234' }]) {
  const { xml, errors } = tryDetails(ok);
  assert(xml, `${JSON.stringify(ok)} should generate: ${errors}`);
}
for (const [bad, field, msg] of [
  [{ 'tx-bn': '12345678' }, 'tx-bn', /15-character BN .* 9-digit BN .* trust account .* non-resident account/],
  [{ 'tx-bn': '123456789MM001' }, 'tx-bn', /15-character BN/],
  [{ 'tx-bn': 'X123' }, 'tx-bn', /15-character BN/],
  [{ 'tx-bn': '', 'tx-repid': '' }, 'tx-bn', /account number, a RepID, or both/],
  [{ 'tx-repid': 'ABCDEFGH' }, 'tx-repid', /up to 7 letters or digits/],
  [{ 'tx-repid': 'AB_12' }, 'tx-repid', /up to 7 letters or digits/],
  [{ 'tx-ref': 'T4-A' }, 'tx-ref', /up to 8 letters or digits, no spaces, hyphens or other characters/],
  [{ 'tx-ref': 'T4 A' }, 'tx-ref', /up to 8 letters or digits/],
  [{ 'tx-ref': '123456789' }, 'tx-ref', /up to 8 letters or digits/],
]) {
  const { xml, errors } = tryDetails(bad);
  assert.strictEqual(xml, '', `${JSON.stringify(bad)} must block generation`);
  assert(errors.some(e => msg.test(e)), `${JSON.stringify(bad)}: ${errors}`);
}

// ---- NR4: CIN only in 1-27-1 files; a bad one is a row error; in 1-26-3 a mapped column is left out with a warning ----
const NR4_CSV = csv('Recipient Name,Recipient Type,Foreign Tax ID,Country of Residence,Gross Income,Canadian Tax ID\r\nAnn Lee,Individual,X1,USA,100,12345\r\n');
{
  const app = createApp({ returnType: 'NR4', now: '2027-01-20T12:00' });
  app.loadFile('nr4.csv', NR4_CSV);
  assert.strictEqual(app.run('columnMap.cin'), 5, 'Canadian Tax ID auto-maps');
  assert.strictEqual(app.run('columnMap.fssn_nbr'), 2, 'Foreign Tax ID still maps to fssn_nbr');
  app.setDetails();
  assert.strictEqual(app.generate(), '');
  assert(/Row 2, column &quot;Canadian Tax ID&quot; \(Ann Lee\).*SIN\/TTN\/ITN/.test(app.errors()), app.errors());
}
{
  const app = createApp({ returnType: 'NR4', now: '2026-11-20T12:00' });
  app.loadFile('nr4.csv', NR4_CSV);
  app.setDetails();
  const xml = app.generate();
  assert(xml && !xml.includes('<CIN>'), app.errors());
  assert(/Canadian Tax ID column is left out/.test(app.el('warnings-box').innerHTML), app.el('warnings-box').innerHTML);
}
{ // "Canadian Tax Identification Number" must not be grabbed by the foreign tax ID's "tax identification" keyword
  const app = createApp({ returnType: 'NR4' });
  app.loadFile('nr4.csv', csv('Recipient Name,Foreign Tax ID,Canadian Tax Identification Number\r\nA,1,\r\n'));
  assert.deepStrictEqual([app.run('columnMap.fssn_nbr'), app.run('columnMap.cin')], [1, 2]);
}

// ---- receipt names the schema the file was built for ----
for (const [rt, now, text] of [['NR4', '2027-01-20T12:00', '1-27-1 (CRA accepts it from January 11, 2027)'],
                               ['NR4', '2026-11-20T12:00', '1-26-3 (CRA accepts it until December 22, 2026)'],
                               ['T4', '2026-11-20T12:00', '1-26-3 and 1-27-1']]) {
  const app = createApp({ returnType: rt, now });
  app.loadFile('f.csv', rt === 'NR4' ? csv(NR4_CSV.toString().replace(',12345', ',')) : T4_CSV);
  app.setDetails();
  assert(app.generate(), app.errors());
  assert(app.el('receipt').innerHTML.includes(`<dt>CRA XML schema</dt><dd>${text}</dd>`), app.el('receipt').innerHTML);
}

// ---- landing-page deep links ----
const PAGES = { T4: 't4-xml-generator.html', NR4: 'nr4-xml-generator.html', T5018: 't5018-xml-generator.html', T1204: 't1204-xml-generator.html' };
for (const [rt, file] of Object.entries(PAGES)) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  assert(!html.includes('href="/#converter"'), `${file}: no plain /#converter link left`);
  const links = html.match(new RegExp(`href="/\\?return=${rt}#converter"`, 'g')) || [];
  assert(links.length >= 3, `${file}: nav, hero CTA and body CTA link /?return=${rt}#converter (found ${links.length})`);
  assert(!/href="\/\?return=(?!\w+#converter")/.test(html), `${file}: well-formed deep links`);
}
const events = (opts) => {
  const log = [];
  const app = createApp({ gtag: (c, name, p) => log.push([name, JSON.parse(JSON.stringify(p))]), ...opts });
  return { app, selected: () => log.filter(e => e[0] === 'return_selected').map(e => e[1]) };
};
for (const [search, rt, source] of [
  ['?return=NR4', 'NR4', 'landing'], ['?return=nr4', 'NR4', 'landing'], ['?RETURN=t5018', 'T5018', 'landing'],
  ['?utm_source=x&return=T1204', 'T1204', 'landing'], ['?return=T4', 'T4', 'landing'],
  ['', 'T4', 'default'], ['?return=', 'T4', 'default'], ['?return=T4A', 'T4', 'default'], ['?return=constructor', 'T4', 'default'],
  ['?return=%3Cscript%3E', 'T4', 'default'], ['?return=NR4x', 'T4', 'default'], ['?returns=NR4', 'T4', 'default'],
]) {
  const { app, selected } = events({ search });
  assert.strictEqual(app.el('return-type').value, rt, search);
  assert.strictEqual(app.el('sample-link').href, `templates/${rt}_Sample.csv`, search);
  // landing fires on page load; default only fires lazily before the first file_opened (not a pageview count)
  assert.deepStrictEqual(selected(), source === 'landing' ? [{ return_type: rt, source }] : [], search);
  app.loadFile('x.csv', Buffer.from('A,B\r\n1,2\r\n'));
  assert.deepStrictEqual(selected(), [{ return_type: rt, source }], `${search}: exactly one return_selected after a file opens`);
}
{ // hero picker and Step 1 dropdown
  const { app, selected } = events({});
  app.heroPicks.find(b => b.dataset.return === 'T5018').click();
  app.el('return-type').value = 'NR4';
  app.el('return-type').dispatchEvent({ type: 'change' });
  assert.deepStrictEqual(selected(), [{ return_type: 'T5018', source: 'hero' }, { return_type: 'NR4', source: 'dropdown' }]);
  assert.strictEqual(app.el('sample-link').href, 'templates/NR4_Sample.csv');
}
{ // privacy page documents the source param and its values
  const privacy = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
  for (const s of ['source', 'default', 'hero', 'dropdown', 'landing']) assert(privacy.includes(`<code>${s}</code>`), `privacy.html names ${s}`);
  assert(/RepID/.test(privacy), 'privacy.html lists the saved RepID');
}

// ---- index.html: no hard-coded year, accurate T619 hints, schema claims backed by tests/xsd.test.js ----
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const id of ['tax-year', 't5018-fiscal-year']) assert(!new RegExp(`id="${id}"[^>]*(value|placeholder)="20`).test(html), `${id} has no hard-coded year`);
  assert(!html.includes('MM0001') && !html.includes('placeholder="T1204A"'), 'no MM0001 hint, no T1204A placeholder');
  assert(html.includes('id="tx-repid"'), 'RepID field');
  assert(html.includes('T619 2027V1 / T4 2027V1 / T1204 2027V1 / T5018 2027V1 / NR4 2027V1</strong> (CRA XML schema 1-27-1), which CRA accepts from January 11, 2027'), 'FAQ: 2027 versions');
  assert(html.includes('1-27-1 for the 2027 filing season (accepted from January 11, 2027) and 1-26-3 until then'), 'hero claim');
}

console.log('seasonal.test.js: all passed');
