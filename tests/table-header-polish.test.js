// Step 2 header polish (desktop): the "⋯" menu is position: fixed so the table's scroll box can't clip it (or grow
// its scroll area, which pushed the sticky header off the top on short tables); CRA and column names size their
// column to fit on 2 lines, broken between words.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createApp, ROOT } = require('./harness');

const csv = rows => Buffer.from(rows.map(r => r.join(',')).join('\r\n') + '\r\n');
const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = sel => [...bare.matchAll(/([^{}]*)\{([^}]*)\}/g)].filter(m => m[1].split(',').some(s => s.trim() === sel)).map(m => m[2]).join(';');

// ---- 1. names: the narrowest 2-line split between words sets the column's minimum width ----
{
  const a = createApp({ returnType: 'T4' });
  const ch = t => a.run(`twoLineCh(${JSON.stringify(t)})`);
  assert.strictEqual(ch('Province of Employment (Box 10)'), 19, '"Province of" / "Employment (Box 10)"');
  assert.strictEqual(ch('SIN (Box 12)'), 8, '"SIN" / "(Box 12)"');
  assert.strictEqual(ch('Supercalifragilistic'), 20, 'one word: its length (never broken)');
  a.loadFile('t4.csv', csv([['Last Name', 'SIN', 'Box 14 - Employment Income'], ['Doe', '046454286', '100']]));
  const head = a.el('editor-thead').innerHTML;
  const label = head.match(/<span class="ed-cra-label" title="Employment Income \(Box 14\)" style="min-width: (\d+)ch">/);
  assert(label, 'CRA label carries its 2-line width: ' + head);
  assert.strictEqual(+label[1], ch('Employment Income (Box 14)') + 1);
  const chip = head.match(/<span class="ed-chip-name" title="Box 14 - Employment Income" style="min-width: (\d+)ch">/);
  assert(chip, 'column name carries its 2-line width: ' + head);
  assert.strictEqual(+chip[1], ch('C · Box 14 - Employment Income') + 2, 'letter prefix and grip included');
  // capped: a very long name stops at the max and clamps to 2 lines with … (full name in the title)
  const b = createApp({ returnType: 'T4' });
  b.loadFile('t4.csv', csv([['Last Name', 'SIN', 'Box 14 ' + 'very long header words '.repeat(6)], ['Doe', '046454286', '100']]));
  const big = b.el('editor-thead').innerHTML.match(/class="ed-chip-name" title="Box 14 very[^"]*" style="min-width: (\d+)ch"/);
  assert(big && +big[1] <= 22, 'capped: ' + (big && big[1]));
}

// ---- 2. CSS: names wrap between words only, 2 lines max; the label no longer gives up its width (width: 0) ----
{
  for (const sel of ['.ed-cra-label', '.ed-slot .ed-chip-name']) {
    const r = rules(sel);
    assert(/-webkit-line-clamp: 2/.test(r), `${sel}: 2 lines max: ${r}`);
    assert(/word-break: keep-all/.test(r) && !/overflow-wrap: (break-word|anywhere)|word-break: break-all/.test(r), `${sel}: no mid-word breaks: ${r}`);
  }
  assert(!/width: 0/.test(rules('.ed-cra-label')), 'the label sizes its column: ' + rules('.ed-cra-label'));
  const fine = (css.match(/@media \(pointer: fine\) \{([\s\S]*?)\n\}/) || [])[1];
  assert(!/\.ed-slot \.ed-chip \{[^}]*width: 0/.test(fine), 'the chip sizes its column too: ' + fine);
  // sticky header kept (both rows, one sticky thead: Chromium and WebKit both pin it), solid background, above cells
  assert(/position: sticky/.test(rules('.ed-table thead')) && /top: 0/.test(rules('.ed-table thead')) && /z-index: 3/.test(rules('.ed-table thead')));
  assert(/background: var\(--paper\)/.test(rules('.ed-table thead th')), 'solid header background');
}

// ---- 3. "⋯" menu: fixed, out of the scroll box; placed under its button, flipped up near the bottom ----
{
  assert(/position: fixed/.test(rules('.ed-menu-list')), '.ed-menu-list is position: fixed: ' + rules('.ed-menu-list'));
  const fine = (css.match(/@media \(pointer: fine\) \{([\s\S]*?)\n\}/) || [])[1];
  assert(!/\.ed-menu-list[^{]*\{[^}]*position: absolute/.test(fine), 'not absolute again on desktop');
  assert(/addEventListener\('scroll', placeColumnMenu, true\)/.test(js), 'follows any scroll (the table box too)');
  assert(/addEventListener\('resize', placeColumnMenu\)/.test(js), 'and window resize');

  const a = createApp({ returnType: 'T4' });
  a.loadFile('t4.csv', csv([['Last Name', 'SIN'], ['Doe', '046454286']]));
  const list = { offsetWidth: 176, offsetHeight: 90, style: {} };
  let btnRect = { top: 100, bottom: 120, left: 300, right: 320 };
  const btn = { getBoundingClientRect: () => btnRect, nextElementSibling: list, focus() {}, setAttribute() {}, dataset: { menuBtn: '0' } };
  const doc = a.run('document');
  doc.querySelector = sel => (sel === '#editor-thead .ed-menu.is-open [data-menu-btn]' ? btn : null);
  a.ctx.innerHeight = 800;
  a.ctx.innerWidth = 1600;
  a.run('menuCol = 0');
  a.run('placeColumnMenu()');
  assert.deepStrictEqual({ ...list.style }, { top: '122px', left: '144px' }, 'below, right edges lined up');
  btnRect = { top: 750, bottom: 770, left: 300, right: 320 };
  a.run('placeColumnMenu()');
  assert.deepStrictEqual({ ...list.style }, { top: '658px', left: '144px' }, 'flipped above near the bottom');
  btnRect = { top: 100, bottom: 120, left: 20, right: 40 };
  a.run('placeColumnMenu()');
  assert.strictEqual(list.style.left, '4px', 'kept on screen at the left edge');
  doc.querySelector = () => null;
  a.run('placeColumnMenu()'); // nothing open: no-op

  // opening it places it; Escape closes and puts focus back on its button (unchanged behaviour)
  a.run('menuCol = null');
  let placed = 0, focused = 0;
  doc.querySelector = sel => (sel === '#editor-thead .ed-menu.is-open [data-menu-btn]' ? (placed++, btn)
    : /\[data-menu-btn="0"\]/.test(sel) ? { focus: () => focused++ } : null);
  a.el('editor-thead').dispatchEvent({ type: 'click', target: { closest: s => (s === '[data-menu-btn]' ? { dataset: { menuBtn: '0' } } : null) } });
  assert.strictEqual(a.run('menuCol'), 0);
  assert(placed >= 1, 'placed when opened');
  a.docEvent({ type: 'keydown', key: 'Escape', target: { closest: () => null } });
  assert.strictEqual(a.run('menuCol'), null, 'Escape closes');
  assert.strictEqual(focused, 1, 'focus back on ⋯');
}

console.log('table-header-polish.test.js: all passed');
