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
  const events = [...fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8').matchAll(/track\('(\w+)'/g)].map(m => m[1]);
  assert(events.length >= 8, events.join());
  for (const e of events) assert(privacy.includes(`<code>${e}</code>`), `privacy.html names event ${e}`);
}

console.log('legal-pages.test.js: all passed');
