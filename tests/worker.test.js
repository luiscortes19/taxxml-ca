// worker/: the Cloudflare Worker that forwards feedback and crash reports to Slack / email. Runs its fetch handler with
// Node's own Request/Response and a stubbed global fetch, so nothing leaves the machine.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PII_FIXTURES, ROOT } = require('./harness');

// The scrubber is copied between the browser and the Worker (no build step): both copies must stay identical.
const block = f => {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const m = /\/\/ ---- scrub: shared[^\n]*\n([\s\S]*?)\/\/ ---- end scrub/.exec(s);
  assert(m, `${f} has the shared scrub block`);
  return m[1];
};
assert.strictEqual(block('worker/scrub.js'), block('js/report.js'), 'worker/scrub.js and js/report.js scrub blocks are identical');

const ORIGIN = 'https://taxxml.ca';
const SLACK = 'https://slack.invalid/webhook'; // stand-in; the real URL only ever lives in a Worker secret
const ENV = { SLACK_WEBHOOK_URL: SLACK, TURNSTILE_SECRET: 'test-secret' };

(async () => {
  const worker = (await import(path.join(ROOT, 'worker/index.js'))).default;
  let out = [], turnstileOk = true, ipN = 0;
  global.fetch = async (url, opts) => {
    out.push({ url: String(url), opts });
    if (String(url).includes('turnstile')) return new Response(JSON.stringify({ success: turnstileOk }));
    return new Response('ok');
  };
  const call = (body, { origin = ORIGIN, method = 'POST', env = ENV, ip } = {}) => {
    out = [];
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip || `10.0.0.${++ipN}` };
    if (origin) headers.Origin = origin;
    return worker.fetch(new Request('https://taxxml-report.example.workers.dev/', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined }), env);
  };
  const crash = { kind: 'crash', error_kind: 'xml_generate_failed', message: 'TypeError: Jane Doe 046454286 54321.99 secret-payroll.csv',
                  stack: 'checkRow@js/app.js:10:2\n    at Jane (https://x/secret-payroll.csv:1:1)', return_type: 'T4', step: 3, browser: 'chrome',
                  version: '2026.11.17', page: 'home', cells: [['Jane', '046454286']], filing: { 'py-bn': '123456789RP0001' } };
  const feedback = { kind: 'feedback', type: 'bug', message: 'The T4 step froze. My SIN is 046 454 286', email: 'me@example.org', website: '', turnstile: 'tok',
                     return_type: 'T4', step: 3, browser: 'firefox', version: '2026.11.17', page: 'home' };
  const slackText = () => JSON.parse(out.find(o => o.url === SLACK).opts.body).text;

  // CORS: only the two production origins, only POST + Content-Type
  for (const origin of [ORIGIN, 'https://www.taxxml.ca']) {
    const r = await call(null, { origin, method: 'OPTIONS' });
    assert.strictEqual(r.status, 204);
    assert.strictEqual(r.headers.get('Access-Control-Allow-Origin'), origin);
    assert.strictEqual(r.headers.get('Access-Control-Allow-Methods'), 'POST');
    assert.strictEqual(r.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
  }
  for (const origin of ['https://evil.example', 'http://localhost:8000', 'https://taxxml.ca.evil.example', '']) {
    const r = await call(crash, { origin });
    assert.strictEqual(r.status, 403, origin);
    assert.strictEqual(r.headers.get('Access-Control-Allow-Origin'), null);
    assert.deepStrictEqual(out, []);
  }
  assert.strictEqual((await call(null, { method: 'GET' })).status, 405);
  assert.strictEqual((await worker.fetch(new Request('https://w/', { method: 'POST', headers: { Origin: ORIGIN }, body: '{not json' }), ENV)).status, 400);
  assert.strictEqual((await call({ kind: 'other' })).status, 400);

  // crash: second scrub + allow-list before Slack
  {
    const r = await call(crash);
    assert.strictEqual(r.status, 204);
    assert.strictEqual(out.length, 1, 'Slack only (no Resend configured), no Turnstile for crash reports');
    const text = slackText();
    for (const p of [...PII_FIXTURES, '123456789RP0001']) assert(!text.includes(p), `Slack text leaks ${p}: ${text}`);
    assert(text.includes('xml_generate_failed') && text.includes('T4') && text.includes('checkRow@js/app.js:10:2'), text);
  }

  // feedback: Turnstile verified server-side; honeypot rejected; SIN-like numbers redacted
  {
    let r = await call({ ...feedback, turnstile: '' });
    assert.strictEqual(r.status, 403, 'missing token');
    assert(!out.some(o => o.url === SLACK));
    turnstileOk = false;
    r = await call(feedback);
    assert.strictEqual(r.status, 403, 'invalid token');
    assert(!out.some(o => o.url === SLACK));
    turnstileOk = true;
    r = await call({ ...feedback, website: 'http://spam.example' });
    assert.strictEqual(r.status, 400, 'honeypot');
    assert.deepStrictEqual(out, []);
    r = await call({ ...feedback, message: '   ' });
    assert.strictEqual(r.status, 400, 'empty message');
    r = await call(feedback, { env: { SLACK_WEBHOOK_URL: SLACK } });
    assert.strictEqual(r.status, 403, 'no TURNSTILE_SECRET: feedback is refused');

    r = await call(feedback);
    assert.strictEqual(r.status, 204);
    const verify = out.find(o => o.url.includes('challenges.cloudflare.com/turnstile/v0/siteverify'));
    assert(verify, 'Turnstile siteverify called');
    const text = slackText();
    assert(text.includes('The T4 step froze') && text.includes('me@example.org') && text.includes('bug'), text);
    assert(!text.includes('046 454 286') && !text.includes('046454286'), text);
    // Slack control sequences in user text are escaped
    await call({ ...feedback, message: 'hi <!channel> <https://x|y>' });
    assert(!slackText().includes('<!channel>'));
  }

  // email via Resend (optional), Slack optional, neither -> error and nothing sent
  {
    const mail = { RESEND_API_KEY: 'test-key', RESEND_FROM: 'from@example.org', ALERT_EMAIL: 'to@example.org', TURNSTILE_SECRET: 'x' };
    let r = await call(crash, { env: mail });
    assert.strictEqual(r.status, 204);
    const m = out.find(o => o.url === 'https://api.resend.com/emails');
    assert(m && out.length === 1, 'email only');
    const body = JSON.parse(m.opts.body);
    assert.deepStrictEqual(body.to, ['to@example.org']);
    assert.strictEqual(m.opts.headers.Authorization, 'Bearer test-key');
    for (const p of PII_FIXTURES) assert(!body.text.includes(p) && !body.subject.includes(p));
    r = await call(feedback, { env: { ...mail, SLACK_WEBHOOK_URL: SLACK } });
    assert.strictEqual(out.filter(o => o.url === SLACK || o.url.includes('resend')).length, 2, 'both');
    assert.strictEqual(JSON.parse(out.find(o => o.url.includes('resend')).opts.body).reply_to, 'me@example.org');
    r = await call(crash, { env: {} });
    assert.strictEqual(r.status, 503);
    assert.deepStrictEqual(out, []);
  }

  // a failing Slack is reported as an error, not swallowed as success
  {
    const ok = global.fetch;
    global.fetch = async () => new Response('no', { status: 500 });
    assert.strictEqual((await call(crash)).status, 502);
    global.fetch = ok;
  }

  // rate limit per IP
  {
    const codes = [];
    for (let i = 0; i < 25; i++) codes.push((await call(crash, { ip: '10.9.9.9' })).status);
    assert(codes.includes(429), codes.join());
    assert.strictEqual(codes[0], 204);
    assert.strictEqual((await call(crash, { ip: '10.9.9.10' })).status, 204, 'other IPs unaffected');
  }

  // oversize bodies are refused before parsing
  assert.strictEqual((await call({ ...crash, message: 'x'.repeat(20000) })).status, 413);

  // nothing is stored: no KV/D1/R2 bindings in wrangler.toml, no storage APIs in the code
  const toml = fs.readFileSync(path.join(ROOT, 'worker/wrangler.toml'), 'utf8');
  assert(!/kv_namespaces|d1_databases|r2_buckets|durable_objects/.test(toml.replace(/^#.*$/gm, '')), 'no storage bindings');
  const code = fs.readFileSync(path.join(ROOT, 'worker/index.js'), 'utf8');
  assert(!/\.put\(|\.prepare\(|console\.(log|info|error|warn)/.test(code), 'no writes, no payload logging');

  console.log('worker.test.js: all passed');
})().catch(e => { console.error(e); process.exit(1); });
