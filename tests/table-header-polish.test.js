// Step 2 header polish (desktop). Measured in Playwright Chromium + WebKit with a 48-row T4 CSV:
// A. the header stays in view whichever box scrolls: sticky in the table's box, and pinned under the site header
//    when the page itself scrolls (pinHead);
// B. every CRA name and column name is shown in full: columns as wide as the name (8rem to 14rem), wrapped between
//    words, no "…" (no line clamp, ellipsis or nowrap);
// C. the "⋯" menu opens in #editor-menu, outside the table's scroll box, position: fixed under its button (above it
//    when there is no room below); scroll, resize, Escape and a click outside close it, focus goes back to ⋯.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createApp, ROOT } = require('./harness');

const csv = rows => Buffer.from(rows.map(r => r.join(',')).join('\r\n') + '\r\n');
const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const fine = (bare.match(/@media \(pointer: fine\) \{([\s\S]*?)\n\}/) || [])[1];
const coarse = (bare.match(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/) || [])[1];
const rulesIn = (src, sel) => [...src.matchAll(/([^{}]*)\{([^}]*)\}/g)].filter(m => m[1].split(',').some(s => s.trim() === sel)).map(m => m[2]).join(';');
const rules = sel => rulesIn(bare.replace(/@media[^{]*\{[^\n]*\}\s*\}|@media[^{]*\{\n[\s\S]*?\n\}/g, ''), sel); // outside any @media
const T4 = [['Employee ID', 'Last Name', 'First Name', 'SIN', 'Employment Income', 'CPP Contributions'], ['1', 'Doe', 'John', '046454286', '100', '5']];

// ---- A. sticky header: in the box (CSS), and pinned under the site header when the page scrolls (pinHead) ----
{
  assert(/position: sticky/.test(rules('.ed-table thead')) && /z-index: 3/.test(rules('.ed-table thead')), 'thead sticky in its box');
  assert(/max-height: calc\(100vh - [\d.]+rem\)/.test(rules('.ed-wrap')), '.ed-wrap: as tall as the window under the site header');
  assert(/addEventListener\('scroll', pinHead/.test(js) && /addEventListener\('resize', pinHead/.test(js), 'pinHead on page scroll and resize');

  const a = createApp({ returnType: 'T4' });
  a.loadFile('t4.csv', csv(T4));
  const head = a.el('editor-thead');
  head.offsetHeight = 100;
  a.el('site-header').getBoundingClientRect = () => ({ bottom: 62 });
  const wrap = { clientHeight: 722, getBoundingClientRect: () => ({ top: wrapTop }) };
  let wrapTop = 292;
  a.run('document').querySelector = sel => (sel === '.ed-wrap' ? wrap : null);
  const pin = top => { wrapTop = top; a.winEvent({ type: 'scroll', target: a.run('document') }); return head.style.top; };
  assert.strictEqual(pin(292), '0px', 'table below the site header: plain sticky');
  assert.strictEqual(pin(-18), '80px', 'page scrolled 80px past the table top: header just under the site header');
  assert.strictEqual(pin(-1000), '622px', 'never below the box bottom (722 - 100)');
  wrapTop = -18;
  a.winEvent({ type: 'resize' });
  assert.strictEqual(head.style.top, '80px', 'resize re-pins');
}

// ---- B. names in full: max-content columns 8rem-14rem, wrapped between words, no clamp / ellipsis / nowrap ----
{
  assert(fine, 'pointer: fine block');
  assert(/min-width: 8rem/.test(rulesIn(fine, '.ed-table thead th')), 'desktop columns at least 8rem: ' + rulesIn(fine, '.ed-table thead th'));
  for (const sel of ['.ed-cra-label', '.ed-slot .ed-chip-name']) {
    const desk = rulesIn(fine, sel), all = rules(sel) + ';' + desk;
    assert(/width: max-content/.test(desk) && /max-width: 14rem/.test(desk), `${sel}: as wide as the name, up to 14rem: ${desk}`);
    assert(!/line-clamp|text-overflow: ellipsis|white-space: nowrap/.test(all), `${sel}: never cut: ${all}`);
    assert(/word-break: keep-all/.test(all) && !/overflow-wrap: (break-word|anywhere)|word-break: break-all/.test(all), `${sel}: no mid-word breaks: ${all}`);
  }
  // the generic .ed-chip-name has "…" for the Ignored tray; the header chip turns it off
  assert(/overflow: visible/.test(rules('.ed-slot .ed-chip-name')), 'header chip: overflow visible: ' + rules('.ed-slot .ed-chip-name'));
  assert(!/width: 0/.test(rules('.ed-cra-label')) && !/\.ed-slot \.ed-chip \{[^}]*width: 0/.test(fine), 'the names size their column');
  // no per-name inline width any more (CSS sizes them)
  const a = createApp({ returnType: 'T4' });
  a.loadFile('t4.csv', csv(T4));
  const head = a.el('editor-thead').innerHTML;
  assert(/<span class="ed-cra-label" title="Employment Income \(Box 14\)">Employment Income \(Box 14\)<\/span>/.test(head), head);
  assert(!/style="min-width/.test(head), 'no inline min-width');
}

// ---- C. "⋯" menu: #editor-menu, outside the scroll box, fixed; placed, flipped, closed on scroll / resize / Escape ----
{
  const step2 = html.slice(html.indexOf('<div class="ed-main">'));
  const wrapEnd = step2.indexOf('</table>\n          </div>');
  assert(wrapEnd > 0 && step2.indexOf('id="editor-menu"') > wrapEnd, '#editor-menu sits after .ed-wrap, not inside it');
  assert(/<div id="editor-menu" class="ed-menu-pop" role="group" aria-label="Column menu" hidden><\/div>/.test(html), '#editor-menu markup');
  assert(/position: fixed/.test(rules('.ed-menu-pop')), '.ed-menu-pop fixed: ' + rules('.ed-menu-pop'));
  assert(/display: none/.test(rulesIn(fine, '.ed-menu-list')), 'desktop: the in-chip list never shows (the pop-up does)');
  assert(/display: flex/.test(rulesIn(coarse, '.ed-menu-list')) && /position: static/.test(rulesIn(coarse, '.ed-menu-list')), 'touch: in-chip buttons, as before');
  assert(/min-height: 44px/.test(rulesIn(coarse, '.ed-arrow, .ed-act, .ed-place summary, .ed-place li button, .ed-del, .ed-filter, .ed-cell-select')), 'touch: 44px');

  const a = createApp({ returnType: 'T4' });
  a.loadFile('t4.csv', csv(T4));
  const menu = a.el('editor-menu');
  menu.offsetWidth = 176;
  menu.offsetHeight = 120;
  let first = 0;
  menu.querySelector = sel => (sel === 'button:not(:disabled)' ? { focus: () => first++ } : null);
  const list = { innerHTML: '<button class="ed-act">Move left</button><button class="ed-act">Leave out</button>' };
  let btnRect = { top: 100, bottom: 120, left: 300, right: 320 }, focused = 0;
  const btn = { getBoundingClientRect: () => btnRect, nextElementSibling: list, focus: () => focused++ };
  a.run('document').querySelector = sel => (/\[data-menu-btn="1"\]/.test(sel) ? btn : null);
  a.ctx.innerHeight = 800;
  const openMenu = () => a.el('editor-thead').dispatchEvent({ type: 'click', target: { closest: s => (s === '[data-menu-btn]' ? { dataset: { menuBtn: '1' } } : null) } });

  openMenu();
  assert.strictEqual(a.run('menuCol'), 1);
  assert.strictEqual(menu.hidden, false, 'shown');
  assert.strictEqual(menu.innerHTML, list.innerHTML, "the column's own menu buttons");
  assert.deepStrictEqual({ top: menu.style.top, left: menu.style.left }, { top: '122px', left: '144px' }, 'under ⋯, right edges lined up');
  assert.strictEqual(first, 1, 'focus on its first button');
  a.winEvent({ type: 'scroll', target: menu });
  assert.strictEqual(a.run('menuCol'), 1, 'scrolling inside the menu keeps it');
  a.winEvent({ type: 'scroll', target: a.run('document') });
  assert.strictEqual(a.run('menuCol'), null, 'a page / table scroll closes it');
  assert.strictEqual(menu.hidden, true, 'hidden');

  btnRect = { top: 750, bottom: 770, left: 20, right: 40 };
  openMenu();
  assert.deepStrictEqual({ top: menu.style.top, left: menu.style.left }, { top: '628px', left: '4px' }, 'flipped above, kept on screen');
  a.winEvent({ type: 'resize' });
  assert.strictEqual(a.run('menuCol'), null, 'resize closes it');

  openMenu();
  focused = 0;
  a.docEvent({ type: 'keydown', key: 'Escape', target: { closest: () => null } });
  assert.strictEqual(a.run('menuCol'), null, 'Escape closes');
  assert.strictEqual(focused, 1, 'focus back on ⋯');
  openMenu();
  a.docEvent({ type: 'click', target: { closest: s => (s === '.ed-menu, #editor-menu' ? {} : null) } });
  assert.strictEqual(a.run('menuCol'), 1, 'a click in the menu (not on an action) keeps it');
  a.docEvent({ type: 'click', target: { closest: () => null } });
  assert.strictEqual(a.run('menuCol'), null, 'a click outside closes');

  // an action in the pop-up: handled like the in-chip buttons; the re-render closes the menu
  openMenu();
  a.el('editor-menu').dispatchEvent({ type: 'click', target: { closest: s => (s === '[data-to]' ? { dataset: { to: 'ignore', col: '1' } } : null) } });
  assert.strictEqual(a.run('columnField(1)'), 'ignore', 'Leave out from the pop-up');
  assert.strictEqual(a.run('menuCol'), null, 'closed after the action');
  assert.strictEqual(menu.hidden, true);
}

console.log('table-header-polish.test.js: all passed');
