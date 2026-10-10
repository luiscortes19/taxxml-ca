// Golden XML: tests/fixtures/<input> -> real app.js pipeline -> must be byte-identical to <name>.golden.xml.
// Regenerate (only when an XML change is intended): UPDATE_GOLDENS=1 node tests/golden.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { fileToXML } = require('./harness');

const DIR = path.join(__dirname, 'fixtures');
const CASES = [
  ['T4', 'T4_input.csv'],
  ['T4', 'T4_input.xlsx'],
  ['T1204', 'T1204_input.csv'],
  ['T5018', 'T5018_input.csv'],
  ['NR4', 'NR4_input.csv'],
];

for (const [rt, input] of CASES) {
  const { xml } = fileToXML(rt, input, fs.readFileSync(path.join(DIR, input)));
  const golden = path.join(DIR, input.replace(/\.\w+$/, '') + (input.endsWith('.xlsx') ? '_xlsx' : '') + '.golden.xml');
  if (process.env.UPDATE_GOLDENS) fs.writeFileSync(golden, xml);
  assert.strictEqual(xml, fs.readFileSync(golden, 'utf8'), `${input}: XML differs from ${path.basename(golden)}`);
}
console.log(`golden.test.js: ${CASES.length} goldens byte-identical`);
