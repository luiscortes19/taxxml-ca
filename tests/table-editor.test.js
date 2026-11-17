// Step 2 table editor: the user's rows in an editable table, one CRA-field dropdown per source column, live validation.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createApp, fileToXML, ROOT, XLSX } = require('./harness');

const csv = rows => Buffer.from(rows.map(r => r.join(',')).join('\r\n') + '\r\n');
function app(returnType = 'T4', opts = {}) {
  const events = [];
  const a = createApp({ returnType, gtag: (cmd, name, params) => events.push([name, JSON.parse(JSON.stringify(params))]), ...opts });
  a.events = events;
  a.named = n => events.filter(e => e[0] === n).map(e => e[1]);
  a.thead = () => a.el('editor-thead').innerHTML;
  a.tbody = () => a.el('editor-tbody').innerHTML;
  a.status = () => a.el('editor-status').textContent;
  a.field = c => a.run(`columnField(${c})`);
  a.cell = (r, c) => JSON.parse(JSON.stringify(a.run(`cellState(${r}, ${c})`)));
  a.issues = () => JSON.parse(JSON.stringify(a.run('validateRows(getSelectedReturnType())')));
  return a;
}
const shown = (a, id) => !a.el(id).classList.contains('hidden');
const T4H = ['Last Name', 'First Name', 'SIN', 'Box 14 - Employment Income'];
const items = html => [...String(html).matchAll(/<li>(.*?)<\/li>/g)].map(m => m[1]);
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// ---- empty file / header-only: Step 1 error, no editor ----
for (const [name, bytes] of [['empty.csv', Buffer.alloc(0)], ['header.csv', csv([T4H])], ['blank-rows.csv', Buffer.from('Last Name,SIN\r\n,\r\n,\r\n')]]) {
  const a = app('T4');
  a.loadFile(name, bytes);
  assert(/no data rows/i.test(a.el('file-error').textContent), `${name}: ${a.el('file-error').textContent}`);
  assert.notStrictEqual(a.run('currentStep'), 2, `${name}: stays on Step 1`);
  assert.deepStrictEqual(a.named('file_parse_error'), [{ return_type: 'T4', error_category: 'no_data_rows' }]);
}

// ---- one row: a real table, CRA field per column, labelled selects, row numbers as in the spreadsheet ----
{
  const a = app('T4');
  a.loadFile('t4.csv', csv([[...T4H, 'Notes'], ['Doe', 'John', '046454286', '100', 'hello']]));
  assert.strictEqual(a.run('currentStep'), 2);
  const th = a.thead();
  assert.strictEqual((th.match(/<th scope="col"/g) || []).length, 6, 'row-number column + 5 source columns: ' + th);
  for (let c = 0; c < 5; c++) {
    assert(new RegExp(`<label[^>]* for="ed-col-${c}"`).test(th), `select ${c} has a label`);
    assert(new RegExp(`<select id="ed-col-${c}" data-col="${c}"`).test(th), `select ${c}`);
  }
  assert.deepStrictEqual([0, 1, 2, 3, 4].map(a.field), ['empe_snm', 'empe_gvn_nm', 'sin', 'empt_incamt', 'ignore']);
  assert(/Notes/.test(th) && /is-ignored/.test(th), 'extra column visible and marked ignored');
  assert(/<option value="ignore" selected>Ignored<\/option>/.test(th), 'extra column shows Ignored');
  assert.strictEqual((th.match(/class="req"/g) || []).length, 3, 'the 3 required T4 fields are starred');
  const tb = a.tbody();
  assert.strictEqual((tb.match(/<tr data-r=/g) || []).length, 1);
  assert(/<th scope="row"[^>]*>2\b/.test(tb), 'row header shows spreadsheet row 2: ' + tb);
  assert(/>hello</.test(tb), 'ignored column data still shown');
  assert(/No problems/i.test(a.status()), a.status());
  assert(!shown(a, 'editor-missing'), 'nothing required is missing');
}

