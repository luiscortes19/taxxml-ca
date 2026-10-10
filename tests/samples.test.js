// Every shipped sample in templates/*.csv must go file -> auto map -> XML with zero validation errors.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { fileToXML, ROOT } = require('./harness');

const dir = path.join(ROOT, 'templates');
const samples = fs.readdirSync(dir).filter(f => f.endsWith('_Sample.csv'));
assert.strictEqual(samples.length, 4, 'expected a sample for T4, T1204, T5018 and NR4');
for (const f of samples) {
  const rt = f.split('_')[0];
  const { xml, app } = fileToXML(rt, f, fs.readFileSync(path.join(dir, f)));   // throws with the on-screen errors
  assert.strictEqual(app.errors(), '');
  const rows = app.run('parsedData.length');
  assert.strictEqual((xml.match(new RegExp(`<${rt}Slip>`, 'g')) || []).length, rows, `${f}: one slip per row`);
}

// T4 sample: separate name columns that auto-map, SINs with and without a leading zero
{
  const { xml, app } = fileToXML('T4', 'T4_Sample.csv', fs.readFileSync(path.join(dir, 'T4_Sample.csv')));
  const raw = fs.readFileSync(path.join(dir, 'T4_Sample.csv'));
  assert.deepStrictEqual([...raw.subarray(0, 2)], [0xff, 0xfe], 'T4 sample stays UTF-16LE with BOM');
  assert(app.run('columnMap.empe_snm') >= 0 && app.run('columnMap.empe_gvn_nm') >= 0, 'both name columns auto-map');
  assert(app.run('columnMap.empe_snm') !== app.run('columnMap.empe_gvn_nm'));
  assert(xml.includes('<snm>Doe</snm>') && xml.includes('<gvn_nm>John</gvn_nm>'));
  assert(xml.includes('<sin>046454286</sin>') && xml.includes('<sin>130692544</sin>'));
}
console.log(`samples.test.js: ${samples.length} samples generate cleanly`);
