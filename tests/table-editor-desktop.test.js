// Step 2 table, desktop first: compact header (chip + "⋯" column menu, arrows on hover), empty optional columns
// collapsed, keyboard moves on the chip, "Next problem", undo row delete, type-to-edit and TSV paste. Touch keeps
// the 44px ← → and Leave out. XML stays byte-identical.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createApp, fileToXML, ROOT } = require('./harness');

const csv = rows => Buffer.from(rows.map(r => r.join(',')).join('\r\n') + '\r\n');
function app(returnType, rows, opts = {}) {
  const events = [];
  const a = createApp({ returnType, gtag: (cmd, name, params) => events.push([name, JSON.parse(JSON.stringify(params))]), ...opts });
  a.events = events;
  a.named = n => events.filter(e => e[0] === n).map(e => e[1]);
  a.field = c => a.run(`columnField(${c})`);
  a.head = () => a.el('editor-thead').innerHTML;
  a.ign = () => a.el('editor-ignored').innerHTML;
  a.slots = () => JSON.parse(JSON.stringify(a.run('editorSlots()')));
  if (rows) a.loadFile('x.csv', Buffer.isBuffer(rows) ? rows : csv(rows));
  return a;
}
const target = (sel, dataset, extra = {}) => ({ closest: s => (s === sel ? { dataset, ...extra } : null) });
const onTd = td => ({ closest: s => (s === 'td[data-f]' ? td : null) });
const key = (k, mods = {}, t = target('[data-drag]', {})) => ({ type: 'keydown', key: k, ...mods, target: t, preventDefault() { this.prevented = true; } });
const slotCell = (head, f, row) => {
  const re = new RegExp(`<th scope="col" class="${row === 'cra' ? 'ed-cra' : 'ed-slot'}[^"]*" data-slot="${f}"[^>]*>([\\s\\S]*?)</th>`);
  return head.match(re);
};

// T4: last name, first name, income placed; SIN (mandatory) and the other optional CRA columns empty
const T4 = [['Last Name', 'First Name', 'Box 14 - Employment Income', 'Notes'], ['Doe', 'John', '100', 'x'], ['Roe', 'Jane', '200', 'y']];

// ---- 1. header markup: one chip per filled slot (grip, name, ← →, "⋯" menu); Leave out / full name only in the menu ----
{
  const a = app('T4', T4);
  const head = a.head();
  for (const f of a.slots()) {
    const c = a.run(`columnMap.${f}`);
    if (c < 0) continue;
    const cell = slotCell(head, f, 'slot')[1];
    assert.strictEqual((cell.match(/class="ed-chip"/g) || []).length, 1, `${f}: one chip: ${cell}`);
    assert(/<span class="ed-grip"[^>]*>⠿<\/span>/.test(cell), `${f}: grip`);
    assert(new RegExp(`<button type="button" class="ed-arrow" data-move="-1" data-col="${c}"`).test(cell), `${f}: ← keeps data-move / data-col`);
    assert(new RegExp(`<button type="button" class="ed-arrow" data-move="1" data-col="${c}"`).test(cell), `${f}: →`);
    const btn = cell.match(new RegExp(`<button type="button" class="ed-menu-btn" data-menu-btn="${c}" aria-expanded="false" aria-label="([^"]+)">⋯</button>`));
    assert(btn && /Column menu/.test(btn[1]), `${f}: "⋯" menu button with an aria-label: ${cell}`);
    const menu = cell.match(/<span class="ed-menu-list">([\s\S]*?)<\/span>/);
    assert(menu, `${f}: menu list: ${cell}`);
    assert(/>Move left<\/button>/.test(menu[1]) && />Move right<\/button>/.test(menu[1]), `${f}: Move left / right in the menu`);
    assert(new RegExp(`data-to="ignore" data-col="${c}"[^>]*>Leave out</button>`).test(menu[1]), `${f}: Leave out in the menu`);
    assert.strictEqual(/>Use as full name</.test(menu[1]), ['empe_snm', 'empe_gvn_nm'].includes(f), `${f}: full name only on the T4 name columns`);
    const outside = cell.replace(menu[0], '');
    assert(!/Leave out|Use as full name/.test(outside), `${f}: no Leave out / full name outside the menu: ${outside}`);
    // the CRA label: one line of text, red * + "Mandatory" text (kept for screen readers), long name in its title
    const cra = slotCell(head, f, 'cra')[1];
    assert(/<span class="ed-cra-label" title="[^"]+"[^>]*>/.test(cra), `${f}: label title: ${cra}`);
  }
}

