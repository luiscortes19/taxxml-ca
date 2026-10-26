// SEO landing pages: each /<return>-xml-generator exists, has its own head tags, points at the converter, is in the sitemap.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./harness');

const XML_SPECS = 'https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/xml-specs.html';
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

for (const code of ['T4', 'NR4', 'T5018', 'T1204']) {
  const slug = `${code.toLowerCase()}-xml-generator`;
  const file = path.join(ROOT, `${slug}.html`);
  assert(fs.existsSync(file), `${slug}.html is missing`);
  const html = fs.readFileSync(file, 'utf8');
  const URL = `https://taxxml.ca/${slug}`;
  const msg = s => `${slug}: ${s}`;

  assert(new RegExp(`<title>[^<]*\\b${code}\\b[^<]*</title>`).test(html), msg(`title mentions ${code}`));
  assert(/<meta name="description" content="[^"]{50,160}">/.test(html), msg('meta description, 50-160 chars'));
  assert(html.includes(`<link rel="canonical" href="${URL}">`), msg('canonical'));
  assert(html.includes(`<meta property="og:url" content="${URL}">`), msg('og:url'));
  assert(html.includes('<link rel="icon" type="image/svg+xml" href="/favicon.svg">'), msg('favicon'));
  assert(new RegExp(`<a href="/\\?return=${code}#converter" class="btn btn-primary[^"]*">`).test(html), msg('CTA button deep-links the converter to this return'));
  assert(html.includes("gtag('config', 'G-E2F5Q3RZVH')"), msg('same GA4 tag as the other pages'));

  // Disclaimer near the CTA points at CRA's XML specs; liability release in the footer links /terms
  const disclaimer = html.match(/<div id="disclaimer"[^>]*>([\s\S]*?)<\/div>/);
  assert(disclaimer, msg('disclaimer exists'));
  assert(disclaimer[1].includes(`href="${XML_SPECS}"`), msg('disclaimer links the CRA xml-specs page'));
  const liability = html.match(/<section id="liability">([\s\S]*?)<\/section>/);
  assert(liability, msg('liability section exists'));
  assert(liability[1].includes('href="/terms"'), msg('liability section links /terms'));

  // FAQPage JSON-LD questions match the visible FAQ, in order
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.strictEqual(ld['@type'], 'FAQPage', msg('FAQPage JSON-LD'));
  const visible = [...html.matchAll(/<summary>(.*?)<\/summary>/g)].map(m => m[1]);
  assert(visible.length > 0, msg('has a visible FAQ'));
  assert.deepStrictEqual(ld.mainEntity.map(q => q.name), visible, msg('JSON-LD matches visible FAQ'));

  // CRA fact-check: no unverified dates, account number wording, WAC sign-in
  const schemaQ = visible.find(q => q.startsWith('Which CRA XML schema'));
  const schemaLd = ld.mainEntity.find(q => q.name === schemaQ).acceptedAnswer.text;
  const schemaVisible = html.match(new RegExp(`<summary>${schemaQ.replace(/\?/, '\\?')}</summary>\\s*<p>([\\s\\S]*?)</p>`))[1].replace(/<[^>]+>/g, '');
  assert(schemaLd.endsWith(" It also follows CRA's rule that empty optional tags must be left out, because IFT rejects them."), msg('schema FAQ answer: empty-tag rule'));
  assert.strictEqual(schemaVisible, schemaLd, msg('schema FAQ: JSON-LD matches visible text'));
  assert(!html.includes('October 2025'), msg('no unverified "October 2025" date'));
  assert(html.includes('CRA rejects files that contain empty optional tags: a tag with nothing in it, like <code>'), msg('empty-tag pitfall wording'));
  assert(!html.includes("transmitter's business number"), msg('no "transmitter\'s business number"'));
  assert(html.includes("the transmitter's CRA account number (usually the 15-character business number)"), msg('T619 account number wording'));
  assert(!html.includes('My Business Account or Represent a Client login'), msg('no MyBA/RAC-only login wording'));
  assert(html.includes('signed in with My Business Account, Represent a Client, or a web access code (WAC)'), msg('WAC sign-in wording'));

  assert(sitemap.includes(`<loc>${URL}</loc>`), msg('listed in sitemap.xml'));
  assert(index.includes(`href="/${slug}"`), msg('linked from index.html'));
}

const page = slug => fs.readFileSync(path.join(ROOT, `${slug}.html`), 'utf8');
const visibleAnswer = (html, q) => html.match(new RegExp(`<summary>${q.replace(/[?.()]/g, "\\$&")}</summary>\\s*<p>([\\s\\S]*?)</p>`))?.[1];
const ldAnswer = (html, q) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])
  .mainEntity.find(e => e.name === q).acceptedAnswer.text;

