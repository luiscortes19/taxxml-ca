// Step 2: chips show only the column name ("⠿ Last Name", not "⠿ B · Last Name"), in the header and in the Ignored
// tray. The spreadsheet letter stays in the chip's tooltip (title="Column B: Last Name") and in its aria-label
// ("Column B, Last Name"). "Moves to:" and the "Use column" menu name no letter. Names are never cut.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createApp, ROOT } = require('./harness');

const csv = rows => Buffer.from(rows.map(r => r.join(',')).join('\r\n') + '\r\n');
const text = h => h.replace(/<[^>]*>/g, '').replace(/⠿/g, '').trim();
const chips = h => [...h.matchAll(/<span class="ed-chip-name"[^>]*>[\s\S]*?<\/span>[^<]*<\/span>/g)].map(m => m[0]);

const a = createApp({ returnType: 'T5018' });
a.loadFile('t.csv', csv([['Recipient Name', 'Recipient BN', 'Recipient Type', 'Address', 'Amount Paid', 'Notes'], ['A', '123456789RZ0001', 'corp', '1 Main', '1', 'x']]));
const head = a.el('editor-thead').innerHTML, ign = a.el('editor-ignored').innerHTML;
const H = ['Recipient Name', 'Recipient BN', 'Recipient Type', 'Address', 'Amount Paid', 'Notes'];

// ---- chip text: name only; title and aria-label keep the letter ----
const headChips = chips(head), ignChips = chips(ign);
assert(headChips.length >= 5 && ignChips.length === 1, `chips found: ${headChips.length} + ${ignChips.length}`);
for (const ch of [...headChips, ...ignChips]) {
  const name = text(ch);
  assert(H.includes(name), `chip text is the name only: "${name}" in ${ch}`);
  assert(!/·/.test(ch), 'no "·" separator: ' + ch);
  const c = H.indexOf(name), L = String.fromCharCode(65 + c);
  assert(ch.includes(`title="Column ${L}: ${name}"`), `title keeps the letter: ${ch}`);
}
assert.strictEqual(text(ignChips[0]), 'Notes');
assert(head.includes('aria-label="Column B, Recipient BN. Drag it'), 'chip aria-label: ' + head.match(/role="group" aria-label="[^"]*"/));

// ---- "Use column" menu: no letter, names the column it replaces ----
const menu = ign.match(/<summary data-col="5"[\s\S]*?<\/details>/)[0];
assert(/data-to="rcpnt_type" data-col="5">Recipient Type \(replaces Recipient Type\)</.test(menu), menu);
assert(!/replaces column [A-Z]/.test(menu), menu);

// ---- "Moves to:" names the CRA column only ----
a.el('editor-thead').dispatchEvent({ type: 'focusin', target: { closest: s => (s === '[data-move]' ? { dataset: { move: '1', col: '0' } } : null) } });
assert(/^Moves to: [^·]+$/.test(a.el('editor-landing').textContent) && !/\b[A-Z] ·|Column [A-Z]\b/.test(a.el('editor-landing').textContent), a.el('editor-landing').textContent);

// ---- the Ignored tray's names are never cut either (no ellipsis, no mid-word break) ----
const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const base = (css.match(/\n\.ed-chip-name \{([^}]*)\}/) || [])[1];
assert(base && !/text-overflow: ellipsis|overflow: hidden|line-clamp|white-space: nowrap/.test(base), '.ed-chip-name never cut: ' + base);
assert(/word-break: (normal|keep-all)/.test(base) && !/word-break: break-all|overflow-wrap: anywhere/.test(base), '.ed-chip-name: no mid-word breaks: ' + base);

console.log('hide-column-letters: ok');