// ---- 2. empty optional CRA columns collapse; empty mandatory ones never do; "Show empty columns (n)" expands all ----
{
  const a = app('T4', T4);
  const head = a.head();
  const req = new Set(JSON.parse(JSON.stringify(a.run('getReturnConfig().fields.filter(f => f.required).map(f => f.key)'))));
  const empty = a.slots().filter(f => a.run(`columnMap.${f}`) < 0);
  const emptyOptional = empty.filter(f => !req.has(f));
  assert(empty.includes('sin') && emptyOptional.length >= 8, empty.join());
  for (const f of a.slots()) {
    for (const row of ['cra', 'slot']) {
      const th = slotCell(head, f, row)[0];
      assert.strictEqual(/\bis-collapsed\b/.test(th), emptyOptional.includes(f), `${f} ${row}: collapsed iff empty and optional: ${th}`);
    }
  }
  // a collapsed strip says what it is, and "+" opens it
  const label = a.run(`getReturnConfig().fields.find(x => x.key === 'empt_prov_cd').label`);
  const prov = slotCell(head, 'empt_prov_cd', 'cra')[1];
  assert(new RegExp(`<button type="button" class="ed-expand" data-expand="empt_prov_cd" title="${label.replace(/[()]/g, '\\$&')}: no column, optional"`).test(prov), prov);
  a.el('editor-thead').dispatchEvent({ type: 'click', target: target('[data-expand]', { expand: 'empt_prov_cd' }) });
  assert(!/\bis-collapsed\b/.test(slotCell(a.head(), 'empt_prov_cd', 'slot')[0]), 'clicking the strip opens that column');
  assert(/\bis-collapsed\b/.test(slotCell(a.head(), 'address', 'slot')[0]), 'the others stay collapsed');
  // the toolbar toggle shows the count and opens them all
  assert.strictEqual(a.el('editor-empty-count').textContent, String(emptyOptional.length));
  a.el('editor-show-empty').checked = true;
  a.el('editor-show-empty').dispatchEvent({ type: 'change', target: a.el('editor-show-empty') });
  assert(!/\bis-collapsed\b/.test(a.head()), 'all empty columns shown');
  a.el('editor-show-empty').checked = false;
  a.el('editor-show-empty').dispatchEvent({ type: 'change', target: a.el('editor-show-empty') });
  assert(/\bis-collapsed\b/.test(slotCell(a.head(), 'address', 'slot')[0]), 'and collapsed again');
  // a column dragged over a collapsed strip opens it (the drop target stays live)
  a.run('expandedSlots.clear(); renderEditorHead()');
  const store = {};
  const dt = { setData: (k, v) => { store[k] = v; }, getData: k => store[k] };
  a.el('editor-thead').dispatchEvent({ type: 'dragstart', dataTransfer: dt, target: target('[data-drag]', { drag: '3' }) });
  a.el('editor-thead').dispatchEvent({ type: 'dragover', dataTransfer: dt, preventDefault() {}, target: target('[data-slot]', { slot: 'unn_dues_amt' }) });
  assert(a.run(`expandedSlots.has('unn_dues_amt')`), 'dragover expands the strip');
  a.el('editor-thead').dispatchEvent({ type: 'drop', dataTransfer: dt, preventDefault() {}, target: target('[data-slot]', { slot: 'unn_dues_amt' }) });
  assert.strictEqual(a.field(3), 'unn_dues_amt', 'dropped on a strip');
  assert.strictEqual(a.el('editor-empty-count').textContent, String(emptyOptional.length - 1), 'count follows');
}

