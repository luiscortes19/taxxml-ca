// Home page head tags target "CRA XML schema" / "CRA XML specifications" searches (Search Console, Jul-Oct 2026).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./harness');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const tag = re => { const m = html.match(re); assert(m, `missing ${re}`); return m[1]; };
const TARGET = /CRA XML (schema|specifications)/i;

const title = tag(/<title>([^<]*)<\/title>/);
assert(title.includes('TaxXML'), 'title keeps the TaxXML brand');
assert(title.includes('CRA XML'), 'title mentions CRA XML');
assert(title.length <= 60, `title is ${title.length} chars, max 60`);

const desc = tag(/<meta name="description" content="([^"]*)">/);
assert(desc.length >= 140 && desc.length <= 160, `meta description is ${desc.length} chars, want 140-160`);
assert(TARGET.test(desc), 'meta description mentions CRA XML schema/specifications');

for (const [kind, attr] of [['og', 'property'], ['twitter', 'name']]) {
  const t = tag(new RegExp(`<meta ${attr}="${kind}:title" content="([^"]*)">`));
  const d = tag(new RegExp(`<meta ${attr}="${kind}:description" content="([^"]*)">`));
  assert(t.includes('CRA XML'), `${kind}:title mentions CRA XML`);
  assert(d.includes('CRA XML'), `${kind}:description mentions CRA XML`);
  assert(TARGET.test(d), `${kind}:description mentions CRA XML schema/specifications`);
}
console.log('seo-home.test.js: all passed');
