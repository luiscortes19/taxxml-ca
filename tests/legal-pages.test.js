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
  const src = ['js/app.js', 'js/ga.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const events = [...src.matchAll(/(?:track|send)\('(\w+)'/g)].map(m => m[1]);
  assert(events.length >= 13, events.join());
  for (const e of events) assert(privacy.includes(`<code>${e}</code>`), `privacy.html names event ${e}`);
  // ...and every event parameter, by name
  for (const p of ['return_type', 'source', 'step', 'direction', 'error_count', 'error_category', 'first_error_field',
                   'is_sample', 'rows_bucket', 'required_unmapped', 'page', 'cta', 'traffic_type', 'debug_mode'])
    assert(privacy.includes(`<code>${p}</code>`), `privacy.html names parameter ${p}`);
}

console.log('legal-pages.test.js: all passed');
