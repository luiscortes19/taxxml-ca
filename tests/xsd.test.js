// Generated XML vs CRA's official schema packages (tests/xsd/*.zip, see tests/xsd/README.md): every sample and
// golden input made in both filing modes, the committed goldens, every transmitter account form, every NR4
// Canadian tax ID form. Needs python3 + lxml (tests/xsd_validate.py); skips loudly without them.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { fileToXML, ROOT } = require('./harness');

if (spawnSync('python3', ['-I', '-c', 'import lxml.etree']).status !== 0) {
  console.warn('\n**********\nxsd.test.js SKIPPED: python3 with lxml is not available, so NO CRA schema validation ran.\n' +
               'Install it (pip install lxml) and re-run npm test.\n**********\n');
  process.exit(0);
}

// A date on which the app emits each schema (targetSchema in js/validate.js)
const MODES = { '1-26-3': '2026-11-15T10:00', '1-27-1': '2027-01-15T10:00' };
const SCHEMAS = Object.keys(MODES);
const FIXTURES = path.join(__dirname, 'fixtures');

// XML made in `mode` must validate against both schemas, except NR4 across modes:
// 1-27-1 requires <CIN> on every NR4 slip and 1-26-3 doesn't allow it, so no NR4 file can pass both.
const cases = [];
function check(label, rt, xml, mode) {
  for (const schema of SCHEMAS) cases.push({ label: `${label}, made in ${mode} mode, vs ${schema}`, rt, xml, schema, valid: rt !== 'NR4' || schema === mode });
}
const gen = (rt, file, bytes, mode, details) => fileToXML(rt, file, bytes, details, { now: MODES[mode] }).xml;

// 1. every sample and golden input
const inputs = [
  ...fs.readdirSync(path.join(ROOT, 'templates')).filter(f => f.endsWith('_Sample.csv')).map(f => path.join(ROOT, 'templates', f)),
  ...fs.readdirSync(FIXTURES).filter(f => /_input.*\.(csv|xlsx)$/.test(f)).map(f => path.join(FIXTURES, f)),
];
assert(inputs.length >= 9, inputs.join());
for (const file of inputs) {
  const name = path.basename(file);
  const rt = name.split('_')[0];
  for (const mode of SCHEMAS) check(name, rt, gen(rt, name, fs.readFileSync(file), mode), mode);
}

// 2. the committed goldens (NR4 *_2027 goldens are 1-27-1 files, the rest 1-26-3)
for (const f of fs.readdirSync(FIXTURES).filter(f => f.endsWith('.golden.xml'))) {
  check(f, f.split('_')[0], fs.readFileSync(path.join(FIXTURES, f), 'utf8'), f.includes('_2027') ? '1-27-1' : '1-26-3');
}

// 3. every T619 transmitter account form, RepID alone, and both
const T4 = fs.readFileSync(path.join(ROOT, 'templates', 'T4_Sample.csv'));
const ACCOUNTS = [
  [{ 'tx-bn': '123456789RP0001' }, '<TransmitterAccountNumber><bn15>123456789RP0001</bn15></TransmitterAccountNumber>'],
  [{ 'tx-bn': '123456789' }, '<TransmitterAccountNumber><bn9>123456789</bn9></TransmitterAccountNumber>'],
  [{ 'tx-bn': 't12345678' }, '<TransmitterAccountNumber><trust>T12345678</trust></TransmitterAccountNumber>'],
  [{ 'tx-bn': 'NRA123456' }, '<TransmitterAccountNumber><nr4>NRA123456</nr4></TransmitterAccountNumber>'],
  [{ 'tx-bn': '', 'tx-repid': 'AB12CD3' }, '<TransmitterAccountNumber></TransmitterAccountNumber>\n    <TransmitterRepID><RepID>AB12CD3</RepID></TransmitterRepID>'],
  [{ 'tx-bn': '123456789RZ0001', 'tx-repid': 'X1' }, '<bn15>123456789RZ0001</bn15></TransmitterAccountNumber>\n    <TransmitterRepID><RepID>X1</RepID></TransmitterRepID>'],
];
for (const mode of SCHEMAS) for (const [details, expected] of ACCOUNTS) {
  const xml = gen('T4', 'T4_Sample.csv', T4, mode, details);
  assert(xml.includes(expected), `${JSON.stringify(details)}: expected ${expected} in\n${xml.slice(0, 400)}`);
  check(`T4 transmitter ${JSON.stringify(details)}`, 'T4', xml, mode);
}

// 4. NR4 box 13 Canadian tax ID: blank (CRA's 000000000), SIN/TTN/ITN, BN, trust
const NR4_CIN = Buffer.from('Recipient Name,Recipient Type,Foreign Tax ID,Country of Residence,Gross Income,Canadian Tax ID\n' +
  'Ann Smith,Individual,X1,USA,100.00,\nBob Smith,Individual,X2,USA,100.00,091234567\n' +
  'Cee Corp,Corporation,X3,USA,100.00,123456789RC0001\nDee Trust,Other,X4,USA,100.00,T12345678\n');
for (const mode of SCHEMAS) {
  const xml = gen('NR4', 'nr4.csv', NR4_CIN, mode);
  const cins = [...xml.matchAll(/<CIN>(.*?)<\/CIN>/g)].map(m => m[1]);
  assert.deepStrictEqual(cins, mode === '1-26-3' ? [] : ['<sin_ttn_itn>000000000</sin_ttn_itn>', '<sin_ttn_itn>091234567</sin_ttn_itn>',
    '<bn>123456789RC0001</bn>', '<trust>T12345678</trust>'], mode);
  check('NR4 Canadian tax ID forms', 'NR4', xml, mode);
}

// Validate everything in one python run
const run = spawnSync('python3', ['-I', path.join(__dirname, 'xsd_validate.py')],
  { input: JSON.stringify(cases.map(({ schema, rt, xml }) => ({ schema, rt, xml }))), encoding: 'utf8', maxBuffer: 64 << 20 });
assert.strictEqual(run.status, 0, run.stderr);
const results = JSON.parse(run.stdout);
const wrong = cases.flatMap((c, i) => results[i].ok === c.valid ? []
  : [`${c.label}: expected ${c.valid ? 'valid, got ' + results[i].errors.join(' | ') : 'a schema error'}`]);
assert.deepStrictEqual(wrong, [], wrong.join('\n'));
console.log(`xsd.test.js: ${cases.length} CRA schema checks passed (${cases.filter(c => c.valid).length} valid, ${cases.filter(c => !c.valid).length} rejected as expected)`);