// ---- 3. column menu: "⋯" opens it, Escape and an outside click close it; Leave out from the menu ----
{
  const a = app('T4', T4);
  const open = c => a.el('editor-thead').dispatchEvent({ type: 'click', target: target('[data-menu-btn]', { menuBtn: String(c) }) });
  open(1);
  assert.strictEqual(a.run('menuCol'), 1, 'open');
  open(1);
  assert.strictEqual(a.run('menuCol'), null, 'the button toggles it');
  open(1);
  a.docEvent({ type: 'keydown', key: 'Escape', target: { closest: () => null } });
  assert.strictEqual(a.run('menuCol'), null, 'Escape closes');
  open(1);
  a.docEvent({ type: 'click', target: { closest: () => null } });
  assert.strictEqual(a.run('menuCol'), null, 'a click outside closes');
  open(1);
  a.docEvent({ type: 'click', target: { closest: s => (s === '.ed-menu' ? {} : null) } });
  assert.strictEqual(a.run('menuCol'), 1, 'a click inside the menu does not');
  a.el('editor-thead').dispatchEvent({ type: 'click', target: target('[data-to]', { to: 'ignore', col: '1' }) });
  assert.strictEqual(a.field(1), 'ignore');
  assert.strictEqual(a.run('menuCol'), null, 'closed after an action');
  assert.deepStrictEqual(a.named('column_remapped').pop(), { return_type: 'T4', field: 'ignore', method: 'button' });
  // the Ignored "Use column" menu (<details>) closes on Escape and outside click too
  const det = { open: true, contains: () => false };
  a.run('document').querySelectorAll = sel => (/details\.ed-place\[open\]/.test(sel) ? [det] : []);
  a.docEvent({ type: 'keydown', key: 'Escape', target: { closest: () => null } });
  assert.strictEqual(det.open, false, 'Use column menu: Escape');
  det.open = true;
  a.docEvent({ type: 'click', target: { closest: () => null } });
  assert.strictEqual(det.open, false, 'Use column menu: outside click');
}

// ---- 4. keyboard on a focused chip: Alt+→ / Alt+← move it (method keyboard), Delete / Backspace leave it out ----
{
  const a = app('T4', T4);
  const thead = a.el('editor-thead');
  const chip = c => target('[data-drag]', { drag: String(c) });
  const before = a.run('moveTarget(1, 1)');
  const e = key('ArrowRight', { altKey: true }, chip(1));
  thead.dispatchEvent(e);
  assert.strictEqual(a.field(1), before, 'Alt+→ = moveColumn(c, 1)');
  assert(e.prevented, 'the page does not scroll / go back');
  assert.deepStrictEqual(a.named('column_remapped').pop(), { return_type: 'T4', field: before, method: 'keyboard' });
  thead.dispatchEvent(key('ArrowLeft', { altKey: true }, chip(1)));
  assert.strictEqual(a.field(1), 'empe_gvn_nm', 'Alt+← moves it back');
  thead.dispatchEvent(key('ArrowRight', {}, chip(1)));
  assert.strictEqual(a.field(1), 'empe_gvn_nm', 'a plain arrow does not move it');
  thead.dispatchEvent(key('Delete', {}, chip(1)));
  assert.strictEqual(a.field(1), 'ignore', 'Delete leaves it out');
  assert.deepStrictEqual(a.named('column_remapped').pop(), { return_type: 'T4', field: 'ignore', method: 'keyboard' });
  thead.dispatchEvent(key('Backspace', {}, chip(0)));
  assert.strictEqual(a.field(0), 'ignore', 'Backspace too');
  // documented in the help popover
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const help = html.match(/<div id="editor-help"[^>]*>([\s\S]*?)<\/div>/);
  assert(help && /Alt/.test(help[1]) && /Delete/.test(help[1]) && /F8/.test(help[1]) && /Ctrl/.test(help[1]), 'help lists the keys: ' + (help && help[1]));
}

// ---- 5. Next problem: error 1, error 2, wrap; across pages; F8 / Shift+F8 in the table ----
{
  const rows = [['Last Name', 'SIN', 'Box 14 - Employment Income']];
  for (let i = 0; i < 450; i++) rows.push(['Doe', i === 5 || i === 300 ? '123' : '046454286', '100']);
  const a = app('T4', rows);
  assert.strictEqual(a.run('EDITOR_PAGE'), 200);
  const next = d => JSON.parse(JSON.stringify(a.run(`nextProblem(${d})`)));
  assert.deepStrictEqual(next(1), [5, 'sin']);
  assert.strictEqual(a.run('editorPage'), 0);
  assert.deepStrictEqual(next(1), [300, 'sin']);
  assert.strictEqual(a.run('editorPage'), 1, 'switched page');
  assert.deepStrictEqual(next(1), [5, 'sin'], 'wraps');
  assert.strictEqual(a.run('editorPage'), 0);
  assert.deepStrictEqual(next(-1), [300, 'sin'], 'previous wraps backwards');
  const td = (r, f) => ({ dataset: { r: String(r), f, c: '1' }, parentElement: {} });
  a.el('editor-tbody').dispatchEvent(key('F8', {}, onTd(td(300, 'sin'))));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.run('problemAt'))), [5, 'sin'], 'F8');
  a.el('editor-tbody').dispatchEvent(key('F8', { shiftKey: true }, onTd(td(5, 'sin'))));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.run('problemAt'))), [300, 'sin'], 'Shift+F8');
  // status bar: short counts; the button is there
  assert(/^2 errors · 0 warnings/.test(a.el('editor-status').textContent), a.el('editor-status').textContent);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert(/<button type="button"[^>]*id="editor-next"[^>]*onclick="nextProblem\(1\)"[^>]*>Next problem ▸<\/button>/.test(html), 'Next problem button');
  const b = app('T4', [['Last Name', 'SIN', 'Box 14 - Employment Income'], ['Doe', '046454286', '100']]);
  assert.strictEqual(b.run('nextProblem(1)'), null, 'no problems: nothing');
  assert.strictEqual(b.el('editor-next').disabled, true, 'and the button is disabled');
}

