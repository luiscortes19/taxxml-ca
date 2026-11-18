// GA4: Step 2 table usage and stuck points. table_shown / table_error_state / table_exited carry the table context
// (counts, buckets and our own column keys only); row_deleted, table_menu_opened, table_help_opened, table_hscroll.
const assert = require('assert');
const { createApp } = require('./harness');

function funnel(returnType = 'T4', opts = {}) {
  const events = [];
  const app = createApp({ returnType, gtag: (cmd, name, params) => events.push([name, JSON.parse(JSON.stringify(params))]), ...opts });
  return { app, events, named: n => events.filter(e => e[0] === n).map(e => e[1]) };
}
const csv = s => Buffer.from(s);
const CLEAN = 'Last Name,First Name,SIN,Box 14 - Employment Income\r\nDoe,John,046454286,100\r\n';
const BAD_SINS = 'Last Name,First Name,SIN,Box 14 - Employment Income\r\nDoe,John,46454286,100\r\nRoe,Jane,123456789,100\r\n';
const UNMAPPED = 'Name,Pay\r\nDoe,1\r\n';                     // none of last name / SIN / income auto-map
const ctx = (over = {}) => ({ return_type: 'T4', is_sample: false, rows_bucket: '1', cols_bucket: '1-8', required_unmapped: 0,
                              error_cells: 0, warning_cells: 0, error_cells_bucket: '0', error_field_list: '', error_by_field: '', ...over });
const SIN_ERRORS = { rows_bucket: '2-5', error_cells: 2, error_cells_bucket: '1-2', first_error_field: 'sin', error_field_list: 'sin', error_by_field: 'sin:2' };
const td = (r, f) => ({ dataset: { r: String(r), f }, getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) });

// ---- 1. table_shown ----
{ // first open: after file_opened, with the table context
  const { app, events, named } = funnel();
  app.loadFile('t4.csv', csv(CLEAN));
  const order = events.map(e => e[0]);
  assert(order.indexOf('file_opened') >= 0 && order.indexOf('file_opened') < order.indexOf('table_shown'), order.join());
  assert.deepStrictEqual(named('table_shown'), [ctx()]);
  // re-renders, a no-op remap and an edit are not a new visit
  app.run('refreshEditor(); remapColumn(2, "sin", "button"); editCell(0, 1, "Johnny")');
  assert.strictEqual(named('table_shown').length, 1);
  // back from Step 3 (and from Step 4) is a new visit
  app.run('goToStep(3); goToStep(2); goToStep(4); goToStep(2)');
  assert.strictEqual(named('table_shown').length, 3);
}
{ // two bad SINs: counts by our own column key
  const { app, named } = funnel();
  app.loadFile('t4.csv', csv(BAD_SINS));
  assert.deepStrictEqual(named('table_shown'), [ctx(SIN_ERRORS)]);
}
{ // required_unmapped, cols_bucket bands
  const { app, named } = funnel();
  app.loadFile('t4.csv', csv(UNMAPPED));
  assert.strictEqual(named('table_shown')[0].required_unmapped, 3);
  for (const [n, bucket] of [[8, '1-8'], [9, '9-16'], [16, '9-16'], [17, '17-24'], [24, '17-24'], [25, '25+']]) {
    const hdr = ['Last Name', 'SIN', 'Employment Income', ...Array.from({ length: n - 3 }, (_, i) => `Extra ${i}`)];
    const f = funnel();
    f.app.loadFile('t4.csv', csv(`${hdr.join(',')}\r\nDoe,046454286,1${',x'.repeat(n - 3)}\r\n`));
    assert.strictEqual(f.named('table_shown')[0].cols_bucket, bucket, `${n} columns`);
  }
}
{ // Step 2 without a file (Step 1's "Continue to your data") is not a table visit
  const { app, named } = funnel();
  app.run('goToStep(2); goToStep(1)');
  assert.deepStrictEqual(named('table_shown'), []);
  assert.deepStrictEqual(named('table_exited'), []);
}

