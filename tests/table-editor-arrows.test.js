// Step 2 table editor, column moves without a header dropdown: ←/→ beside each column's name, a "Moves to" landing
// indicator (hover, focus, drag), "Leave out" / "Use column" buttons, and no browser save / autofill prompts.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createApp, ROOT } = require('./harness');

const csv = rows => Buffer.from(rows.map(r => r.join(',')).join('\r\n') + '\r\n');
function app(returnType, rows) {
  const events = [];
  const a = createApp({ returnType, gtag: (cmd, name, params) => events.push([name, JSON.parse(JSON.stringify(params))]) });
  a.named = n => events.filter(e => e[0] === n).map(e => e[1]);
  a.field = c => a.run(`columnField(${c})`);
  a.head = () => a.el('editor-thead').innerHTML;
  a.ign = () => a.el('editor-ignored').innerHTML;
  // The header cells the landing marker lands on: fakes for document.querySelectorAll('#editor-thead [data-slot="x"]')
  const cells = {};
  const fake = () => { const cls = new Set(); return { cls, classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) } }; };
  a.ctx.document.querySelectorAll = sel => {
    const m = sel.match(/^#editor-thead \[data-slot="(\w+)"\]$/);
    return m ? (cells[m[1]] = cells[m[1]] || [fake(), fake()]) : [];
  };
  a.marked = cls => Object.keys(cells).filter(k => cells[k].every(e => e.cls.has(cls)));
  a.landing = () => a.el('editor-landing').textContent;
  a.loadFile('x.csv', csv(rows));
  return a;
}
const label = (a, f) => a.run(`getReturnConfig().fields.find(x => x.key === ${JSON.stringify(f)}).label`);
const on = (a, el, type, sel, dataset) => a.el(el).dispatchEvent({ type, target: { closest: s => (s === sel ? { dataset } : null) } });

const FILES = {
  T4: [['Last Name', 'First Name', 'SIN', 'Box 14 - Employment Income', 'Notes'], ['Doe', 'John', '046454286', '100', 'x']],
  T1204: [['Vendor Name', 'Vendor BN', 'Amount Paid', 'Notes'], ['Acme', '123456789RT0001', '1', 'x']],
  T5018: [['Recipient Name', 'Recipient BN', 'Amount Paid', 'Notes'], ['Acme', '123456789RZ0001', '1', 'x']],
  NR4: [['Recipient Name', 'Foreign Tax ID', 'Gross Income', 'Notes'], ['Al', 'X1', '1', 'x']],
};

