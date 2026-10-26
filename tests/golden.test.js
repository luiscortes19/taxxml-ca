// Golden XML: tests/fixtures/<input> -> real app.js pipeline -> must be byte-identical to <name>.golden.xml.
// The app's clock is pinned: the output schema depends on the date (1-26-3 until Dec 22 2026, then 1-27-1).
// Regenerate (only when an XML change is intended): UPDATE_GOLDENS=1 node tests/golden.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { fileToXML } = require('./harness');

const DIR = path.join(__dirname, 'fixtures');
const IN_1_26_3 = '2026-11-15T10:00', IN_1_27_1 = '2027-01-15T10:00';
const CASES = [
  ['T4', 'T4_input.csv', IN_1_26_3],
  ['T4', 'T4_input.xlsx', IN_1_26_3],
  ['T1204', 'T1204_input.csv', IN_1_26_3],
  ['T5018', 'T5018_input.csv', IN_1_26_3],
  ['NR4', 'NR4_input.csv', IN_1_26_3],
  ['NR4', 'NR4_input_2027.csv', IN_1_27_1, { 'tax-year': '2026' }],
];

for (const [rt, input, now, details] of CASES) {
  const { xml } = fileToXML(rt, input, fs.readFileSync(path.join(DIR, input)), details, { now });
  const golden = path.join(DIR, input.replace(/\.\w+$/, '') + (input.endsWith('.xlsx') ? '_xlsx' : '') + '.golden.xml');
  if (process.env.UPDATE_GOLDENS) fs.writeFileSync(golden, xml);
  assert.strictEqual(xml, fs.readFileSync(golden, 'utf8'), `${input}: XML differs from ${path.basename(golden)}`);
}
console.log(`golden.test.js: ${CASES.length} goldens byte-identical`);
