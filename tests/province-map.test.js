// Province auto-mapping: province names and loose abbreviations in the T4 Box 10 / NR4 ste_cd column become the
// CRA 2-letter code when the file opens (or a column moves onto that field). Anything uncertain stays as typed and
// keeps its validation error. Never a guess.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { mapProvince } = require('../js/validate.js');
const { createApp, fileToXML, ROOT } = require('./harness');


// ---- 1. pure function: every province and territory, English and French, with and without accents ----
const NAMES = {
  BC: ['British Columbia', 'Colombie-Britannique', 'Colombie Britannique', 'BRITISH COLUMBIA', '  british   columbia '],
  AB: ['Alberta', 'Alta', 'Alta.'],
  SK: ['Saskatchewan', 'Sask', 'Sask.'],
  MB: ['Manitoba', 'Man', 'Man.'],
  ON: ['Ontario', 'Ont', 'Ont.'],
  QC: ['Quebec', 'Québec', 'QUÉBEC', 'Que', 'Qué.', 'PQ', 'P.Q.'],
  NB: ['New Brunswick', 'Nouveau-Brunswick', 'Nouveau Brunswick'],
  NS: ['Nova Scotia', 'Nouvelle-Écosse', 'Nouvelle-Ecosse', 'nouvelle ecosse'],
  PE: ['Prince Edward Island', 'Île-du-Prince-Édouard', 'Ile du Prince Edouard', 'PEI', 'P.E.I.', 'p.e.i'],
  NL: ['Newfoundland and Labrador', 'Newfoundland & Labrador', 'Terre-Neuve-et-Labrador', 'Newfoundland', 'NF', 'Nfld', 'Nfld.'],
  YT: ['Yukon', 'Yukon Territory', 'Yuk', 'Yuk.'],
  NT: ['Northwest Territories', 'North-West Territories', 'Territoires du Nord-Ouest', 'NWT', 'N.W.T.'],
  NU: ['Nunavut'],
};
for (const rt of ['T4', 'NR4']) {
  for (const [want, list] of Object.entries(NAMES)) {
    for (const raw of list) {
      assert.deepStrictEqual(mapProvince(raw, rt), { code: want, changed: true }, `${rt}: "${raw}" -> ${want}`);
    }
  }
}

// dotted / spaced / lower-case codes; a code that is already valid needs no rewrite
assert.deepStrictEqual(mapProvince('B.C.', 'T4'), { code: 'BC', changed: true });
assert.deepStrictEqual(mapProvince('b. c.', 'T4'), { code: 'BC', changed: true });
assert.deepStrictEqual(mapProvince('BC', 'T4'), { code: 'BC', changed: false });
assert.deepStrictEqual(mapProvince('bc', 'T4'), { code: 'BC', changed: false }, 'normCode already takes it: cell left alone');
assert.deepStrictEqual(mapProvince(' on ', 'T4'), { code: 'ON', changed: false });
assert.deepStrictEqual(mapProvince('ZZ', 'T4'), { code: 'ZZ', changed: false });

// T4 only: the United States -> US. Never ZZ from a country name.
for (const raw of ['United States', 'United States of America', 'USA', 'U.S.', 'U.S.A.', 'usa']) {
  assert.deepStrictEqual(mapProvince(raw, 'T4'), { code: 'US', changed: true }, `T4: "${raw}" -> US`);
}
// NR4: a country name in the state column stays as typed (U.S. is just the dotted 2-letter code, which the list has)
for (const raw of ['United States', 'United States of America', 'USA', 'U.S.A.']) assert.strictEqual(mapProvince(raw, 'NR4'), null, `NR4: "${raw}" stays`);
for (const raw of ['Canada', 'France', 'Mexico', 'Other', 'Foreign']) assert.strictEqual(mapProvince(raw, 'T4'), null, `T4: "${raw}" stays`);

// NR4 only: US state names -> USPS code
const STATES = { Washington: 'WA', 'New York': 'NY', California: 'CA', Texas: 'TX', 'District of Columbia': 'DC',
  'North Carolina': 'NC', 'West Virginia': 'WV', Massachusetts: 'MA', Alabama: 'AL', 'Puerto Rico': 'PR', 'new   mexico': 'NM' };
for (const [raw, want] of Object.entries(STATES)) {
  assert.deepStrictEqual(mapProvince(raw, 'NR4'), { code: want, changed: true }, `NR4: "${raw}" -> ${want}`);
  assert.strictEqual(mapProvince(raw, 'T4'), null, `T4: "${raw}" is no T4 code`);
}
// AL and MA are US states in NR4: kept as they are, never turned into Alberta / Manitoba
assert.deepStrictEqual(mapProvince('AL', 'NR4'), { code: 'AL', changed: false });
assert.deepStrictEqual(mapProvince('ma', 'NR4'), { code: 'MA', changed: false });
// ...and in T4 the old aliases that could be a US state, or are rare, stay errors
for (const raw of ['AL', 'MA', 'LB', 'NN', 'SA', 'QU']) assert.strictEqual(mapProvince(raw, 'T4'), null, `T4: legacy "${raw}" stays`);