// ---- display order follows the CRA field order; ignored columns last, in file order ----
{
  const a = app('T4');
  a.loadFile('t.csv', csv([['Extra', 'SIN', 'Other', 'Last Name', 'Box 14 - Employment Income'], ['x', '046454286', 'y', 'Doe', '1']]));
  assert.deepStrictEqual(a.run('editorColumns()'), [3, 1, 4, 0, 2]);
}

// ---- missing required columns: listed, Continue blocked, fixed by the dropdown ----
{
  const a = app('T4');
  a.loadFile('t4.csv', csv([['Nom', 'Prenom', 'NAS', 'Paye'], ['Doe', 'John', '046454286', '100']]));
  assert(shown(a, 'editor-missing'));
  for (const l of ['Last Name (Box 12)', 'SIN (Box 12)', 'Employment Income (Box 14)']) assert(a.el('editor-missing').innerHTML.includes(l), l);
  a.run('continueFromEditor()');
  assert.strictEqual(a.run('currentStep'), 2, 'blocked on Step 2');
  assert(shown(a, 'editor-errors'));
  assert(/dropdown at the top of the column/.test(a.el('editor-errors').innerHTML), a.el('editor-errors').innerHTML);
  a.run(`remapColumn(0, 'empe_snm', 'dropdown'); remapColumn(2, 'sin', 'dropdown')`);
  assert(a.el('editor-missing').innerHTML.includes('Employment Income') && !a.el('editor-missing').innerHTML.includes('SIN (Box 12)'));
  a.run(`remapColumn(3, 'empt_incamt', 'dropdown')`);
  assert(!shown(a, 'editor-missing'), 'all required set');
  assert(!shown(a, 'editor-errors'), 'Continue error clears once fixed');
  a.run('continueFromEditor()');
  assert.strictEqual(a.run('currentStep'), 3);
  assert.deepStrictEqual(a.named('column_remapped'), [
    { return_type: 'T4', field: 'empe_snm', method: 'dropdown' }, { return_type: 'T4', field: 'sin', method: 'dropdown' },
    { return_type: 'T4', field: 'empt_incamt', method: 'dropdown' }]);
}

// ---- one CRA field -> one column: picking it elsewhere unassigns the old column; 'ignore' unassigns ----
{
  const a = app('T4');
  a.loadFile('t.csv', csv([[...T4H, 'SIN copy'], ['Doe', 'John', '046454286', '1', '130692544']]));
  assert.strictEqual(a.field(2), 'sin');
  a.run(`remapColumn(4, 'sin', 'dropdown')`);
  assert.strictEqual(a.field(4), 'sin');
  assert.strictEqual(a.field(2), 'ignore', 'old SIN column is now ignored');
  assert.strictEqual(a.run('columnMap.sin'), 4);
  assert.strictEqual(Object.values(JSON.parse(JSON.stringify(a.run('columnMap')))).filter(c => c === 4).length, 1);
  a.run(`remapColumn(4, 'ignore', 'dropdown')`);
  assert.strictEqual(a.run('columnMap.sin'), -1);
  assert(a.el('editor-missing').innerHTML.includes('SIN (Box 12)'));
  assert.deepStrictEqual(a.named('column_remapped').map(p => p.field), ['sin', 'ignore']);
  // a value that isn't a field of this return (tampered select) changes nothing and sends nothing
  a.run(`remapColumn(0, 'rcpnt_bn', 'dropdown'); remapColumn(0, '__proto__', 'dropdown')`);
  assert.strictEqual(a.field(0), 'empe_snm');
  assert.strictEqual(a.named('column_remapped').length, 2);
}

// ---- duplicate source headers are separate columns with their own ids ----
{
  const a = app('T5018');
  a.loadFile('t.csv', csv([['Recipient Name', 'Amount', 'Amount', 'Recipient BN'], ['Acme', '1', '2', '123456789RZ0001']]));
  const th = a.thead();
  assert(/id="ed-col-1"/.test(th) && /id="ed-col-2"/.test(th));
  assert.deepStrictEqual([1, 2].map(a.field), ['sbctrcr_amt', 'ignore']);
  assert(/\bB\b[^<]*Amount/.test(th) && /\bC\b[^<]*Amount/.test(th), 'column letters tell them apart: ' + th);
  a.run(`remapColumn(2, 'sbctrcr_amt', 'dropdown')`);
  assert.deepStrictEqual([1, 2].map(a.field), ['ignore', 'sbctrcr_amt']);
  a.setDetails();
  assert(a.generate().includes('<sbctrcr_amt>2.00</sbctrcr_amt>'), 'the picked duplicate column is the one used');
}

