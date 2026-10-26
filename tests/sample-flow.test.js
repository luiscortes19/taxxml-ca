// PR C: one-click sample data, Step 2 required-column check, "what you'll need", deadline reminder (.ics),
// intent chip, Step 1 return summary with a Change link.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createApp, ROOT } = require('./harness');

const sampleFetch = url => {
  const m = String(url).match(/templates\/(\w+)_Sample\.csv$/);
  if (!m) return Promise.reject(new Error('unexpected fetch ' + url));
  const b = fs.readFileSync(path.join(ROOT, 'templates', `${m[1]}_Sample.csv`));
  return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)) });
};
const tick = () => new Promise(r => setTimeout(r, 0));
function app(returnType = 'T4', opts = {}) {
  const events = [];
  const a = createApp({ returnType, fetch: sampleFetch, gtag: (cmd, name, params) => events.push([name, JSON.parse(JSON.stringify(params))]), ...opts });
  a.named = n => events.filter(e => e[0] === n).map(e => e[1]);
  a.events = events;
  return a;
}
const shown = (a, id) => !a.el(id).classList.contains('hidden');

(async () => {
  // ---- 1. one-click sample: loads, auto-maps, fills demo filing details, reaches XML ----
  for (const rt of ['T4', 'T5018', 'NR4', 'T1204']) {
    const a = app(rt);
    await a.run(`loadSample('${rt}', 'home')`);
    assert.strictEqual(a.run('currentStep'), 2, `${rt}: sample lands on Step 2`);
    assert(a.run('parsedData.length') >= 2, `${rt}: sample rows parsed`);
    assert(shown(a, 'demo-banner'), `${rt}: demo banner visible`);
    assert.deepStrictEqual(a.named('sample_loaded'), [{ return_type: rt, page: 'home' }]);
    assert.deepStrictEqual(a.named('file_opened'), [{ return_type: rt, is_sample: true }]);
    a.run('continueFromMapping()');
    assert.strictEqual(a.run('currentStep'), 3, `${rt}: required columns of the sample are mapped`);
    assert(/demo/i.test(a.el('tx-name').value), `${rt}: demo transmitter name is obviously fake`);
    const xml = a.generate();
    assert(xml.includes(`<${rt}Slip>`), `${rt}: demo reaches XML: ${a.errors()}`);
  }
  { // returning user's saved details are kept; only empty fields get demo values
    const a = app('T4');
    a.el('tx-name').value = 'Real Co';
    await a.run(`loadSample('T4', 'home')`);
    assert.strictEqual(a.el('tx-name').value, 'Real Co');
  }
  { // demo values are never saved, and a real file afterwards clears them and the banner
    const a = app('T4');
    await a.run(`loadSample('T4', 'home')`);
    a.run('saveFilingDetails()');
    const saved = JSON.parse(a.store.taxxml_filing_details);
    assert(!Object.values(saved).some(v => /demo/i.test(v)), 'demo values not saved: ' + JSON.stringify(saved));
    a.loadFile('mine.csv', Buffer.from('Last Name,First Name,SIN,Box 14 - Employment Income\r\nDoe,John,046454286,100\r\n'));
    assert.strictEqual(a.el('tx-name').value, '', 'demo transmitter name cleared');
    assert(!shown(a, 'demo-banner'), 'banner hidden for a real file');
    assert.deepStrictEqual(a.named('file_opened').map(p => p.is_sample), [true, false]);
  }
  { // fetch failure (e.g. opened from file://) shows an error, no crash, no sample_loaded
    const a = app('T4', { fetch: () => Promise.reject(new Error('offline')) });
    await a.run(`loadSample('T4', 'home')`);
    assert(/sample/i.test(a.el('file-error').textContent), a.el('file-error').textContent);
    assert.deepStrictEqual(a.named('sample_loaded'), []);
  }
  { // deep link from a generator page: /?return=NR4&sample=1#converter
    const a = app('T4', { search: '?return=NR4&sample=1' });
    for (let i = 0; i < 5; i++) await tick();
    assert.strictEqual(a.el('return-type').value, 'NR4');
    assert.deepStrictEqual(a.named('sample_loaded'), [{ return_type: 'NR4', page: 'landing' }]);
    assert.strictEqual(a.run('currentStep'), 2);
  }
  for (const search of ['?return=T4X&sample=1', '?return=T5018', '?sample=1']) { // nothing to load
    const a = app('T4', { search });
    for (let i = 0; i < 5; i++) await tick();
    assert.deepStrictEqual(a.named('sample_loaded'), [], search);
  }

  // ---- 2. Step 2 Continue blocks on unmapped required columns ----
  {
    const a = app('T4');
    a.loadFile('t4.csv', Buffer.from('Nom,Prenom,Pay\r\nDoe,John,100\r\n'));
    a.run('continueFromMapping()');
    assert.strictEqual(a.run('currentStep'), 2, 'blocked on Step 2');
    const box = a.el('mapping-errors');
    assert(shown(a, 'mapping-errors'));
    for (const l of ['Last Name (Box 12)', 'SIN (Box 12)', 'Employment Income (Box 14)']) assert(box.innerHTML.includes(l), `lists ${l}: ${box.innerHTML}`);
    assert(/Your Excel Column/.test(box.innerHTML), 'says how to fix');
    a.run('columnMap.empe_snm = 0; columnMap.sin = 1; columnMap.empt_incamt = 2; continueFromMapping()');
    assert.strictEqual(a.run('currentStep'), 3);
    assert(!shown(a, 'mapping-errors'), 'errors cleared once mapped');
  }
  { // required fields are starred in the mapping table
    const a = app('T5018');
    a.loadFile('t.csv', Buffer.from('Recipient Name,Recipient BN,Subcontractor Payments\r\nAcme,123456789,100\r\n'));
    const stars = a.created.filter(e => e.className === 'req' && e.textContent === '*').length;
    assert.strictEqual(stars, 3, 'T5018 has 3 required fields');
  }

  // ---- 3. "What you'll need" per return + Step 1 return summary ----
  const needs = rt => { const a = app('T4'); a.el('return-type').value = rt; a.run('onReturnTypeChange()'); return a; };
  assert(/RP/.test(needs('T4').el('needs').innerHTML));
  assert(/RZ/.test(needs('T5018').el('needs').innerHTML));
  assert(/3 letters \+ 6 digits/.test(needs('NR4').el('needs').innerHTML));
  assert(/RP/.test(needs('T1204').el('needs').innerHTML));
  for (const rt of ['T4', 'T5018', 'NR4', 'T1204']) {
    const a = needs(rt);
    assert(/Internet File Transfer/.test(a.el('needs').innerHTML), `${rt}: transmitter item`);
    assert(a.el('return-current').textContent.startsWith(rt), `${rt}: Step 1 shows the selected return`);
  }
  { // Change link reveals the return select
    const a = app('T4');
    assert(!shown(a, 'return-select-group'));
    a.run('showReturnSelect()');
    assert(shown(a, 'return-select-group'));
  }

  // ---- 5. deadline: last day of Feb (T4) / Mar 31 (NR4, T1204) / Jun 30 (T5018, calendar year), next business day ----
  {
    const a = app('T4');
    const due = (rt, y) => a.run(`filingDueDate('${rt}', ${y})`);
    assert.strictEqual(due('T4', 2026), '2027-03-01', 'Sun Feb 28 2027 -> Mon Mar 1');
    assert.strictEqual(due('T4', 2025), '2026-03-02', 'Sat Feb 28 2026 -> Mon Mar 2');
    assert.strictEqual(due('T4', 2027), '2028-02-29', 'leap year');
    assert.strictEqual(due('T4', 2022), '2023-02-28', 'weekday stays');
    assert.strictEqual(due('NR4', 2026), '2027-03-31');
    assert.strictEqual(due('T1204', 2026), '2027-03-31');
    assert.strictEqual(due('NR4', 2028), '2029-04-03', 'Sat Mar 31 2029 -> Easter Monday Apr 2 -> Tue Apr 3');
    assert.strictEqual(due('T1204', 2023), '2024-04-02', 'Sun Mar 31 2024 (Easter) -> Easter Monday Apr 1 -> Tue Apr 2');
    assert.strictEqual(due('T5018', 2026), '2027-06-30');
    assert.strictEqual(due('T5018', 2029), '2030-07-02', 'Sun Jun 30 2030 -> Canada Day Jul 1 -> Tue Jul 2');
    const next = (rt, d) => JSON.parse(JSON.stringify(a.run(`nextFilingDue('${rt}', new Date(${JSON.stringify(d)}))`)));
    assert.deepStrictEqual(next('T4', '2026-10-26T12:00:00'), { year: 2026, due: '2027-03-01' });
    assert.deepStrictEqual(next('T4', '2027-03-01T23:00:00'), { year: 2026, due: '2027-03-01' }, 'due day itself');
    assert.deepStrictEqual(next('T4', '2027-03-02T08:00:00'), { year: 2027, due: '2028-02-29' });
    assert.deepStrictEqual(next('T5018', '2026-10-26T12:00:00'), { year: 2026, due: '2027-06-30' });

    const PII = ['Secret Co', '111111118RP0001', 'secret@example.com', 'Pat Secret'];
    a.setDetails({ 'tx-name': 'Secret Co', 'py-bn': '111111118RP0001', 'tx-email': 'secret@example.com', 'tx-contact': 'Pat Secret' });
    const ics = a.run(`reminderICS('T4', new Date('2026-10-26T12:00:00'))`);
    assert(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'), 'CRLF calendar');
    for (const l of ['VERSION:2.0', 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20270215', 'DTEND;VALUE=DATE:20270216', 'BEGIN:VALARM', 'END:VALARM'])
      assert(ics.split('\r\n').includes(l), `ics has ${l}\n${ics}`);
    const unfolded = ics.replace(/\r\n /g, '');
    assert(/SUMMARY:.*T4.*March 1\\, 2027/.test(unfolded), unfolded);
    assert(unfolded.includes('https://taxxml.ca/?return=T4#converter'), 'links back to the site');
    assert(ics.split('\r\n').every(l => Buffer.byteLength(l) <= 75), 'lines folded to 75 octets');
    for (const p of PII) assert(!unfolded.includes(p), `ics leaks ${p}`);

    a.run(`addReminder()`);
    assert.deepStrictEqual(a.named('reminder_added'), [{ return_type: 'T4' }]);
  }

  // ---- 6. intent chip ----
  {
    const session = {};
    const a = app('T4', { session });
    assert(shown(a, 'intent'), 'asked on first visit');
    a.run(`chooseIntent('exploring_format')`);
    a.run(`chooseIntent('my name is Pat')`);
    assert.deepStrictEqual(a.named('intent_selected'), [{ intent: 'exploring_format' }]);
    assert(!shown(a, 'intent'));
    assert(Object.values(session).every(v => v === '1'), 'stores only a flag: ' + JSON.stringify(session));
    const b = app('T4', { session });
    assert(!shown(b, 'intent'), 'not asked again this session');
    const c = app('T4', { session: {} });
    c.run('dismissIntent()');
    assert(!shown(c, 'intent'));
    assert.deepStrictEqual(c.named('intent_selected'), [], 'dismiss sends nothing');
  }

  // ---- every new event/param carries only enums/booleans ----
  {
    const a = app('T4', { session: {} });
    await a.run(`loadSample('T5018', 'home')`);
    a.run(`chooseIntent('for_client'); addReminder()`);
    const ALLOWED = { return_type: /^(T4|T1204|T5018|NR4)$/, page: /^(home|landing)$/, is_sample: /^(true|false)$/,
                      intent: /^(filing_now|exploring_format|for_client)$/, step: /^[1-4]$/ };
    for (const [name, params] of a.events) for (const [k, v] of Object.entries(params)) {
      assert(ALLOWED[k], `${name}: unexpected param ${k}`);
      assert(ALLOWED[k].test(String(v)), `${name}.${k} = ${v}`);
    }
  }
  console.log('sample-flow.test.js: all passed');
})().catch(e => { console.error(e); process.exit(1); });
