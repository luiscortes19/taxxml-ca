// js/report.js: scrubbed crash reports + the Feedback button. Gating, hooks, de-dupe, scrubber, and the app.js wiring.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createApp, FILING_DETAILS, PII_FIXTURES, ROOT } = require('./harness');

const SRC = fs.readFileSync(path.join(ROOT, 'js/report.js'), 'utf8');
const URL_ = 'https://taxxml-report.example.workers.dev';
const KEY = '1x00000000000000000000AA'; // Cloudflare's documented always-pass test site key, never a real one
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// Every personal value the tests put into errors: the shared fixtures, Step 3 answers, and file names.
const STEP3 = Object.values(FILING_DETAILS).filter(v => v.length >= 3);
const SECRETS = [...PII_FIXTURES, ...STEP3, 'secret-payroll.xlsx', 'payroll-2025', 'Users', 'luis', 'Documents', 'NRA123456'];
const noLeak = (out, what) => { for (const s of SECRETS) assert(!out.includes(s), `${what} leaks "${s}": ${out}`); };

// Runs report.js on a fake page. endpoint / siteKey stand in for the (empty) committed config.
function load({ hostname = 'taxxml.ca', protocol = 'https:', pathname = '/', endpoint, siteKey, gtag = true, fetch, ua = CHROME } = {}) {
  let src = SRC;
  if (endpoint !== undefined) src = src.replace("REPORT_ENDPOINT = ''", `REPORT_ENDPOINT = ${JSON.stringify(endpoint)}`);
  if (siteKey !== undefined) src = src.replace("TURNSTILE_SITE_KEY = ''", `TURNSTILE_SITE_KEY = ${JSON.stringify(siteKey)}`);
  const win = {}, doc = {}, posts = [], events = [], created = [];
  const on = bag => (t, fn) => (bag[t] = bag[t] || []).push(fn);
  const ctx = {
    location: { hostname, protocol, pathname }, navigator: { userAgent: ua }, Promise, JSON,
    addEventListener: on(win),
    fetch: fetch || ((url, opts) => { posts.push({ url, opts, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true }); }),
    document: { addEventListener: on(doc), querySelectorAll: () => [], getElementById: () => null,
                createElement: t => { created.push(t); return {}; }, head: { appendChild: () => {} }, body: { insertAdjacentHTML: () => created.push('html') } },
  };
  ctx.window = ctx;
  if (gtag) ctx.gtag = (cmd, name, params) => events.push([name, JSON.parse(JSON.stringify(params))]);
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'js/report.js' });
  const fire = (bag, t, e) => (bag[t] || []).forEach(fn => fn(e));
  return { ctx, api: ctx.taxxmlReport, posts, events, created, win: (t, e) => fire(win, t, e), doc: (t, e) => fire(doc, t, e), winListeners: win };
}

// An error as a browser reports it: own frames (Chrome and Firefox style) mixed with a page/extension frame carrying data.
const fakeErr = (msg, name = 'TypeError') => ({ name, message: msg, stack: [
  `${name}: ${msg}`,
  '    at checkRow (https://taxxml.ca/js/app.js:1040:12)',
  '    at Jane (https://evil.example/secret-payroll.csv:1:1)',
  '    at https://taxxml.ca/js/validate.js:20:5',
  `    at Object.<anonymous> (chrome-extension://abc/${msg.replace(/\s/g, '_')}.js:3:3)`,
  'generateT4XML@https://www.taxxml.ca/js/app.js:1400:7',
].join('\n') });

// ---- Ships unset: no endpoint, no Turnstile key ----
assert(/REPORT_ENDPOINT = '';/.test(SRC), 'REPORT_ENDPOINT ships empty');
assert(/TURNSTILE_SITE_KEY = '';/.test(SRC), 'TURNSTILE_SITE_KEY ships empty');

