// Each templates/<RT>_Sample.csv, per return type:
//  1. under its own return: zero errors, well-formed XML with the CRA Submission/T619/Return/<RT> shape,
//     one slip per row, real amounts, required slip elements, summary totals = sum of slips
//  2. under every other return: generation is blocked with an error, never silently produces XML
//  3. identifiers with leading zeros injected into the sample come out in the XML exactly as typed
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createApp, fileToXML, ROOT } = require('./harness');

const DIR = path.join(ROOT, 'templates');
const TYPES = ['T4', 'T1204', 'T5018', 'NR4'];
const sample = rt => fs.readFileSync(path.join(DIR, `${rt}_Sample.csv`));

// Tag-balance check: every open tag closed in order, one root, no empty elements (CRA rejects <x/> and <x></x>).
function assertWellFormed(xml, label) {
  assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), `${label}: XML declaration`);
  const stack = [];
  let roots = 0;
  for (const [, close, name, selfClose] of xml.replace(/^<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([A-Za-z_][\w.-]*)[^>]*?(\/?)>/g)) {
    assert(!selfClose, `${label}: empty element <${name}/>`);
    if (close) assert.strictEqual(stack.pop(), name, `${label}: </${name}> closes the wrong element`);
    else { if (!stack.length) roots++; stack.push(name); }
  }
  assert.strictEqual(stack.length, 0, `${label}: unclosed ${stack.join('>')}`);
  assert.strictEqual(roots, 1, `${label}: one root element`);
  assert(!/<([\w.-]+)>\s*<\/\1>/.test(xml), `${label}: empty element ${(xml.match(/<([\w.-]+)>\s*<\/\1>/) || [])[0]}`);
  assert(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml), `${label}: unescaped &`);
}
const all = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map(m => m[1]);
const one = (xml, tag) => { const v = all(xml, tag); assert.strictEqual(v.length, 1, `exactly one <${tag}>`); return v[0]; };
const sum = vals => vals.reduce((s, v) => s + Number(v), 0).toFixed(2);
const block = (xml, tag) => all(xml.replace(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'), (_, b) => `<${tag}>${b.replace(/</g, '\u0001')}</${tag}>`), tag)
  .map(b => b.replace(/\u0001/g, '<'));

// Per return: elements every slip must carry (CRA_REFERENCE_GUIDE.md), the slip amount tag, the summary total tag
const SPEC = {
  T4: { slipTags: ['snm', 'sin', 'bn', 'empt_prov_cd', 'rpt_tcd'], amt: 'empt_incamt', tot: 'tot_empt_incamt', summary: ['bn', 'tx_yr', 'slp_cnt', 'rpt_tcd'] },
  T1204: { slipTags: ['sin', 'rcpnt_bn', 'l1_nm', 'rcpnt_tcd', 'payr_bn', 'rpt_tcd', 'addr_l1_txt'], amt: '(?:srvc_pay_amt|mxd_gd_pay_amt)', tot: '(?:tot_srvc_pay_amt|tot_mxd_gd_pay_amt)', summary: ['bn', 'tx_yr', 'slp_cnt', 'rpt_tcd'] },
  T5018: { slipTags: ['sin', 'rcpnt_bn', 'rcpnt_tcd', 'bn', 'rpt_tcd', 'addr_l1_txt'], amt: 'sbctrcr_amt', tot: 'tot_sbctrcr_amt', summary: ['bn', 'slp_cnt', 'rpt_tcd', 'dy', 'mo', 'yr'] },
  NR4: { slipTags: ['tx_cntry_cd', 'fssn_nbr', 'nr_acct_nbr', 'rcpnt_tcd', 'inc_1_tcd', 'rpt_tcd'], amt: 'gro_1_incamt', tot: 'tot_gro_1_incamt', summary: ['nr_acct_nbr', 'tx_yr', 'slp_cnt', 'rpt_tcd'] },
};

// ---- 1. own return type ----
for (const rt of TYPES) {
  const label = `${rt}_Sample.csv as ${rt}`;
  const { xml, app } = fileToXML(rt, `${rt}_Sample.csv`, sample(rt));
  assert.strictEqual(app.errors(), '', label);
  assertWellFormed(xml, label);
  const rows = app.run('parsedData.length');
  assert(rows >= 2, `${label}: sample has rows`);

  // Submission > T619 + Return > <RT> > <RT>Slip... <RT>Summary
  assert(/^<\?xml[^>]*\?>\s*<Submission[ >][\s\S]*<\/Submission>\s*$/.test(xml), `${label}: root Submission`);
  const t619 = block(xml, 'T619');
  assert.strictEqual(t619.length, 1, `${label}: one T619`);
  for (const t of ['bn15', 'sbmt_ref_id', 'summ_cnt', 'lang_cd', 'l1_nm', 'cntc_nm', 'cntc_area_cd', 'cntc_phn_nbr', 'cntc_email_area']) one(t619[0], t);
  assert(/<\/T619>\s*<Return>\s*<\w+>/.test(xml) && new RegExp(`<Return>\\s*<${rt}>[\\s\\S]*</${rt}>\\s*</Return>`).test(xml), `${label}: Return/${rt}`);
  const ret = block(xml, rt)[0];
  assert(new RegExp(`^\\s*<${rt}Slip>[\\s\\S]*</${rt}Slip>\\s*<${rt}Summary>[\\s\\S]*</${rt}Summary>\\s*$`).test(ret), `${label}: slips then summary`);

  const slips = block(xml, `${rt}Slip`);
  assert.strictEqual(slips.length, rows, `${label}: one slip per row`);
  const spec = SPEC[rt];
  slips.forEach((s, i) => {
    for (const t of spec.slipTags) assert(all(s, t).length >= 1, `${label}: slip ${i + 1} missing <${t}>`);
    const amts = all(s, spec.amt);
    assert.strictEqual(amts.length, 1, `${label}: slip ${i + 1} amount`);
    assert(Number(amts[0]) > 0, `${label}: slip ${i + 1} amount is ${amts[0]} (amount column not read?)`);
  });
  const summary = block(xml, `${rt}Summary`)[0];
  for (const t of spec.summary) one(summary, t);
  assert.strictEqual(one(summary, 'slp_cnt'), String(rows), `${label}: slp_cnt`);
  assert.strictEqual(sum(all(summary, spec.tot)), sum(slips.flatMap(s => all(s, spec.amt))), `${label}: summary total = sum of slips`);
}

// ---- 2. mismatched return type: blocked with an error, no XML ----
for (const s of TYPES) for (const rt of TYPES.filter(t => t !== s)) {
  const app = createApp({ returnType: rt });
  app.loadFile(`${s}_Sample.csv`, sample(s));
  app.setDetails();
  const xml = app.generate();
  assert.strictEqual(xml, '', `${s}_Sample.csv under ${rt} must not produce XML`);
  assert(/<li>/.test(app.errors()), `${s}_Sample.csv under ${rt}: needs a visible error`);
}
// The SIN field must not grab a "Business ..." column ("buSINess")
{
  const app = createApp({ returnType: 'T4' });
  app.loadFile('t4.csv', Buffer.from('Business Unit,Last Name,First Name,SIN,Employment Income\nSales,Doe,John,046454286,100\n'));
  assert.strictEqual(app.run('columnMap.sin'), 3);
}

// ---- 3. leading-zero identifiers injected into each sample, same file encoding ----
function edit(rt, pairs) {
  const raw = sample(rt);
  const utf16 = raw[0] === 0xff && raw[1] === 0xfe;
  let text = utf16 ? raw.subarray(2).toString('utf16le') : raw.toString('utf8');
  for (const [from, to] of pairs) { assert(text.includes(from), `${rt} sample has ${from}`); text = text.replace(from, to); }
  return utf16 ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]) : Buffer.from(text);
}
// Filing details with leading zeros too: transmitter/payer BN, submission ref, NR account digits
const ZERO_DETAILS = { 'tx-bn': '012345678MM0001', 'py-bn': '000000001RP0001', 'tx-ref': '000001', 'nr4-acct': 'NRA000123' };
const zeroCases = {
  T4: [[['046454286', '000000000'], ['130692544', '012345674']], ['<sin>000000000</sin>', '<sin>012345674</sin>']],
  T1204: [[['123456789RT0001', '012345678RT0001'], ['046454286', '000000018']], ['<rcpnt_bn>012345678RT0001</rcpnt_bn>', '<sin>000000018</sin>']],
  T5018: [[['123456789RT0001', '001234567RZ0001'], ['046454286', '000000018']], ['<rcpnt_bn>001234567RZ0001</rcpnt_bn>', '<sin>000000018</sin>']],
  NR4: [[['987-65-4320', '000123456'], ['98101', '02134'], ['10115', '01067']], ['<fssn_nbr>000123456</fssn_nbr>', '<fgn_pstl_cd>02134</fgn_pstl_cd>', '<fgn_pstl_cd>01067</fgn_pstl_cd>', '<inc_1_tcd>06</inc_1_tcd>', '<inc_1_tcd>02</inc_1_tcd>']],
};
for (const [rt, [pairs, expected]] of Object.entries(zeroCases)) {
  const payerBn = rt === 'T5018' ? '000000001RZ0001' : ZERO_DETAILS['py-bn'];
  const { xml, app } = fileToXML(rt, `${rt}_Sample.csv`, edit(rt, pairs), { ...ZERO_DETAILS, 'py-bn': payerBn });
  assert.strictEqual(app.errors(), '', rt);
  assertWellFormed(xml, `${rt} leading zeros`);
  for (const e of expected) assert(xml.includes(e), `${rt}: expected ${e}`);
  assert(xml.includes('<bn15>012345678MM0001</bn15>') && xml.includes('<sbmt_ref_id>000001</sbmt_ref_id>'), `${rt}: T619 ids`);
  if (rt === 'NR4') assert.strictEqual(all(xml, 'nr_acct_nbr').filter(v => v === 'NRA000123').length, 3, 'NR4: account on summary + 2 slips');
  else assert(all(xml, rt === 'T1204' ? 'payr_bn' : 'bn').includes(payerBn), `${rt}: payer BN`);
}

console.log('samples-per-return.test.js: own type, mismatches and leading zeros all passed');
