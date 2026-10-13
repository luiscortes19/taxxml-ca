// SEO landing page: /t4-xml-generator exists, has its own head tags, points at the converter, is in the sitemap.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./harness');

const file = path.join(ROOT, 't4-xml-generator.html');
assert(fs.existsSync(file), 't4-xml-generator.html is missing');
const html = fs.readFileSync(file, 'utf8');
const URL = 'https://taxxml.ca/t4-xml-generator';

assert(/<title>[^<]*T4[^<]*<\/title>/.test(html), 'title mentions T4');
assert(/<meta name="description" content="[^"]{50,160}">/.test(html), 'meta description, 50-160 chars');
assert(html.includes(`<link rel="canonical" href="${URL}">`), 'canonical');
assert(html.includes(`<meta property="og:url" content="${URL}">`), 'og:url');
assert(/<a href="\/#converter" class="btn btn-primary[^"]*">/.test(html), 'CTA button to the converter');
assert(html.includes("gtag('config', 'G-E2F5Q3RZVH')"), 'same GA4 tag as the other pages');

// FAQPage JSON-LD questions match the visible FAQ, in order
const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
assert.strictEqual(ld['@type'], 'FAQPage');
const visible = [...html.matchAll(/<summary>(.*?)<\/summary>/g)].map(m => m[1]);
assert.deepStrictEqual(ld.mainEntity.map(q => q.name), visible);

const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
assert(sitemap.includes(`<loc>${URL}</loc>`), 'listed in sitemap.xml');
assert(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').includes('href="/t4-xml-generator"'), 'linked from index.html');

console.log('seo-page.test.js: all passed');