// ---- drag (swap the CRA fields of two columns) and keyboard move left/right ----
{
  const a = app('T4');
  a.loadFile('t.csv', csv([[...T4H, 'Notes'], ['Doe', 'John', '046454286', '1', 'n']]));
  a.run(`swapColumns(0, 1, 'drag')`);
  assert.deepStrictEqual([0, 1].map(a.field), ['empe_gvn_nm', 'empe_snm']);
  assert.deepStrictEqual(a.run('editorColumns()'), [1, 0, 2, 3, 4], 'columns re-order to follow the CRA fields');
  a.run(`swapColumns(3, 4, 'drag')`); // onto an ignored column: that column takes the field, the dragged one is ignored
  assert.deepStrictEqual([3, 4].map(a.field), ['ignore', 'empt_incamt']);
  a.run(`swapColumns(3, 3, 'drag')`); // onto itself: nothing
  assert.deepStrictEqual(a.named('column_remapped'), [{ return_type: 'T4', field: 'empe_gvn_nm', method: 'drag' }, { return_type: 'T4', field: 'ignore', method: 'drag' }]);
  // keyboard: move a column one place left/right in the display order = swap with that neighbour
  const order = () => a.run('editorColumns()');
  assert.deepStrictEqual(order(), [1, 0, 2, 4, 3]);
  a.run(`moveColumn(0, -1)`);
  assert.deepStrictEqual(order(), [0, 1, 2, 4, 3]);
  assert.deepStrictEqual([0, 1].map(a.field), ['empe_snm', 'empe_gvn_nm']);
  a.run(`moveColumn(0, -1)`); // already first: nothing
  a.run(`moveColumn(3, 1)`);  // last: nothing
  assert.deepStrictEqual(a.named('column_remapped').slice(2), [{ return_type: 'T4', field: 'empe_snm', method: 'keyboard' }]);
  assert(/data-move="-1"/.test(a.thead()) && /aria-label="Move column/.test(a.thead()), 'move buttons rendered with labels');
  assert(/draggable="true"/.test(a.thead()), 'drag handle rendered');
  a.setDetails();
  assert(a.generate().includes('<snm>Doe</snm>'), 'XML follows the remapped columns');
}

// ---- delegated DOM events: header select change, move buttons, drag-and-drop ----
{
  const a = app('T4');
  a.loadFile('t.csv', csv([[...T4H, 'SIN2'], ['Doe', 'John', '046454286', '1', '130692544']]));
  const target = (dataset, value) => ({ dataset, value, closest: () => null });
  a.el('editor-thead').dispatchEvent({ type: 'change', target: target({ col: '4' }, 'sin') });
  assert.strictEqual(a.field(4), 'sin');
  a.el('editor-thead').dispatchEvent({ type: 'click', target: { closest: s => (s === '[data-move]' ? { dataset: { move: '-1', col: '4' } } : null) } });
  assert.deepStrictEqual(a.named('column_remapped').map(p => p.method), ['dropdown', 'keyboard']);
  const before = [0, 1].map(a.field);
  const store = {};
  const dt = { setData: (k, v) => { store[k] = v; }, getData: k => store[k], effectAllowed: '', dropEffect: '' };
  a.el('editor-thead').dispatchEvent({ type: 'dragstart', dataTransfer: dt, target: { closest: s => (s === '[data-drag]' ? { dataset: { drag: '0' } } : null) } });
  a.el('editor-thead').dispatchEvent({ type: 'drop', dataTransfer: dt, preventDefault: () => {}, target: { closest: s => (s === 'th[data-c]' ? { dataset: { c: '1' } } : null) } });
  assert.notDeepStrictEqual(before[0], before[1]);
  assert.deepStrictEqual([0, 1].map(a.field), before.reverse(), 'dropping column A on column B swaps their fields');
  assert.strictEqual(a.named('column_remapped').pop().method, 'drag');
}

// ---- live validation: edits that fix and break a cell; warnings styled apart; count summary; accessible message ----
{
  const a = app('T4');
  a.loadFile('t4.csv', csv([T4H, ['Doe', 'John', '46454286', '100'], ['Roe', 'Jane', '130692544', '100'], ['Poe', 'Ann', '', '1']]));
  assert.strictEqual(a.cell(0, 2).cls, 'cell-error');
  assert(/8 digits/.test(a.cell(0, 2).msg));
  assert.strictEqual(a.cell(1, 2).cls, '');
  assert.strictEqual(a.cell(2, 2).cls, 'cell-warning', 'blank SIN is a warning, not an error');
  assert(/1 error\b/.test(a.status()) && /1 warning\b/.test(a.status()), a.status());
  const tb = a.tbody();
  const m = tb.match(/<td[^>]*data-r="0" data-c="2"[^>]*>/)[0];
  assert(/class="cell-error"/.test(m) && /title="[^"]*8 digits/.test(m), m);
  const id = m.match(/aria-describedby="([^"]+)"/)[1];
  assert(new RegExp(`id="${id}"[^>]*>[^<]*8 digits`).test(a.el('editor-msgs').innerHTML), 'description element exists');
  // fix it
  assert.strictEqual(a.run(`editCell(0, 2, '046454286')`), true);
  assert.strictEqual(a.cell(0, 2).cls, '');
  assert(/0 errors|^1 warning/.test(a.status()) && !/1 error\b/.test(a.status()), a.status());
  assert.strictEqual(a.run('parsedData[0][2]'), '046454286', 'edit lands in the data used for generation');
  // break another
  a.run(`editCell(1, 2, '123')`);
  assert.strictEqual(a.cell(1, 2).cls, 'cell-error');
  assert(/3 digits/.test(a.cell(1, 2).msg));
  // re-typing the same value is not an edit
  assert.strictEqual(a.run(`editCell(1, 2, '123')`), false);
  // a name edit changes the 'who' in the message
  a.run(`editCell(1, 0, 'Smith')`);
  assert(/Jane Smith/.test(a.cell(1, 2).msg), a.cell(1, 2).msg);
  assert.deepStrictEqual(a.named('cell_edited'), [{ return_type: 'T4', field: 'sin' }, { return_type: 'T4', field: 'sin' }, { return_type: 'T4', field: 'empe_snm' }]);
  // generate is blocked by errors, with exactly the editor's messages
  a.setDetails();
  assert.strictEqual(a.generate(), '');
  const editorErrors = a.issues().filter(i => i.severity === 'error').map(i => esc(i.message));
  assert.deepStrictEqual(items(a.errors()), editorErrors);
  assert(/Go back to Step 2/.test(a.errors()) && !/first 10 rows/.test(a.errors()), a.errors());
  // warnings don't block
  a.run(`editCell(1, 2, '130692544')`);
  const xml = a.generate();
  assert(xml.includes('<sin>046454286</sin>') && xml.includes('<sin>000000000</sin>'), a.errors());
  const warned = items(a.el('warnings-box').innerHTML);
  assert.deepStrictEqual(warned, a.issues().filter(i => i.severity === 'warning').map(i => esc(i.message)));
  // edits to an ignored column are tracked as 'ignore'
  a.run(`remapColumn(1, 'ignore', 'dropdown'); editCell(0, 1, 'Jo')`);
  assert.deepStrictEqual(a.named('cell_edited').pop(), { return_type: 'T4', field: 'ignore' });
}

