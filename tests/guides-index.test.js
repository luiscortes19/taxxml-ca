// /guides/ index page: exists, links every guide with its own meta description, every internal link resolves,
// it is in the sitemap, and every page's footer Resources links to it.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./harness');

const PAGE = path.join(ROOT, 'guides', 'index.html');
const URL = 'https://taxxml.ca/guides/';
assert(fs.existsSync(PAGE), 'guides/index.html is missing');
const html = fs.readFileSync(PAGE, 'utf8');

assert(/<title>[^<]+<\/title>/.test(html), 'has a <title>');
assert(/<meta name="description" content="[^"]+">/.test(html), 'has a meta description');
assert(html.includes(`<link rel="canonical" href="${URL}">`), 'canonical');
assert(html.includes(`<meta property="og:url" content="${URL}">`), 'og:url matches canonical');
assert(html.includes('<script src="/js/ga.js"></script>'), 'same GA4 loader as the other pages');

// Each guide is listed with the exact meta description of the target page
const description = f => fs.readFileSync(path.join(ROOT, f), 'utf8').match(/<meta name="description" content="([^"]*)">/)[1];
for (const slug of ['t4-xml-generator', 'nr4-xml-generator', 't5018-xml-generator', 't1204-xml-generator', 'cra-xml-samples']) {
  assert(html.includes(`href="/${slug}"`), `links /${slug}`);
  assert(html.includes(description(`${slug}.html`)), `${slug}: description reused verbatim`);
}

// Every same-origin href resolves to a file, mapped the way GitHub Pages serves them
const resolves = href => {
  const p = href.split(/[?#]/)[0];
  if (p === '' || p === '/') return fs.existsSync(path.join(ROOT, 'index.html'));
  const rel = p.replace(/^\//, '').replace(/\/$/, '');
  return [rel, `${rel}.html`, path.join(rel, 'index.html')].some(f => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).isFile());
};
for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
  if (/^(https?:|mailto:)/.test(href)) continue;
  assert(resolves(href), `guides/index.html: ${href} resolves to a file`);
}

const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
assert(sitemap.includes(`<loc>${URL}</loc>`), 'sitemap lists /guides/');

for (const p of ['index.html', 't4-xml-generator.html', 'nr4-xml-generator.html', 't5018-xml-generator.html',
                 't1204-xml-generator.html', 'cra-xml-samples.html', 'privacy.html', 'terms.html']) {
  const page = fs.readFileSync(path.join(ROOT, p), 'utf8');
  const footer = page.slice(page.indexOf('<footer'), page.indexOf('</footer>'));
  assert(/href="\/guides\/?"/.test(footer), `${p}: footer links /guides/`);
}

console.log('guides-index.test.js: all passed');
