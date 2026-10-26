// GA4: downloadXML must fire exactly one xml_downloaded {return_type} per successful download, before the click.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createApp } = require('./harness');

function setup({ xml = '<Submission/>', createObjectURL } = {}) {
  const log = [];
  const gtag = (...args) => log.push(['gtag', ...args]);
  const URL = {
    createObjectURL: createObjectURL || (() => { log.push(['createObjectURL']); return 'blob:x'; }),
    revokeObjectURL: () => log.push(['revoke']),
  };
  const app = createApp({ returnType: 'NR4', gtag, URL });
  log.length = 0; // drop the page-load return_selected
  app.el('tax-year').value = '2025';
  app.run(`xmlOutput = ${JSON.stringify(xml)}`);
  const origCreate = app.ctx.document.createElement;
  app.ctx.document.createElement = tag => {
    const el = origCreate(tag);
    el.click = () => log.push(['click', el.download]);
    return el;
  };
  return { app, log, events: () => JSON.parse(JSON.stringify(log.filter(l => l[0] === 'gtag'))) };
}

{
  const { app, log, events } = setup();
  app.run('downloadXML()');
  assert.deepStrictEqual(events(), [['gtag', 'event', 'xml_downloaded', { return_type: 'NR4' }]]);
  const iEvent = log.findIndex(l => l[0] === 'gtag');
  const iClick = log.findIndex(l => l[0] === 'click');
  assert(iClick >= 0 && log[iClick][1] === 'NR4_submission_2025.xml');
  assert(iEvent < iClick, 'event is queued before the download click');
  assert(!log.some(l => l[0] === 'revoke'), 'blob URL must not be revoked synchronously (races the download)');
}
{ // nothing generated -> no download, no event
  const { app, log } = setup({ xml: '' });
  app.run('downloadXML()');
  assert.deepStrictEqual(log, []);
}
{ // download can't start -> no event
  const { app, events } = setup({ createObjectURL: () => { throw new Error('blocked'); } });
  assert.throws(() => app.run('downloadXML()'), /blocked/);
  assert.deepStrictEqual(events(), []);
}
{ // analytics failure never breaks the download
  const app = createApp({ returnType: 'T4', gtag: () => { throw new Error('ga down'); } });
  app.run('xmlOutput = "<x/>"');
  let clicked = 0;
  const orig = app.ctx.document.createElement;
  app.ctx.document.createElement = t => Object.assign(orig(t), { click: () => clicked++ });
  app.run('downloadXML()');
  assert.strictEqual(clicked, 1);
}
{ // no gtag on the page (blocked) -> download still works
  const app = createApp({ returnType: 'T4' });
  app.run('xmlOutput = "<x/>"');
  app.run('downloadXML()');
}

// ---- Funnel diagnostics ----
// Collects only the GA4 events (name + params) a fresh app fires, ignoring anything before `since`.
function funnel(returnType = 'T4', opts = {}) {
  const events = [];
  const app = createApp({ returnType, gtag: (cmd, name, params) => events.push([name, JSON.parse(JSON.stringify(params))]), ...opts });
  return { app, events, named: n => events.filter(e => e[0] === n).map(e => e[1]) };
}
const csv = s => Buffer.from(s);