// ---- 2. table_error_state ----
{ // Continue blocked by unmapped required columns
  const { app, named } = funnel();
  app.loadFile('t4.csv', csv(UNMAPPED));
  app.run('continueFromEditor()');
  assert.deepStrictEqual(named('table_error_state'), [ctx({ required_unmapped: 3, trigger: 'continue' })]);
  app.run('refreshEditor()');                            // live re-check of the shown box: no event
  assert.strictEqual(named('table_error_state').length, 1);
}
{ // Generate blocked by row-data errors; validation_failed unchanged beside it
  const { app, named } = funnel();
  app.loadFile('t4.csv', csv(BAD_SINS));
  app.run('editCell(0, 1, "Johnny")');                   // live revalidate: no event
  assert.deepStrictEqual(named('table_error_state'), []);
  app.run('continueFromEditor()');
  app.setDetails();
  assert.strictEqual(app.generate(), '');
  assert.deepStrictEqual(named('table_error_state'), [ctx({ ...SIN_ERRORS, trigger: 'generate' })]);
  assert.deepStrictEqual(named('validation_failed'), [{ return_type: 'T4', error_count: 2, error_category: 'row_data', first_error_field: 'sin' }]);
}
{ // Generate blocked by unmapped required columns
  const { app, named } = funnel();
  app.loadFile('t4.csv', csv(UNMAPPED));
  app.run('goToStep(3)');
  app.setDetails();
  app.generate();
  assert.deepStrictEqual(named('table_error_state'), [ctx({ required_unmapped: 3, trigger: 'generate' })]);
}
{ // Step 3 filing-details failure: validation_failed as today, no table_error_state
  const { app, named } = funnel('T5018');
  app.loadFile('t.csv', csv('Recipient Name,Recipient BN,Subcontractor Payments\r\nAcme,123456789,100\r\n'));
  app.setDetails({ 'tx-name': '', 'tx-email': 'nope' });
  assert.strictEqual(app.generate(), '');
  assert.deepStrictEqual(named('validation_failed'), [{ return_type: 'T5018', error_count: 2, error_category: 'filing_details', first_error_field: 'tx-name' }]);
  assert.deepStrictEqual(named('table_error_state'), []);
}

// ---- 3. table_exited ----
const exited = (reason, over = {}) => ctx({ exit_reason: reason, step2_seconds_bucket: '0-10', step2_seconds: 0,
                                            remaps_count: 0, edits_count: 0, deletes_count: 0, ...over });
{ // Continue right away; a later page close sends nothing more
  const { app, named } = funnel();
  app.loadFile('t4.csv', csv(CLEAN));
  app.run('continueFromEditor()');
  assert.deepStrictEqual(named('table_exited'), [exited('continue')]);
  app.winEvent({ type: 'pagehide' });
  app.run('goToStep(4); resetAll()');                    // left Step 2 already: Start Over isn't a table exit
  assert.strictEqual(named('table_exited').length, 1);
}
{ // Back to Step 1, then Start Over from Step 2 (context taken before the reset clears the file)
  const { app, named } = funnel();
  app.loadFile('t4.csv', csv(CLEAN));
  app.run('goToStep(1)');
  app.run('goToStep(2); resetAll()');
  assert.deepStrictEqual(named('table_exited'), [exited('back'), exited('reset')]);
}
{ // page closed on Step 2: once, sent as a beacon
  const { app, named } = funnel();
  app.loadFile('t4.csv', csv(CLEAN));
  app.winEvent({ type: 'pagehide' });
  app.winEvent({ type: 'pagehide' });
  assert.deepStrictEqual(named('table_exited'), [exited('pagehide', { transport_type: 'beacon' })]);
}
{ // counters: this visit's remaps, edits (a paste is one), deletes; time on the table; zeroed on the next visit
  const { app, named } = funnel();
  app.loadFile('t4.csv', csv(CLEAN + 'Roe,Jane,130692544,200\r\n'));
  app.run('remapColumn(1, "ignore", "button"); remapColumn(1, "empe_gvn_nm", "drag")');
  app.run('editCell(0, 3, "150"); pasteCells(0, "empt_incamt", "1\\n2"); deleteRow(1); undoDelete(); deleteRow(1)');
  app.run('const realNow = Date.now; Date.now = () => realNow() + 45000');
  app.run('continueFromEditor()');
  app.run('goToStep(2); goToStep(1)');
  const [first, second] = named('table_exited');
  assert.deepStrictEqual(first, exited('continue', { step2_seconds_bucket: '31-60', step2_seconds: 45, remaps_count: 2, edits_count: 2, deletes_count: 2 }));
  assert.deepStrictEqual(second, exited('back'));
}
{ // step2_seconds_bucket bands
  for (const [s, bucket] of [[0, '0-10'], [10, '0-10'], [11, '11-30'], [30, '11-30'], [31, '31-60'], [60, '31-60'], [61, '61-180'], [180, '61-180'], [181, '181+']]) {
    const { app, named } = funnel();
    app.loadFile('t4.csv', csv(CLEAN));
    app.run(`const realNow = Date.now; Date.now = () => realNow() + ${s * 1000 + 500}`);
    app.run('goToStep(1)');
    assert.strictEqual(named('table_exited')[0].step2_seconds_bucket, bucket, `${s} s`);
    assert.strictEqual(named('table_exited')[0].step2_seconds, s);
  }
}