// blank and anything uncertain: null
for (const raw of ['', '   ', null, undefined, 'Mars', 'Van', 'Vancouver', 'B', 'Brit Col', 'Ontari', 'Columbia', 'BC2', 'B/C', 'N/A', 'ON, BC']) {
  for (const rt of ['T4', 'NR4']) assert.strictEqual(mapProvince(raw, rt), null, `${rt}: ${JSON.stringify(raw)} stays`);
}
assert.strictEqual(mapProvince(12, 'T4'), null, 'a number stays');

// ---- 2. in the editor: header detection, conversion on load, notice, marks, tooltip ----
const csv = rows => Buffer.from('﻿' + rows.map(r => r.join(',')).join('\r\n') + '\r\n');
function app(rt = 'T4') {
  const events = [];
  const a = createApp({ returnType: rt, gtag: (cmd, name, params) => events.push([name, JSON.parse(JSON.stringify(params))]) });
  a.named = n => events.filter(e => e[0] === n).map(e => e[1]);
  a.events = events;
  return a;
}
const shown = (a, id) => !a.el(id).classList.contains('hidden');

// a plain "Province" header (and its variants) fills Box 10
for (const h of ['Province', 'Prov', 'Province/Territory', 'Prov. of employment', 'PROVINCE']) {
  const a = app('T4');
  a.loadFile('t4.csv', csv([['Last Name', 'First Name', 'SIN', 'Employment Income', h], ['Doe', 'John', '046454286', '100', 'ON']]));
  assert.strictEqual(a.run('columnMap.empt_prov_cd'), 4, `T4 header "${h}" -> Box 10`);
}