// ---- every return: no mapping <select>; ← name → in each filled slot; first ← / last → disabled; Leave out; Use column ----
for (const [rt, rows] of Object.entries(FILES)) {
  const a = app(rt, rows);
  const slots = JSON.parse(JSON.stringify(a.run('editorSlots()')));
  assert(!/<select/.test(a.head() + a.ign()), `${rt}: no <select> in #editor-thead or #editor-ignored`);
  const mapped = slots.map(f => a.run(`columnMap.${f}`)).filter(c => c >= 0);
  assert(mapped.length >= 3, rt);
  // put a column in the first and in the last CRA column, so both ends are checked
  const [first, last] = [slots[0], slots[slots.length - 1]];
  if (a.run(`columnMap.${last}`) < 0) a.run(`remapColumn(${rows[0].length - 1}, '${last}', 'button')`);
  const head = a.head();
  for (const f of slots) {
    const c = a.run(`columnMap.${f}`);
    if (c < 0) continue;
    const cell = head.match(new RegExp(`<th scope="col" class="ed-slot[^"]*" data-slot="${f}">([\\s\\S]*?)</th>`))[1];
    const L = a.run(`colLetter(${c})`);
    const name = rows[0][c];
    // ← before the name, → after it
    const m = cell.match(/<button type="button" class="ed-arrow" data-move="-1"[^>]*>←<\/button><span class="ed-chip-name"[^>]*>[\s\S]*?<\/span><\/span><button type="button" class="ed-arrow" data-move="1"[^>]*>→<\/button>/);
    assert(m, `${rt}.${f}: [←] name [→]: ${cell}`);
    assert(new RegExp(`data-move="-1" data-col="${c}"( disabled)? aria-label="Move column ${L} \\(${name}\\) to the previous CRA column`).test(cell), `${rt}.${f} ← label: ${cell}`);
    assert(new RegExp(`data-move="1" data-col="${c}"( disabled)? aria-label="Move column ${L} \\(${name}\\) to the next CRA column`).test(cell), `${rt}.${f} → label`);
    assert.strictEqual(/data-move="-1"[^>]* disabled/.test(cell), f === first, `${rt}.${f}: ← disabled only in the first CRA column`);
    assert.strictEqual(/data-move="1"[^>]* disabled/.test(cell), f === last, `${rt}.${f}: → disabled only in the last CRA column`);
    assert(new RegExp(`<button type="button" class="ed-act" data-to="ignore" data-col="${c}" aria-label="Leave out column ${L} \\(${name}\\)">Leave out</button>`).test(cell), `${rt}.${f}: Leave out`);
  }
  assert.strictEqual(a.run(`moveTarget(${a.run(`columnMap.${first}`)}, -1)`), null);
  assert.strictEqual(a.run(`moveTarget(${a.run(`columnMap.${last}`)}, 1)`), null);
  // Leave out -> Ignored, with an honest GA4 method
  const c0 = a.run(`columnMap.${first}`);
  on(a, 'editor-thead', 'click', '[data-to]', { to: 'ignore', col: String(c0) });
  assert.strictEqual(a.field(c0), 'ignore', `${rt}: Leave out`);
  assert.deepStrictEqual(a.named('column_remapped').pop(), { return_type: rt, field: 'ignore', method: 'button' });
  // the Ignored chip: a "Use column" menu of the empty CRA columns (mandatory first), no select
  const ign = a.ign();
  assert(new RegExp(`<details class="ed-place"><summary data-col="${c0}" aria-label="Use column ${a.run(`colLetter(${c0})`)} \\(${rows[0][c0]}\\): pick a CRA column">Use column</summary>`).test(ign), `${rt}: Use column menu: ${ign}`);
  const menu = ign.match(new RegExp(`<summary data-col="${c0}"[\\s\\S]*?</details>`))[0];
  const offered = [...menu.matchAll(/data-to="(\w+)"/g)].map(x => x[1]).filter(k => k !== 'full_name');
  const empty = slots.filter(f => a.run(`columnMap.${f}`) < 0);
  const req = new Set(JSON.parse(JSON.stringify(a.run('getReturnConfig().fields.filter(f => f.required).map(f => f.key)'))));
  assert.deepStrictEqual(offered, [...empty.filter(f => req.has(f)), ...empty.filter(f => !req.has(f))], `${rt}: empty CRA columns, mandatory first`);
  assert.strictEqual(/data-to="full_name"/.test(menu), rt === 'T4', `${rt}: full name only on T4`);
  // ... and back
  on(a, 'editor-ignored', 'click', '[data-to]', { to: first, col: String(c0) });
  assert.strictEqual(a.field(c0), first, `${rt}: Use column puts it back`);
  assert.deepStrictEqual(a.named('column_remapped').pop(), { return_type: rt, field: first, method: 'button' });
  // keyboard moves are unchanged
  a.el('editor-thead').dispatchEvent({ type: 'click', target: { closest: s => (s === '[data-move]' ? { dataset: { move: '1', col: String(c0) } } : null) } });
  assert.strictEqual(a.field(c0), slots[1], `${rt}: → moves to the next CRA column`);
  assert.deepStrictEqual(a.named('column_remapped').pop().method, 'keyboard');
}

