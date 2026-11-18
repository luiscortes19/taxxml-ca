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

const BAD = [
  [/hooks\.slack\.com/i, 'Slack webhook host'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}|\bre_[A-Za-z0-9]{24,}/, 'Resend API key'],
  [/\bsk[-_](?:live_|test_|proj-)?[A-Za-z0-9]{20,}/, 'sk- style secret'],
  [/\b0x4AAAAAAA[A-Za-z0-9_-]{6,}/, 'Turnstile site/secret key'],
  [/\b(?:SLACK_WEBHOOK_URL|RESEND_API_KEY|RESEND_FROM|TURNSTILE_SECRET|ALERT_EMAIL)\s*=\s*["'][^"'\s]+/, 'secret value assigned in config'],
];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  for (const [re, what] of BAD) assert(!re.test(text), `${path.relative(ROOT, f)}: ${what} (${(re.exec(text) || [])[0]})`);
}
assert(files.some(f => f.endsWith(path.join('worker', 'wrangler.toml'))), 'scanned worker/wrangler.toml');

// The Worker and the client config name no mailbox: ALERT_EMAIL / RESEND_FROM are secrets
for (const f of [...walk(path.join(ROOT, 'worker')), path.join(ROOT, 'js/report.js')]) {
  const emails = (fs.readFileSync(f, 'utf8').match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []).filter(e => !/@example\.(com|org)$/.test(e));
  assert.deepStrictEqual(emails, [], `${path.relative(ROOT, f)} names a mailbox`);
}

console.log(`no-secrets.test.js: ${files.length} files clean`);