// ---- 6. undo a row delete: same row, same place; toast with Undo; Ctrl/Cmd+Z ----
{
  const a = app('T4', [['Last Name', 'SIN', 'Box 14 - Employment Income'], ['A', '046454286', '1'], ['B', '046454286', '2'], ['C', '046454286', '3']]);
  const orig = JSON.parse(JSON.stringify(a.run('parsedData')));
  a.run('deleteRow(1)');
  assert.strictEqual(a.run('parsedData.length'), 2);
  const toast = a.el('editor-toast');
  assert(!toast.classList.contains('hidden') && /Row 3 deleted/.test(toast.innerHTML) && /onclick="undoDelete\(\)"[^>]*>Undo</.test(toast.innerHTML), toast.innerHTML);
  a.run('undoDelete()');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.run('parsedData'))), orig, 'restored at the same index');
  assert(toast.classList.contains('hidden'), 'toast gone');
  a.run('undoDelete()');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.run('parsedData'))), orig, 'a second undo does nothing');
  a.run('deleteRow(0)');
  a.docEvent({ type: 'keydown', key: 'z', ctrlKey: true, target: { tagName: 'TD', closest: () => null }, preventDefault() {} });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.run('parsedData'))), orig, 'Ctrl+Z');
  a.run('deleteRow(2)');
  a.docEvent({ type: 'keydown', key: 'z', ctrlKey: true, target: { tagName: 'INPUT', closest: () => null }, preventDefault() {} });
  assert.strictEqual(a.run('parsedData.length'), 2, 'Ctrl+Z in a text field is that field\'s own undo');
  a.docEvent({ type: 'keydown', key: 'z', metaKey: true, target: { tagName: 'BODY', closest: () => null }, preventDefault() {} });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.run('parsedData'))), orig, 'Cmd+Z');
}