// ---- validateRows is pure and shared: same issues as generate for every return ----
{
  const cases = [
    ['T1204', [['Vendor Name', 'Vendor BN', 'Amount Paid', 'Business Type'], ['Acme', '12345', '1', 'Corporation'], ['Jo Doe', '', '1', 'Individual'], ['Bad', '123456789', '1', 'Llc']]],
    ['T5018', [['Recipient Name', 'Recipient BN', 'Amount Paid', 'Recipient Type'], ['Acme', '12345', '1', 'corp'], ['Jo Doe', '46454286', '1', 'Individual']]],
    ['NR4', [['Recipient Name', 'Recipient Type', 'Foreign Tax ID', 'Country of Residence', 'Gross Income'], ['Al', 'Alien', 'X1', 'Narnia', '1'], ['', 'Individual', 'X2', 'USA', '1']]],
    ['T4', [T4H, ['Doe', 'John', '1', '1'], ['Roe', 'Jane', '', '1']]],
  ];
  for (const [rt, rows] of cases) {
    const a = app(rt);
    a.loadFile('x.csv', csv(rows));
    const before = JSON.stringify(a.run('parsedData')) + JSON.stringify(a.run('columnMap'));
    const issues = a.issues();
    assert(issues.length >= 2, rt);
    for (const i of issues) {
      assert(['error', 'warning'].includes(i.severity) && Number.isInteger(i.row) && typeof i.field === 'string' && i.message, JSON.stringify(i));
      assert(a.run('analyticsFieldAllowlist()').has(i.field), `${rt}: issue field ${i.field} is one of our keys`);
    }
    assert.strictEqual(JSON.stringify(a.run('parsedData')) + JSON.stringify(a.run('columnMap')), before, `${rt}: validateRows changes nothing`);
    // explicit arguments: a different mapping gives a different answer without touching the app's mapping
    const unmapped = JSON.parse(JSON.stringify(a.run(`validateRows('${rt}', parsedData, {}, headers)`)));
    assert.deepStrictEqual(unmapped, [], `${rt}: nothing mapped -> every row is blank -> no issues`);
    a.setDetails();
    a.generate();
    assert.deepStrictEqual(items(a.errors()), issues.filter(i => i.severity === 'error').map(i => esc(i.message)), rt);
  }
}