// ---- "Use column" when every CRA column is taken: offers them all, says which column it replaces, which goes to Ignored ----
{
  const a = app('T5018', [['Recipient Name', 'Recipient BN', 'Recipient Type', 'Address', 'Amount Paid', 'Notes'], ['A', '123456789RZ0001', 'corp', '1 Main', '1', 'x']]);
  assert.strictEqual(a.field(5), 'ignore');
  const slots = JSON.parse(JSON.stringify(a.run('editorSlots()')));
  assert(slots.every(f => a.run(`columnMap.${f}`) >= 0), 'all taken');
  const menu = a.ign().match(/<summary data-col="5"[\s\S]*?<\/details>/)[0];
  assert.deepStrictEqual([...menu.matchAll(/data-to="(\w+)"/g)].map(x => x[1]), slots, 'all CRA columns, in CRA order');
  assert(/data-to="rcpnt_type" data-col="5">Recipient Type \(replaces column C\)</.test(menu), menu);
  on(a, 'editor-ignored', 'click', '[data-to]', { to: 'rcpnt_type', col: '5' });
  assert.deepStrictEqual([2, 5].map(a.field), ['ignore', 'rcpnt_type'], 'the column that was there goes to Ignored');
  // moveColumn on an ignored column: nothing, as before
  a.run('moveColumn(2, 1); moveColumn(2, -1)');
  assert.strictEqual(a.field(2), 'ignore');
  // drag out of Ignored still works
  a.run(`dropOnSlot(2, 'address', 'drag')`);
  assert.deepStrictEqual([2, 3].map(a.field), ['address', 'ignore']);
}

// ---- landing indicator: hover / focus on ← → outlines the CRA column it moves to and says "Moves to: <label>" ----
{
  const a = app('T4', FILES.T4);
  assert.strictEqual(a.field(1), 'empe_gvn_nm');
  for (const [enter, leave] of [['focusin', 'focusout'], ['mouseover', 'mouseout']]) {
    on(a, 'editor-thead', enter, '[data-move]', { move: '1', col: '1' });
    assert.strictEqual(a.landing(), `Moves to: ${label(a, 'address')}`, enter);
    assert.deepStrictEqual(a.marked('is-landing'), ['address'], `${enter}: both header cells of the next CRA column`);
    on(a, 'editor-thead', leave, '[data-move]', { move: '1', col: '1' });
    assert.strictEqual(a.landing(), '', leave);
    assert.deepStrictEqual(a.marked('is-landing'), [], `${leave} clears it`);
    on(a, 'editor-thead', enter, '[data-move]', { move: '-1', col: '1' });
    assert.strictEqual(a.landing(), `Moves to: ${label(a, 'empe_snm')}`);
    assert.deepStrictEqual(a.marked('is-landing'), ['empe_snm']);
    on(a, 'editor-thead', leave, '[data-move]', { move: '-1', col: '1' });
  }
  // an arrow that can't move shows no target
  on(a, 'editor-thead', 'focusin', '[data-move]', { move: '-1', col: '0' });
  assert.strictEqual(a.landing(), '');
  assert.deepStrictEqual(a.marked('is-landing'), []);
  // the "Use column" and "Leave out" buttons show where they put the column too
  on(a, 'editor-ignored', 'focusin', '[data-to]', { to: 'cpp_cntrb_amt', col: '4' });
  assert.strictEqual(a.landing(), `Moves to: ${label(a, 'cpp_cntrb_amt')}`);
  on(a, 'editor-thead', 'mouseover', '[data-to]', { to: 'ignore', col: '2' });
  assert.strictEqual(a.landing(), 'Moves to: Ignored columns');
  assert(a.el('editor-ignored').classList.contains('is-landing'), 'the Ignored area is outlined');
  assert.deepStrictEqual(a.marked('is-landing'), []);
  on(a, 'editor-thead', 'mouseout', '[data-to]', { to: 'ignore', col: '2' });
  assert(!a.el('editor-ignored').classList.contains('is-landing'));
  // Enter / click moves it; the destination flashes; the old marker is gone after the re-render
  on(a, 'editor-thead', 'focusin', '[data-move]', { move: '1', col: '1' });
  a.el('editor-thead').dispatchEvent({ type: 'click', target: { closest: s => (s === '[data-move]' ? { dataset: { move: '1', col: '1' } } : null) } });
  assert.strictEqual(a.field(1), 'address');
  assert(a.marked('is-landed').includes('address'), 'the CRA column it landed on flashes');
  assert.strictEqual(a.landing(), '', 'cleared once the move is done');
  // the screen-reader text: the destination is in the arrow's accessible name
  assert(/data-move="1" data-col="1" aria-label="Move column B \(First Name\) to the next CRA column\. Moves to: Province of Employment \(Box 10\)"/.test(a.head()), a.head());
}

