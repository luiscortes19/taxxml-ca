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
  assert(/<a href="\/#converter" class="btn btn-primary[^"]*">/.test(html), msg('CTA button to the converter'));
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

  assert(sitemap.includes(`<loc>${URL}</loc>`), msg('listed in sitemap.xml'));
  assert(index.includes(`href="/${slug}"`), msg('linked from index.html'));
}

console.log('seo-page.test.js: all passed');
