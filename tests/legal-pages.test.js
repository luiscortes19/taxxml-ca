// Legal pages list every supported return, including NR4.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./harness');

for (const page of ['terms.html', 'privacy.html']) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  for (const ret of ['NR4', 'T4', 'T1204', 'T5018']) {
    assert(html.includes(`<strong>${ret}</strong>`), `${page} lists ${ret}`);
  }
}

// Privacy page names every GA4 event app.js sends, so its analytics wording can't go stale.
{
  const privacy = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
  const src = ['js/app.js', 'js/ga.js', 'js/report.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const events = [...src.matchAll(/(?:track|send)\('(\w+)'/g)].map(m => m[1]);
  assert(events.length >= 13, events.join());
  assert(events.includes('app_error'), 'report.js sends app_error');
  for (const e of events) assert(privacy.includes(`<code>${e}</code>`), `privacy.html names event ${e}`);
  // ...and every event parameter, by name
  for (const p of ['return_type', 'source', 'step', 'direction', 'error_count', 'error_category', 'first_error_field',
                   'is_sample', 'rows_bucket', 'required_unmapped', 'page', 'cta', 'traffic_type', 'debug_mode', 'field', 'method', 'error_kind',
                   'cols_bucket', 'error_cells', 'warning_cells', 'error_cells_bucket', 'error_field_list', 'error_by_field', 'trigger',
                   'exit_reason', 'transport_type', 'step2_seconds_bucket', 'step2_seconds', 'remaps_count', 'edits_count', 'deletes_count', 'help_kind'])
    assert(privacy.includes(`<code>${p}</code>`), `privacy.html names parameter ${p}`);
}

// Privacy page describes the Feedback form and crash reports: where they go, what they contain, and that nothing is kept.
{
  const privacy = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
  const text = privacy.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  assert(text.includes('Last updated: 18 November 2026'), 'privacy.html date bumped');
  for (const k of ['js_error', 'xml_generate_failed', 'parse_crash']) assert(privacy.includes(`<code>${k}</code>`), `privacy.html names error_kind ${k}`);
  for (const re of [/Feedback form/, /feedback and error reports/i, /Cloudflare Worker/, /United States/, /Slack/, /Resend/, /Cloudflare Turnstile/,
                    /only the message and optional email you type/i,
                    /scrubbed technical report \(return type, step, browser, error kind, scrubbed stack\)/i,
                    /never include[^.]*slip data[^.]*SINs[^.]*names[^.]*amounts[^.]*file names/i,
                    /not stored in a TaxXML database/i, /does not keep a copy/i])
    assert(re.test(text), `privacy.html: ${re}`);
  assert(!/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(text), 'privacy.html publishes no email address');
}

console.log('legal-pages.test.js: all passed');