// ---- drag: a drop marker on the CRA column or Ignored area under the pointer; drop still remaps (method 'drag') ----
{
  const a = app('T4', FILES.T4);
  const store = {};
  const dt = { setData: (k, v) => { store[k] = v; }, getData: k => store[k], effectAllowed: '', dropEffect: '' };
  const ev = (type, sel, data) => ({ type, dataTransfer: dt, preventDefault() {}, target: { closest: s => (s === sel ? { dataset: data } : null) } });
  a.el('editor-thead').dispatchEvent({ type: 'dragstart', dataTransfer: dt, target: { closest: s => (s === '[data-drag]' ? { dataset: { drag: '4' } } : null) } });
  a.el('editor-ignored').dispatchEvent(ev('dragover', '[data-slot]', { slot: 'unn_dues_amt' }));
  assert.strictEqual(a.landing(), `Moves to: ${label(a, 'unn_dues_amt')}`);
  assert.deepStrictEqual(a.marked('is-landing'), ['unn_dues_amt']);
  a.el('editor-thead').dispatchEvent(ev('dragleave', '[data-slot]', { slot: 'unn_dues_amt' }));
  assert.deepStrictEqual(a.marked('is-landing'), [], 'dragleave clears it');
  a.el('editor-thead').dispatchEvent(ev('dragover', '[data-slot]', { slot: 'sin' }));
  assert.deepStrictEqual(a.marked('is-landing'), ['sin']);
  a.el('editor-thead').dispatchEvent(ev('drop', '[data-slot]', { slot: 'sin' }));
  assert.deepStrictEqual(a.marked('is-landing'), [], 'drop clears it');
  assert.strictEqual(a.landing(), '');
  assert.deepStrictEqual([2, 4].map(a.field), ['ignore', 'sin']);
  assert.deepStrictEqual(a.named('column_remapped').pop(), { return_type: 'T4', field: 'sin', method: 'drag' });
  a.el('editor-thead').dispatchEvent({ type: 'dragstart', dataTransfer: dt, target: { closest: s => (s === '[data-drag]' ? { dataset: { drag: '4' } } : null) } });
  a.el('editor-ignored').dispatchEvent(ev('dragover', '[data-drop]', { drop: 'ignore' }));
  assert.strictEqual(a.landing(), 'Moves to: Ignored columns');
  assert(a.el('editor-ignored').classList.contains('is-landing'));
  a.el('editor-ignored').dispatchEvent({ type: 'dragend' });
  assert.strictEqual(a.landing(), '', 'dragend (cancelled drag) clears it');
  assert(!a.el('editor-ignored').classList.contains('is-landing'));
  assert.strictEqual(a.field(4), 'sin', 'a cancelled drag moves nothing');
}

// ---- T4 full name: the Ignored "Use column" menu has it too, and the XML is the same as before ----
{
  const a = app('T4', [['Employee Name', 'SIN', 'Box 14 - Employment Income', 'Full'], ['John Q Doe', '046454286', '100', 'Jane Roe']]);
  on(a, 'editor-ignored', 'click', '[data-to]', { to: 'full_name', col: '3' });
  assert.strictEqual(a.field(3), 'full_name');
  assert.strictEqual(a.field(0), 'ignore', 'the name column that was there goes to Ignored');
  on(a, 'editor-thead', 'click', '[data-to]', { to: 'empe_snm', col: '3' }); // Last name only
  assert.deepStrictEqual([a.field(3), a.run('columnMap.empe_gvn_nm')], ['empe_snm', -1]);
  a.run(`remapColumn(3, 'full_name', 'button')`);
  a.setDetails();
  const xml = a.generate();
  assert(xml.includes('<snm>Roe</snm>') && xml.includes('<gvn_nm>Jane</gvn_nm>'), xml || a.errors());
  assert.deepStrictEqual(a.named('column_remapped').map(p => p.field), ['full_name', 'empe_snm', 'full_name']);
}