// ---- add / delete rows ----
{
  const a = app('T4');
  a.loadFile('t.csv', csv([T4H, ['Doe', 'John', '1', '1'], ['Roe', 'Jane', '130692544', '1']]));
  assert(/1 error\b/.test(a.status()));
  a.run('addRow()');
  assert.strictEqual(a.run('parsedData.length'), 3);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.run('parsedData[2]'))), ['', '', '', '']);
  assert(/data-r="2"/.test(a.tbody()), 'new row visible');
  assert(/1 error\b/.test(a.status()), 'a blank row is skipped like a blank spreadsheet row');
  a.run(`editCell(2, 0, 'New')`);
  assert.strictEqual(a.cell(2, 2).cls, 'cell-warning', 'new row with a name but no SIN warns');
  a.run('deleteRow(0)');
  assert.strictEqual(a.run('parsedData.length'), 2);
  assert(/0 errors|^1 warning/.test(a.status()) && !/1 error\b/.test(a.status()), a.status());
  assert(!/data-r="2"/.test(a.tbody()));
  a.run('deleteRow(0); deleteRow(0)');
  assert.strictEqual(a.run('parsedData.length'), 0);
  assert(/No rows/.test(a.tbody()), 'empty state: ' + a.tbody());
  a.run('deleteRow(5)'); // out of range: nothing
  a.setDetails();
  assert.strictEqual(a.generate(), '');
  assert(/No valid employee rows/.test(a.errors()));
  // with every row deleted, switching return still re-maps the columns
  a.el('return-type').value = 'NR4';
  a.run('onReturnTypeChange()');
  assert.strictEqual(a.run('currentStep'), 2);
  assert(a.thead().includes('ed-col-0'));
}