// T4: bn15 wording, WAC in the "does TaxXML file" FAQ, cross-links to the other guides
const t4 = page('t4-xml-generator');
assert(t4.includes("<code>bn15</code>: the transmitter's 15-character account number, usually the business number."), 't4: bn15 wording');
const t4Submit = "No. You download the XML and upload it through CRA's Internet File Transfer, signed in with My Business Account, Represent a Client, or a web access code (WAC).";
const t4SubmitQ = [...t4.matchAll(/<summary>(.*?)<\/summary>/g)].map(m => m[1]).find(q => visibleAnswer(t4, q) === t4Submit);
assert(t4SubmitQ, 't4: visible WAC FAQ answer');
assert.strictEqual(ldAnswer(t4, t4SubmitQ), t4Submit, 't4: JSON-LD WAC FAQ answer');
for (const code of ['t1204', 't5018', 'nr4']) {
  assert(t4.includes(`<a href="/${code}-xml-generator"><strong>${code.toUpperCase()}</strong></a>`), `t4: links /${code}-xml-generator`);
}

// T1204: mandatory e-filing regardless of slip count; recipient type codes
const t1204 = page('t1204-xml-generator');
assert(!/more than 5|5 slips|optional but still accepted/.test(t1204), 't1204: no 5-slip threshold');
assert(t1204.includes('T1204 returns must be filed electronically, whatever the number of slips'), 't1204: mandatory e-filing paragraph');
const efileQ = 'Do I have to file T1204 slips electronically?';
const efileA = 'Yes. CRA requires T1204 returns to be filed electronically, whatever the number of slips. Internet File Transfer with an XML file is one of the accepted ways; Web Forms is the other.';
assert.strictEqual(visibleAnswer(t1204, efileQ), efileA, 't1204: visible e-filing FAQ');
assert.strictEqual(ldAnswer(t1204, efileQ), efileA, 't1204: JSON-LD e-filing FAQ');
assert(t1204.includes('<code>rcpnt_tcd</code>: recipient type: <code>1</code> sole proprietor, <code>3</code> corporation, <code>4</code> partnership.'), 't1204: rcpnt_tcd codes');

// NR4: 2027V1 (schema 1-27-1) from Dec 22 2026, 2026V3 (1-26-3) before; CIN box 13, fssn_nbr box 30 (NR4 2027 spec)
const nr4 = page('nr4-xml-generator');
assert(!/NR4 2026(?!V3)/.test(nr4) && !/NR4 2027(?!V1)/.test(nr4), 'nr4: every "NR4 2026" is 2026V3, every "NR4 2027" is 2027V1');
assert(nr4.includes('1-27-1 (T619 2027V1, NR4 2027V1) for files made from December 22, 2026, and 1-26-3 (T619 2026, NR4 2026V3) before then'), 'nr4: subtitle version');
const nr4SchemaQ = 'Which CRA XML schema does TaxXML use for NR4?';
assert(ldAnswer(nr4, nr4SchemaQ).startsWith('For files made from December 22, 2026: CRA XML schema 1-27-1, T619 2027V1 and NR4 2027V1, which CRA accepts from January 11, 2027.'), 'nr4: JSON-LD schema version');
assert(visibleAnswer(nr4, nr4SchemaQ).includes('schema 1-26-3 (T619 2026 and NR4 2026V3), accepted until December 22, 2026.'), 'nr4: visible schema version');
assert(nr4.includes("<code>fssn_nbr</code>: the recipient's 3-letter country of tax residence (Box 12) and their foreign tax identification number (Box 30 on 2027 slips; Box 13 before)."), 'nr4: fssn_nbr wording');
assert(nr4.includes('CRA says to enter <code>&lt;sin_ttn_itn&gt;000000000&lt;/sin_ttn_itn&gt;</code>'), 'nr4: CIN placeholder wording');
// T4, T5018, T1204: output is the same under both schemas (tests/xsd.test.js), so the pages claim both
for (const [code, v26] of [['T4', '2026V4'], ['T5018', '2026V3'], ['T1204', '2026V3']]) {
  const html = page(`${code.toLowerCase()}-xml-generator`);
  assert(html.includes(`<title>Free ${code} XML Generator for CRA (2027 Schema) | TaxXML.ca</title>`), `${code}: title`);
  assert(html.includes(`CRA XML schema <strong>1-27-1</strong>: T619 2027V1 and ${code} 2027V1, which CRA accepts from January 11, 2027. The same file is also valid under the 2026 schema 1-26-3 (${code} ${v26}), accepted until December 22, 2026.`), `${code}: schema FAQ`);
  assert(html.includes('t619-2027.html') && !html.includes('t619-2026.html'), `${code}: links the T619 2027 spec`);
}

// Payer account program: T5018 uses RZ, T1204 uses RP (CRA 2026 specs / schema 1-26-3)
const t5018 = page('t5018-xml-generator');
assert(t5018.includes('<code>bn</code>: the payer\'s 15-character account number on the RZ program, for example <code>123456789RZ0001</code>, on every slip and the summary.'), 't5018: payer bn is RZ');
assert(t5018.includes('For the payer, T5018 uses the RZ program account'), 't5018: RZ rejection reason');
assert(t1204.includes('<code>payr_bn</code>: on each slip, the paying department\'s 15-character payroll (RP) account number, for example <code>123456789RP0001</code>. The summary carries it as <code>bn</code>.'), 't1204: payer bn is RP');

console.log('seo-page.test.js: all passed');