// ---- CSS: arrows are a 32px tap target (44px on touch screens); landing marker styles; old dropdown rules gone ----
{
  const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
  const rule = sel => (css.match(new RegExp(`(^|\\n)${sel.replace(/[.#()]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[2] || '';
  assert(/min-width: 32px/.test(rule('.ed-arrow')) && /min-height: 32px/.test(rule('.ed-arrow')), '.ed-arrow: ' + rule('.ed-arrow'));
  const coarse = css.match(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/)[1];
  assert(/\.ed-arrow[^{]*\{[^}]*min-height: 44px; min-width: 44px/.test(coarse), coarse);
  assert(/\.is-landing/.test(css) && /\.is-landed/.test(css), 'landing marker styles');
  assert(!css.includes('.ed-move-to') && !css.includes('.ed-move '), 'dead dropdown / old arrow rules are gone');
}

// ---- copy: no "Move to CRA column" dropdown anywhere; arrows, drag and the buttons are explained ----
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const step2 = html.slice(html.indexOf('id="step-2"'), html.indexOf('id="step-3"'));
  assert(!/Move to CRA column/.test(html + js));
  assert(!/dropdown/i.test(step2), 'Step 2 copy no longer mentions a dropdown');
  assert(/←/.test(step2) && /drag/i.test(step2) && /Leave out/.test(step2) && /Use column/.test(step2), step2);
  assert(/<p id="editor-landing" class="ed-landing"><\/p>/.test(step2), 'the visible "Moves to" line');
  const a = app('T4', [['Unrelated'], ['x']]);
  a.run('checkRequiredColumns()');
  const help = a.el('editor-errors').innerHTML;
  assert(!/dropdown/i.test(help) && /Use column/.test(help) && /←/.test(help), help);
  assert(!/dropdown/i.test(a.ign()), a.ign());
}

// ---- no browser save-name / save-address / autofill prompts: Step 3 inputs and the Step 2 cells ----
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert(!/<form\b/i.test(html), 'no <form> for browsers to treat as an address or login form');
  assert(!/autocomplete="(tel|email|name|given-name|family-name|street-address|address-line1|postal-code|address-level\d|organization|on)"/.test(html), 'no autofill tokens');
  const step3 = html.slice(html.indexOf('id="step-3"'), html.indexOf('id="step-4"'));
  const PERSONAL = ['tx-name', 'tx-contact', 'tx-phone', 'tx-email', 'py-name', 'py-addr', 'py-city', 'py-prov', 'py-postal', 'py-contact', 'py-phone'];
  const names = new Set();
  for (const id of PERSONAL) {
    const tag = step3.match(new RegExp(`<(input|select)\\b[^>]*\\bid="${id}"[^>]*>`));
    assert(tag, id);
    assert(/\bautocomplete="off"/.test(tag[0]), `${id}: autocomplete="off": ${tag[0]}`);
    const name = (tag[0].match(/\bname="([^"]+)"/) || [])[1];
    assert(name, `${id}: has a neutral name, so the browser doesn't fall back to the id (tx-name, tx-email...)`);
    assert(!/name|mail|phone|tel|addr|city|postal|zip|contact|org|company/i.test(name), `${id}: name="${name}" looks like an autofill field`);
    assert(!names.has(name), `${id}: name is unique`);
    names.add(name);
    assert(!/type="email"|type="tel"/.test(tag[0]), `${id}: plain text input, not an autofill-typed one`);
  }
  for (const tag of step3.match(/<input\b[^>]*type="text"[^>]*>/g)) assert(/autocomplete="off"/.test(tag), `every text field in Step 3 is autocomplete="off": ${tag}`);
  // Step 2: cells are plain table cells with no name; the code-cell select doesn't autofill either
  const a = app('T4', [['Last Name', 'First Name', 'SIN', 'Box 14 - Employment Income', 'Province'], ['Doe', 'John', '046454286', '100', 'ON']]);
  assert(!/\bname=/.test(a.el('editor-tbody').innerHTML + a.head() + a.ign()), 'no form-like names in the editor');
  const sel = a.run(`cellEditor(0, 4)`);
  assert(/^<select class="ed-cell-select" autocomplete="off"/.test(sel), 'province cell editor: ' + sel);
  // Step 3 fields are still read by id
  a.setDetails();
  assert(a.generate().includes('<l1_nm>Test Transmitter Inc</l1_nm>'), a.errors());
}
console.log('table-editor-arrows.test.js: all passed');