// ---- switching the return re-maps and re-renders ----
{
  const a = app('T4');
  a.loadFile('t.csv', csv([['Recipient Name', 'Foreign Tax ID', 'Gross Income', 'Country'], ['Al', 'X', '1', 'USA']]));
  assert(shown(a, 'editor-missing'));
  a.el('return-type').value = 'NR4';
  a.run('onReturnTypeChange()');
  assert.deepStrictEqual([0, 1, 2, 3].map(a.field), ['rcpnt_name', 'fssn_nbr', 'gro_1_incamt', 'tx_cntry_cd']);
  assert(!shown(a, 'editor-missing'));
  assert(/Foreign Tax ID/.test(a.thead()) && !/SIN \(Box 12\)/.test(a.thead()), 'NR4 fields in the dropdowns');
}

// ---- T4 full name in one column: a dropdown option that fills both name fields ----
{
  const a = app('T4');
  a.loadFile('t.csv', csv([['Employee Name', 'SIN', 'Box 14 - Employment Income'], ['John Q Doe', '046454286', '100']]));
  assert(/<option value="full_name"/.test(a.thead()));
  a.run(`remapColumn(0, 'full_name', 'dropdown')`);
  assert.deepStrictEqual([a.run('columnMap.empe_snm'), a.run('columnMap.empe_gvn_nm')], [0, 0]);
  assert.strictEqual(a.field(0), 'full_name');
  assert.deepStrictEqual(a.named('column_remapped'), [{ return_type: 'T4', field: 'full_name', method: 'dropdown' }]);
  a.setDetails();
  const xml = a.generate();
  assert(xml.includes('<snm>Doe</snm>') && xml.includes('<gvn_nm>John Q</gvn_nm>'), xml || a.errors());
  const b = app('NR4');
  b.loadFile('t.csv', csv([['Recipient Name', 'Foreign Tax ID'], ['A', 'X']]));
  assert(!/full_name/.test(b.thead()), 'only T4 has it');
}

// ---- keyboard grid navigation (pure step function) ----
{
  const a = app('T4');
  const step = (k, s, r, c) => JSON.parse(JSON.stringify(a.run(`gridStep(${JSON.stringify(k)}, ${s}, ${r}, ${c}, 3, 4)`)));
  assert.deepStrictEqual(step('ArrowRight', false, 0, 0), [0, 1]);
  assert.deepStrictEqual(step('ArrowDown', false, 0, 0), [1, 0]);
  assert.deepStrictEqual(step('ArrowUp', false, 0, 0), null);
  assert.deepStrictEqual(step('ArrowLeft', false, 1, 0), null);
  assert.deepStrictEqual(step('ArrowDown', false, 2, 3), null);
  assert.deepStrictEqual(step('Tab', false, 0, 3), [1, 0], 'Tab wraps to the next row');
  assert.deepStrictEqual(step('Tab', true, 1, 0), [0, 3], 'Shift+Tab wraps back');
  assert.deepStrictEqual(step('Tab', false, 2, 3), null, 'Tab off the last cell leaves the table');
  assert.deepStrictEqual(step('Tab', true, 0, 0), null);
  assert.deepStrictEqual(step('a', false, 1, 1), null);
}

