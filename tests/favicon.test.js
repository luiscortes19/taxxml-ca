// Every HTML page links the same favicon set, and each linked file exists at the size it claims.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./harness');

const TAGS = [
  '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
  '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
  '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
];
const PNG_SIZES = { 'favicon-16x16.png': 16, 'favicon-32x32.png': 32, 'apple-touch-icon.png': 180 };

const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
assert(pages.length >= 4, `expected at least 4 HTML pages, found ${pages}`);
for (const page of pages) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  for (const tag of TAGS) assert(html.includes(tag), `${page} is missing ${tag}`);
  assert(!html.includes('logo.png'), `${page} still references the old logo.png favicon`);
}

for (const f of ['favicon.svg', 'favicon.ico', ...Object.keys(PNG_SIZES)]) {
  assert(fs.existsSync(path.join(ROOT, f)), `${f} is missing`);
}
for (const [f, size] of Object.entries(PNG_SIZES)) {
  const ihdr = fs.readFileSync(path.join(ROOT, f));  // PNG IHDR: width at byte 16, height at 20
  assert.deepStrictEqual([ihdr.readUInt32BE(16), ihdr.readUInt32BE(20)], [size, size], `${f} is ${size}x${size}`);
}

console.log('favicon.test.js: all passed');