// ---- Scrubber: the PII fixtures, Step 3 values and file names never survive ----
{
  const { api } = load();
  const messages = [
    "Cannot read properties of undefined (reading 'Jane Doe 046454286')",
    'Unexpected token J in JSON at position 3: {"name":"John","sin":"046454286","amt":"54321.99"}',
    'secret-payroll.csv: invalid row Doe,John,46454286,54321.99,Roe,Jane,123456789,777.10',
    `${FILING_DETAILS['tx-name']} ${FILING_DETAILS['tx-bn']} ${FILING_DETAILS['tx-email']} ${FILING_DETAILS['tx-phone']}`,
    `invalid value ${FILING_DETAILS['py-addr']}, ${FILING_DETAILS['py-city']} ${FILING_DETAILS['py-prov']} ${FILING_DETAILS['py-postal']} for py-addr`,
    `bad account ${FILING_DETAILS['nr4-acct']} for ${FILING_DETAILS['py-name']} (${FILING_DETAILS['py-bn']}) ref ${FILING_DETAILS['tx-ref']}`,
    'Failed to parse C:\\Users\\luis\\Documents\\secret-payroll.xlsx and /home/luis/payroll-2025/secret-payroll.csv',
    'see https://taxxml.ca/?name=Jane%20Doe&sin=046454286 and blob:https://taxxml.ca/1234-abcd',
    'Jane Doe 046 454 286 earned $54,321.99 (130-692-544)',
    'Jérôme Côté 130692544 Test Payer',
  ];
  for (const m of messages) {
    const out = api.scrubText(m);
    noLeak(out, 'scrubText');
    assert(out.length <= 300);
    assert.strictEqual(api.scrubText(out), out, `idempotent: ${out}`); // the Worker scrubs again
  }
  assert.strictEqual(api.scrubText("TypeError: Cannot read properties of undefined (reading 'x')"), 'TypeError: Cannot read properties of undefined (reading "?")');
  assert.strictEqual(api.scrubText(null), '');

  for (const m of messages) {
    const stack = api.scrubStack(fakeErr(m).stack);
    noLeak(stack, 'scrubStack');
    assert.strictEqual(stack, 'checkRow@js/app.js:1040:12\njs/validate.js:20:5\ngenerateT4XML@js/app.js:1400:7');
    assert.strictEqual(api.scrubStack(stack), stack, 'idempotent');
  }
  assert.strictEqual(api.scrubStack('at x (https://cdn.sheetjs.com/xlsx.full.min.js:1:2)'), '', 'only our own files');

  // the prepared report keeps only allow-listed metadata
  for (const m of messages) {
    const r = api.buildCrash('xml_generate_failed', fakeErr(m), { return_type: 'T5018', step: 3, first_row: 'Jane Doe', file: 'secret-payroll.csv' });
    assert.deepStrictEqual(Object.keys(r).sort(), ['browser', 'error_kind', 'message', 'page', 'return_type', 'stack', 'step', 'version']);
    assert.strictEqual(r.error_kind, 'xml_generate_failed');
    assert.strictEqual(r.return_type, 'T5018');
    assert.strictEqual(r.step, 3);
    assert.strictEqual(r.browser, 'chrome');
    assert(/^[\w.-]{1,20}$/.test(r.version), r.version);
    noLeak(JSON.stringify(r), 'buildCrash');
  }
  const odd = api.buildCrash('Jane Doe', 'plain string 046454286', { return_type: 'Jane', step: '046454286' });
  assert.strictEqual(odd.error_kind, 'js_error', 'unknown kinds collapse to js_error');
  assert.strictEqual(odd.return_type, '');
  assert.strictEqual(odd.step, 0);
  noLeak(JSON.stringify(odd), 'buildCrash(odd)');
  for (const [ua, b] of [['Mozilla/5.0 Firefox/131.0', 'firefox'], ['Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 'safari'],
                         [CHROME + ' Edg/130.0', 'edge'], ['curl/8', 'other']])
    assert.strictEqual(load({ ua }).api.buildCrash('js_error', fakeErr('x')).browser, b, ua);
}

// ---- Hooks: window error + unhandledrejection report a scrubbed crash ----
{
  const r = load({ endpoint: URL_ });
  assert(r.winListeners.error && r.winListeners.unhandledrejection, 'both hooks installed');
  r.win('error', { message: 'Uncaught TypeError: Jane Doe 046454286', error: fakeErr('Jane Doe 046454286') });
  r.win('unhandledrejection', { reason: fakeErr('row Roe 123456789 777.10', 'RangeError') });
  assert.strictEqual(r.posts.length, 2);
  for (const p of r.posts) {
    assert.strictEqual(p.url, URL_);
    assert.strictEqual(p.opts.method, 'POST');
    assert.strictEqual(p.body.kind, 'crash');
    assert.strictEqual(p.body.error_kind, 'js_error');
    noLeak(JSON.stringify(p.body), 'crash POST');
  }
  assert.deepStrictEqual(r.events, [['app_error', { error_kind: 'js_error' }], ['app_error', { error_kind: 'js_error' }]]);

  // de-dupe: the same error in a tight loop is sent once
  for (let i = 0; i < 50; i++) r.win('error', { error: fakeErr('Jane Doe 046454286') });
  assert.strictEqual(r.posts.length, 2);
  // and a flood of different errors is capped per page
  for (let i = 0; i < 100; i++) r.win('error', { error: fakeErr(`boom${'x'.repeat(i)}`) });
  assert(r.posts.length <= 10, `capped: ${r.posts.length}`);
  assert(r.events.length <= 10);
}
{ // errors with no frame in our own files (extensions, other scripts) are ignored
  const r = load({ endpoint: URL_ });
  r.win('error', { message: 'Script error.', error: null });
  r.win('error', { error: { name: 'Error', message: 'ext', stack: 'Error: ext\n    at chrome-extension://abc/x.js:1:1' } });
  r.win('unhandledrejection', { reason: 'Jane Doe' });
  assert.deepStrictEqual(r.posts, []);
  assert.deepStrictEqual(r.events, []);
}
{ // app context (return type, step) comes from app.js's reportContext(), allow-listed
  const r = load({ endpoint: URL_ });
  r.ctx.reportContext = () => ({ return_type: 'NR4', step: 2, cells: ['Jane', '046454286'] });
  r.win('error', { error: fakeErr('x') });
  assert.strictEqual(r.posts[0].body.return_type, 'NR4');
  assert.strictEqual(r.posts[0].body.step, 2);
  assert(!('cells' in r.posts[0].body));
  assert.deepStrictEqual(r.events, [['app_error', { error_kind: 'js_error', return_type: 'NR4' }]]);
  r.ctx.reportContext = () => { throw new Error('app broken'); };
  assert.doesNotThrow(() => r.win('error', { error: fakeErr('y') }));
}

// ---- No URL: no POST, no throw. app_error still goes to GA4 on the live host ----
{
  const r = load();
  assert.doesNotThrow(() => r.win('error', { error: fakeErr('Jane') }));
  assert.doesNotThrow(() => r.win('unhandledrejection', { reason: fakeErr('Doe') }));
  assert.deepStrictEqual(r.posts, []);
  assert.deepStrictEqual(r.events.map(e => e[0]), ['app_error', 'app_error']);
  const rep = r.api.crash('parse_crash', fakeErr('Jane Doe 046454286'));
  assert.strictEqual(rep.error_kind, 'parse_crash', 'a scrubbed report is still prepared');
  noLeak(JSON.stringify(rep), 'crash()');
  assert.deepStrictEqual(r.created, [], 'nothing injected: no Turnstile, no dialog');
  assert.strictEqual(r.api.feedbackLive, false);
}
{ // no gtag either (GA blocked): still nothing throws
  const r = load({ gtag: false });
  assert.doesNotThrow(() => r.win('error', { error: fakeErr('x') }));
}

// ---- Local copies: nothing leaves, even with a URL configured (same gate as js/ga.js) ----
for (const loc of [{ hostname: 'localhost' }, { hostname: '127.0.0.1' }, { hostname: '::1' }, { hostname: '[::1]' },
                   { hostname: '', protocol: 'file:' }, { hostname: 'taxxml.ca', protocol: 'file:' }]) {
  const r = load({ ...loc, endpoint: URL_, siteKey: KEY });
  r.win('error', { error: fakeErr('x') });
  r.api.crash('xml_generate_failed', fakeErr('y'));
  assert.deepStrictEqual(r.posts, [], JSON.stringify(loc));
  assert.deepStrictEqual(r.events, [], `no app_error on ${JSON.stringify(loc)}`);
  assert.strictEqual(r.api.feedbackLive, false);
}

// ---- A failing network never breaks the page ----
for (const fetch of [() => { throw new Error('blocked'); }, () => Promise.reject(new Error('offline')), undefined]) {
  const r = load({ endpoint: URL_, fetch });
  if (!fetch) delete r.ctx.fetch;
  assert.doesNotThrow(() => r.win('error', { error: fakeErr('x') }));
}
{ const r = load({ endpoint: URL_ }); r.ctx.gtag = () => { throw new Error('ga down'); }; assert.doesNotThrow(() => r.win('error', { error: fakeErr('z') })); }

// ---- Feedback ----
{ // unset: the link is left alone (it goes to avanza-automation.com)
  const r = load({ endpoint: URL_ }); // a URL but no Turnstile key: form stays off too
  let prevented = false;
  r.doc('click', { target: { closest: () => ({ dataset: { feedback: '' } }) }, preventDefault: () => { prevented = true; } });
  assert(!prevented);
  assert.strictEqual(r.api.feedbackLive, false);
}
(async () => {
  const r = load({ endpoint: URL_, siteKey: KEY });
  assert.strictEqual(r.api.feedbackLive, true);
  r.ctx.reportContext = () => ({ return_type: 'T4', step: 3 });
  const ok = await r.api.sendFeedback({ type: 'bug', message: 'Step 3 froze', email: 'me@example.org', website: '', turnstile: 'tok' });
  assert.strictEqual(ok, true);
  assert.strictEqual(r.posts.length, 1);
  const b = r.posts[0].body;
  assert.deepStrictEqual(Object.keys(b).sort(), ['browser', 'email', 'kind', 'message', 'page', 'return_type', 'step', 'turnstile', 'type', 'version', 'website']);
  assert.strictEqual(b.kind, 'feedback');
  assert.strictEqual(b.message, 'Step 3 froze');
  assert.strictEqual(b.return_type, 'T4');
  // failure is reported, not thrown
  const bad = load({ endpoint: URL_, siteKey: KEY, fetch: () => Promise.resolve({ ok: false }) });
  assert.strictEqual(await bad.api.sendFeedback({ type: 'feedback', message: 'hi' }), false);
  const off = load();
  assert.strictEqual(await off.api.sendFeedback({ type: 'feedback', message: 'hi' }), false);
  assert.deepStrictEqual(off.posts, []);
})().catch(e => { console.error(e); process.exit(1); });

// ---- app.js: generateXML and file-parse crashes are caught, friendly on screen, scrubbed in the report ----
const T4_CSV = fs.readFileSync(path.join(__dirname, 'fixtures', 'T4_input.csv'));
function wired(reportEndpoint) {
  const posts = [], events = [];
  const app = createApp({ returnType: 'T4', reportEndpoint, gtag: (c, n, p) => events.push([n, JSON.parse(JSON.stringify(p))]),
                          fetch: (u, o) => { posts.push(JSON.parse(o.body)); return Promise.resolve({ ok: true }); } });
  return { app, posts, events, named: n => events.filter(e => e[0] === n).map(e => e[1]) };
}
for (const endpoint of [URL_, undefined]) {
  const { app, posts, named } = wired(endpoint);
  app.loadFile('secret-payroll.csv', T4_CSV);
  app.setDetails();
  app.run(`getReturnConfig().generateXML = () => {
    throw new TypeError('bad ' + document.getElementById('tx-name').value + ' ' + document.getElementById('py-bn').value + ' ' + parsedData[0].join(' '));
  }`);
  assert.doesNotThrow(() => app.generate());
  const shown = app.errors();
  assert(/Something went wrong while building the XML/.test(shown), shown);
  assert(!shown.includes('bad ') && !shown.includes('TypeError'), 'no raw err.message on screen');
  assert.deepStrictEqual(named('app_error'), [{ error_kind: 'xml_generate_failed', return_type: 'T4' }]);
  assert.deepStrictEqual(named('validation_failed'), [], 'a crash is not a validation failure');
  if (endpoint) {
    assert.strictEqual(posts.length, 1);
    assert.strictEqual(posts[0].error_kind, 'xml_generate_failed');
    assert(/generateXML@js\/app\.js:\d+:\d+/.test(posts[0].stack), posts[0].stack);
    noLeak(JSON.stringify(posts[0]), 'xml_generate_failed POST');
    for (const row of app.run('parsedData')) for (const cell of row) if (String(cell).length >= 3) assert(!JSON.stringify(posts[0]).includes(String(cell)), `cell ${cell}`);
  } else assert.deepStrictEqual(posts, []);
}
{ // unexpected parse throw (the read_error path): fixed friendly sentence, file_parse_error stays, parse_crash reported
  const { app, posts, named } = wired(URL_);
  app.ctx.XLSX = { read: () => { throw new Error('corrupt secret-payroll.xlsx at row Jane Doe 046454286'); } };
  app.loadFile('secret-payroll.xlsx', Buffer.from('x'));
  const msg = app.els['file-error'].textContent;
  assert.strictEqual(msg, "We couldn't read this file. Check that it is a valid Excel (.xlsx, .xls) or CSV file, then try again.");
  assert.deepStrictEqual(named('file_parse_error'), [{ return_type: 'T4', error_category: 'read_error' }]);
  assert.deepStrictEqual(named('app_error'), [{ error_kind: 'parse_crash', return_type: 'T4' }]);
  assert.strictEqual(posts.length, 1);
  assert.strictEqual(posts[0].error_kind, 'parse_crash');
  noLeak(JSON.stringify(posts[0]), 'parse_crash POST');
}
{ // ordinary user problems are not crashes: no app_error, no POST
  const { app, posts, named } = wired(URL_);
  app.loadFile('secret-payroll.pdf', Buffer.from('x'));                         // unsupported_type
  app.loadFile('empty.csv', Buffer.from('Last Name,SIN\r\n'));                  // no_data_rows
  app.loadFile('t4.csv', Buffer.from('Last Name,SIN,Employment Income\r\nDoe,46454286,1\r\n'));
  app.setDetails({ 'tx-name': '' });
  app.generate();                                                               // validation_failed (filing_details)
  app.setDetails();
  app.generate();                                                               // validation_failed (row_data)
  assert.deepStrictEqual(named('file_parse_error').map(p => p.error_category), ['unsupported_type', 'no_data_rows']);
  assert.strictEqual(named('validation_failed').length, 2);
  assert.deepStrictEqual(named('app_error'), []);
  assert.deepStrictEqual(posts, []);
}

// ---- Every public page loads js/report.js and has the Feedback / Contact us fallback in header and footer ----
const PAGES = ['index.html', 'privacy.html', 'terms.html', 't4-xml-generator.html', 'nr4-xml-generator.html', 't5018-xml-generator.html',
               't1204-xml-generator.html', 'cra-xml-samples.html'];
for (const p of PAGES) {
  const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
  assert(/<script src="\/?js\/report\.js"><\/script>/.test(html), `${p} loads js/report.js`);
  for (const part of ['header', 'footer']) {
    const block = html.slice(html.indexOf(`<${part}`), html.indexOf(`</${part}>`));
    assert(/<a href="https:\/\/avanza-automation\.com" target="_blank" rel="noopener" data-feedback>Contact us<\/a>/.test(block), `${p}: ${part} Feedback fallback`);
  }
  assert(!/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(html.replace(/https?:\/\/\S+/g, '')), `${p} publishes no email address`);
  assert(!html.includes('challenges.cloudflare.com'), `${p} does not load Turnstile itself`);
}

console.log('report.test.js: all passed');
