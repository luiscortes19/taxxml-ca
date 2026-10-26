// js/ga.js: GA4 loads only on the live site, internal/debug flags, and the delegated cta_click / sample_downloaded events.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('./harness');

const SRC = fs.readFileSync(path.join(ROOT, 'js/ga.js'), 'utf8');
const ID = 'G-E2F5Q3RZVH';

// Runs ga.js on a fake page. Returns what it did: injected scripts, gtag calls, and a click() helper.
function load({ hostname = 'taxxml.ca', protocol = 'https:', search = '', pathname = '/', store = {}, storageThrows = false } = {}) {
  const scripts = [];
  let onClick = null;
  const localStorage = {
    getItem: k => { if (storageThrows) throw new Error('blocked'); return store[k] ?? null; },
    setItem: (k, v) => { if (storageThrows) throw new Error('blocked'); store[k] = String(v); },
    removeItem: k => { if (storageThrows) throw new Error('blocked'); delete store[k]; },
  };
  const ctx = {
    location: { hostname, protocol, search, pathname }, localStorage, URLSearchParams, Date,
    document: {
      createElement: () => ({}),
      head: { appendChild: s => scripts.push(s) },
      addEventListener: (type, fn) => { if (type === 'click') onClick = fn; },
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const calls = () => JSON.parse(JSON.stringify(Array.from(ctx.dataLayer || [], a => [...a])));
  const events = () => calls().filter(c => c[0] === 'event').map(c => [c[1], c[2]]);
  // a click on an <a>/<button> with these attributes (or on a child of it)
  const click = attrs => onClick && onClick({ target: { closest: () => ({ dataset: attrs.dataset || {}, getAttribute: n => attrs[n] ?? null }) } });
  return { ctx, scripts, calls, events, click, rawClick: e => onClick(e), store, hasClick: () => !!onClick };
}

// ---- Gating: no tag, no gtag, no listeners on local copies ----
for (const loc of [
  { hostname: 'localhost' }, { hostname: '127.0.0.1' }, { hostname: '[::1]' }, { hostname: '::1' },
  { hostname: '', protocol: 'file:' }, { hostname: 'taxxml.ca', protocol: 'file:' },
  { hostname: 'localhost', search: '?internal=1&debug_mode=1' },
]) {
  const r = load(loc);
  assert.deepStrictEqual(r.scripts, [], `no gtag.js on ${JSON.stringify(loc)}`);
  assert.strictEqual(r.ctx.gtag, undefined, `gtag stays undefined (track() no-op) on ${JSON.stringify(loc)}`);
  assert.strictEqual(r.ctx.dataLayer, undefined);
  assert(!r.hasClick(), 'no click tracking on local copies');
}

// ---- Live site: same tag as before ----
for (const hostname of ['taxxml.ca', 'www.taxxml.ca']) {
  const r = load({ hostname });
  assert.strictEqual(r.scripts.length, 1);
  assert.strictEqual(r.scripts[0].src, `https://www.googletagmanager.com/gtag/js?id=${ID}`);
  assert.strictEqual(r.scripts[0].async, true);
  assert.strictEqual(typeof r.ctx.gtag, 'function');
  const c = r.calls();
  assert.strictEqual(c[0][0], 'js');
  assert.deepStrictEqual(c[1], ['config', ID, {}], 'external visitor: plain config, no traffic_type, no debug_mode');
}

// ---- Internal flag: ?internal=1 remembers, ?internal=0 forgets ----
{
  const store = {};
  let r = load({ search: '?internal=1', store });
  assert.strictEqual(store.taxxml_internal, '1');
  assert.deepStrictEqual(r.calls()[1], ['config', ID, { traffic_type: 'internal' }]);
  assert.strictEqual(r.scripts.length, 1, 'internal traffic still loads GA (so DebugView/testing works)');

  r = load({ store, pathname: '/nr4-xml-generator' });          // later visit, no param: still internal
  assert.deepStrictEqual(r.calls()[1], ['config', ID, { traffic_type: 'internal' }]);

  r = load({ search: '?internal=0', store });
  assert.strictEqual(store.taxxml_internal, undefined);
  assert.deepStrictEqual(r.calls()[1], ['config', ID, {}]);
  r = load({ store });
  assert.deepStrictEqual(r.calls()[1], ['config', ID, {}], 'stays cleared');
}
{ // other values don't touch the flag
  const store = { taxxml_internal: '1' };
  load({ search: '?internal=yes', store });
  assert.strictEqual(store.taxxml_internal, '1');
}
{ // blocked storage: GA still loads, treated as external, nothing throws
  const r = load({ search: '?internal=1', storageThrows: true });
  assert.deepStrictEqual(r.calls()[1], ['config', ID, {}]);
}

// ---- debug_mode: this page load only, never sent as false (GA treats any debug_mode as on) ----
{
  const store = {};
  let r = load({ search: '?debug_mode=1', store });
  assert.deepStrictEqual(r.calls()[1], ['config', ID, { debug_mode: true }]);
  r = load({ search: '?internal=1&debug_mode=1', store });
  assert.deepStrictEqual(r.calls()[1], ['config', ID, { traffic_type: 'internal', debug_mode: true }]);
  r = load({ search: '?debug_mode=0', store: {} });
  assert.deepStrictEqual(r.calls()[1], ['config', ID, {}]);
  r = load({ store: {} });
  assert.deepStrictEqual(r.calls()[1], ['config', ID, {}], 'not remembered');
}

// ---- cta_click { page, cta } ----
for (const [pathname, page] of [['/', 'home'], ['/index.html', 'home'], ['/t4-xml-generator', 't4'], ['/nr4-xml-generator.html', 'nr4'],
                                ['/t5018-xml-generator', 't5018'], ['/t1204-xml-generator', 't1204'], ['/privacy', 'privacy'],
                                ['/terms.html', 'terms'], ['/cra-xml-samples', 'cra-xml-samples'], ['/some/odd/path?x=Jane', 'home']]) {
  const r = load({ pathname });
  r.click({ dataset: { cta: 'hero' }, href: '/#converter' });
  assert.deepStrictEqual(r.events(), [['cta_click', { page, cta: 'hero' }]], pathname);
}
{ // elements without data-cta are ignored
  const r = load();
  r.click({ href: '/privacy' });
  r.click({});
  assert.deepStrictEqual(r.events(), []);
}

// ---- sample_downloaded { return_type } from the CSV template link, on any page ----
{
  const r = load({ pathname: '/nr4-xml-generator' });
  r.click({ href: '/templates/NR4_Sample.csv' });
  r.click({ href: 'templates/T4_Sample.csv', dataset: {} });                  // index.html's relative #sample-link
  r.click({ href: 'templates/T5018_Sample.csv' });
  r.click({ href: '/templates/T1204_Sample.csv' });
  r.click({ href: '/templates/Other.csv' });                                  // not a sample
  r.click({ href: '/templates/XX_Sample.csv' });                              // not a return we support
  assert.deepStrictEqual(r.events(), [
    ['sample_downloaded', { return_type: 'NR4' }], ['sample_downloaded', { return_type: 'T4' }],
    ['sample_downloaded', { return_type: 'T5018' }], ['sample_downloaded', { return_type: 'T1204' }],
  ]);
}
{ // a broken gtag never breaks a click
  const r = load();
  r.ctx.gtag = () => { throw new Error('ga down'); };
  assert.doesNotThrow(() => r.click({ dataset: { cta: 'nav' }, href: '/templates/T4_Sample.csv' }));
}
{ // clicks outside any link/button, or on a target without closest(), are ignored
  const r = load();
  assert.doesNotThrow(() => r.rawClick({ target: { closest: () => null } }));
  assert.doesNotThrow(() => r.rawClick({ target: {} }));
  assert.deepStrictEqual(r.events(), []);
}

// ---- Every page with the Google tag loads it through js/ga.js, and nowhere else ----
const PAGES = ['index.html', 'privacy.html', 'terms.html', 't4-xml-generator.html', 'nr4-xml-generator.html', 't5018-xml-generator.html', 't1204-xml-generator.html',
               'cra-xml-samples.html'];
const ALLOWED_CTA = /^(nav|hero|hero_pick|bottom|footer|sample_try|sample_xml|sample_xml_download|reminder)$/;
for (const p of PAGES) {
  const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
  assert(/<script src="\/?js\/ga\.js"><\/script>/.test(html), `${p} loads js/ga.js`);
  assert(!html.includes('googletagmanager.com/gtag/js'), `${p} has no unconditional gtag.js`);
  assert(!html.includes("gtag('config'"), `${p} has no inline config`);
  const ctas = [...html.matchAll(/data-cta="([^"]*)"/g)].map(m => m[1]);
  assert(ctas.length, `${p} tags its CTAs`);
  for (const c of ctas) assert(ALLOWED_CTA.test(c), `${p}: cta id ${c}`);
  // every link into the converter is tagged
  for (const m of html.matchAll(/<a [^>]*href="\/?(?:\?[^"#]*)?#converter"[^>]*>/g)) assert(/data-cta="/.test(m[0]), `${p}: untagged ${m[0]}`);
  // one-click sample links, links to the sample XML page, and its XML downloads
  for (const [re, cta] of [[/<a [^>]*href="[^"]*sample=1[^"]*"[^>]*>/g, 'sample_try'], [/<a [^>]*href="\/cra-xml-samples[^"]*"[^>]*>/g, 'sample_xml'],
                           [/<a [^>]*href="\/samples\/\w+_sample\.xml"[^>]*>/g, 'sample_xml_download']])
    for (const m of html.matchAll(re)) assert(m[0].includes(`data-cta="${cta}"`), `${p}: ${m[0]} needs data-cta="${cta}"`);
}
{ // C's buttons: Step 1 "Try it with sample data" and the reminder (rendered by app.js)
  assert(/<button [^>]*id="try-sample"[^>]*data-cta="sample_try"/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')), 'try-sample tagged');
  assert(/onclick="addReminder\(\)" data-cta="reminder"/.test(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8')), 'reminder tagged');
  assert.strictEqual([...fs.readFileSync(path.join(ROOT, 'cra-xml-samples.html'), 'utf8').matchAll(/data-cta="sample_xml_download"/g)].length, 4);
}
{ // the four hero return buttons on the home page
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.strictEqual([...html.matchAll(/class="return-pick"[^>]*data-cta="hero_pick"/g)].length, 4);
}

console.log('ga.test.js: all passed');