// ---- 7. CSS contract: touch keeps 44px visible arrows and Leave out; fine pointer shows arrows on hover / focus ----
{
  const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
  const block = q => (css.match(new RegExp(`@media \\(pointer: ${q}\\) \\{([\\s\\S]*?)\\n\\}`)) || [])[1] || '';
  const coarse = block('coarse'), fine = block('fine');
  assert(/\.ed-arrow[^{]*\{[^}]*min-height: 44px; min-width: 44px/.test(coarse), coarse);
  assert(/\.ed-arrow[^{]*\{[^}]*opacity: 1/.test(coarse), 'touch: arrows always visible');
  assert(/\.ed-menu-list[^{]*\{[^}]*visibility: visible/.test(coarse), 'touch: Leave out (the menu items) always visible');
  assert(fine, 'a (pointer: fine) block');
  assert(/\.ed-arrow[^{]*\{[^}]*opacity: 0/.test(fine), 'fine: arrows hidden with opacity: ' + fine);
  assert(/th:hover \.ed-arrow/.test(fine) && /:focus-within \.ed-arrow/.test(fine), 'fine: shown on th:hover / :focus-within');
  for (const m of fine.matchAll(/([^{}]*\.ed-arrow[^{}]*)\{([^}]*)\}/g)) assert(!/display: none/.test(m[2]), `arrows stay in the tab order: ${m[0]}`);
  for (const m of css.matchAll(/([^{}]*\.ed-chip-name[^{}]*)\{([^}]*)\}/g)) assert(!/overflow-wrap: (break-word|anywhere)|word-break: break-all/.test(m[2]), `no mid-word breaks: ${m[0]}`);
  assert(/\.is-collapsed/.test(fine), 'collapsed strips only on a fine pointer');
  assert(!/\.ed-table thead th\.ed-slot \{[^}]*min-width: 10rem/.test(css), 'no fixed 160px slot width');
  assert(/prefers-reduced-motion/.test(css));
}

// ---- G. spreadsheet feel: a printable key starts editing with that key; a TSV paste fills right / down ----
{
  const a = app('T4', [['Last Name', 'First Name', 'SIN', 'Box 14 - Employment Income'], ['A', 'a', '046454286', '1'], ['B', 'b', '046454286', '2'], ['C', 'c', '046454286', '3']]);
  a.run('document').createRange = () => ({ selectNodeContents() {}, collapse() {} });
  a.ctx.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
  const td = { dataset: { r: '0', c: '0', f: 'empe_snm' }, focus() {}, removeAttribute() {}, set textContent(v) { this.text = v; }, get textContent() { return this.text; } };
  a.el('editor-tbody').dispatchEvent(key('x', {}, onTd(td)));
  assert.strictEqual(td.text, 'x', 'typing starts an edit with that key');
  assert.strictEqual(JSON.parse(JSON.stringify(a.run('editing ? [editing.r, editing.c] : null'))).join(), '0,0');
  a.run('stopEdit(true)');
  assert.strictEqual(a.run('parsedData[0][0]'), 'x');
  const ctrl = { dataset: { r: '0', c: '0', f: 'empe_snm' }, focus() {}, parentElement: { querySelectorAll: () => [] } };
  a.el('editor-tbody').dispatchEvent(key('c', { ctrlKey: true }, onTd(ctrl)));
  assert.strictEqual(a.run('editing'), null, 'Ctrl+C is not typing');
  a.events.length = 0;
  // paste a 2x3 block at (row 1, Last Name): fills Last Name / First Name / Address(no column: skipped) ... down 2 rows
  const n = a.run(`pasteCells(1, 'empe_snm', 'P\\tp\\tskip\\nQ\\tq\\tskip\\nR\\tr\\tskip\\n')`);
  assert.strictEqual(n, 4, 'cells changed: 2 rows x 2 placed columns; the 3rd pasted row is past the end');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.run('parsedData.map(r => r.slice(0, 2))'))), [['x', 'a'], ['P', 'p'], ['Q', 'q']]);
  assert.deepStrictEqual(a.named('cell_edited'), [{ return_type: 'T4', field: 'empe_snm' }], 'one cell_edited per paste (first field)');
  // the paste event on a focused cell (not while editing a cell)
  let prevented = false;
  a.el('editor-tbody').dispatchEvent({ type: 'paste', preventDefault() { prevented = true; }, clipboardData: { getData: () => 'Z' },
    target: onTd({ dataset: { r: '2', c: '0', f: 'empe_snm' } }) });
  assert(prevented && a.run('parsedData[2][0]') === 'Z', 'paste event');
}

// ---- E. error tooltip: a styled role="tooltip" on hover / focus of a red or amber cell ----
{
  const a = app('T4', [['Last Name', 'SIN', 'Box 14 - Employment Income'], ['Doe', '123', '100']]);
  const msg = a.run(`cellState(0, 'sin').msg`);
  assert(msg);
  const td = { dataset: { r: '0', f: 'sin', c: '1' }, getAttribute: k => (k === 'aria-describedby' ? 'ed-msg-0-sin' : null), getBoundingClientRect: () => ({ left: 10, bottom: 20, top: 5 }) };
  const tip = a.el('editor-tip');
  a.el('editor-tbody').dispatchEvent({ type: 'mouseover', target: onTd(td) });
  assert.strictEqual(tip.textContent, msg);
  assert.strictEqual(tip.hidden, false);
  a.el('editor-tbody').dispatchEvent({ type: 'mouseout', target: onTd(td) });
  assert.strictEqual(tip.hidden, true);
  a.el('editor-tbody').dispatchEvent({ type: 'focusin', target: onTd(td) });
  assert.strictEqual(tip.hidden, false, 'focus shows it too');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert(/<div id="editor-tip" class="ed-tip" role="tooltip" hidden><\/div>/.test(html), 'tooltip element');
  assert(/title="/.test(a.el('editor-tbody').innerHTML), 'title stays as a fallback');
}

// ---- D. less chrome: one-line intro + "How this works"; one tool bar; help popover; Ignored tray toggle ----
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const step2 = html.slice(html.indexOf('id="step-2"'), html.indexOf('id="step-3"'));
  assert(/<p class="ed-intro">Check each column and fix red cells\. Drag a column name to move it\.<\/p>/.test(step2), step2);
  assert(/<details class="ed-how"><summary>How this works<\/summary>/.test(step2));
  assert(/<details class="ed-help"><summary>Keyboard &amp; help \?<\/summary>/.test(step2));
  const tools = step2.match(/<div class="ed-tools">([\s\S]*?)\n {8}<\/div>/)[1];
  for (const id of ['editor-status', 'editor-next', 'editor-only-problems', 'editor-show-empty', 'editor-landing']) assert(tools.includes(`id="${id}"`), `${id} in the one tool bar`);
  assert(/addRow\(\)/.test(tools), '+ Add row in the bar');
  assert(/<div class="ed-main">\s*<div class="ed-wrap">[\s\S]*?<\/table>\s*<\/div>\s*<div id="editor-ignored"/.test(step2), 'Ignored tray beside the table');
  const a = app('T4', T4);
  assert(/<button type="button" class="ed-tray-btn" aria-expanded="false" title="[^"]+">Ignored columns \(1\)<\/button>/.test(a.ign()), a.ign());
  assert(!/ed-hint/.test(a.ign()), 'the hint moved into the title');
  a.run('toggleIgnored()');
  assert(a.el('editor-ignored').classList.contains('is-open') && /aria-expanded="true"/.test(a.ign()));
}

