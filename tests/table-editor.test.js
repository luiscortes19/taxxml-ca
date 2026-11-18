// Step 2 table editor: the user's rows in an editable table under the CRA columns; ←/→, drag and buttons move columns; live validation.
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
  a.thead = () => a.el('editor-thead').innerHTML + a.el('editor-ignored').innerHTML; // the whole mapping UI
  a.tbody = () => a.el('editor-tbody').innerHTML;
  a.status = () => a.el('editor-status').textContent;
  a.field = c => a.run(`columnField(${c})`);
  a.cell = (r, c) => JSON.parse(JSON.stringify(a.run(`cellState(${r}, columnField(${c}))`))); // by source column
  a.issues = () => JSON.parse(JSON.stringify(a.run('validateRows(getSelectedReturnType())')));
  a.slots = () => JSON.parse(JSON.stringify(a.run('editorSlots()'))); // a plain array, not the vm realm's
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

// ---- one row: a real table under a fixed header of CRA columns; every source column appears exactly once ----
{
  const a = app('T4');
  a.loadFile('t4.csv', csv([[...T4H, 'Notes'], ['Doe', 'John', '046454286', '100', 'hello']]));
  assert.strictEqual(a.run('currentStep'), 2);
  const th = a.el('editor-thead').innerHTML;
  const slots = a.slots();
  assert.strictEqual(slots.length, 17, 'T4 has 17 CRA columns');
  assert.strictEqual((th.match(/<tr\b/g) || []).length, 2, 'two header rows: CRA columns, then your columns under them');
  assert.strictEqual((th.match(/<th scope="col"/g) || []).length, 1 + 2 * slots.length, 'row-number column + a CRA header and a slot per CRA column: ' + th);
  assert(/<th scope="col" class="ed-rownum" rowspan="2">Row<\/th>/.test(th));
  for (let c = 0; c < 5; c++) {
    assert.strictEqual((a.thead().match(new RegExp(`data-drag="${c}"`, 'g')) || []).length, 1, `column ${c} appears once`);
  }
  assert(!/<select/.test(a.thead()), 'no mapping dropdowns in the header or the Ignored area');
  assert.deepStrictEqual([0, 1, 2, 3, 4].map(a.field), ['empe_snm', 'empe_gvn_nm', 'sin', 'empt_incamt', 'ignore']);
  // the unmatched column is in the Ignored area, not in the table
  const ign = a.el('editor-ignored').innerHTML;
  assert(/Ignored columns/.test(ign) && /E · Notes/.test(ign) && /<summary data-col="4"/.test(ign), ign);
  assert(!/Notes/.test(th));
  assert(/data-drop="ignore"/.test(ign), 'the area is a drop target');
  const tb = a.tbody();
  assert.strictEqual((tb.match(/<tr data-r=/g) || []).length, 1);
  assert(/<th scope="row"[^>]*>2\b/.test(tb), 'row header shows spreadsheet row 2: ' + tb);
  assert.strictEqual((tb.match(/<td\b/g) || []).length, slots.length, 'one cell per CRA column');
  assert(!/hello/.test(tb), 'ignored data is not in the table');
  assert(/No problems/i.test(a.status()), a.status());
  assert(!shown(a, 'editor-missing'), 'nothing required is missing');
}

