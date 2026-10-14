// CRA rules from the 2026 specs: T5018 payer RZ program, T1204 recipient type codes, landing-page claims.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createApp, fileToXML, ROOT } = require('./harness');

const fieldErrors = app => app.created.filter(e => e.className === 'field-error').map(e => e.textContent);

// ---- T5018 payer account must be the RZ program ----
const T5018_CSV = Buffer.from('Subcontractor Name,Subcontractor BN/SIN,Total Construction Payments,Recipient Type\nBuildIt Inc,123456789RT0001,1000.00,Corporation\n');
for (const bn of ['123456789RP0001', '123456789RT0001', '123456789RZ001', '123456789']) {
  const app = createApp({ returnType: 'T5018' });
  app.loadFile('t5018.csv', T5018_CSV);
  app.setDetails({ 'py-bn': bn });
  assert.strictEqual(app.generate(), '', `T5018 payer ${bn} must block generation`);
  const msg = fieldErrors(app).join(' | ');
  assert(msg.includes('T5018 payer account must use the RZ program, e.g. 123456789RZ0001') && msg.includes(`you entered ${bn}`), msg);
}
{
  const { xml } = fileToXML('T5018', 't5018.csv', T5018_CSV, { 'py-bn': '123456789rz0001' });
  assert(xml.includes('<bn>123456789RZ0001</bn>'), 'lower-case RZ is accepted and upper-cased');
}

// ---- T1204 Business Type -> rcpnt_tcd (1 sole proprietor, 3 corporation, 4 partnership) ----
const t1204 = type => {
  const app = createApp({ returnType: 'T1204' });
  app.loadFile('t1204.csv', Buffer.from(`Vendor Name,Vendor BN,Amount Paid,Business Type,Service Payments Only,Address\nBob Contractor,046454286,100.00,${type},Yes,1 Main St / Ottawa ON K1A0B1\n`));
  app.setDetails();
  return { xml: app.generate(), errors: app.errors() };
};
const TYPES = {
  1: ['Individual', 'individual', 'Sole Proprietor', 'Sole Proprietorship', 'Self-Employed', 'self employed', '1'],
  3: ['Corporation', 'CORPORATION', '3'],
  4: ['Partnership', 'partnership', '4'],
};
for (const [code, names] of Object.entries(TYPES)) for (const t of names) {
  const { xml, errors } = t1204(t);
  assert(xml.includes(`<rcpnt_tcd>${code}</rcpnt_tcd>`), `T1204 "${t}" -> ${code}: ${errors || xml}`);
}
for (const t of ['Trust', 'LLC', '2', '']) {
  const { xml, errors } = t1204(t);
  assert.strictEqual(xml, '', `T1204 business type "${t}" must block generation`);
  assert(/Row 2, column (&quot;|")Business Type\1 \(Bob Contractor\)/.test(errors) && /Individual.*Corporation.*Partnership/.test(errors), errors);
}

// ---- T1204 golden input: real amounts and totals ----
{
  const { xml } = fileToXML('T1204', 'T1204_input.csv', fs.readFileSync(path.join(__dirname, 'fixtures', 'T1204_input.csv')));
  const amts = [...xml.matchAll(/<(?:srvc_pay_amt|mxd_gd_pay_amt)>([^<]+)</g)].map(m => Number(m[1]));
  const tots = [...xml.matchAll(/<(?:tot_srvc_pay_amt|tot_mxd_gd_pay_amt)>([^<]+)</g)].map(m => Number(m[1]));
  assert(amts.length === 2 && amts.every(a => a > 0), `T1204 fixture slip amounts: ${amts}`);
  assert(tots.length && tots.reduce((a, b) => a + b) === amts.reduce((a, b) => a + b), `T1204 fixture totals: ${tots}`);
  assert(xml.includes('<addr_l1_txt>'), 'T1204 fixture address has a street line');
}

// ---- index.html claims match CRA (factcheck 2026-10-14) ----
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const gone of ['October 2025', 'Oct 2025', 'NR4 2026 ', 'NR4 2026<', 'T619 2026 ', 'T1204 uses RT', 'If you file more than 5 information slips']) {
    assert(!html.includes(gone), `index.html still says "${gone}"`);
  }
  assert(html.includes('NR4 2026V3') && html.includes('T619 2026V4'), 'spec versions');
  assert(/empty optional tags/i.test(html), 'still warns that empty optional tags are rejected');
  assert(/T1204[^.]*always[^.]*electronically/.test(html), 'T1204 is always filed electronically');
  assert(/web access code/i.test(html), 'IFT also accepts a web access code');
  assert(/Transmitter CRA account number/i.test(html), 'T619 holds the transmitter CRA account number');
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert(!/Oct(ober)? 2025|NR4 2026(?!V)/.test(ld), 'JSON-LD');
}

console.log('cra-rules.test.js: all passed');