// mixed formats end to end: names converted, valid codes untouched, blank and Mars as today
const T4H = ['Last Name', 'First Name', 'SIN', 'Box 14 - Employment Income', 'Province', 'Address'];
const T4ROWS = [
  ['Doe', 'A', '046454286', '100', 'British Columbia', ''],
  ['Doe', 'B', '046454286', '100', 'B.C.', ''],
  ['Doe', 'C', '046454286', '100', 'on', ''],
  ['Doe', 'D', '046454286', '100', 'Québec', ''],
  ['Doe', 'E', '046454286', '100', 'Nouvelle-Écosse', ''],
  ['Doe', 'F', '046454286', '100', 'PEI', ''],
  ['Doe', 'G', '046454286', '100', '', '"1 Main St / Ottawa ON K1A 0B1"'],
  ['Doe', 'H', '046454286', '100', 'Mars', ''],
];
{
  const a = app('T4');
  a.loadFile('t4.csv', csv([T4H, ...T4ROWS]));
  assert.strictEqual(a.run('columnMap.empt_prov_cd'), 4);
  const cells = JSON.parse(JSON.stringify(a.run('parsedData.map(r => r[4])')));
  assert.deepStrictEqual(cells, ['BC', 'BC', 'on', 'QC', 'NS', 'PE', '', 'Mars'], 'only cells that change are rewritten');
  assert.deepStrictEqual(a.named('province_mapped'), [{ return_type: 'T4', count: 5 }], 'counts only, never a value');
  assert(!JSON.stringify(a.events).includes('British') && !JSON.stringify(a.events).includes('Mars'), 'no cell text in GA4');

  const note = a.el('editor-province-note');
  assert(shown(a, 'editor-province-note'), 'notice above the table');
  assert.strictEqual(note.textContent, 'We changed 5 province names to CRA codes (British Columbia → BC).');
  const body = a.el('editor-tbody').innerHTML;
  assert.strictEqual((body.match(/cell-mapped/g) || []).length, 5, 'converted cells marked: ' + body);
  assert(body.includes('title="Was: British Columbia"'), 'tooltip with the original text');
  assert(body.includes('title="Was: Nouvelle-Écosse"'));
  // Mars keeps the existing error; blank row falls back to the address province with the existing warning
  assert.strictEqual(a.run('cellState(7, "empt_prov_cd").cls'), 'cell-error');
  assert(/province of employment "Mars" isn't a province or territory code/.test(a.run('cellState(7, "empt_prov_cd").msg')));
  assert.strictEqual(a.run('cellState(6, "empt_prov_cd").cls'), 'cell-warning');
  assert.strictEqual(a.run('cellState(0, "empt_prov_cd").cls'), '', 'a converted cell is valid');

  // the user can still edit a converted cell; the mark and the count follow
  a.run('editCell(0, 4, "AB")');
  assert.strictEqual(a.run('parsedData[0][4]'), 'AB');
  assert.strictEqual(a.run('mappedFrom(0, 4)'), undefined, 'edited cell is no longer marked');
  assert.strictEqual(a.el('editor-province-note').textContent, 'We changed 4 province names to CRA codes (B.C. → BC).');

  // XML: Mars still blocks generation with the existing message
  a.setDetails();
  assert.strictEqual(a.generate(), '', 'Mars blocks the file');
  assert(/Mars/.test(a.errors()));
}
{ // without Mars the file builds: empt_prov_cd in row order, the blank row takes the address province
  const { xml } = fileToXML('T4', 't4.csv', csv([T4H, ...T4ROWS.slice(0, 7)]));
  const provs = [...xml.matchAll(/<empt_prov_cd>(\w+)<\/empt_prov_cd>/g)].map(m => m[1]);
  assert.deepStrictEqual(provs, ['BC', 'BC', 'ON', 'QC', 'NS', 'PE', 'ON']);
}
{ // blank with no address: the existing "province of employment is blank" error
  const a = app('T4');
  a.loadFile('t4.csv', csv([T4H, ['Doe', 'A', '046454286', '100', '', '']]));
  assert(/province of employment is blank/.test(a.run('cellState(0, "empt_prov_cd").msg')));
  assert(!shown(a, 'editor-province-note'), 'nothing converted: no notice');
  assert.deepStrictEqual(a.named('province_mapped'), []);
}

// a column moved onto Box 10 is converted then
{
  const a = app('T4');
  a.loadFile('t4.csv', csv([['Last Name', 'First Name', 'SIN', 'Employment Income', 'Where'], ['Doe', 'John', '046454286', '100', 'Ontario']]));
  assert.strictEqual(a.run('columnMap.empt_prov_cd'), -1);
  assert.strictEqual(a.run('parsedData[0][4]'), 'Ontario', 'not touched while it is ignored');
  a.run('remapColumn(4, "empt_prov_cd", "button")');
  assert.strictEqual(a.run('parsedData[0][4]'), 'ON');
  assert.strictEqual(a.el('editor-province-note').textContent, 'We changed 1 province name to CRA codes (Ontario → ON).');
  assert.deepStrictEqual(a.named('province_mapped'), [{ return_type: 'T4', count: 1 }]);
}

// NR4: state names, AL/MA kept, a country name in the state column stays an error
{
  const a = app('NR4');
  const H = ['Recipient Name', 'Recipient Type', 'Foreign Tax ID', 'Country of Residence', 'Gross Income', 'State/Province'];
  a.loadFile('nr4.csv', csv([H, ...[['Washington'], ['AL'], ['ma'], ['British Columbia'], ['USA'], ['New York']]
    .map(([s], i) => [`P${i}`, 'Individual', `X${i}`, 'USA', '100', s])]));
  assert.strictEqual(a.run('columnMap.ste_cd'), 5);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.run('parsedData.map(r => r[5])'))), ['WA', 'AL', 'ma', 'BC', 'USA', 'NY']);
  assert.deepStrictEqual(a.named('province_mapped'), [{ return_type: 'NR4', count: 3 }]);
  assert.strictEqual(a.run('cellState(4, "ste_cd").cls'), 'cell-error', 'USA stays an error in a state column');
}

// ---- 3. already-valid inputs: byte-identical XML, no notice, no event ----
for (const f of fs.readdirSync(path.join(ROOT, 'tests', 'fixtures')).filter(f => /_input.*\.(csv|xlsx)$/.test(f))) {
  const rt = f.split('_')[0];
  const golden = path.join(ROOT, 'tests', 'fixtures', f.replace(/\.csv$/, '.golden.xml').replace(/\.xlsx$/, '_xlsx.golden.xml'));
  const is2027 = /2027/.test(f); // the same pins as golden.test.js
  const now = is2027 ? '2027-01-15T10:00' : '2026-11-15T10:00';
  const events = [];
  const { xml, app: a } = fileToXML(rt, f, fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', f)), is2027 ? { 'tax-year': '2026' } : undefined,
    { now, gtag: (cmd, name) => events.push(name) });
  if (fs.existsSync(golden)) assert.strictEqual(xml, fs.readFileSync(golden, 'utf8'), `${f}: golden unchanged`);
  assert(!events.includes('province_mapped'), `${f}: nothing to convert`);
  assert(a.el('editor-province-note').classList.contains('hidden'), `${f}: no notice`);
}

console.log('province-map.test.js: all passed');