// ---- the fixed header is in CRA order (schema / box order) for every return, with Mandatory / Optional badges ----
{
  const ORDER = {
    T4: ['empe_snm', 'empe_gvn_nm', 'address', 'empt_prov_cd', 'sin', 'empt_incamt', 'cpp_cntrb_amt', 'cppe_cntrb_amt', 'qpp_cntrb_amt', 'empe_eip_amt',
      'rpp_cntrb_amt', 'itx_ddct_amt', 'ei_insu_ern_amt', 'cpp_qpp_ern_amt', 'cpp_qpp_xmpt_cd', 'ei_xmpt_cd', 'unn_dues_amt'],
    T1204: ['vendor_name', 'vendor_bn', 'biz_type', 'address', 'amount', 'svc_only'],
    T5018: ['rcpnt_name', 'rcpnt_bn', 'rcpnt_type', 'address', 'sbctrcr_amt'],
    NR4: ['rcpnt_name', 'addr_l1', 'city', 'ste_cd', 'fgn_pstl_cd', 'tx_cntry_cd', 'cin', 'fssn_nbr', 'rcpnt_type', 'inc_1_tcd', 'crcy_1_cd',
      'gro_1_incamt', 'nr_tx_1_amt', 'tx_xmpt_1_cd'],
  };
  const MANDATORY = { T4: ['empe_snm', 'sin', 'empt_incamt'], T1204: ['vendor_name', 'vendor_bn'], T5018: ['rcpnt_name', 'rcpnt_bn', 'sbctrcr_amt'], NR4: ['rcpnt_name', 'fssn_nbr', 'gro_1_incamt'] };
  for (const [rt, order] of Object.entries(ORDER)) {
    const a = app(rt);
    a.loadFile('x.csv', csv([['Unrelated'], ['x']])); // nothing matches: every slot is empty, the column is ignored
    assert.deepStrictEqual(a.slots(), order, `${rt} CRA order`);
    const th = a.el('editor-thead').innerHTML;
    const [row1, row2] = th.split('</tr>');
    assert.deepStrictEqual([...row1.matchAll(/data-slot="([^"]+)"/g)].map(m => m[1]), order, `${rt} header row`);
    assert.deepStrictEqual([...row2.matchAll(/data-slot="([^"]+)"/g)].map(m => m[1]), order, `${rt} slot row`);
    const labels = a.run(`getReturnConfig().fields.map(f => f.label)`);
    for (const l of labels) assert(th.includes(esc(l)), `${rt} header shows ${l}`);
    // badge = text + class (colour), never colour alone
    const badges = [...row1.matchAll(/<th scope="col" class="ed-cra[^"]*" data-slot="([^"]+)"[^>]*>[\s\S]*?<span class="badge badge-(mandatory|optional)">(Mandatory|Optional)<\/span>/g)]
      .map(m => [m[1], m[2], m[3]]);
    assert.strictEqual(badges.length, order.length, `${rt}: a badge per CRA column: ${row1}`);
    for (const [key, cls, text] of badges) {
      const want = MANDATORY[rt].includes(key) ? 'mandatory' : 'optional';
      assert.strictEqual(cls, want, `${rt}.${key}`);
      assert.strictEqual(text.toLowerCase(), want);
    }
    // empty slots: mandatory ones warn, optional ones are neutral
    for (const key of order) {
      const slot = row2.match(new RegExp(`<th scope="col" class="([^"]*)" data-slot="${key}"[^>]*>([\\s\\S]*?)</th>`));
      assert(slot, `${rt}.${key} slot`);
      assert(/\bis-empty\b/.test(slot[1]), `${rt}.${key} empty`);
      if (MANDATORY[rt].includes(key)) {
        assert(/\bis-missing\b/.test(slot[1]) && /Mandatory: no column yet/.test(slot[2]), `${rt}.${key} mandatory warning: ${slot[0]}`);
      } else {
        assert(!/\bis-missing\b/.test(slot[1]) && /No column/.test(slot[2]) && !/Mandatory/.test(slot[2]), `${rt}.${key} neutral: ${slot[0]}`);
      }
    }
    assert(/A · Unrelated/.test(a.el('editor-ignored').innerHTML));
  }
}

// ---- one source column per CRA column: moving a column under a taken CRA column ignores the one that was there ----
{
  const a = app('T4');
  a.loadFile('t.csv', csv([[...T4H, 'SIN copy'], ['Doe', 'John', '046454286', '1', '130692544']]));
  assert.strictEqual(a.field(2), 'sin');
  a.run(`remapColumn(4, 'sin', 'button')`);
  assert.strictEqual(a.field(4), 'sin');
  assert.strictEqual(a.field(2), 'ignore', 'old SIN column is now ignored');
  assert(/C · SIN/.test(a.el('editor-ignored').innerHTML), 'and listed in the Ignored area');
  assert.strictEqual(a.run('columnMap.sin'), 4);
  assert.strictEqual(Object.values(JSON.parse(JSON.stringify(a.run('columnMap')))).filter(c => c === 4).length, 1);
  a.run(`remapColumn(4, 'ignore', 'button')`);
  assert.strictEqual(a.run('columnMap.sin'), -1);
  assert(a.el('editor-missing').innerHTML.includes('SIN (Box 12)'));
  assert(/data-slot="sin"[^>]*>[\s\S]*?Mandatory: no column yet/.test(a.el('editor-thead').innerHTML.split('</tr>')[1]), 'empty mandatory slot warns');
  assert.deepStrictEqual(a.named('column_remapped').map(p => p.field), ['sin', 'ignore']);
  // a value that isn't a field of this return (tampered select) changes nothing and sends nothing
  a.run(`remapColumn(0, 'rcpnt_bn', 'button'); remapColumn(0, '__proto__', 'button')`);
  assert.strictEqual(a.field(0), 'empe_snm');
  assert.strictEqual(a.named('column_remapped').length, 2);
  // the "Use column" menu of an ignored column lists the empty CRA columns, mandatory first; taken ones aren't offered
  const menu = a.el('editor-ignored').innerHTML.match(/<summary data-col="2"[\s\S]*?<\/details>/)[0];
  const offered = [...menu.matchAll(/data-to="(\w+)"/g)].map(m => m[1]);
  assert.strictEqual(offered[0], 'sin', 'free mandatory slot first: ' + menu);
  assert(/data-to="sin" data-col="2">SIN \(Box 12\) <span class="badge badge-mandatory">Mandatory<\/span>/.test(menu), menu);
  assert(!offered.includes('empe_gvn_nm') && !offered.includes('empe_snm'), 'taken CRA columns are not offered while some are empty');
  assert(offered.includes('full_name'), 'T4: full name is offered');
}

// ---- invariant: after any sequence of moves, no CRA column has two source columns and no column is in two CRA columns ----
{
  const a = app('NR4');
  const H = ['Recipient Name', 'Recipient Type', 'Foreign Tax ID', 'Country', 'Gross Income', 'Tax Withheld', 'City', 'Zip', 'Extra 1', 'Extra 2'];
  a.loadFile('t.csv', csv([H, ['Al', 'Individual', 'X1', 'USA', '1', '0', 'Seattle', '98101', 'e1', 'e2']]));
  const slots = a.slots();
  let seed = 7;
  const rnd = n => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  for (let i = 0; i < 400; i++) {
    const c = rnd(H.length), f = slots[rnd(slots.length)];
    const op = rnd(5);
    if (op === 0) a.run(`remapColumn(${c}, '${f}', 'button')`);
    else if (op === 1) a.run(`dropOnSlot(${c}, '${f}', 'drag')`);
    else if (op === 2) a.run(`moveColumn(${c}, ${rnd(2) ? 1 : -1})`);
    else if (op === 3) a.run(`remapColumn(${c}, 'ignore', 'drag')`);
    else a.run(`swapColumns(${c}, ${rnd(H.length)}, 'drag')`);
    const map = JSON.parse(JSON.stringify(a.run('columnMap')));
    const used = Object.values(map).filter(v => v >= 0);
    assert.strictEqual(new Set(used).size, used.length, `step ${i}: ${JSON.stringify(map)}`);
    const ignored = JSON.parse(JSON.stringify(a.run('ignoredColumns()')));
    assert.deepStrictEqual([...used, ...ignored].sort((x, y) => x - y), H.map((_, k) => k), `step ${i}: every column is in one place`);
  }
}

// ---- duplicate source headers are separate columns with their own ids ----
{
  const a = app('T5018');
  a.loadFile('t.csv', csv([['Recipient Name', 'Amount', 'Amount', 'Recipient BN'], ['Acme', '1', '2', '123456789RZ0001']]));
  const th = a.thead();
  assert(/data-drag="1"/.test(th) && /data-drag="2"/.test(th));
  assert.deepStrictEqual([1, 2].map(a.field), ['sbctrcr_amt', 'ignore']);
  assert(/\bB\b[^<]*Amount/.test(th) && /\bC\b[^<]*Amount/.test(th), 'column letters tell them apart: ' + th);
  a.run(`remapColumn(2, 'sbctrcr_amt', 'button')`);
  assert.deepStrictEqual([1, 2].map(a.field), ['ignore', 'sbctrcr_amt']);
  a.setDetails();
  assert(a.generate().includes('<sbctrcr_amt>2.00</sbctrcr_amt>'), 'the picked duplicate column is the one used');
}

// ---- drag onto a CRA column, drag to Ignored, drag out of Ignored; keyboard moves to the next / previous CRA column ----
{
  const a = app('T4');
  a.loadFile('t.csv', csv([[...T4H, 'Notes'], ['Doe', 'John', '046454286', '1', '2']]));
  a.run(`dropOnSlot(0, 'empe_gvn_nm', 'drag')`); // onto a taken CRA column, from a CRA column: the two trade places
  assert.deepStrictEqual([0, 1].map(a.field), ['empe_gvn_nm', 'empe_snm']);
  a.run(`dropOnSlot(4, 'empt_incamt', 'drag')`); // from Ignored onto a taken CRA column: the one there goes to Ignored
  assert.deepStrictEqual([3, 4].map(a.field), ['ignore', 'empt_incamt']);
  a.run(`dropOnSlot(3, 'unn_dues_amt', 'drag')`); // from Ignored onto an empty CRA column
  assert.strictEqual(a.field(3), 'unn_dues_amt');
  a.run(`dropOnSlot(3, 'unn_dues_amt', 'drag')`); // onto itself: nothing
  a.run(`remapColumn(3, 'ignore', 'drag')`); // dragged to the Ignored area
  assert.strictEqual(a.field(3), 'ignore');
  assert.deepStrictEqual(a.named('column_remapped'), [
    { return_type: 'T4', field: 'empe_gvn_nm', method: 'drag' }, { return_type: 'T4', field: 'empt_incamt', method: 'drag' },
    { return_type: 'T4', field: 'unn_dues_amt', method: 'drag' }, { return_type: 'T4', field: 'ignore', method: 'drag' }]);
  // keyboard: → / ← move a column to the next / previous CRA column (trading with the column there, if any)
  a.run(`moveColumn(1, 1)`); // column B (Last Name, 1st slot) -> First Name slot, trades with column A
  assert.deepStrictEqual([0, 1].map(a.field), ['empe_snm', 'empe_gvn_nm']);
  a.run(`moveColumn(0, -1)`); // already in the first CRA column: nothing
  a.run(`moveColumn(4, 1)`); // Box 14 -> Box 16 (empty): Box 14 is left empty
  assert.strictEqual(a.field(4), 'cpp_cntrb_amt');
  assert.strictEqual(a.run('columnMap.empt_incamt'), -1);
  a.run(`moveColumn(4, -1)`);
  assert.strictEqual(a.field(4), 'empt_incamt');
  a.run(`moveColumn(3, 1)`); // an ignored column has no CRA neighbour: nothing
  assert.strictEqual(a.field(3), 'ignore');
  assert.deepStrictEqual(a.named('column_remapped').slice(4).map(p => [p.field, p.method]),
    [['empe_gvn_nm', 'keyboard'], ['cpp_cntrb_amt', 'keyboard'], ['empt_incamt', 'keyboard']]);
  const th = a.el('editor-thead').innerHTML;
  assert(/data-move="-1" data-col="0" disabled aria-label="Move column A \(Last Name\) to the previous CRA column"/.test(th), 'first CRA column: ← is disabled: ' + th);
  assert(/data-move="1" data-col="1" aria-label="Move column B \(First Name\) to the next CRA column\. Moves to: Employee Address"/.test(th), th);
  assert(/data-move="-1" data-col="1" aria-label="Move column B \(First Name\) to the previous CRA column\. Moves to: Last Name \(Box 12\)"/.test(th), th);
  assert(/<span class="ed-chip" draggable="true" data-drag="1"/.test(th), 'drag handle on the column in its slot');
  assert(/<li class="ed-chip" draggable="true" data-drag="3"/.test(a.el('editor-ignored').innerHTML), 'drag handle on ignored columns');
  a.setDetails();
  assert(a.generate().includes('<snm>Doe</snm>'), 'XML follows the remapped columns');
}

// ---- delegated DOM events: "Use column" and "Leave out" buttons, move buttons, drag-and-drop in and out ----
{
  const a = app('T4');
  a.loadFile('t.csv', csv([[...T4H, 'SIN2'], ['Doe', 'John', '046454286', '1', '130692544']]));
  const to = (dataset) => ({ type: 'click', target: { closest: s => (s === '[data-to]' ? { dataset } : null) } });
  a.el('editor-ignored').dispatchEvent(to({ to: 'sin', col: '4' }));
  assert.strictEqual(a.field(4), 'sin', '"Use column" in the Ignored area, onto a taken CRA column');
  assert.strictEqual(a.field(2), 'ignore', 'the column that was there goes to Ignored');
  a.el('editor-thead').dispatchEvent(to({ to: 'ignore', col: '4' }));
  assert.strictEqual(a.field(4), 'ignore', '"Leave out" in the header');
  a.el('editor-ignored').dispatchEvent(to({ to: 'qpp_cntrb_amt', col: '4' }));
  assert.strictEqual(a.field(4), 'qpp_cntrb_amt');
  a.el('editor-thead').dispatchEvent({ type: 'click', target: { closest: s => (s === '[data-move]' ? { dataset: { move: '-1', col: '4' } } : null) } });
  assert.strictEqual(a.field(4), 'cppe_cntrb_amt');
  assert.deepStrictEqual(a.named('column_remapped').map(p => p.method), ['button', 'button', 'button', 'keyboard']);
  a.run(`remapColumn(2, 'sin', 'button')`); // put back, so the drag checks below start from the same map as before
  const store = {};
  const dt = { setData: (k, v) => { store[k] = v; }, getData: k => store[k], effectAllowed: '', dropEffect: '' };
  const drag = (el, c) => a.el(el).dispatchEvent({ type: 'dragstart', dataTransfer: dt, target: { closest: s => (s === '[data-drag]' ? { dataset: { drag: String(c) } } : null) } });
  const drop = (el, sel, data) => {
    let prevented = 0;
    const ev = type => ({ type, dataTransfer: dt, preventDefault: () => { prevented++; }, target: { closest: s => (s === sel ? { dataset: data } : null) } });
    a.el(el).dispatchEvent(ev('dragover'));
    a.el(el).dispatchEvent(ev('drop'));
    return prevented;
  };
  drag('editor-thead', 0);
  assert.strictEqual(drop('editor-thead', '[data-slot]', { slot: 'empe_gvn_nm' }), 2, 'slots accept the drop');
  assert.deepStrictEqual([0, 1].map(a.field), ['empe_gvn_nm', 'empe_snm'], 'dropping column A on the First Name slot trades with B');
  drag('editor-thead', 4);
  assert.strictEqual(drop('editor-ignored', '[data-drop]', { drop: 'ignore' }), 2);
  assert.strictEqual(a.field(4), 'ignore', 'dropped on the Ignored area');
  drag('editor-ignored', 4);
  drop('editor-thead', '[data-slot]', { slot: 'cpp_cntrb_amt' });
  assert.strictEqual(a.field(4), 'cpp_cntrb_amt', 'dragged out of the Ignored area');
  assert.deepStrictEqual(a.named('column_remapped').slice(5).map(p => p.method), ['drag', 'drag', 'drag']);
  store['text/plain'] = 'evil';
  drop('editor-thead', '[data-slot]', { slot: 'sin' }); // not a column number: nothing
  assert.strictEqual(a.named('column_remapped').length, 8);
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
  a.run(`remapColumn(1, 'ignore', 'button'); editCell(0, 1, 'Jo')`);
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
  assert(a.thead().includes('data-drag="0"'));
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
  assert(/Foreign Tax ID/.test(a.thead()) && !/SIN \(Box 12\)/.test(a.thead()), 'NR4 fields in the header');
}

// ---- T4 full name in one column: a "Use as full name" button that fills both name fields ----
{
  const a = app('T4');
  a.loadFile('t.csv', csv([['Employee Name', 'SIN', 'Box 14 - Employment Income'], ['John Q Doe', '046454286', '100']]));
  assert.strictEqual(a.field(0), 'ignore', 'no header match');
  a.run(`remapColumn(0, 'empe_snm', 'button')`); // under Last Name
  a.events.length = 0;
  assert(/<button type="button" class="ed-act" data-to="full_name" data-col="0" aria-label="Use as full name: column A \(Employee Name\) fills Last Name and First Name">Use as full name<\/button>/.test(a.thead()), a.thead());
  a.el('editor-thead').dispatchEvent({ type: 'click', target: { closest: s => (s === '[data-to]' ? { dataset: { to: 'full_name', col: '0' } } : null) } });
  assert.deepStrictEqual([a.run('columnMap.empe_snm'), a.run('columnMap.empe_gvn_nm')], [0, 0]);
  assert.strictEqual(a.field(0), 'full_name');
  assert.deepStrictEqual(a.named('column_remapped'), [{ return_type: 'T4', field: 'full_name', method: 'button' }]);
  const th = a.el('editor-thead').innerHTML;
  assert(/Same column as Last Name \(full name\)/.test(th));
  assert(/data-to="empe_snm" data-col="0" aria-label="Last name only: use column A \(Employee Name\) for Last Name only">Last name only</.test(th), 'and back: ' + th);
  assert(!/data-to="full_name"/.test(th), 'no "Use as full name" on a full-name column');
  assert.strictEqual(a.run('moveTarget(0, 1)'), null, '→ of a full-name column has nowhere to go (it already fills First Name)');
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
  assert(rendered > 100 && rendered <= 200, `only one page rendered (${rendered})`);
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
  a.run('setEditorPage(19)');
  assert(/data-r="3998"/.test(a.tbody()), 'page 20 holds rows 3801-4000 (200 a page)');
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
    const cols = a.run('editorSlots().map(f => columnMap[f]).filter(c => c >= 0)');
    const [c0, c1] = cols;
    const f0 = a.field(c0);
    a.run(`remapColumn(${c0}, 'ignore', 'button'); remapColumn(${c0}, '${f0}', 'button')`);
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
  a.run(`editCell(0, 0, 'Secret Doe'); editCell(0, 4, 'Secret 130692544'); remapColumn(4, 'empe_gvn_nm', 'button'); swapColumns(4, 1, 'drag'); moveColumn(1, 1); dropOnSlot(4, 'sin', 'drag'); remapColumn(4, 'ignore', 'drag'); remapColumn(4, 'full_name', 'button')`);
  const allow = a.run('analyticsFieldAllowlist()');
  const ALLOWED = { return_type: /^(T4|T1204|T5018|NR4)$/, method: /^(button|drag|keyboard)$/ };
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
  const a0 = app('T4');
  a0.loadFile('t.csv', csv([T4H, ['Doe', 'John', '046454286', '1']]));
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
  // v1 code this replaces is gone
  for (const gone of ['editorColumns', 'rowHeaderState', 'editorFieldOptions', 'ed-head-name', 'ed-src', 'is-ignored', 'class="req"'])
    assert(!js.includes(gone), `app.js still has ${gone}`);
  for (const gone of ['.ed-head-name', '.ed-src', 'is-ignored', '.ed-pick'])
    assert(!css.includes(gone), `styles.css still has ${gone}`);
  // fixed CRA header + Ignored area markup
  assert(/<div id="editor-ignored"[^>]*class="ed-ignored"/.test(html), 'Ignored columns area');
  assert(/aria-live="polite"/.test(html.slice(html.indexOf('id="step-2"'), html.indexOf('id="step-3"'))));
  // density: full width, compact cells, sticky header row and row-number column, more rows a page, still touch-friendly
  const rule = sel => (css.match(new RegExp(`(^|\\n)${sel.replace(/[.#()]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[2] || '';
  assert(/width: min\(1800px, calc\(100vw - 2rem\)\)/.test(rule('#step-2')), 'Step 2 breaks out of the narrow card: ' + rule('#step-2'));
  assert(/position: sticky/.test(rule('.ed-table thead')) && /top: 0/.test(rule('.ed-table thead')), 'sticky header rows');
  assert(/position: sticky/.test(rule('.ed-table tbody th')) && /left: 0/.test(rule('.ed-table tbody th')), 'sticky row numbers');
  assert(/position: sticky/.test(rule('.ed-table thead th.ed-rownum')) && /left: 0/.test(rule('.ed-table thead th.ed-rownum')), 'sticky corner');
  assert(/padding: 0\.2rem 0\.4rem/.test(rule('.ed-table td')), 'compact cells: ' + rule('.ed-table td'));
  assert(/max-height: calc\(100vh - /.test(rule('.ed-wrap')), 'the table fills the screen height: ' + rule('.ed-wrap'));
  assert(/@media \(pointer: coarse\)[^{]*\{[^@]*min-height: 44px/.test(css), 'touch targets grow on touch screens');
  assert(a0.run('EDITOR_PAGE') >= 200, 'more rows a page');
  assert(/\.badge-mandatory \{/.test(css) && /\.badge-optional \{/.test(css) && /\.is-missing/.test(css));
  assert(/class="ed-rownum"/.test(a0.el('editor-tbody').innerHTML), 'row-number cells carry the sticky class');
  assert(/\.cell-error/.test(css) && /\.cell-warning/.test(css));
  assert.strictEqual((js.match(/\bfetch\(/g) || []).length, 1, 'the only fetch is the sample template');
  assert(!/XMLHttpRequest|sendBeacon|WebSocket/.test(js));
}
console.log('table-editor.test.js: all passed');
