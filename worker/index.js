// TaxXML feedback + crash-report Worker. Receives JSON from js/report.js, scrubs it again, and forwards it to Slack
// and/or email (Resend). Nothing is stored: no KV, D1, R2, or logs of the payload. Setup: README.md.
// Secrets (wrangler secret put, never in this repo): SLACK_WEBHOOK_URL, TURNSTILE_SECRET, and optionally
// RESEND_API_KEY + RESEND_FROM + ALERT_EMAIL.
import { cleanCrash, cleanFeedback } from './scrub.js';

const ORIGINS = ['https://taxxml.ca', 'https://www.taxxml.ca'];
const MAX_BODY = 8000;                      // bytes; a feedback message is capped at 2000 characters
const LIMITS = { feedback: 5, crash: 20 };  // per IP per window
const WINDOW_MS = 10 * 60 * 1000;
// ponytail: per-isolate counter (each Cloudflare location/instance counts separately). Upgrade to the Workers
// Rate Limiting binding if abuse gets through. Holds only IP -> count, never a message.
const hits = new Map();

function limited(ip, kind) {
  const now = Date.now(), key = kind + ':' + ip;
  if (hits.size > 10000) hits.clear();
  const h = hits.get(key);
  if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + WINDOW_MS }); return false; }
  return ++h.n > LIMITS[kind];
}

async function turnstileOk(token, ip, env) {
  if (!token || !env.TURNSTILE_SECRET) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', String(token).slice(0, 2048));
  if (ip) form.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    return (await r.json()).success === true;
  } catch { return false; }
}

const slackEscape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function format(kind, c) {
  const where = [c.return_type || 'no return', c.step ? `step ${c.step}` : '', c.page, c.browser, c.version].filter(Boolean).join(' · ');
  if (kind === 'crash') {
    return { subject: `TaxXML crash: ${c.error_kind} (${c.return_type || c.page})`,
             text: `Crash: ${c.error_kind}\n${where}\n${c.message}\n${c.stack}` };
  }
  return { subject: `TaxXML ${c.type}${c.return_type ? ' (' + c.return_type + ')' : ''}`,
           text: `New ${c.type}\n${where}\nReply to: ${c.email || '(no email given)'}\n\n${c.message}` };
}

async function toSlack(env, text) {
  if (!env.SLACK_WEBHOOK_URL) return null;
  try {
    const r = await fetch(env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: slackEscape(text) }) });
    return r.ok;
  } catch { return false; }
}

async function toEmail(env, subject, text, replyTo) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM || !env.ALERT_EMAIL) return null;
  const mail = { from: env.RESEND_FROM, to: [env.ALERT_EMAIL], subject, text };
  if (replyTo) mail.reply_to = replyTo;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(mail) });
    return r.ok;
  } catch { return false; }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!ORIGINS.includes(origin)) return new Response(null, { status: 403 });
    const cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
    const reply = status => new Response(null, { status, headers: cors });
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
    }
    if (request.method !== 'POST') return reply(405);
    const slackOn = !!env.SLACK_WEBHOOK_URL, emailOn = !!(env.RESEND_API_KEY && env.RESEND_FROM && env.ALERT_EMAIL);
    if (!slackOn && !emailOn) return reply(503);

    const raw = await request.text();
    if (raw.length > MAX_BODY) return reply(413);
    let body;
    try { body = JSON.parse(raw); } catch { return reply(400); }
    const kind = body && (body.kind === 'feedback' || body.kind === 'crash') ? body.kind : null;
    if (!kind) return reply(400);
    if (body.website) return reply(400); // honeypot filled: a bot

    const ip = request.headers.get('CF-Connecting-IP') || '';
    if (limited(ip, kind)) return reply(429);
    if (kind === 'feedback' && !(await turnstileOk(body.turnstile, ip, env))) return reply(403);

    const clean = kind === 'feedback' ? cleanFeedback(body) : cleanCrash(body);
    if (kind === 'feedback' && !clean.message) return reply(400);
    const { subject, text } = format(kind, clean);
    const sent = await Promise.all([toSlack(env, text), toEmail(env, subject, text, kind === 'feedback' ? clean.email : '')]);
    return reply(sent.includes(true) ? 204 : 502);
  },
};
