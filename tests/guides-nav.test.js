// Every public page has a visible Guides text link in the header nav, before Contact us and the CTA.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./harness');

const PAGES = ['index.html', 't4-xml-generator.html', 'nr4-xml-generator.html', 't5018-xml-generator.html', 't1204-xml-generator.html',
  'cra-xml-samples.html', 'guides/index.html', 'privacy.html', 'terms.html'];

for (const page of PAGES) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const header = (html.match(/<header id="site-header"[\s\S]*?<\/header>/) || [])[0];
  assert(header, `${page}: no #site-header`);
  const nav = (header.match(/<nav>[\s\S]*?<\/nav>/) || [])[0];
  assert(nav, `${page}: no <nav> in #site-header`);
  const links = nav.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) || [];
  const i = links.findIndex(a => /href="\/guides\/?"/.test(a) && />\s*Guides\s*<\/a>$/.test(a));
  assert(i >= 0, `${page}: header nav has no Guides link to /guides/`);
  assert(!/nav-cta|data-cta/.test(links[i]), `${page}: Guides link must be a plain text link, not the CTA`);
  const fb = links.findIndex(a => /data-feedback/.test(a)), cta = links.findIndex(a => /nav-cta/.test(a));
  assert(i === fb - 1 && fb < cta, `${page}: Guides must sit right before Contact us, before the CTA`);
}
console.log(`guides-nav: ${PAGES.length} pages ok`);
