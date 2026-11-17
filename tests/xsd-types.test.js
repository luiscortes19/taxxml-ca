// The field-type table (js/validate.js + RETURN_TYPES in js/app.js) against CRA's own schemas, both packages the app
// builds for (tests/xsd/xmlschm1-26-3.zip and 1-27-1). If CRA changes a code list, a pattern or a box size, this fails.
// Reads the zips with SheetJS's zip reader, so it needs no python.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createApp, XLSX } = require('./harness');
const V = require('../js/validate.js');

const app = createApp({ returnType: 'T4' });
const RETURN_TYPES = JSON.parse(JSON.stringify(app.run('RETURN_TYPES'))); // plain objects, not the vm realm's
const XSD_FILE = { T4: 't4.xsd', T1204: 't1204.xsd', T5018: 't5018.xsd', NR4: 'nr4.xsd' };

for (const version of ['1-26-3', '1-27-1']) {
  const zip = XLSX.CFB.read(fs.readFileSync(path.join(__dirname, 'xsd', `xmlschm${version}.zip`)), { type: 'buffer' });
  const file = name => {
    const i = zip.FullPaths.findIndex(p => p.toLowerCase().endsWith('/' + name.toLowerCase()));
    assert(i >= 0, `${version}: ${name} in the zip`);
    return Buffer.from(zip.FileIndex[i].content).toString('utf8');
  };
  const ALL = zip.FullPaths.filter(p => p.endsWith('.xsd')).map(p => file(p.split('/').pop())).join('\n');
  const block = (kind, name) => {
    const m = new RegExp(`<xsd:${kind} name="${name}"[\\s\\S]*?</xsd:${kind}>`).exec(ALL);
    assert(m, `${version}: ${kind} ${name}`);
    return m[0];
  };
  // a simple type -> { enums, patterns, maxLength }, unions flattened
  const simple = name => {
    const b = block('simpleType', name);
    const union = /memberTypes="([^"]+)"/.exec(b);
    if (union) {
      const parts = union[1].split(/\s+/).map(simple);
      return { enums: parts.flatMap(p => p.enums), patterns: parts.flatMap(p => p.patterns), maxLength: null };
    }
    return {
      enums: [...b.matchAll(/<xsd:enumeration value="([^"]*)"/g)].map(m => m[1]),
      patterns: [...b.matchAll(/<xsd:pattern value="([^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"')),
      maxLength: +(/<xsd:maxLength value="(\d+)"/.exec(b) || [])[1] || null,
    };
  };
  const typeOf = (xsd, element, inType) => {
    const scope = inType ? block('complexType', inType) : file(xsd);
    const m = new RegExp(`<xsd:element name="${element}" type="([^"]+)"`).exec(scope);
    assert(m, `${version}: element ${element} in ${inType || xsd}`);
    return m[1];
  };
  const xsdRegex = p => new RegExp(`^(?:${p})$`, 'u'); // XSD patterns are anchored; \d, \p{L}, [..] read the same in JS
  const upper = list => [...new Set(list.map(s => s.toUpperCase()))].sort();
  const sorted = list => [...list].sort();

  // ---- T4 box 10: our dropdown = the XSD's provinceType, minus the old aliases we don't offer ----
  assert.strictEqual(typeOf('t4.xsd', 'empt_prov_cd'), 'provinceType');
  const prov = upper(simple('provinceType').enums);
  assert.deepStrictEqual(sorted([...V.T4_PROVINCE_CODES, ...V.LEGACY_PROVINCE_CODES]), prov, `${version}: T4 province codes drifted from provinceType`);
  assert.deepStrictEqual(V.T4_PROVINCE_CODES.filter(c => V.LEGACY_PROVINCE_CODES.includes(c)), []);
  assert.deepStrictEqual(V.T4_PROVINCE_CODES, [...V.PROVINCES, 'US', 'ZZ']);

  // ---- NR4 foreign address state/province: forcesProvinceStateType (forces + provinces + US states) ----
  const steType = typeOf('nr4.xsd', 'ste_cd', typeOf('nr4.xsd', 'RCPNT_ADDR'));
  assert.strictEqual(steType, 'forcesProvinceStateType');
  const ste = upper(simple(steType).enums);
  const legacyOnly = V.LEGACY_PROVINCE_CODES.filter(c => !V.NR4_STATE_CODES.includes(c));
  assert.deepStrictEqual(sorted([...V.NR4_STATE_CODES, ...legacyOnly]), ste, `${version}: NR4 state codes drifted from ${steType}`);
  assert.strictEqual(new Set(V.NR4_STATE_CODES).size, V.NR4_STATE_CODES.length, 'no duplicates');

  // ---- money: every amount column's size is the XSD's decimalNType (digits before the decimal point) ----
  for (const [rt, cfg] of Object.entries(RETURN_TYPES)) {
    for (const f of cfg.fields.filter(f => f.type === 'money')) {
      for (const el of f.xsd || [f.key]) {
        const t = typeOf(XSD_FILE[rt], el);
        const { patterns } = simple(t);
        const digits = +/^\\d\{0,(\d+)\}/.exec(patterns[0])[1];
        assert.strictEqual(f.digits, digits, `${version} ${rt}.${f.key} (${el}: ${t}) allows ${digits} digits before the decimal point`);
        // what we accept, formatted for the XML, is what the XSD accepts
        const max = '9'.repeat(digits) + '.99';
        for (const [raw, ok] of [[max, true], ['0', true], ['1234.5', digits >= 4], ['1' + '0'.repeat(digits) + '.00', false], ['-1', false], ['1.234', false]]) {
          const r = V.parseMoney(raw, f.digits);
          assert.strictEqual(!r.error, ok, `${rt}.${f.key} ${raw}: ${JSON.stringify(r)}`);
          if (ok) assert(patterns.some(p => xsdRegex(p).test(r.value.toFixed(2))), `${rt}.${f.key} ${raw} -> ${r.value.toFixed(2)} fails ${t}`);
        }
      }
    }
  }

  // ---- code lists ----
  for (const rt of ['T1204', 'T5018']) {
    const t = typeOf(XSD_FILE[rt], 'rcpnt_tcd');
    assert.strictEqual(t, 'indicator1-3-4Type');
    assert.deepStrictEqual(simple(t).patterns, ['1|3|4']);
  }
  assert.deepStrictEqual([...new Set(Object.values(JSON.parse(JSON.stringify(app.run('BIZ_TYPE_MAP')))))].sort(), ['1', '3', '4'], 'T1204/T5018 types map to 1, 3, 4 only');
  assert.strictEqual(typeOf('nr4.xsd', 'rcpnt_tcd'), 'indicator1-5Type');
  assert.deepStrictEqual(simple('indicator1-5Type').patterns, ['[1-5]{1}']);
  assert.deepStrictEqual([...new Set(Object.values(JSON.parse(JSON.stringify(app.run('NR4_RCPNT_TYPE_MAP')))))].sort(), ['1', '2', '3', '4', '5']);
  for (const el of ['cpp_qpp_xmpt_cd', 'ei_xmpt_cd']) {
    const t = typeOf('t4.xsd', el);
    assert.strictEqual(t, 'indicator0-1Type');
    const field = RETURN_TYPES.T4.fields.find(f => f.key === el);
    assert(field && field.type === 'code', `T4 has a ${el} column`);
    assert.deepStrictEqual(field.codes.map(c => c[0]).filter(Boolean), ['0', '1']);
    for (const [v] of field.codes.filter(c => c[0])) assert(simple(t).patterns.some(p => xsdRegex(p).test(v)));
  }

  // ---- NR4 identifiers and codes: XSD pattern vs our check on the value we write ----
  const nr4 = (el, inType) => simple(typeOf('nr4.xsd', el, inType));
  assert.deepStrictEqual(nr4('inc_1_tcd').patterns, ['\\d{2}']);
  assert.deepStrictEqual(nr4('crcy_1_cd').patterns, ['\\p{L}{3}']);
  assert.deepStrictEqual(nr4('tx_xmpt_1_cd').patterns, ['\\p{L}{1}']);
  assert.deepStrictEqual(nr4('tx_cntry_cd').patterns, ['\\p{L}{3}|\\p{N}{3}']);
  assert.strictEqual(nr4('fssn_nbr').maxLength, 20);
  const pc = nr4('fgn_pstl_cd', typeOf('nr4.xsd', 'RCPNT_ADDR'));
  assert.strictEqual(pc.maxLength, 10);
  for (const raw of ['98101', 'SW1A 1AA', '10115', 'K1A-0B1', 'sw1a1aa', '12345678901', 'AB#1', '']) {
    const out = V.foreignPostal(raw);
    assert.strictEqual(out !== null && out !== '', pc.patterns.some(p => xsdRegex(p).test(out || '')) && (out || '').length <= 10, `foreign postal ${raw} -> ${out}`);
  }
  for (const [type, re] of [['sinType', '\\d{1,9}'], ['bnType', '\\d{9}\\p{L}{2}\\d{4}'], ['bnRPType', '\\d{9}[Rr][Pp]\\d{4}'],
    ['bnRZType', '\\d{9}[Rr][Zz]\\d{4}'], ['nrType', '(\\p{L}{3}[0-9]{6})'], ['trustType', '(\\p{L}{1}[0-9]{8})']])
    assert.deepStrictEqual(simple(type).patterns, [re], `${version} ${type}`);
  assert.strictEqual(typeOf('t4.xsd', 'bn', 'T4SlipType'), 'bnRPType', 'T4 employer account is the RP program');
  assert.strictEqual(typeOf('t5018.xsd', 'bn', 'T5018SlipType'), 'bnRZType');
  // name and address elements are up to 100 characters; we cut them to CRA's slip sizes (see the length tests)
  for (const t of ['NameType', 'Line2Type', 'CanadaAddressType', 'NR4ForeignAddressType'])
    for (const m of block('complexType', t).matchAll(/name="(snm|gvn_nm|l1_nm|l2_nm|addr_l1_txt|cty_nm)" type="([^"]+)"/g))
      assert.strictEqual(simple(m[2]).maxLength, 100, `${t}.${m[1]}`);
  // dates: T5018 period end dy 1-31, mo 1-12, yr yearType
  assert.deepStrictEqual(simple('yearType').patterns, ['(20\\d{2})|(196[6-9])|(19[7-9][0-9])']);
  for (const y of ['1965', '1966', '2025', '2099', '210', 'abcd']) assert.strictEqual(V.isTaxYear(y), xsdRegex(simple('yearType').patterns[0]).test(y), `year ${y}`);
}
console.log('xsd-types.test.js: field-type table matches the 1-26-3 and 1-27-1 schemas');