// ---- 8. golden: drag remap, keyboard move back, cell edit + revert, delete + undo, paste of the same values ----
{
  const DIR = path.join(__dirname, 'fixtures');
  const bytes = fs.readFileSync(path.join(DIR, 'T4_input.csv'));
  const { xml: untouched } = fileToXML('T4', 'T4_input.csv', bytes, undefined, { now: '2026-11-15T10:00' });
  assert.strictEqual(untouched, fs.readFileSync(path.join(DIR, 'T4_input.golden.xml'), 'utf8'));
  const a = app('T4', null, { now: '2026-11-15T10:00' });
  a.loadFile('T4_input.csv', bytes);
  const slots = a.slots();
  const i = slots.findIndex((f, k) => a.run(`columnMap.${f}`) >= 0 && a.run(`columnMap.${slots[k + 1]}`) >= 0);
  const [c0, c1] = [a.run(`columnMap.${slots[i]}`), a.run(`columnMap.${slots[i + 1]}`)];
  const store = {};
  const dt = { setData: (k, v) => { store[k] = v; }, getData: k => store[k] };
  a.el('editor-thead').dispatchEvent({ type: 'dragstart', dataTransfer: dt, target: target('[data-drag]', { drag: String(c0) }) });
  a.el('editor-thead').dispatchEvent({ type: 'drop', dataTransfer: dt, preventDefault() {}, target: target('[data-slot]', { slot: slots[i + 1] }) });
  assert.deepStrictEqual([a.field(c0), a.field(c1)], [slots[i + 1], slots[i]], 'drag swapped them');
  a.el('editor-thead').dispatchEvent(key('ArrowLeft', { altKey: true }, target('[data-drag]', { drag: String(c0) })));
  assert.deepStrictEqual([a.field(c0), a.field(c1)], [slots[i], slots[i + 1]], 'Alt+← swapped them back');
  const orig = a.run(`parsedData[0][${c0}]`);
  a.run(`editCell(0, ${c0}, 'zzz'); editCell(0, ${c0}, ${JSON.stringify(String(orig))})`);
  a.run('deleteRow(1); undoDelete()');
  a.run(`pasteCells(0, ${JSON.stringify(slots[i])}, ${JSON.stringify(String(orig))})`);
  a.setDetails();
  assert.strictEqual(a.generate(), untouched, 'XML through the editor is the untouched file\'s');
}

// ---- 9. GA4: column_remapped and cell_edited keep their param keys ----
{
  const a = app('T4', T4);
  a.run(`remapColumn(3, 'sin', 'button'); dropOnSlot(3, 'address', 'drag'); moveColumn(3, 1); editCell(0, 0, 'Poe')`);
  a.el('editor-thead').dispatchEvent(key('Delete', {}, target('[data-drag]', { drag: '3' })));
  const mine = a.events.filter(e => e[0] === 'column_remapped' || e[0] === 'cell_edited');
  assert.deepStrictEqual(mine.map(e => e[1].method || '-'), ['button', 'drag', 'keyboard', '-', 'keyboard']);
  for (const [name, params] of mine) assert.deepStrictEqual(Object.keys(params).sort(), name === 'cell_edited' ? ['field', 'return_type'] : ['field', 'method', 'return_type']);
}
console.log('table-editor-desktop.test.js: all passed');