// ---- 4. row_deleted ----
{
  const { app, named } = funnel();
  app.loadFile('t4.csv', csv(CLEAN + 'Roe,Jane,130692544,200\r\n'));
  app.run('deleteRow(0)');
  assert.deepStrictEqual(named('row_deleted'), [{ return_type: 'T4', rows_bucket: '1' }]);
  app.run('undoDelete()');
  assert.strictEqual(named('row_deleted').length, 1, 'Undo sends nothing');
  app.run('deleteRow(99); deleteRow(-1)');               // nothing deleted, nothing sent
  app.run('deleteRow(0); deleteRow(0)');
  assert.deepStrictEqual(named('row_deleted').map(p => p.rows_bucket), ['1', '1', '0']);
}

// ---- 5. table_menu_opened ----
{
  const { app, named } = funnel();
  app.loadFile('t4.csv', csv(CLEAN));
  app.run('toggleColumnMenu(0)');                        // opens
  app.run('toggleColumnMenu(0)');                        // closes
  app.run('toggleColumnMenu(1); closeColumnMenu()');     // opens, closes
  assert.deepStrictEqual(named('table_menu_opened'), [{ return_type: 'T4' }, { return_type: 'T4' }]);
}

// ---- 6. table_help_opened ----
{ // the "Keyboard & help" popover: on open only
  const { app, named } = funnel();
  app.loadFile('t4.csv', csv(CLEAN));
  const help = app.ctx.document.querySelector('details.ed-help');
  help.open = true; help.dispatchEvent({ type: 'toggle' });
  help.open = false; help.dispatchEvent({ type: 'toggle' });
  assert.deepStrictEqual(named('table_help_opened'), [{ return_type: 'T4', help_kind: 'keyboard' }]);
}
{ // a red cell's tip: once per field per visit; a clean cell's no tip at all
  const { app, named } = funnel();
  app.loadFile('t4.csv', csv(BAD_SINS));
  const showTip = app.run('showTip');
  showTip(td(0, 'sin')); showTip(td(0, 'sin')); showTip(td(1, 'sin')); showTip(td(0, 'empe_snm'));
  assert.deepStrictEqual(named('table_help_opened'), [{ return_type: 'T4', help_kind: 'cell_tip', field: 'sin' }]);
  assert.strictEqual(app.el('editor-tip').hidden, true, 'clean cell: tip hidden');
  app.run('goToStep(3); goToStep(2)');
  showTip(td(0, 'sin'));
  assert.strictEqual(named('table_help_opened').length, 2, 'new visit, tip counted again');
}

// ---- 7. table_hscroll ----
{
  const { app, named } = funnel();
  app.loadFile('t4.csv', csv(CLEAN));
  const wrap = app.ctx.document.querySelector('.ed-wrap');
  wrap.scrollLeft = 0; wrap.dispatchEvent({ type: 'scroll' });      // vertical scroll only
  wrap.scrollLeft = 120; wrap.dispatchEvent({ type: 'scroll' });
  wrap.scrollLeft = 300; wrap.dispatchEvent({ type: 'scroll' });
  assert.deepStrictEqual(named('table_hscroll'), [{ return_type: 'T4', cols_bucket: '1-8' }]);
  app.run('goToStep(3); goToStep(2)');
  wrap.dispatchEvent({ type: 'scroll' });
  assert.strictEqual(named('table_hscroll').length, 2, 'new visit');
  app.run('goToStep(3)');
  wrap.dispatchEvent({ type: 'scroll' });                // not on Step 2
  assert.strictEqual(named('table_hscroll').length, 2);
}

// ---- 9. analytics failure or no gtag never breaks the table ----
for (const opts of [{ gtag: () => { throw new Error('ga down'); } }, {}]) {
  const app = createApp({ returnType: 'T4', ...opts });
  app.loadFile('t4.csv', csv(BAD_SINS));
  const help = app.ctx.document.querySelector('details.ed-help');
  help.open = true; help.dispatchEvent({ type: 'toggle' });
  app.run('showTip')(td(0, 'sin'));
  const wrap = app.ctx.document.querySelector('.ed-wrap');
  wrap.scrollLeft = 5; wrap.dispatchEvent({ type: 'scroll' });
  app.run('toggleColumnMenu(0); deleteRow(0)');
  assert.strictEqual(app.run('parsedData.length'), 1);
  app.run('continueFromEditor()');
  assert.strictEqual(app.run('currentStep'), 3);
  app.setDetails();
  assert.strictEqual(app.generate(), '');                // blocked by the bad SIN, no throw
  app.run('goToStep(2); deleteRow(0)');                  // every row gone
  app.winEvent({ type: 'pagehide' });
}
{ // every row deleted, then the page closes: still a clean payload
  const { app, named } = funnel();
  app.loadFile('t4.csv', csv(CLEAN));
  app.run('deleteRow(0)');
  app.winEvent({ type: 'pagehide' });
  assert.deepStrictEqual(named('table_exited'), [exited('pagehide', { rows_bucket: '0', transport_type: 'beacon', deletes_count: 1 })]);
}

console.log('table-analytics.test.js: all passed');
