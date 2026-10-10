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
  const el = {
    id, value: '', textContent: '', innerHTML: '', tagName: 'DIV', dataset: {}, style: {}, children: [],
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
    scrollIntoView: () => {},
    focus: () => {},
    click: () => { (listeners.click || []).forEach(fn => fn({ target: el })); el.onclickCalled = (el.onclickCalled || 0) + 1; },
  };
  return el;
}

// Returns a fresh app instance: { ctx, run(code), els, loadFile(name, bytes), setDetails(), generate() }.
function createApp({ returnType = 'T4', gtag, URL: urlImpl, withStorage } = {}) {
  const els = {};
  const getEl = id => (els[id] = els[id] || makeElement(id));
  const created = [];
  const document = {
    getElementById: getEl,
    querySelector: () => makeElement(),
    querySelectorAll: () => [],
    createElement: tag => { const e = makeElement(); e.tagName = tag.toUpperCase(); created.push(e); return e; },
    addEventListener: () => {},
    body: makeElement('body'),
  };
  class FileReader {
    readAsArrayBuffer(file) { this.onload({ target: { result: file.bytes } }); }
  }
  const store = withStorage || {};
  const ctx = {
    document, FileReader, XLSX, console, setTimeout, clearTimeout, TextDecoder,
    location: { hostname: 'taxxml.ca' },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    Blob: class Blob { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; } },
    URL: urlImpl || { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
    Event: class Event { constructor(type) { this.type = type; } },
  };
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  if (gtag) ctx.gtag = gtag;
  vm.createContext(ctx);
  getEl('return-type').value = returnType;
  for (const f of ['js/validate.js', 'js/app.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  const run = code => vm.runInContext(code, ctx);
  return {
    ctx, els, created, run, store, el: getEl,
    loadFile(name, bytes) { run('handleFile')({ name, bytes: new Uint8Array(bytes) }); },
    setDetails(overrides = {}) {
      for (const [id, v] of Object.entries({ ...FILING_DETAILS, ...overrides })) getEl(id).value = v;
    },
    generate() { run('generateXML()'); return run('xmlOutput'); },
    errors() { return getEl('generate-errors').innerHTML; },
  };
}

// file bytes -> XML, the whole pipeline. Throws with the on-screen errors if generation is blocked.
function fileToXML(returnType, fileName, bytes, detailOverrides) {
  const app = createApp({ returnType });
  app.loadFile(fileName, bytes);
  const fileErr = app.els['file-error'] && app.els['file-error'].textContent;
  if (fileErr) throw new Error(fileErr);
  app.setDetails(detailOverrides);
  const xml = app.generate();
  if (!xml) throw new Error(`${returnType} ${fileName}: generation blocked: ${app.errors()}`);
  return { xml, app };
}

module.exports = { createApp, fileToXML, FILING_DETAILS, ROOT, XLSX };
