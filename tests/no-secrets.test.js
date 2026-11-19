// No webhook URLs, API keys or secret values in the repo. Secrets live only in Worker secrets (wrangler secret put).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT } = require('./harness');

const BINARY = /\.(png|ico|jpg|jpeg|gif|webp|zip|xlsx|xls|pdf|woff2?)$/i;
const walk = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]) : [];

// The committed tree, plus this feature's files even before they are staged
let files = [];
try { files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).map(f => path.join(ROOT, f)); }
catch { /* no git: the walk below still covers the feature */ }
files.push(...walk(path.join(ROOT, 'worker')), ...walk(path.join(ROOT, 'js')),
           ...fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).map(f => path.join(ROOT, f)));
files = [...new Set(files)].filter(f => !BINARY.test(f) && fs.existsSync(f));

// Public values that are allowed, and only where they belong
const SITE_KEY = '0x4AAAAAAGHli_z8IhdQWKyo'; // the production Turnstile site key (public)
const SITE_KEY_OK = ['js/report.js', 'tests/report.test.js', 'tests/no-secrets.test.js'];
const FROM = 'alerts@mail.taxxml.ca';        // the documented alert sender (public); RESEND_FROM itself stays a secret
const FROM_OK = ['worker/README.md', 'worker/wrangler.toml'];

const BAD = [
  [/hooks\.slack\.com/i, 'Slack webhook host'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}|\bre_[A-Za-z0-9]{24,}/, 'Resend API key'],
  [/\bsk[-_](?:live_|test_|proj-)?[A-Za-z0-9]{20,}/, 'sk- style secret'],
  [/\b(?:SLACK_WEBHOOK_URL|RESEND_API_KEY|RESEND_FROM|TURNSTILE_SECRET|ALERT_EMAIL)\s*=\s*["'][^"'\s]+/, 'secret value assigned in config'],
];
// Problems in one file (rel: repo-relative, '/' separators)
function scan(rel, text) {
  const out = BAD.filter(([re]) => re.test(text)).map(([re, what]) => `${what} (${re.exec(text)[0]})`);
  for (const k of text.match(/\b0x4[A-Za-z0-9_-]{10,}/g) || [])
    if (!(k === SITE_KEY && SITE_KEY_OK.includes(rel))) out.push(`Turnstile site/secret key (${k})`);
  // The Worker and the client config name no mailbox: ALERT_EMAIL / RESEND_FROM are secrets
  if (rel.startsWith('worker/') || rel === 'js/report.js') {
    for (const line of text.split('\n')) {
      for (const e of line.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []) {
        if (/@example\.(com|org)$/.test(e)) continue;
        const ok = e === FROM && FROM_OK.includes(rel) && (rel !== 'worker/wrangler.toml' || /^\s*#/.test(line));
        if (!ok) out.push(`names a mailbox (${e})`);
      }
    }
  }
  return out;
}

for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  assert.deepStrictEqual(scan(rel, fs.readFileSync(f, 'utf8')), [], rel);
}
assert(files.some(f => f.endsWith(path.join('worker', 'wrangler.toml'))), 'scanned worker/wrangler.toml');

// The scanner itself: the allowed public values pass only where allowed; everything else fails
const K = '0x4AAAAAAA' + 'BCDEFghijk_lmno'; // built at runtime so this file holds no other key
assert.deepStrictEqual(scan('js/report.js', `var TURNSTILE_SITE_KEY = '${SITE_KEY}';`), []);
assert.strictEqual(scan('js/app.js', SITE_KEY).length, 1, 'site key outside report.js');
assert.strictEqual(scan('worker/README.md', SITE_KEY).length, 1, 'site key in the Worker docs');
assert.strictEqual(scan('js/report.js', K).length, 1, 'any other Turnstile key');
assert.strictEqual(scan('js/report.js', SITE_KEY + 'x').length, 1, 'a longer key that starts with the site key');
assert.deepStrictEqual(scan('worker/README.md', `sender \`TaxXML <${FROM}>\``), []);
assert.deepStrictEqual(scan('worker/wrangler.toml', `#   RESEND_FROM  TaxXML <${FROM}>`), []);
assert.strictEqual(scan('worker/wrangler.toml', `from = "${FROM}"`).length, 1, 'from-address outside a wrangler.toml comment');
assert.strictEqual(scan('worker/index.js', `// ${FROM}`).length, 1, 'from-address in the Worker code');
assert.strictEqual(scan('js/report.js', FROM).length, 1, 'from-address in report.js');
assert.strictEqual(scan('worker/README.md', 'alerts go to luis' + '@avanza-automation.com').length, 1, 'a recipient mailbox');
assert.strictEqual(scan('worker/wrangler.toml', '# ALERT_EMAIL owner' + '@gmail.com').length, 1, 'a recipient mailbox in a comment');
for (const n of ['RESEND_FROM', 'ALERT_EMAIL', 'TURNSTILE_SECRET', 'RESEND_API_KEY', 'SLACK_WEBHOOK_URL'])
  for (const rel of ['worker/wrangler.toml', 'worker/README.md'])
    assert(scan(rel, `${n} = "${FROM}"`).length >= 1, `assigned secret: ${n} in ${rel}`);
assert(scan('worker/README.md', 'https://hooks.slack' + '.com/services/T/B/x').length, 'Slack webhook');
assert(scan('worker/README.md', 're_' + 'abcdefgh_ijklmnop').length, 'Resend key');

console.log(`no-secrets.test.js: ${files.length} files clean`);
