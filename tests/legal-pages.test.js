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

console.log('legal-pages.test.js: all passed');