// ---- escaping: headers and cells are user data ----
{
  const a = app('T4');
  a.loadFile('t.csv', csv([['Last Name', '<img src=x onerror=alert(1)>', 'SIN', 'Box 14 - Employment Income'], ['<b>Doe</b>', '"q"', '<script>x</script>', '1']]));
  for (const html of [a.thead(), a.tbody(), a.el('editor-msgs').innerHTML]) {
    assert(!/<img|<script|<b>/.test(html), html);
  }
  assert(a.thead().includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert(a.tbody().includes('&lt;b&gt;Doe&lt;/b&gt;'));
}

// ---- thousands of rows: paged rendering, fast validation and edits, "only rows with problems" ----
{
  const N = 5000;
  const rows = [T4H];
  for (let i = 0; i < N; i++) rows.push([`Last${i}`, `First${i}`, i === 3998 ? '123' : '046454286', '100']);
  const a = app('T4');
  let t = Date.now();
  a.loadFile('big.csv', csv(rows));
  const loadMs = Date.now() - t;
  assert.strictEqual(a.run('parsedData.length'), N);
  assert(loadMs < 3000, `load + map + validate + render 5000 rows took ${loadMs}ms`);
  const rendered = (a.tbody().match(/<tr data-r=/g) || []).length;
  assert(rendered > 0 && rendered <= 100, `only one page rendered (${rendered})`);
  assert(/5,000/.test(a.el('editor-pager').innerHTML), a.el('editor-pager').innerHTML);
  assert(/1 error\b/.test(a.status()), a.status());
  t = Date.now();
  for (let i = 0; i < 10; i++) a.run(`editCell(${i}, 1, 'Edited${i}')`);
  assert(Date.now() - t < 2000, `10 edits on 5000 rows took ${Date.now() - t}ms`);
  // the bad row is far down: jump to it with the problems filter
  assert(!/data-r="3998"/.test(a.tbody()));
  a.el('editor-only-problems').checked = true;
  a.el('editor-only-problems').dispatchEvent({ type: 'change', target: a.el('editor-only-problems') });
  assert(/data-r="3998"/.test(a.tbody()), 'problem row shown');
  assert.strictEqual((a.tbody().match(/<tr data-r=/g) || []).length, 1);
  a.el('editor-only-problems').checked = false;
  a.el('editor-only-problems').dispatchEvent({ type: 'change', target: a.el('editor-only-problems') });
  a.run('setEditorPage(39)');
  assert(/data-r="3998"/.test(a.tbody()), 'page 40 holds rows 3901-4000');
  a.run('setEditorPage(999)');
  assert(/data-r="4999"/.test(a.tbody()), 'page is clamped to the last one');
  a.run('addRow()');
  assert(/data-r="5000"/.test(a.tbody()), 'adding a row shows the last page');
  a.setDetails();
  t = Date.now();
  a.run(`editCell(3998, 2, '046454286')`);
  const xml = a.generate();
  assert.strictEqual((xml.match(/<T4Slip>/g) || []).length, N);
  assert(Date.now() - t < 3000, `generate 5000 slips took ${Date.now() - t}ms`);
}

// ---- GOLDEN: through the editor (remap away and back, swap twice, edit and undo, shuffled columns) -> byte-identical ----
{
  const DIR = path.join(__dirname, 'fixtures');
  const CASES = [['T4', 'T4_input.csv'], ['T4', 'T4_input.xlsx'], ['T1204', 'T1204_input.csv'], ['T5018', 'T5018_input.csv'], ['NR4', 'NR4_input.csv']];
  for (const [rt, input] of CASES) {
    const golden = fs.readFileSync(path.join(DIR, input.replace(/\.\w+$/, '') + (input.endsWith('.xlsx') ? '_xlsx' : '') + '.golden.xml'), 'utf8');
    const bytes = fs.readFileSync(path.join(DIR, input));
    const a = app(rt, { now: '2026-11-15T10:00' });
    a.loadFile(input, bytes);
    const cols = a.run('editorColumns()');
    const [c0, c1] = cols;
    const f0 = a.field(c0);
    a.run(`remapColumn(${c0}, 'ignore', 'dropdown'); remapColumn(${c0}, '${f0}', 'dropdown')`);
    a.run(`swapColumns(${c0}, ${c1}, 'drag'); swapColumns(${c0}, ${c1}, 'drag')`);
    const orig = a.run(`parsedData[0][${c0}]`);
    a.run(`editCell(0, ${c0}, 'zzz'); editCell(0, ${c0}, ${JSON.stringify(String(orig))})`);
    a.run(`addRow(); deleteRow(parsedData.length - 1)`);
    a.setDetails();
    assert.strictEqual(a.generate(), golden, `${input}: XML through the editor differs from the golden`);

    // same data with the columns in reverse order: auto-mapped by header, so the same slips
    if (input.endsWith('.csv')) {
      const wb = XLSX.read(bytes, { type: 'buffer' });
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
      const reversed = Buffer.from(aoa.map(r => r.slice().reverse().map(v => /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\r\n'));
      const { xml } = fileToXML(rt, input, reversed, undefined, { now: '2026-11-15T10:00' });
      assert.strictEqual(xml, golden, `${input}: reversed columns differ from the golden`);
    }
  }
}

// ---- GA4: new events carry only enums; nothing typed or uploaded leaks ----
{
  const PII = ['Secret', 'Doe', '046454286', '130692544', 'Payroll Notes', '777'];
  const a = app('T4');
  a.loadFile('secret.csv', csv([['Last Name', 'First Name', 'SIN', 'Box 14 - Employment Income', 'Payroll Notes'], ['Doe', 'Secret', '046454286', '777', 'Secret']]));
  a.run(`editCell(0, 0, 'Secret Doe'); editCell(0, 4, 'Secret 130692544'); remapColumn(4, 'empe_gvn_nm', 'dropdown'); swapColumns(4, 1, 'drag'); moveColumn(4, -1); remapColumn(4, 'full_name', 'dropdown')`);
  const allow = a.run('analyticsFieldAllowlist()');
  const ALLOWED = { return_type: /^(T4|T1204|T5018|NR4)$/, method: /^(dropdown|drag|keyboard)$/ };
  const mine = a.events.filter(e => e[0] === 'column_remapped' || e[0] === 'cell_edited');
  assert(mine.filter(e => e[0] === 'column_remapped').length >= 4 && mine.filter(e => e[0] === 'cell_edited').length === 2, JSON.stringify(mine));
  for (const [name, params] of mine) {
    assert.deepStrictEqual(Object.keys(params).sort(), name === 'cell_edited' ? ['field', 'return_type'] : ['field', 'method', 'return_type']);
    for (const [k, v] of Object.entries(params)) {
      if (k === 'field') assert(allow.has(v), `${name}.field ${v} on the allowlist`);
      else assert(ALLOWED[k].test(v), `${name}.${k} = ${v}`);
      for (const p of PII) assert(!String(v).includes(p), `${name}.${k} leaks ${p}`);
    }
  }
  assert(allow.has('ignore') && allow.has('full_name'));
}

// ---- the old mapping UI is gone; the editor is accessible markup; no network calls with data ----
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
  for (const gone of ['mapping-table', 'mapping-tbody', 'preview-table', 'count-matched', 'Continue to Mapping', 'Column Mapping', 'Your Excel Column', 'mapping-errors'])
    assert(!html.includes(gone), `index.html still has ${gone}`);
  for (const gone of ['buildPreview', 'renderPreviewTable', 'updateMappingSummary', 'continueFromMapping', 'badCells', 'mapping-select', 'preview-tbody', 'getVal('])
    assert(!js.includes(gone), `app.js still has ${gone}`);
  for (const gone of ['.mapping-table', '.mapping-select', '#preview-table', '.mapping-summary', '.mapping-status-icon', '.box-tag'])
    assert(!css.includes(gone), `styles.css still has ${gone}`);
  assert(/<table id="editor-table"/.test(html));
  assert(/<thead id="editor-thead"><\/thead>/.test(html) && /<tbody id="editor-tbody"><\/tbody>/.test(html));
  assert(/id="editor-status"[^>]*aria-live="polite"|aria-live="polite"[^>]*id="editor-status"/.test(html), 'error count is announced');
  assert(/<label[^>]*>\s*<input type="checkbox" id="editor-only-problems"/.test(html), 'problems filter is labelled');
  assert(/onclick="continueFromEditor\(\)"/.test(html));
  assert(/never sent anywhere|stay[s]? (on|in) this (device|browser)/i.test(html.slice(html.indexOf('id="step-2"'), html.indexOf('id="step-3"'))), 'Step 2 keeps the privacy promise');
  assert(/\.ed-wrap[^{]*\{[^}]*overflow-x: auto/.test(css), 'table scrolls sideways in its box');
  assert(/position: sticky/.test(css), 'sticky header / row numbers');
  assert(/\.cell-error/.test(css) && /\.cell-warning/.test(css));
  assert.strictEqual((js.match(/\bfetch\(/g) || []).length, 1, 'the only fetch is the sample template');
  assert(!/XMLHttpRequest|sendBeacon|WebSocket/.test(js));
}
console.log('table-editor.test.js: all passed');
