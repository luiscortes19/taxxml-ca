// Accented names must survive every CSV encoding people actually upload; SINs keep their leading zero on every path.
const assert = require('assert');
const { createApp } = require('./harness');

const csv = 'Last Name,First Name,SIN,Box 14 - Employment Income,Province of Employment\r\n' +
            'Côté,François,046454286,50000.00,QC\r\n';
const enc = {
  'utf-8 (no BOM)': Buffer.from(csv),                 // Google Sheets, Numbers, most payroll exports
  'utf-8 BOM': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv)]),
  'windows-1252': Buffer.from(csv, 'latin1'),          // Excel "CSV": é is the single byte 0xE9
  'utf-16le BOM': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv, 'utf16le')]),
  'utf-16be BOM': Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(csv, 'utf16le').swap16()]),
};
assert.strictEqual(enc['windows-1252'].indexOf(0xe9), 'Last Name,First Name,SIN,Box 14 - Employment Income,Province of Employment\r\nCôt'.length);

for (const [label, bytes] of Object.entries(enc)) {
  const app = createApp({ returnType: 'T4' });
  app.loadFile('t4.csv', bytes);
  const [row] = app.run('parsedData');
  assert.strictEqual(row[0], 'Côté', `${label}: last name`);
  assert.strictEqual(row[1], 'François', `${label}: first name`);
  assert.strictEqual(row[2], '046454286', `${label}: SIN lost its leading zero`);
}

console.log('csv-encoding.test.js: all passed');