{ // step_reached fires on actual step changes only, with the direction
  const { app, named } = funnel();
  app.run('goToStep(2); goToStep(3); goToStep(3); goToStep(1); goToStep(1); goToStep(4)');
  assert.deepStrictEqual(named('step_reached'), [{ step: 2, direction: 'forward' }, { step: 3, direction: 'forward' },
                                                 { step: 1, direction: 'back' }, { step: 4, direction: 'forward' }]);
  app.run('resetAll()');                               // Start Over
  app.run('resetAll()');                               // already on Step 1: no change, no event
  assert.deepStrictEqual(named('step_reached').slice(4), [{ step: 1, direction: 'reset' }]);
}
{ // return_selected.source: hero button, Step 1 dropdown
  const { app, named } = funnel();
  app.heroPicks[1].click();                            // T5018
  app.el('return-type').value = 'NR4';
  app.el('return-type').dispatchEvent(new app.ctx.Event('change'));
  assert.deepStrictEqual(named('return_selected'), [{ return_type: 'T5018', source: 'hero' }, { return_type: 'NR4', source: 'dropdown' }]);
  app.loadFile('x.csv', csv('Recipient Name,Foreign Tax ID,Gross Income\r\nA,1,1\r\n'));
  assert.strictEqual(named('return_selected').length, 2, 'an explicit choice means no default event');
}
{ // return_selected.source 'default': a file opened with the preselected return, once, before file_opened
  const { app, events, named } = funnel('T4');
  app.loadFile('t4.csv', csv('Last Name,SIN,Employment Income\r\nDoe,046454286,1\r\n'));
  app.loadFile('t4.csv', csv('Last Name,SIN,Employment Income\r\nDoe,046454286,1\r\n'));
  assert.deepStrictEqual(named('return_selected'), [{ return_type: 'T4', source: 'default' }]);
  const order = events.map(e => e[0]);
  assert(order.indexOf('return_selected') < order.indexOf('file_opened'), order.join());
}
{ // picker_opened: the dropzone opens the file picker
  const { app, named } = funnel('NR4');
  app.el('dropzone').click();
  assert.deepStrictEqual(named('picker_opened'), [{ return_type: 'NR4' }]);
}
{ // generate_clicked fires before (and regardless of) the validation result
  const { app, events, named } = funnel('T5018');
  app.generate();                                      // nothing mapped at all
  app.loadFile('t.csv', csv('Recipient Name,Recipient BN,Subcontractor Payments\r\nAcme,123456789,100\r\n'));
  app.setDetails({ 'tx-name': '' });
  app.generate();
  assert.deepStrictEqual(named('generate_clicked'), [{ return_type: 'T5018' }, { return_type: 'T5018' }]);
  const order = events.map(e => e[0]).filter(n => /generate_clicked|validation_failed/.test(n));
  assert.deepStrictEqual(order, ['generate_clicked', 'validation_failed', 'generate_clicked', 'validation_failed']);
}
{ // file_opened: is_sample, rows_bucket, required_unmapped
  const rows = n => 'Last Name,SIN,Employment Income\r\n' + 'Doe,046454286,1\r\n'.repeat(n);
  for (const [n, bucket] of [[1, '1'], [2, '2-5'], [5, '2-5'], [6, '6-20'], [20, '6-20'], [21, '21-100'], [100, '21-100'], [101, '100+']]) {
    const { app, named } = funnel('T4');
    app.loadFile('t4.csv', csv(rows(n)));
    assert.deepStrictEqual(named('file_opened'), [{ return_type: 'T4', is_sample: false, rows_bucket: bucket, required_unmapped: 0 }], `${n} rows`);
  }
  const { app, named } = funnel('T4');
  app.loadFile('t4.csv', csv('Name,Pay\r\nDoe,1\r\n'));            // none of last name / SIN / income auto-map
  assert.strictEqual(named('file_opened')[0].required_unmapped, 3);
}
{ // is_sample: every template counts as a sample, under whichever return is selected; edited copies don't
  for (const rt of ['T4', 'T1204', 'T5018', 'NR4']) {
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'templates', `${rt}_Sample.csv`));
    for (const selected of [rt, rt === 'T4' ? 'NR4' : 'T4']) {
      const { app, named } = funnel(selected);
      app.loadFile('renamed-anything.csv', bytes);
      const p = named('file_opened')[0];
      assert.strictEqual(p.is_sample, true, `${rt} sample opened as ${selected}`);
      if (selected === rt) assert.strictEqual(p.required_unmapped, 0, `${rt} sample maps every required column`);
    }
    // same headers, real first row -> not the sample
    const text = rt === 'NR4' ? bytes.toString('utf8') : bytes.toString('utf16le').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/);
    lines[1] = 'Zed' + lines[1];
    const { app, named } = funnel(rt);
    app.loadFile(`${rt}_Sample.csv`, csv(lines.join('\r\n')));
    assert.strictEqual(named('file_opened')[0].is_sample, false, `${rt}: edited first row`);
  }
}
{ // Step 3 field problems -> validation_failed, category filing_details, count of bad fields
  const { app, named } = funnel('T5018');
  app.loadFile('t.csv', csv('Recipient Name,Recipient BN,Subcontractor Payments\r\nAcme,123456789,100\r\n'));
  app.setDetails({ 'tx-name': '', 'tx-email': 'nope' });
  assert.strictEqual(app.generate(), '');
  assert.deepStrictEqual(named('validation_failed'), [{ return_type: 'T5018', error_count: 2, error_category: 'filing_details', first_error_field: 'tx-name' }]);
  assert.deepStrictEqual(named('validation_passed'), []);
}
{ // row problems -> validation_failed, category row_data, count of row errors
  const { app, named } = funnel('T4');
  app.loadFile('t4.csv', csv('Last Name,First Name,SIN,Box 14 - Employment Income\r\nDoe,John,46454286,100\r\nRoe,Jane,123456789,100\r\n'));
  app.setDetails();
  assert.strictEqual(app.generate(), '');
  assert.deepStrictEqual(named('validation_failed'), [{ return_type: 'T4', error_count: 2, error_category: 'row_data', first_error_field: 'sin' }]);
}
{ // successful generation -> exactly one validation_passed
  const { app, named } = funnel('NR4');
  app.loadFile('NR4_input.csv', fs.readFileSync(path.join(__dirname, 'fixtures', 'NR4_input.csv')));
  app.setDetails();
  assert(app.generate());
  assert.deepStrictEqual(named('validation_passed'), [{ return_type: 'NR4' }]);
  assert.deepStrictEqual(named('validation_failed'), []);
}
{ // file parse errors -> category only
  const { app, named } = funnel('T1204');
  app.loadFile('payroll.pdf', csv('x'));
  app.loadFile('empty.csv', csv('Name,BN\r\n'));
  app.ctx.XLSX = { read: () => { throw new Error('corrupt payroll.xlsx'); } };
  app.loadFile('broken.xlsx', csv('x'));
  assert.deepStrictEqual(named('file_parse_error'), [
    { return_type: 'T1204', error_category: 'unsupported_type' },
    { return_type: 'T1204', error_category: 'no_data_rows' },
    { return_type: 'T1204', error_category: 'read_error' },
  ]);
}
{ // Start fresh button
  const { app, named } = funnel('T4');
  app.run('clearFilingDetails()');
  assert.deepStrictEqual(named('start_fresh'), [{}]);
}
{ // NO PII: drive every event with personal data in the file and Step 3, then scan every param value
  const PII = ['John', 'Doe', 'Roe', 'Jane', '46454286', '046454286', '123456789', '130692544', '54321.99', '777.10',
               'secret-payroll.csv', 'Test Transmitter', 'Test Payer', 'jane@example.com', '604-638-8328', '987654321', '100 Main'];
  const { app, events } = funnel('T4');
  app.loadFile('secret-payroll.pdf', csv('x'));
  app.el('dropzone').click();
  // custom headers carry a fake name + SIN too: the SIN column's own header, and an unmapped free-text column
  app.loadFile('secret-payroll.csv', csv('Last Name,First Name,SIN Jane Doe 046454286,Box 14 - Employment Income,Jane Doe 046454286 notes\r\n' +
                                         'Doe,John,46454286,54321.99,Jane Doe 046454286\r\nRoe,Jane,123456789,777.10,Jane Doe\r\n'));
  app.setDetails({ 'tx-email': 'jane@example' });
  app.generate();                                      // filing_details failure
  app.setDetails();
  app.generate();                                      // row_data failure
  app.run('parsedData[0][2] = "046454286"; parsedData[1][2] = "130692544"');
  assert(app.generate());                              // passed
  app.run('downloadXML(); clearFilingDetails(); goToStep(1); resetAll()');
  app.heroPicks[0].click();
  app.el('return-type').dispatchEvent(new app.ctx.Event('change'));
  const names = new Set(events.map(e => e[0]));
  for (const n of ['return_selected', 'file_opened', 'file_parse_error', 'step_reached', 'validation_failed', 'validation_passed', 'xml_downloaded', 'start_fresh',
                   'picker_opened', 'generate_clicked'])
    assert(names.has(n), `expected ${n} in ${[...names]}`);
  const ALLOWED = { return_type: /^(T4|T1204|T5018|NR4)$/, source: /^(default|hero|dropdown|landing)$/, step: /^[1-4]$/, error_count: /^\d+$/,
                    error_category: /^(filing_details|row_data|unsupported_type|no_data_rows|read_error)$/,
                    first_error_field: /^[a-z0-9_-]+$/, direction: /^(forward|back|reset)$/,
                    is_sample: /^(true|false)$/, rows_bucket: /^(1|2-5|6-20|21-100|100\+)$/, required_unmapped: /^\d$/ };
  for (const [, params] of events) for (const k of ['is_sample', 'required_unmapped', 'step']) if (k in params) assert.notStrictEqual(typeof params[k], 'string', k);
  for (const [name, params] of events) {
    for (const [k, v] of Object.entries(params || {})) {
      assert(ALLOWED[k], `${name}: unexpected param ${k}`);
      assert(ALLOWED[k].test(String(v)), `${name}.${k} = ${v}`);
      for (const p of PII) assert(!String(v).includes(p), `${name}.${k} leaks "${p}"`);
    }
  }
  const allow = app.run('analyticsFieldAllowlist()');
  assert.deepStrictEqual(events.filter(e => e[0] === 'validation_failed').map(e => e[1].first_error_field), ['tx-email', 'sin']);
  for (const [, p] of events) if ('first_error_field' in p) assert(p.first_error_field === 'other' || allow.has(p.first_error_field));
}
{ // allowlist: known column keys + Step 3 ids pass through; anything else (custom header, free text, cell value) -> 'other'
  const { app } = funnel('T4');
  for (const f of ['sin', 'empt_incamt', 'vendor_bn', 'sbctrcr_amt', 'fssn_nbr', 'tx-email', 'py-bn', 'nr4-acct', 't5018-fiscal-year'])
    assert.strictEqual(app.run(`analyticsField(${JSON.stringify(f)})`), f);
  for (const f of ['Jane Doe 046454286', '046454286', 'SIN', 'box_99', '', undefined, '__proto__', 'constructor'])
    assert.strictEqual(app.run(`analyticsField(${JSON.stringify(f)})`), 'other', String(f));
}
{ // a failure with no specific cell (no valid rows at all) -> 'other'
  const { app, named } = funnel('T4');
  app.loadFile('t4.csv', csv('Last Name,First Name,SIN\r\n,,\r\n'));
  app.setDetails();
  app.generate();
  assert.deepStrictEqual(named('validation_failed').map(p => p.first_error_field), ['other']);
}
console.log('analytics.test.js: all passed');
