// Headless runner for the real browser code: loads js/validate.js + js/app.js into a vm
// context with a minimal DOM stub, then drives file -> auto map -> generate like a user would.
// Zero dependencies apart from SheetJS (the same xlsx 0.20.3 build index.html loads).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');

// Fixed Step 3 answers so generated XML is deterministic.
const FILING_DETAILS = {
  'tx-bn': '123456789MM0001', 'tx-name': 'Test Transmitter Inc', 'tx-ref': 'TEST01', 'tx-lang': 'E',
  'tx-contact': 'Jane Smith', 'tx-phone': '604-638-8328', 'tx-email': 'jane@example.com',
  'py-bn': '987654321RP0001', 'py-name': 'Test Payer Ltd', 'py-addr': '100 Main Street', 'py-city': 'Ottawa',
  'py-prov': 'ON', 'py-postal': 'K1A 0B1', 'py-contact': 'Jane Smith', 'py-phone': '613-555-0100',
  't4-dental-code': '1', 'nr4-acct': 'NRA123456',
  't5018-fiscal-day': '31', 't5018-fiscal-month': '12', 't5018-fiscal-year': '2025',
  'tax-year': '2025', 'report-type': 'O',
};

function makeElement(id) {
  const classes = new Set(id === undefined ? [] : ['hidden']);
  const listeners = {};
  let value = '';
  const el = {
    id, get value() { return value; }, set value(v) { value = String(v); }, // like a real input: always a string
    textContent: '', innerHTML: '', tagName: 'DIV', dataset: {}, style: {}, children: [],
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, on) => { (on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c); },
      contains: c => classes.has(c),
    },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    dispatchEvent: e => { (listeners[e.type] || []).forEach(fn => fn(e)); },
    appendChild: child => { el.children.push(child); return child; },
    removeChild: child => { el.children = el.children.filter(c => c !== child); },
    insertBefore: child => child,
    append: () => {},
    remove: () => {},
    closest: () => makeElement(),
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute: (k, v) => { el[`attr:${k}`] = String(v); },
    removeAttribute: k => { delete el[`attr:${k}`]; },
    scrollIntoView: () => {},
    focus: () => {},
    click: () => { (listeners.click || []).forEach(fn => fn({ target: el })); el.onclickCalled = (el.onclickCalled || 0) + 1; },
  };
  return el;
}

// Returns a fresh app instance: { ctx, run(code), els, loadFile(name, bytes), setDetails(), generate() }.
// now: pins the app's clock (e.g. '2027-01-15T10:00'); search: the page's ?query (e.g. '?return=NR4').
// reportEndpoint: stands in for js/report.js's REPORT_ENDPOINT (empty in the committed file).
function createApp({ returnType = 'T4', gtag, URL: urlImpl, withStorage, now, search = '', fetch, session, reportEndpoint } = {}) {
  const els = {};
  const getEl = id => (els[id] = els[id] || makeElement(id));
  const created = [];
  // the hero's .return-pick buttons, so tests can click them
  const heroPicks = ['T4', 'T5018', 'NR4', 'T1204'].map(r => Object.assign(makeElement(), { dataset: { return: r } }));
  const document = {
    getElementById: getEl,
    querySelector: () => makeElement(),
    querySelectorAll: sel => (sel === '.return-pick' ? heroPicks : []),
    createElement: tag => { const e = makeElement(); e.tagName = tag.toUpperCase(); created.push(e); return e; },
    body: makeElement('body'),
  };
  const docListeners = {}; // recorded, never fired on their own (DOMContentLoaded included); tests call dispatchEvent / docEvent
  document.addEventListener = (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); };
  document.dispatchEvent = e => { (docListeners[e.type] || []).forEach(fn => fn(e)); };
  class FileReader {
    readAsArrayBuffer(file) { this.onload({ target: { result: file.bytes } }); }
  }
  const store = withStorage || {};
  const ctx = {
    document, FileReader, XLSX, console, setTimeout, clearTimeout, TextDecoder,
    location: { hostname: 'taxxml.ca', search }, URLSearchParams, fetch,
    sessionStorage: { getItem: k => (session || {})[k] ?? null, setItem: (k, v) => { if (session) session[k] = String(v); } },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    Blob: class Blob { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; } },
    URL: urlImpl || { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
    Event: class Event { constructor(type) { this.type = type; } },
  };
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  if (gtag) ctx.gtag = gtag;
  vm.createContext(ctx);
  if (now) vm.runInContext(`Date = class extends Date { constructor(...a) { super(...(a.length ? a : [${+new Date(now)}])); } static now() { return ${+new Date(now)}; } };`, ctx);
  getEl('return-type').value = returnType;
  for (const f of ['js/report.js', 'js/validate.js', 'js/app.js']) {
    let src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (f === 'js/report.js' && reportEndpoint) src = src.replace("REPORT_ENDPOINT = ''", `REPORT_ENDPOINT = ${JSON.stringify(reportEndpoint)}`);
    vm.runInContext(src, ctx, { filename: f });
  }
  const run = code => vm.runInContext(code, ctx);
  return {
    ctx, els, created, run, store, el: getEl, heroPicks,
    docEvent: e => (docListeners[e.type] || []).forEach(fn => fn(e)),
    loadFile(name, bytes) { run('handleFile')({ name, bytes: new Uint8Array(bytes) }); },
    setDetails(overrides = {}) {
      const perReturn = returnType === 'T5018' ? { 'py-bn': '987654321RZ0001' } : {}; // T5018 payer is the RZ program
      for (const [id, v] of Object.entries({ ...FILING_DETAILS, ...perReturn, ...overrides })) getEl(id).value = v;
    },
    generate() { run('generateXML()'); return run('xmlOutput'); },
    errors() { return getEl('generate-errors').innerHTML; },
  };
}

// file bytes -> XML, the whole pipeline. Throws with the on-screen errors if generation is blocked.
function fileToXML(returnType, fileName, bytes, detailOverrides, appOptions) {
  const app = createApp({ returnType, ...appOptions });
  app.loadFile(fileName, bytes);
  const fileErr = app.els['file-error'] && app.els['file-error'].textContent;
  if (fileErr) throw new Error(fileErr);
  app.setDetails(detailOverrides);
  const xml = app.generate();
  if (!xml) throw new Error(`${returnType} ${fileName}: generation blocked: ${app.errors()}`);
  return { xml, app };
}

// Personal values that must never reach GA4 or an error report (names, SINs, BNs, amounts, file names, emails...).
const PII_FIXTURES = ['John', 'Doe', 'Roe', 'Jane', '46454286', '046454286', '123456789', '130692544', '54321.99', '777.10',
                      'secret-payroll.csv', 'Test Transmitter', 'Test Payer', 'jane@example.com', '604-638-8328', '987654321', '100 Main'];

module.exports = { createApp, fileToXML, FILING_DETAILS, PII_FIXTURES, ROOT, XLSX };
