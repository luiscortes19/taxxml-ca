/* ============================================================
   TaxXML.ca — App Logic (Multi-Return Excel → CRA XML)
   All processing is client-side. No data leaves the browser.
   Supports: T1204, T4, T5018, NR4
   ============================================================ */

// ---- State ----
let parsedData = [];
let headers = [];
let xmlOutput = '';
let currentStep = 1;
let columnMap = {};
let step2Visit = null; // GA4: the current visit to the Step 2 table { start, remaps, edits, deletes, tips, hscroll }, null when off it

// ============================================================
// RETURN TYPE REGISTRY
// ============================================================
// Field-type table. fields are in CRA order (schema / box order): the Step 2 table's fixed header.
// type 'money': digits = digits before the decimal point in the box's XSD decimalNType (xsd: the element names, when
// they aren't the key); type 'code': codes = the choices the editor offers, [value, label]. Checked against the CRA
// schemas by tests/xsd-types.test.js. Everything else is free text, checked in checkRow.
const moneyField = digits => ({ type: 'money', digits });
const provCode = c => [c, { US: 'US (United States)', ZZ: 'ZZ (another country)' }[c] || c];
const BIZ_TYPE_CODES = [['Individual', 'Individual (sole proprietor)'], ['Corporation', 'Corporation'], ['Partnership', 'Partnership']];
const EXEMPT_CODES = [['', '(blank) Not exempt'], ['0', '0 Not exempt'], ['1', '1 Exempt']];
const RETURN_TYPES = {
  T1204: {
    label: 'T1204 — Government Service Contract Payments',
    fields: [
      { key: 'vendor_name',   label: 'Vendor Name',            autoMatch: ['vendor name', 'recipient name', 'payee name'], required: true },
      { key: 'vendor_bn',     label: 'Vendor BN / SIN',        autoMatch: ['vendor bn', 'vendor business', 'vendor sin', 'recipient bn', 'recipient business', 'payee bn', 'payee sin'], required: true },
      { key: 'biz_type',      label: 'Business Type',          autoMatch: ['business type', 'recipient type', 'entity type'], type: 'code', codes: BIZ_TYPE_CODES },
      { key: 'address',       label: 'Address',                autoMatch: ['vendor address', 'recipient address', 'address', 'addr'] },
      { key: 'amount',        label: 'Amount Paid',            autoMatch: ['amount paid', 'amount', 'payment amount', 'total paid'], ...moneyField(10), xsd: ['srvc_pay_amt', 'mxd_gd_pay_amt'] },
      { key: 'svc_only',      label: 'Service Payments Only',  autoMatch: ['service payments', 'service only', 'services only'], type: 'code', codes: [['Yes', 'Yes'], ['No', 'No']] },
    ],
    summaryLabel: 'T1204 Summary — Payer Information',
    summaryHint: 'The government department that made the payments.',
    generateXML: generateT1204XML,
  },
  T4: {
    label: 'T4 — Statement of Remuneration Paid',
    fields: [
      { key: 'empe_snm',       label: 'Last Name (Box 12)',        autoMatch: ['last name', 'surname', 'family name', 'snm'], required: true },
      { key: 'empe_gvn_nm',    label: 'First Name',                autoMatch: ['first name', 'given name', 'gvn'] },
      { key: 'address',        label: 'Employee Address',          autoMatch: ['address', 'addr', 'employee address'] },
      { key: 'empt_prov_cd',   label: 'Province of Employment (Box 10)', autoMatch: ['province of employment', 'box 10', 'prov emp', 'employment prov'], type: 'code', codes: T4_PROVINCE_CODES.map(provCode) },
      { key: 'sin',             label: 'SIN (Box 12)',              autoMatch: ['sin', 'social insurance'], required: true },
      { key: 'empt_incamt',    label: 'Employment Income (Box 14)', autoMatch: ['employment income', 'box 14', 'salary', 'wages', 'gross pay', 'income'], required: true, ...moneyField(8) },
      { key: 'cpp_cntrb_amt',  label: 'CPP Contributions (Box 16)', autoMatch: ['cpp', 'pension plan', 'box 16', 'cpp contrib'], ...moneyField(4) },
      { key: 'cppe_cntrb_amt', label: 'CPP2 Contributions (Box 16A)', autoMatch: ['cpp2', 'second cpp', 'box 16a', 'cppe'], ...moneyField(4) },
      { key: 'qpp_cntrb_amt',  label: 'QPP Contributions (Box 17)', autoMatch: ['qpp', 'quebec pension', 'box 17'], ...moneyField(4) },
      { key: 'empe_eip_amt',   label: 'EI Premiums (Box 18)',      autoMatch: ['ei premium', 'employment insurance', 'box 18', 'ei'], ...moneyField(4) },
      { key: 'rpp_cntrb_amt',  label: 'RPP Contributions (Box 20)', autoMatch: ['rpp', 'registered pension', 'box 20'], ...moneyField(5) },
      { key: 'itx_ddct_amt',   label: 'Income Tax Deducted (Box 22)', autoMatch: ['income tax', 'tax deducted', 'box 22', 'tax withheld'], ...moneyField(8) },
      { key: 'ei_insu_ern_amt', label: 'EI Insurable Earnings (Box 24)', autoMatch: ['insurable earnings', 'box 24', 'ei earn'], ...moneyField(5) },
      { key: 'cpp_qpp_ern_amt', label: 'CPP/QPP Pensionable Earnings (Box 26)', autoMatch: ['pensionable earnings', 'box 26', 'cpp earn', 'qpp earn'], ...moneyField(7) },
      { key: 'cpp_qpp_xmpt_cd', label: 'CPP/QPP Exempt (Box 28)',  autoMatch: ['cpp exempt', 'cpp qpp exempt', 'qpp exempt'], type: 'code', codes: EXEMPT_CODES },
      { key: 'ei_xmpt_cd',     label: 'EI Exempt (Box 28)',        autoMatch: ['ei exempt'], type: 'code', codes: EXEMPT_CODES },
      { key: 'unn_dues_amt',   label: 'Union Dues (Box 44)',       autoMatch: ['union dues', 'box 44', 'union'], ...moneyField(7) },
    ],
    summaryLabel: 'T4 Summary — Employer Information',
    summaryHint: 'The employer who paid the remuneration.',
    generateXML: generateT4XML,
  },
  T5018: {
    label: 'T5018 — Statement of Contract Payments',
    fields: [
      { key: 'rcpnt_name',    label: 'Recipient Name',             autoMatch: ['contractor name', 'recipient name', 'subcontractor', 'payee name', 'company name', 'name'], required: true },
      { key: 'rcpnt_bn',      label: 'Recipient BN / SIN (Box 24)', autoMatch: ['contractor bn', 'recipient bn', 'subcontractor bn', 'contractor sin', 'recipient sin', 'business number'], required: true },
      { key: 'rcpnt_type',    label: 'Recipient Type',             autoMatch: ['recipient type', 'contractor type', 'entity type', 'type'], type: 'code', codes: BIZ_TYPE_CODES },
      { key: 'address',       label: 'Recipient Address',          autoMatch: ['contractor address', 'recipient address', 'subcontractor address', 'address', 'addr'] },
      { key: 'sbctrcr_amt',   label: 'Sub-contractor Payments (Box 22)', autoMatch: ['sub-contractor', 'subcontractor payment', 'contract payment', 'amount paid', 'amount', 'payment'], required: true, ...moneyField(10) },
    ],
    summaryLabel: 'T5018 Summary — Payer Information',
    summaryHint: 'The business that made the contract payments.',
    generateXML: generateT5018XML,
  },
  NR4: {
    label: 'NR4 — Statement of Amounts Paid or Credited to Non-Residents of Canada',
    fields: [
      { key: 'rcpnt_name',   label: 'Recipient Name',                autoMatch: ['recipient name', 'payee name', 'name'], required: true },
      { key: 'addr_l1',      label: 'Address Line 1',                autoMatch: ['street address', 'address line', 'address', 'addr'] },
      { key: 'city',         label: 'City',                          autoMatch: ['city'] },
      { key: 'ste_cd',       label: 'State / Province (2 letters)',  autoMatch: ['state/province', 'state', 'province'], type: 'code', codes: [['', '(none)'], ...NR4_STATE_CODES.map(c => [c, c])] },
      { key: 'fgn_pstl_cd',  label: 'Postal / ZIP Code',             autoMatch: ['postal code', 'zip code', 'postal', 'zip'] },
      { key: 'tx_cntry_cd',  label: 'Country of Residence (3 letters)', autoMatch: ['country of residence', 'residence country', 'tax country', 'country'] },
      // Box 13 from schema 1-27-1; blank -> CRA's 000000000. Ignored in 1-26-3 files, which have no such element.
      { key: 'cin',          label: 'Canadian Tax ID (Box 13)',      autoMatch: ['canadian tax identification', 'canadian tax id', 'canadian tax', 'sin/ttn/itn'] },
      { key: 'fssn_nbr',     label: 'Foreign Tax ID',                autoMatch: ['foreign tax id', 'foreign tax', 'tax identification', 'fssn', 'tax id'], required: true },
      { key: 'rcpnt_type',   label: 'Recipient Type',                autoMatch: ['recipient type', 'payee type', 'entity type', 'type'], type: 'code',
        codes: [['Individual', 'Individual'], ['Joint account', 'Joint account'], ['Corporation', 'Corporation'], ['Other', 'Other'], ['Government', 'Government']] },
      { key: 'inc_1_tcd',    label: 'Income Code (Box 14)',          autoMatch: ['income code', 'income type', 'type of income', 'box 14'] },
      { key: 'crcy_1_cd',    label: 'Currency Code (Box 15)',        autoMatch: ['currency', 'crcy', 'box 15'] },
      { key: 'gro_1_incamt', label: 'Gross Income (Box 16)',         autoMatch: ['gross income', 'gross amount', 'gross', 'box 16'], required: true, ...moneyField(9) },
      { key: 'nr_tx_1_amt',  label: 'Non-Resident Tax Withheld (Box 17)', autoMatch: ['tax withheld', 'non-resident tax', 'withholding', 'box 17'], ...moneyField(9) },
      { key: 'tx_xmpt_1_cd', label: 'Exemption Code (Box 18)',       autoMatch: ['exemption code', 'exemption', 'exempt', 'box 18'] },
    ],
    summaryLabel: 'NR4 Summary — Payer Information',
    summaryHint: 'The payer or agent who paid or credited amounts to non-residents.',
    generateXML: generateNR4XML,
  },
};

function getSelectedReturnType() {
  return document.getElementById('return-type').value;
}

function getReturnConfig() {
  return RETURN_TYPES[getSelectedReturnType()];
}

// ---- Helpers ----
const VALID_PROVINCES = new Set(PROVINCES);
const T4_PROVINCES = new Set(T4_PROVINCE_CODES);
const NR4_STATES = new Set(NR4_STATE_CODES);
const COUNTRY_MAP = { 'CA': 'CAN', 'US': 'USA', 'CAN': 'CAN', 'USA': 'USA' };
// CRA rcpnt_tcd: 1 sole proprietor (an individual in business), 3 corporation, 4 partnership. Keys are lower case.
const BIZ_TYPE_MAP = {
  'individual': '1', 'sole proprietor': '1', 'sole proprietorship': '1', 'self-employed': '1', 'self employed': '1', '1': '1',
  'corporation': '3', '3': '3', 'partnership': '4', '4': '4',
};
const NR4_RCPNT_TYPE_MAP = { 'individual': '1', 'joint account': '2', 'joint': '2', 'corporation': '3', 'other': '4', 'government': '5' };

// ============================================================
// STEP NAVIGATION
// ============================================================
// showTable false: the caller sends table_shown itself (a new file: after file_opened)
function goToStep(step, direction, showTable = true) {
  document.querySelectorAll('.wizard-step').forEach(el => el.classList.add('hidden'));
  document.getElementById(`step-${step}`).classList.remove('hidden');

  document.querySelectorAll('.progress-step').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.remove('active', 'done');
    if (s === step) el.classList.add('active');
    else if (s < step) el.classList.add('done');
  });

  if (currentStep === 2 && step !== 2) tableExited(step === 1 ? 'back' : 'continue');
  if (step !== currentStep) track('step_reached', { step, direction: direction || (step > currentStep ? 'forward' : 'back') });
  const entered = step === 2 && currentStep !== 2;
  currentStep = step;
  if (entered && showTable) tableShown();
  document.getElementById('converter').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetAll() {
  tableExited('reset'); // before the file is cleared, so it reports the table being left
  parsedData = [];
  headers = [];
  xmlOutput = '';
  columnMap = {};
  setDemoMode(false);
  document.getElementById('file-info').classList.add('hidden');
  document.getElementById('file-input').value = '';
  goToStep(1, 'reset');
}

// ============================================================
// RETURN TYPE SWITCHER — updates Step 3 form
// ============================================================
let returnChosen = false; // false until the visitor picks a return; a file opened before that used the preselected one

// source: how the return was chosen, for GA4: 'landing' (page load from a guide page) | 'hero' | 'dropdown'.
// 'default' is sent lazily by handleFile instead, so return_selected never doubles as a pageview count.
function onReturnTypeChange(source) {
  const rt = getSelectedReturnType();
  const config = RETURN_TYPES[rt];
  if (source) { // page load without ?return= sets up the UI silently
    returnChosen = true;
    track('return_selected', { return_type: rt, source });
  }
  suggestSubmissionRef();

  // Update step 1 description + sample link
  const step1Data = { T4: 'T4 payroll', T5018: 'T5018 sub-contractor payment', NR4: 'NR4 non-resident payment', T1204: 'T1204 payment' };
  document.querySelector('#step-1 .card > p').textContent =
    `Open the .xlsx or .csv file with your ${step1Data[rt]} data.`;
  document.getElementById('return-current').textContent = config.label;
  renderNeeds(rt);
  const sampleLink = document.getElementById('sample-link');
  sampleLink.href = `templates/${rt}_Sample.csv`;
  sampleLink.textContent = `Download the ${rt} sample spreadsheet`;

  // Update Step 3 summary section header
  document.getElementById('summary-section-title').textContent = config.summaryLabel;
  document.getElementById('summary-section-hint').textContent = config.summaryHint;

  // Show/hide return-type-specific form sections
  const t1204Fields = document.getElementById('t1204-specific-fields');
  const t4Fields = document.getElementById('t4-specific-fields');
  const t5018Fields = document.getElementById('t5018-specific-fields');
  if (t1204Fields) t1204Fields.classList.toggle('hidden', rt !== 'T1204');
  if (t4Fields) t4Fields.classList.toggle('hidden', rt !== 'T4');
  if (t5018Fields) t5018Fields.classList.toggle('hidden', rt !== 'T5018');
  document.getElementById('nr4-specific-fields').classList.toggle('hidden', rt !== 'NR4');
  // NR4 identifies the payer by NR account number, not a 15-char BN
  document.getElementById('py-bn-group').classList.toggle('hidden', rt === 'NR4');
  clearFieldErrors();

  // If a file is already open (even with every row deleted), re-map
  if (headers.length > 0) {
    autoMapColumns();
    openEditor();
    goToStep(2); // Jump back to step 2 automatically if they change type mid-flow
  }
}

// ============================================================
// STEP 1: FILE UPLOAD
// ============================================================
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');

dropzone.addEventListener('click', () => {
  track('picker_opened', { return_type: getSelectedReturnType() });
  fileInput.click();
});
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e => { if (e.target.files.length) handleFile(e.target.files[0]); });

// Listen for return type changes
document.getElementById('return-type').addEventListener('change', () => onReturnTypeChange('dropdown'));

// Hero return picker: preselect the return and jump to Step 1
document.querySelectorAll('.return-pick').forEach(btn => btn.addEventListener('click', () => {
  document.getElementById('return-type').value = btn.dataset.return;
  onReturnTypeChange('hero');
  document.getElementById('converter').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));

// Landing pages link to /?return=NR4#converter. Only the four return codes count (any case); anything else is ignored.
function returnFromUrl(search) {
  const m = /[?&]return=([^&#]*)/i.exec(search || '');
  const rt = m && m[1].toUpperCase();
  return rt && Object.hasOwn(RETURN_TYPES, rt) ? rt : null;
}

// The suggested Submission Reference ID follows the return until the user types their own
let suggestedRef = '';
function suggestSubmissionRef() {
  const ref = document.getElementById('tx-ref');
  const next = defaultSubmissionRef(getSelectedReturnType(), new Date());
  if (!ref.value || ref.value === suggestedRef) ref.value = next;
  ref.placeholder = suggestedRef = next;
}

// category goes to GA4; msg (may hold the file name) stays on screen only
function showFileError(msg, category) {
  if (category) track('file_parse_error', { return_type: getSelectedReturnType(), error_category: category });
  const el = document.getElementById('file-error');
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

function handleFile(file) {
  showFileError('');
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx', 'xls', 'csv'].includes(ext)) {
    showFileError('Please upload a valid Excel (.xlsx, .xls) or CSV file.', 'unsupported_type');
    return;
  }

  const reader = new FileReader();
  reader.onload = e => openWorkbook(e.target.result, file.name, ext, false);
  reader.readAsArrayBuffer(file);
}

// SheetJS reads BOM-marked UTF-8/UTF-16LE CSVs itself, but not UTF-16BE, and it reads a BOM-less CSV as
// Windows-1252 ("Côté" -> "CÃ´tÃ©"). Decode those here; null = let SheetJS read the bytes (BOM files, Excel's Windows-1252).
function csvText(bytes) {
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes);
  if ((bytes[0] === 0xFF && bytes[1] === 0xFE) || (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; } // not valid UTF-8 -> Windows-1252
}

// Parses the file bytes and moves to Step 2. isSample: the one-click sample (fetched, not chosen by the user).
function openWorkbook(buffer, name, ext, isSample) {
    try {
      const text = ext === 'csv' ? csvText(new Uint8Array(buffer)) : null;
      const wb = text !== null ? XLSX.read(text, { type: 'string' }) : XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      Object.keys(ws).forEach(k => { if (k[0] !== '!') keepDigitText(ws[k], ext === 'csv'); }); // keep SIN/BN/ZIP leading zeros
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      const rows = raw.slice(1).filter(row => row.some(cell => cell !== ''));
      if (!rows.length) { showFileError('File has no data rows.', 'no_data_rows'); return; }

      headers = raw[0].map(h => String(h || '').trim());
      parsedData = rows;

      const info = document.getElementById('file-info');
      info.innerHTML = `<i data-lucide="check-circle" class="icon-sm"></i> ${escapeXml(name)} &mdash; ${parsedData.length} rows, ${headers.length} columns`;
      setDemoMode(isSample);
      info.classList.remove('hidden');
      document.getElementById('step1-actions').classList.remove('hidden');
      if (window.lucide) window.lucide.createIcons();

      autoMapColumns();
      openEditor();
      goToStep(2, undefined, false);
      if (!returnChosen) { returnChosen = true; track('return_selected', { return_type: getSelectedReturnType(), source: 'default' }); }
      track('file_opened', { return_type: getSelectedReturnType(), is_sample: isSampleFile(),
        rows_bucket: rowsBucket(parsedData.length), required_unmapped: unmappedRequired().length });
      tableShown();
    } catch (err) {
      // err.message can hold the file name or a cell value: never shown, only the scrubbed report leaves
      showFileError("We couldn't read this file. Check that it is a valid Excel (.xlsx, .xls) or CSV file, then try again.", 'read_error');
      reportCrash('parse_crash', err);
    }
}

// ============================================================
// STEP 2: TABLE EDITOR — a fixed header of the return's CRA columns in CRA order, each with the user's column that
// fills it (one at most); unmatched columns wait in "Ignored columns". The user's rows below, live validation.
// columnMap (field key -> column index, -1 = none) stays the one source of truth that generate*XML reads.
// ============================================================
const EDITOR_PAGE = 200; // rows rendered at once, so thousands of rows stay fast
let editorPage = 0;
let onlyProblems = false;
let rowIssues = new Map(); // parsedData index -> its issues, from the last validateRows()
let showEmpty = false; // "Show empty columns": empty optional CRA columns at full width (a fine pointer collapses them)
const expandedSlots = new Set(); // empty optional CRA columns opened one by one (click on the strip, or a drag over it)
let menuCol = null; // the column whose "⋯" menu is open
let ignoredOpen = false; // the Ignored columns tray (desktop); always open on a touch screen

function autoMapColumns() {
  const config = getReturnConfig();
  columnMap = {};
  const usedColumns = new Set();

  // Score each (field, column) pair by keyword match length (longer = more specific = better)
  const candidates = [];
  config.fields.forEach(field => {
    headers.forEach((h, colIdx) => {
      // Keywords match at the start of a word, so "sin" doesn't hit "Business Type"
      const words = ' ' + h.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
      field.autoMatch.forEach(keyword => {
        if (words.includes(' ' + keyword.replace(/[^a-z0-9]+/g, ' '))) {
          candidates.push({ fieldKey: field.key, colIdx, score: keyword.length });
        }
      });
    });
  });

  // Sort by score descending — most specific matches win first
  candidates.sort((a, b) => b.score - a.score);

  // Assign greedily: best scores first, no column or field reuse
  const assignedFields = new Set();
  candidates.forEach(c => {
    if (assignedFields.has(c.fieldKey) || usedColumns.has(c.colIdx)) return;
    columnMap[c.fieldKey] = c.colIdx;
    assignedFields.add(c.fieldKey);
    usedColumns.add(c.colIdx);
  });

  // Fill unassigned fields with -1
  config.fields.forEach(f => {
    if (!(f.key in columnMap)) columnMap[f.key] = -1;
  });
}

// A new file or return: first page, all rows, no stale Continue error
function openEditor() {
  editorPage = 0;
  expandedSlots.clear();
  deleted = null;
  document.getElementById('editor-toast').classList.add('hidden');
  onlyProblems = document.getElementById('editor-only-problems').checked = false;
  document.getElementById('editor-errors').classList.add('hidden');
  refreshEditor();
}

// Spreadsheet column letter: 0 -> A, 25 -> Z, 26 -> AA. Tells duplicate headers apart.
function colLetter(c) {
  let s = '';
  for (c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + (c - 1) % 26) + s;
  return s;
}

// The table's fixed header: the return's CRA columns, in CRA order
function editorSlots() {
  return getReturnConfig().fields.map(f => f.key);
}

// Where a column can go: Ignored, then (T4 only) one column holding the whole name, then the CRA columns
function moveOptions() {
  const rt = getSelectedReturnType();
  return [{ key: 'ignore', label: 'Ignored' },
    ...(rt === 'T4' ? [{ key: 'full_name', label: 'Full name (first and last name in one column)' }] : []),
    ...RETURN_TYPES[rt].fields];
}

// The CRA field a source column feeds: a field key, 'full_name' (T4: both name fields) or 'ignore'
function columnField(c) {
  if (getSelectedReturnType() === 'T4' && columnMap.empe_snm === c && columnMap.empe_gvn_nm === c) return 'full_name';
  return getReturnConfig().fields.find(f => columnMap[f.key] === c)?.key || 'ignore';
}

const isColumn = c => Number.isInteger(c) && c >= 0 && c < headers.length;

// Source columns in no CRA column, in file order
function ignoredColumns() {
  const used = new Set(getReturnConfig().fields.map(f => columnMap[f.key]));
  return headers.map((_, c) => c).filter(c => !used.has(c));
}

// Puts column c under a CRA column (or 'ignore' / 'full_name'). One CRA column, one source column: the column that
// was there goes to Ignored. method ('button' | 'drag' | 'keyboard') is for GA4 only.
function remapColumn(c, field, method) {
  if (!isColumn(c) || !moveOptions().some(o => o.key === field) || columnField(c) === field) return;
  getReturnConfig().fields.forEach(f => { if (columnMap[f.key] === c) columnMap[f.key] = -1; });
  if (field === 'full_name') columnMap.empe_snm = columnMap.empe_gvn_nm = c;
  else if (field !== 'ignore') columnMap[field] = c;
  track('column_remapped', { return_type: getSelectedReturnType(), field, method });
  tableCount('remaps');
  refreshEditor();
}

// Columns a and b trade CRA columns
function swapColumns(a, b, method) {
  if (!isColumn(a) || !isColumn(b) || columnField(a) === columnField(b)) return;
  const keys = c => getReturnConfig().fields.filter(f => columnMap[f.key] === c).map(f => f.key);
  const [ka, kb] = [keys(a), keys(b)];
  ka.forEach(k => { columnMap[k] = b; });
  kb.forEach(k => { columnMap[k] = a; });
  track('column_remapped', { return_type: getSelectedReturnType(), field: columnField(a), method });
  tableCount('remaps');
  refreshEditor();
}

// Column c dropped on CRA column f: a column coming from another CRA column trades places with the one there;
// one coming from Ignored sends it to Ignored
function dropOnSlot(c, f, method) {
  if (!isColumn(c) || !editorSlots().includes(f) || columnMap[f] === c) return;
  const there = columnMap[f];
  if (there >= 0 && !['ignore', 'full_name'].includes(columnField(c))) swapColumns(c, there, method);
  else remapColumn(c, f, method);
}

// The CRA column ← (-1) / → (+1) moves column c to; null when it can't move (first / last CRA column, Ignored)
function moveTarget(c, dir) {
  const slots = editorSlots();
  const f = columnField(c);
  const to = slots[slots.indexOf(f === 'full_name' ? 'empe_snm' : f) + dir];
  return f !== 'ignore' && to && columnMap[to] !== c ? to : null;
}

// Keyboard alternative to dragging: column c moves to the previous (-1) or next (+1) CRA column.
// Focus stays on the same arrow of the moved column (the other one when it reached the end).
function moveColumn(c, dir) {
  const to = moveTarget(c, dir);
  if (!to) return;
  dropOnSlot(c, to, 'keyboard');
  const b = document.querySelector(`#editor-thead [data-move="${dir}"][data-col="${c}"]`);
  (b && !b.disabled ? b : document.querySelector(`#editor-thead [data-move="${-dir}"][data-col="${c}"]`))?.focus();
}

const slotLabel = f => (f === 'ignore' ? 'Ignored columns' : getReturnConfig().fields.find(x => x.key === f).label);

// The header cells of CRA column `to` (both rows), or the Ignored area
const landingEls = to => (to === 'ignore' ? [document.getElementById('editor-ignored')] : [...document.querySelectorAll(`#editor-thead [data-slot="${to}"]`)]);

// "Moves to: …" while an arrow, a Leave out / Use column button or a dragged column is over its destination:
// that CRA column (or the Ignored area) is outlined. null clears it. Anything else (full_name, junk) shows nothing.
let landing = null, landingMarked = [];
function showLanding(to) {
  if (to !== 'ignore' && !editorSlots().includes(to)) to = null;
  if (to === landing) return;
  landingMarked.forEach(el => el.classList.remove('is-landing'));
  landing = to;
  landingMarked = to ? landingEls(to) : [];
  landingMarked.forEach(el => el.classList.add('is-landing'));
  document.getElementById('editor-landing').textContent = to ? `Moves to: ${slotLabel(to)}` : '';
}

// After a move by button: the destination flashes, so a phone user sees where the column went
function flashLanded(to) {
  if (to !== 'ignore' && !editorSlots().includes(to)) return;
  landingEls(to).forEach(el => {
    el.classList.add('is-landed');
    setTimeout(() => el.classList.remove('is-landed'), 900);
  });
}

// Inline edit of one cell. Returns false (and does nothing) when the value didn't change.
function editCell(r, c, value) {
  const row = parsedData[r];
  value = String(value);
  if (!row || !isColumn(c) || String(row[c] ?? '') === value) return false;
  row[c] = value;
  track('cell_edited', { return_type: getSelectedReturnType(), field: columnField(c) });
  tableCount('edits');
  revalidate();
  patchEditorRow(r); // in place, so the cell being clicked next isn't replaced under the pointer
  renderEditorStatus();
  return true;
}

// How cell (r, column c) would look with `value`, while it's being typed; changes nothing
function previewCell(r, c, value) {
  const row = parsedData[r].slice();
  row[c] = String(value);
  const fields = getReturnConfig().fields.filter(f => columnMap[f.key] === c).map(f => f.key);
  return issueState((checkRow(getSelectedReturnType(), row, r)?.issues || []).filter(x => fields.includes(x.field)));
}

// A code column is edited with a select of its CRA codes (null: typed in). A value that isn't one stays first.
function cellEditor(r, c) {
  const f = getReturnConfig().fields.find(x => x.key === columnField(c));
  if (!f || f.type !== 'code') return null;
  const cur = String(parsedData[r][c] ?? '').trim();
  const match = f.codes.find(([v]) => v.toUpperCase() === cur.toUpperCase());
  const opts = match ? f.codes
    : [[cur, cur ? `${cur} (${cellState(r, f.key).cls === 'cell-error' ? 'not valid' : 'as typed'})` : '(blank)'], ...f.codes];
  const selected = match ? match[0] : cur;
  return `<select class="ed-cell-select" autocomplete="off" aria-label="${escapeXml(f.label)}, row ${r + 2}">` +
    opts.map(([v, label]) => `<option value="${escapeXml(v)}"${v === selected ? ' selected' : ''}>${escapeXml(label)}</option>`).join('') + '</select>';
}

function addRow() {
  parsedData.push(headers.map(() => ''));
  onlyProblems = document.getElementById('editor-only-problems').checked = false;
  editorPage = Infinity; // clamped to the last page
  refreshEditor();
  focusCell(parsedData.length - 1, editorSlots().find(f => columnMap[f] >= 0));
}

// A deleted row can come back (Undo in the toast, or Ctrl/Cmd+Z) until the toast goes, 8 s later
let deleted = null, toastTimer; // { r, row }
function deleteRow(r) {
  if (!Number.isInteger(r) || r < 0 || r >= parsedData.length) return;
  deleted = { r, row: parsedData.splice(r, 1)[0] };
  track('row_deleted', { return_type: getSelectedReturnType(), rows_bucket: rowsBucket(parsedData.length) });
  tableCount('deletes');
  refreshEditor();
  const toast = document.getElementById('editor-toast');
  toast.innerHTML = `Row ${r + 2} deleted · <button type="button" class="ed-undo" onclick="undoDelete()">Undo</button>`;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { deleted = null; toast.classList.add('hidden'); }, 8000);
  toastTimer.unref?.(); // node (tests) only: don't hold the process open
}

function undoDelete() {
  if (!deleted) return;
  const { r, row } = deleted;
  deleted = null;
  clearTimeout(toastTimer);
  document.getElementById('editor-toast').classList.add('hidden');
  parsedData.splice(r, 0, row);
  refreshEditor();
  focusCell(r, editorSlots().find(f => columnMap[f] >= 0));
}
document.addEventListener('keydown', e => {
  if (!deleted || currentStep !== 2 || editing || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
  e.preventDefault();
  undoDelete();
});

function setEditorPage(p) {
  editorPage = p;
  renderEditorBody();
}

function revalidate() {
  rowIssues = new Map();
  for (const x of validateRows()) {
    if (!rowIssues.has(x.row)) rowIssues.set(x.row, []);
    rowIssues.get(x.row).push(x);
  }
}

function refreshEditor() {
  revalidate();
  renderEditor();
  if (!document.getElementById('editor-errors').classList.contains('hidden')) checkRequiredColumns();
}

function renderEditor() {
  renderEditorHead();
  renderEditorIgnored();
  renderEditorBody();
  renderEditorStatus();
}

// A warning about a field with no column (e.g. T4 province defaulting to ON) isn't marked on every row:
// it's summed up in the status line and listed in Step 4. Errors always count, and show in the empty column.
const placed = x => columnMap[x.field] >= 0;
const counted = x => x.severity === 'error' || placed(x);

function issueState(list) {
  return { cls: list.some(x => x.severity === 'error') ? 'cell-error' : list.length ? 'cell-warning' : '', msg: list.map(x => x.message).join(' ') };
}

// How the editor shows row r under CRA column f: { cls: 'cell-error' | 'cell-warning' | '', msg }
function cellState(r, f) {
  return issueState((rowIssues.get(r) || []).filter(x => x.field === f && counted(x)));
}

// The cell's text: amounts with thousands separators and 2 decimals (display only), anything else as typed
function cellText(r, f) {
  const raw = parsedData[r][columnMap[f]] ?? '';
  const field = getReturnConfig().fields.find(x => x.key === f);
  const m = field.type === 'money' && parseMoney(raw, field.digits);
  return m && !m.error && m.value !== null ? formatMoney(m.value) : String(raw);
}

// A source column's drag handle and name; its spreadsheet letter only in the tooltip
function chipName(c) {
  const name = escapeXml(headers[c] || '(no header)');
  return `<span class="ed-chip-name" title="Column ${colLetter(c)}: ${name}"><span class="ed-grip" aria-hidden="true">⠿</span> ${name}</span>`;
}
const who = c => `column ${colLetter(c)} (${escapeXml(headers[c] || 'no header')})`;
const toButton = (c, to, text, label) => `<button type="button" class="ed-act" data-to="${to}" data-col="${c}" aria-label="${label}">${text}</button>`;

// A column in a CRA column: the whole chip is the drag handle; [←] name [→] [⋯]. The "⋯" menu holds Move left /
// right, Leave out (and, on T4 names, the full-name switch). A fine pointer shows ← → on hover / focus; a touch
// screen always shows ← → and the menu's buttons. Focused chip: Alt+← / Alt+→ move it, Delete leaves it out.
function slotChip(c, f) {
  const move = (dir, cls, text, word) => {
    const to = moveTarget(c, dir);
    return `<button type="button" class="${cls}" data-move="${dir}" data-col="${c}"${to ? '' : ' disabled'} ` +
      `aria-label="Move ${who(c)} to the ${word} CRA column${to ? `. Moves to: ${escapeXml(slotLabel(to))}` : ''}">${text}</button>`;
  };
  const full = getSelectedReturnType() !== 'T4' ? ''
    : columnField(c) === 'full_name' ? toButton(c, 'empe_snm', 'Last name only', `Last name only: use ${who(c)} for Last Name only`)
    : ['empe_snm', 'empe_gvn_nm'].includes(f) ? toButton(c, 'full_name', 'Use as full name', `Use as full name: ${who(c)} fills Last Name and First Name`)
    : '';
  return `<span class="ed-chip" draggable="true" data-drag="${c}" tabindex="0" role="group" ` +
    `aria-label="Column ${colLetter(c)}, ${escapeXml(headers[c] || 'no header')}. Drag it, or press Alt+Left or Alt+Right to move it, Delete to leave it out">` +
    `${move(-1, 'ed-arrow', '←', 'previous')}${chipName(c)}${move(1, 'ed-arrow', '→', 'next')}` +
    `<span class="ed-menu${menuCol === c ? ' is-open' : ''}"><button type="button" class="ed-menu-btn" data-menu-btn="${c}" aria-expanded="${menuCol === c}" ` +
    `aria-label="Column menu: ${who(c)}">⋯</button><span class="ed-menu-list">` +
    `${move(-1, 'ed-act ed-menu-move', 'Move left', 'previous')}${move(1, 'ed-act ed-menu-move', 'Move right', 'next')}` +
    `${toButton(c, 'ignore', 'Leave out', `Leave out ${who(c)}`)}${full}</span></span></span>`;
}

// The "⋯" menu of column c opens (null: all close). One open at a time. It opens in #editor-menu, outside the
// table's scroll box (which would clip it), position: fixed under its button, above it when there's no room below;
// it holds a copy of the chip's own buttons (shown inline on touch screens)
const edMenu = document.getElementById('editor-menu');
function toggleColumnMenu(c) {
  menuCol = c === null || menuCol === c ? null : c;
  document.querySelectorAll('#editor-thead .ed-menu').forEach(m => {
    const open = menuCol !== null && m.querySelector('[data-menu-btn]')?.dataset.menuBtn === String(menuCol);
    m.classList.toggle('is-open', open);
    m.querySelector('[data-menu-btn]')?.setAttribute('aria-expanded', String(open));
  });
  const btn = menuCol !== null && document.querySelector(`#editor-thead [data-menu-btn="${menuCol}"]`);
  edMenu.hidden = !btn;
  if (!btn) return;
  track('table_menu_opened', { return_type: getSelectedReturnType() });
  edMenu.innerHTML = btn.nextElementSibling.innerHTML;
  const b = btn.getBoundingClientRect(), h = edMenu.offsetHeight;
  edMenu.style.top = `${b.bottom + 2 + h > window.innerHeight ? Math.max(4, b.top - 2 - h) : b.bottom + 2}px`;
  edMenu.style.left = `${Math.max(4, b.right - edMenu.offsetWidth)}px`;
  edMenu.querySelector('button:not(:disabled)')?.focus();
}

// Closes the "⋯" menu; focus goes back to its ⋯ when it was in the menu (or on Escape)
function closeColumnMenu(e) {
  if (menuCol === null) return;
  const c = menuCol, back = e?.type === 'keydown' || edMenu.contains(document.activeElement);
  toggleColumnMenu(null);
  if (back) document.querySelector(`#editor-thead [data-menu-btn="${c}"]`)?.focus({ preventScroll: true });
}
// it doesn't follow its button: any scroll (page or table box, not the menu's own) and resize close it
window.addEventListener('scroll', e => { if (!edMenu.contains(e.target)) closeColumnMenu(); }, true);
window.addEventListener('resize', () => closeColumnMenu());

// The page scrolls too (mouse wheel beside the table, or past the end of its box). The header is sticky in the
// table's box only, so when the box's top goes under the fixed site header, the header moves down by that much and
// stays just under it, until the box's bottom
function pinHead() {
  const wrap = document.querySelector('.ed-wrap'), head = document.getElementById('editor-thead');
  if (!wrap) return;
  const under = document.getElementById('site-header').getBoundingClientRect().bottom - wrap.getBoundingClientRect().top;
  head.style.top = `${Math.max(0, Math.min(under, wrap.clientHeight - head.offsetHeight))}px`;
}
window.addEventListener('scroll', pinHead, { passive: true });
window.addEventListener('resize', pinHead);

// Escape or a click elsewhere closes the "⋯" menu, the Ignored "Use column" menus and the help popover
function closeMenus(e) {
  if (!(e.type === 'click' && e.target.closest?.('.ed-menu, #editor-menu'))) closeColumnMenu(e);
  document.querySelectorAll('details.ed-place[open], details.ed-help[open]').forEach(d => {
    if (e.type === 'click' && d.contains(e.target)) return;
    d.open = false;
  });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(e); });
document.addEventListener('click', closeMenus);

// An ignored column: name and a "Use column" menu of the empty CRA columns, mandatory first (all of them, when none
// is empty: the one there goes to Ignored), then T4's full name
function ignoredChip(c) {
  const fields = getReturnConfig().fields;
  const empty = fields.filter(f => !(columnMap[f.key] >= 0));
  const list = empty.length ? [...empty.filter(f => f.required), ...empty.filter(f => !f.required)] : fields;
  const items = list.map(f => `<li><button type="button" data-to="${f.key}" data-col="${c}">${escapeXml(f.label)}` +
    (f.required ? ' <span class="badge badge-mandatory">Mandatory</span>' : '') +
    (columnMap[f.key] >= 0 ? ` (replaces ${escapeXml(headers[columnMap[f.key]] || 'no header')})` : '') + '</button></li>');
  if (getSelectedReturnType() === 'T4') items.push(`<li><button type="button" data-to="full_name" data-col="${c}">Full name (Last Name and First Name)</button></li>`);
  return `<li class="ed-chip" draggable="true" data-drag="${c}">${chipName(c)}<details class="ed-place">` +
    `<summary data-col="${c}" aria-label="Use ${who(c)}: pick a CRA column">Use column</summary><ul>${items.join('')}</ul></details></li>`;
}

// An empty optional CRA column (a fine pointer shows it as a narrow strip; "+" or a drag over it opens it)
const isEmptyOptional = f => !f.required && !(columnMap[f.key] >= 0);
const isCollapsed = f => isEmptyOptional(f) && !showEmpty && !expandedSlots.has(f.key);

function renderEditorHead() {
  const fields = getReturnConfig().fields;
  const collapsed = f => (isCollapsed(f) ? ' is-collapsed' : '');
  const cra = fields.map(f => `<th scope="col" class="ed-cra${f.required ? ' is-mandatory' : ''}${collapsed(f)}" data-slot="${f.key}">` +
    (isCollapsed(f) ? `<button type="button" class="ed-expand" data-expand="${f.key}" title="${escapeXml(f.label)}: no column, optional" ` +
      `aria-label="${escapeXml(f.label)}: no column, optional. Show this column">+</button>` : '') +
    `<span class="ed-cra-label" title="${escapeXml(f.label)}">${escapeXml(f.label)}</span> ` +
    `<span class="badge badge-${f.required ? 'mandatory' : 'optional'}">${f.required ? 'Mandatory' : 'Optional'}</span></th>`).join('');
  const slots = fields.map(f => {
    const c = columnMap[f.key];
    let body;
    if (c >= 0 && f.key === 'empe_gvn_nm' && columnMap.empe_snm === c) body = '<span class="ed-slot-note">Same column as Last Name (full name)</span>';
    else if (c >= 0) body = slotChip(c, f.key);
    else body = f.required ? '<span class="ed-slot-empty"><span aria-hidden="true">⚠</span> Mandatory: no column yet</span>' : '<span class="ed-slot-empty">No column: drop one here</span>';
    const cls = c >= 0 ? 'is-filled' : f.required ? 'is-empty is-missing' : 'is-empty';
    return `<th scope="col" class="ed-slot ${cls}${collapsed(f)}" data-slot="${f.key}">${body}</th>`;
  }).join('');
  document.getElementById('editor-thead').innerHTML = `<tr><th scope="col" class="ed-rownum" rowspan="2">Row</th>${cra}</tr><tr>${slots}</tr>`;
  closeColumnMenu(); // its button was just replaced (e.g. after one of its actions)
  pinHead();
  document.getElementById('editor-empty-count').textContent = String(fields.filter(isEmptyOptional).length);
  showLanding(null); // the marked cells were just replaced
}

// A column dragged over a strip: that column opens, in place (a re-render mid-drag would drop the dragged chip)
function expandSlot(f) {
  if (expandedSlots.has(f) || !editorSlots().includes(f)) return;
  expandedSlots.add(f);
  document.querySelectorAll(`#editor-thead [data-slot="${f}"]`).forEach(el => el.classList.remove('is-collapsed'));
  document.querySelector(`#editor-thead [data-expand="${f}"]`)?.remove();
}

// The Ignored columns tray: beside the table on a wide desktop screen, a one-line bar above it otherwise
function renderEditorIgnored() {
  const cols = ignoredColumns();
  const el = document.getElementById('editor-ignored');
  el.classList.toggle('is-open', ignoredOpen);
  el.innerHTML =
    `<button type="button" class="ed-tray-btn" aria-expanded="${ignoredOpen}" title="Left out of the file. To use one, pick a CRA column in its “Use column” menu, or drag it onto a CRA column in the table header. To leave a column out, use its “Leave out” menu item, or drag it here.">Ignored columns (${cols.length})</button>` +
    `<ul class="ed-chips" data-drop="ignore">${cols.length ? cols.map(ignoredChip).join('') : '<li class="ed-none">None: every column of your file is used.</li>'}</ul>`;
}

function toggleIgnored() {
  ignoredOpen = !ignoredOpen;
  renderEditorIgnored();
}

let editorVisibleRows = [];

// The rows "Show only rows with problems" leaves (null: all rows)
const problemRows = () => (onlyProblems ? [...rowIssues.keys()].filter(r => rowIssues.get(r).some(counted)) : null);

function renderEditorBody() {
  const slots = editorSlots();
  const list = problemRows();
  const total = list ? list.length : parsedData.length;
  const pages = Math.max(1, Math.ceil(total / EDITOR_PAGE));
  editorPage = Math.min(Math.max(0, editorPage), pages - 1);
  const start = editorPage * EDITOR_PAGE;
  const end = Math.min(total, start + EDITOR_PAGE);
  editorVisibleRows = list ? list.slice(start, end) : Array.from({ length: end - start }, (_, k) => start + k);

  document.getElementById('editor-tbody').innerHTML = editorVisibleRows.length
    ? editorVisibleRows.map(r => editorRowHtml(r, slots)).join('')
    : `<tr><td colspan="${slots.length + 1}" class="ed-empty">${list ? 'No rows with problems.' : 'No rows. Add one, or open another file in Step 1.'}</td></tr>`;
  renderEditorMsgs();

  const n = v => v.toLocaleString('en-CA');
  document.getElementById('editor-pager').innerHTML = total > EDITOR_PAGE
    ? `<button type="button" class="btn btn-ghost" onclick="setEditorPage(${editorPage - 1})"${editorPage ? '' : ' disabled'}>← Previous</button>` +
      `<span>Rows ${n(start + 1)}–${n(end)} of ${n(total)}${list ? ' with problems' : ''}</span>` +
      `<button type="button" class="btn btn-ghost" onclick="setEditorPage(${editorPage + 1})"${editorPage < pages - 1 ? '' : ' disabled'}>Next →</button>`
    : '';
}

// A cell under an empty CRA column has no source column (no data-c): it can't be edited, but shows that column's errors
const cellClass = (td, s) => [td.c === undefined ? 'ed-noslot' : '', s.cls].filter(Boolean).join(' ');

function editorRowHtml(r, slots) {
  return `<tr data-r="${r}"><th scope="row" class="ed-rownum">${r + 2}` +
    `<button type="button" class="ed-del" onclick="deleteRow(${r})" aria-label="Delete row ${r + 2}" title="Delete row">×</button></th>` +
    slots.map(f => {
      const c = columnMap[f] >= 0 ? columnMap[f] : undefined;
      const s = cellState(r, f);
      const cls = cellClass({ c }, s);
      return `<td tabindex="-1" data-r="${r}"${c === undefined ? '' : ` data-c="${c}"`} data-f="${f}"${cls ? ` class="${cls}"` : ''}` +
        `${s.msg ? ` title="${escapeXml(s.msg)}" aria-describedby="ed-msg-${r}-${f}"` : ''}>${c === undefined ? '' : escapeXml(cellText(r, f))}</td>`;
    }).join('') + '</tr>';
}

// Hidden text the marked cells point to with aria-describedby (screen readers read the message with the cell)
function renderEditorMsgs() {
  const slots = editorSlots();
  document.getElementById('editor-msgs').innerHTML = editorVisibleRows.flatMap(r => slots.map(f => [f, cellState(r, f)])
    .filter(([, s]) => s.msg).map(([f, s]) => `<span id="ed-msg-${r}-${f}">${escapeXml(s.msg)}</span>`)).join('');
}

// After an edit: new marks and text on that row's cells without replacing them
function patchEditorRow(r) {
  const tr = document.querySelector(`#editor-tbody tr[data-r="${r}"]`);
  if (!tr) return;
  tr.querySelectorAll('td[data-f]').forEach(td => {
    const f = td.dataset.f;
    const s = cellState(r, f);
    td.className = cellClass(td.dataset, s);
    if (s.msg) { td.title = s.msg; td.setAttribute('aria-describedby', `ed-msg-${r}-${f}`); }
    else { td.removeAttribute('title'); td.removeAttribute('aria-describedby'); }
    if (td.dataset.c !== undefined) td.textContent = cellText(r, f);
  });
  renderEditorMsgs();
}

function renderEditorStatus() {
  let errors = 0, warnings = 0, notes = 0;
  const noteFields = new Set();
  for (const list of rowIssues.values()) for (const x of list) {
    if (x.severity === 'error') errors++;
    else if (placed(x)) warnings++;
    else { notes++; noteFields.add(x.field); }
  }
  const count = (k, word) => `${k.toLocaleString('en-CA')} ${word}${k === 1 ? '' : 's'}`;
  const labels = getReturnConfig().fields.filter(f => noteFields.has(f.key)).map(f => f.label);
  const status = document.getElementById('editor-status');
  status.textContent = (errors || warnings ? `${count(errors, 'error')} · ${count(warnings, 'warning')}` : 'No problems found.') +
    (notes ? ` · ${count(notes, 'more warning')} (no column)` : '');
  status.title = (errors ? 'Errors (red) stop the file from being made; warnings (amber) don’t.' : '') +
    (notes ? ` ${count(notes, 'more warning')} for ${labels.join(', ')}, which ${labels.length === 1 ? 'has' : 'have'} no column; you'll see them with the file.` : '');
  document.getElementById('editor-next').disabled = !(errors || warnings);

  const unmapped = unmappedRequired();
  const missing = document.getElementById('editor-missing');
  missing.innerHTML = unmapped.length
    ? `<h4>Mandatory, with no column yet</h4><ul>${unmapped.map(f => `<li>${escapeXml(f.label)}</li>`).join('')}</ul>`
    : '';
  missing.classList.toggle('hidden', !unmapped.length);
}

// ---- Mapping events (header slots and the Ignored area): ← / → (data-move), Leave out / Use column / full name
// buttons (data-to), drag-and-drop; and the "Moves to" landing marker for all three ----
// "Use column" menus (<details>) close on a click outside them and on Escape (focus back on that menu's summary)
document.addEventListener('click', e => {
  const inside = e.target.closest && e.target.closest('details.ed-place');
  document.querySelectorAll('details.ed-place[open]').forEach(d => { if (d !== inside) d.open = false; });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('details.ed-place[open]').forEach(d => {
    d.open = false;
    if (d.contains(document.activeElement)) d.querySelector('summary').focus();
  });
});
const dropTarget = e =>e.target.closest && (e.target.closest('[data-slot]') || e.target.closest('[data-drop]'));
const moveButton = e => e.target.closest && (e.target.closest('[data-move]') || e.target.closest('[data-to]'));
const buttonTarget = btn => (btn.dataset.move ? moveTarget(+btn.dataset.col, +btn.dataset.move) : btn.dataset.to);
for (const el of [document.getElementById('editor-thead'), document.getElementById('editor-ignored'), edMenu]) {
  el.addEventListener('click', e => {
    const menuBtn = e.target.closest && e.target.closest('[data-menu-btn]');
    if (menuBtn) { toggleColumnMenu(+menuBtn.dataset.menuBtn); return; }
    const strip = e.target.closest && e.target.closest('[data-expand]');
    if (strip) { expandedSlots.add(strip.dataset.expand); renderEditorHead(); return; }
    if (e.target.closest && e.target.closest('.ed-tray-btn')) { toggleIgnored(); return; }
    const btn = moveButton(e);
    if (!btn) return;
    const c = +btn.dataset.col, to = buttonTarget(btn);
    if (btn.dataset.move) moveColumn(c, +btn.dataset.move);
    else {
      remapColumn(c, to, 'button');
      document.querySelector(`#editor-thead [data-col="${c}"]:not(:disabled), #editor-ignored [data-col="${c}"]`)?.focus(); // its button was replaced
    }
    flashLanded(to);
  });
  const hover = e => { const btn = moveButton(e); showLanding(btn ? buttonTarget(btn) : null); };
  el.addEventListener('mouseover', hover);
  el.addEventListener('focusin', hover);
  el.addEventListener('mouseout', () => showLanding(null));
  el.addEventListener('focusout', () => showLanding(null));
  el.addEventListener('dragleave', () => showLanding(null));
  el.addEventListener('dragend', () => showLanding(null));
  el.addEventListener('dragstart', e => {
    const handle = e.target.closest && e.target.closest('[data-drag]');
    if (!handle) return;
    e.dataTransfer.setData('text/plain', handle.dataset.drag);
    e.dataTransfer.effectAllowed = 'move';
  });
  el.addEventListener('dragover', e => {
    const t = dropTarget(e);
    if (!t) return;
    e.preventDefault();
    if (t.dataset.slot) expandSlot(t.dataset.slot); // a collapsed strip opens under the dragged column
    showLanding(t.dataset.slot || 'ignore');
  });
  // A focused chip (or a button in it): Alt+← / Alt+→ move the column, Delete / Backspace leave it out
  el.addEventListener('keydown', e => {
    const chip = e.target.closest && e.target.closest('[data-drag]');
    if (!chip || e.ctrlKey || e.metaKey) return;
    const c = +chip.dataset.drag;
    const dir = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (dir && e.altKey) {
      e.preventDefault();
      moveColumn(c, dir);
      document.querySelector(`#editor-thead [data-drag="${c}"]`)?.focus();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !e.altKey && columnField(c) !== 'ignore') {
      e.preventDefault();
      remapColumn(c, 'ignore', 'keyboard');
      flashLanded('ignore');
    }
  });
  el.addEventListener('drop', e => {
    showLanding(null);
    const t = dropTarget(e);
    if (!t) return;
    e.preventDefault();
    const from = e.dataTransfer.getData('text/plain');
    if (!/^\d+$/.test(from)) return;
    if (t.dataset.slot) dropOnSlot(+from, t.dataset.slot, 'drag');
    else remapColumn(+from, 'ignore', 'drag');
  });
}
document.getElementById('editor-show-empty').addEventListener('change', e => {
  showEmpty = e.target.checked;
  renderEditorHead();
});
document.getElementById('editor-only-problems').addEventListener('change', e => {
  onlyProblems = e.target.checked;
  editorPage = 0;
  renderEditorBody();
});

// Arrow keys / Tab between cells -> [row, col] of the next cell, or null to stay put (Tab: leave the table)
function gridStep(key, shift, r, c, rows, cols) {
  if (key === 'Tab') {
    const n = r * cols + c + (shift ? -1 : 1);
    return n < 0 || n >= rows * cols ? null : [Math.floor(n / cols), n % cols];
  }
  const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (!Object.hasOwn(d, key)) return null;
  const [nr, nc] = [r + d[key][0], c + d[key][1]];
  return nr < 0 || nc < 0 || nr >= rows || nc >= cols ? null : [nr, nc];
}

function focusCell(r, f) {
  document.querySelector(`#editor-tbody td[data-r="${r}"][data-f="${f}"]`)?.focus();
}

let editing = null; // { td, r, c, select? } while a cell is being edited

// typed: the key that started the edit replaces the value (like a spreadsheet); code columns open their select
function startEdit(td, typed) {
  if (editing || td.dataset.c === undefined) return;
  hideTip();
  const r = +td.dataset.r, c = +td.dataset.c;
  editing = { td, r, c };
  const select = cellEditor(r, c);
  if (select) { // code columns: pick from the CRA codes
    td.innerHTML = select;
    editing.select = td.querySelector('select');
    editing.select.focus();
    return;
  }
  td.textContent = typed ?? String(parsedData[r][c] ?? ''); // the value as stored, not as displayed (60,000.00)
  try { td.contentEditable = 'plaintext-only'; } catch { td.contentEditable = 'true'; } // pasted formatting stays out
  td.focus();
  const range = document.createRange(); // caret at the end
  range.selectNodeContents(td);
  range.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
}

function stopEdit(commit) {
  if (!editing) return;
  const { td, r, c, select } = editing;
  editing = null;
  td.removeAttribute('contenteditable');
  if (!(commit && editCell(r, c, select ? select.value : td.textContent))) patchEditorRow(r); // back to the display
  td.focus();
}

const edBody = document.getElementById('editor-tbody');
edBody.addEventListener('click', e => {
  const td = e.target.closest && e.target.closest('td[data-f]');
  if (td && (!editing || editing.td !== td)) startEdit(td);
});
// Leaving the cell commits. Focus moving inside it doesn't: WebKit fires focusout on the td as its own select takes focus.
edBody.addEventListener('focusout', e => {
  if (!editing || (e.target !== editing.td && e.target !== editing.select)) return;
  if (editing.td.contains(e.relatedTarget)) return;
  stopEdit(true);
});
edBody.addEventListener('change', e => { if (editing && e.target === editing.select) stopEdit(true); });
// Typing: the cell turns red / amber at once, before it's saved
edBody.addEventListener('input', e => {
  if (!editing || editing.select || e.target !== editing.td) return;
  const s = previewCell(editing.r, editing.c, editing.td.textContent);
  editing.td.className = s.cls;
  editing.td.title = s.msg;
});
edBody.addEventListener('keydown', e => {
  const td = e.target.closest && e.target.closest('td[data-f]');
  if (!td) return;
  if (e.key === 'F8') {
    e.preventDefault();
    if (editing) stopEdit(true);
    nextProblem(e.shiftKey ? -1 : 1, [+td.dataset.r, td.dataset.f]);
    return;
  }
  if (editing) {
    if (e.key === 'Escape') { e.preventDefault(); stopEdit(false); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); stopEdit(true); }
    else if (e.key === 'Tab') { stopEdit(true); moveFocus(e, td); }
    return;
  }
  if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(td); return; }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); startEdit(td, e.key); return; }
  moveFocus(e, td);
});
edBody.addEventListener('paste', e => {
  const td = e.target.closest && e.target.closest('td[data-f]');
  if (!td || editing) return;
  e.preventDefault();
  if (pasteCells(+td.dataset.r, td.dataset.f, e.clipboardData.getData('text/plain'))) focusCell(+td.dataset.r, td.dataset.f);
});

// A block copied from Excel / Sheets (tab-separated lines) pasted on cell (row r, CRA column f): fills right and down
// over the rows on show; empty CRA columns and cells past the last row are skipped. One cell_edited per paste
// (the first changed field). Returns the number of cells changed.
function pasteCells(r, f, text) {
  const slots = editorSlots();
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const at = editorVisibleRows.indexOf(r);
  let changed = 0, first = null;
  lines.forEach((line, i) => {
    const row = parsedData[at < 0 ? r + i : editorVisibleRows[at + i]];
    if (!row) return;
    line.split('\t').forEach((v, j) => {
      const c = columnMap[slots[slots.indexOf(f) + j]];
      if (!(c >= 0) || String(row[c] ?? '') === v) return;
      row[c] = v;
      changed++;
      if (first === null) first = c;
    });
  });
  if (!changed) return 0;
  track('cell_edited', { return_type: getSelectedReturnType(), field: columnField(first) });
  tableCount('edits');
  revalidate();
  renderEditorBody();
  renderEditorStatus();
  return changed;
}

// ---- Problems: "Next problem ▸", F8 / Shift+F8 ----
let problemAt = null; // [row, CRA column] of the last problem cell jumped to

// Red and amber cells in table order: [row, CRA column]
function problemCells() {
  const slots = editorSlots();
  return [...rowIssues.keys()].sort((a, b) => a - b).flatMap(r => slots.filter(f => cellState(r, f).cls).map(f => [r, f]));
}

// Focuses the next (dir 1) or previous (-1) problem cell after `from` (default: the focused cell, else the last one
// jumped to), wrapping around; turns the page when it's on another one. Returns [row, CRA column], or null.
function nextProblem(dir = 1, from) {
  const cells = problemCells();
  if (!cells.length) return null;
  const slots = editorSlots();
  const ord = ([r, f]) => r * slots.length + slots.indexOf(f);
  const focused = document.activeElement?.closest?.('#editor-tbody td[data-f]');
  const here = from || (focused ? [+focused.dataset.r, focused.dataset.f] : problemAt);
  let i = here ? (dir > 0 ? cells.findIndex(x => ord(x) > ord(here)) : cells.findLastIndex(x => ord(x) < ord(here))) : -1;
  if (i < 0) i = dir > 0 ? 0 : cells.length - 1;
  problemAt = cells[i];
  const [r, f] = problemAt;
  const list = problemRows();
  const page = Math.floor((list ? list.indexOf(r) : r) / EDITOR_PAGE);
  if (page !== editorPage) setEditorPage(page);
  document.querySelector('.ed-wrap')?.scrollIntoView({ block: 'start', behavior: 'instant' }); // the table just under the site header
  focusCell(r, f);
  return problemAt;
}

// ---- Error tooltip: the message of a red / amber cell, on hover or focus (the title stays as a fallback) ----
const edTip = document.getElementById('editor-tip');
function hideTip() { edTip.hidden = true; }
function showTip(td) {
  const s = td && !editing && cellState(+td.dataset.r, td.dataset.f);
  if (!s || !s.msg) return hideTip();
  if (step2Visit && !step2Visit.tips.has(td.dataset.f)) { // GA4: once per field per visit, never the message
    step2Visit.tips.add(td.dataset.f);
    track('table_help_opened', { return_type: getSelectedReturnType(), help_kind: 'cell_tip', field: analyticsField(td.dataset.f) });
  }
  edTip.textContent = s.msg;
  edTip.className = `ed-tip ${s.cls === 'cell-error' ? 'is-error' : 'is-warning'}`;
  const box = td.getBoundingClientRect();
  edTip.style.left = `${Math.max(4, Math.min(box.left, (window.innerWidth || 1e4) - 330))}px`;
  edTip.style.top = `${box.bottom + 4}px`;
  edTip.hidden = false;
}
const tipCell = e => e.target.closest && e.target.closest('td[data-f]');
edBody.addEventListener('mouseover', e => showTip(tipCell(e)));
edBody.addEventListener('focusin', e => showTip(tipCell(e)));
edBody.addEventListener('mouseout', hideTip);
edBody.addEventListener('focusout', hideTip);
const edWrap = document.querySelector('.ed-wrap');
edWrap?.addEventListener('scroll', hideTip);

// ---- GA4: help opened, sideways scroll (once per visit), page closed on Step 2 ----
const edHelp = document.querySelector('details.ed-help');
edHelp?.addEventListener('toggle', () => {
  if (edHelp.open) track('table_help_opened', { return_type: getSelectedReturnType(), help_kind: 'keyboard' });
});
edWrap?.addEventListener('scroll', () => {
  if (!step2Visit || step2Visit.hscroll || !(edWrap.scrollLeft > 0)) return;
  step2Visit.hscroll = true;
  track('table_hscroll', { return_type: getSelectedReturnType(), cols_bucket: colsBucket(headers.length) });
});
window.addEventListener('pagehide', () => { if (currentStep === 2) tableExited('pagehide'); });

function moveFocus(e, td) {
  const rows = [...edBody.querySelectorAll('tr[data-r]')];
  const cells = tr => [...tr.querySelectorAll('td[data-f]')];
  const here = cells(td.parentElement);
  const to = gridStep(e.key, e.shiftKey, rows.indexOf(td.parentElement), here.indexOf(td), rows.length, here.length);
  if (!to) return;
  e.preventDefault();
  cells(rows[to[0]])[to[1]].focus();
}

// ============================================================
// STEP 3: FORM HELPERS
// ============================================================
function copyTransmitterToPayer() {
  const checked = document.getElementById('same-as-tx').checked;
  if (checked) {
    document.getElementById('py-bn').value = document.getElementById('tx-bn').value;
    document.getElementById('py-name').value = document.getElementById('tx-name').value;
    document.getElementById('py-contact').value = document.getElementById('tx-contact').value;
    document.getElementById('py-phone').value = document.getElementById('tx-phone').value;
  }
}

// ============================================================
// ADDRESS PARSER
// ============================================================
function parseAddress(addrStr) {
  const result = { addr_l1: '', city: '', prov: '', postal: '', country: 'CAN', cuts: [] };
  if (!addrStr) return result;

  let cleaned = String(addrStr).trim().replace(/\/\s*$/, '').trim();

  let parts = cleaned.split(' / ').map(s => s.trim()).filter(s => s);
  if (parts.length < 1) return result;

  const RECOGNIZED = new Set(['CA','CAN','CANADA','US','USA','UNITED STATES','UK','GBR','FRA','DEU','MEX','AUS']);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1].toUpperCase();
    if (RECOGNIZED.has(last) || (last.length === 3 && /^[A-Z]{3}$/.test(last))) {
      result.country = COUNTRY_MAP[last] || last;
      parts.pop();
    }
  }

  let cityBlock = '';
  if (parts.length >= 2) {
    result.addr_l1 = parts[0];
    cityBlock = parts[parts.length - 1];
  } else if (parts.length === 1) {
    cityBlock = parts[0];
  }

  const postalMatch = cityBlock.match(/([A-Z]\d[A-Z])\s?(\d[A-Z]\d)$/);
  if (postalMatch) {
    result.postal = postalMatch[1] + postalMatch[2];
    const remaining = cityBlock.substring(0, postalMatch.index).trim();
    const provMatch = remaining.match(/\b([A-Z]{2})$/);
    if (provMatch && VALID_PROVINCES.has(provMatch[1])) {
      result.prov = provMatch[1];
      result.city = remaining.substring(0, provMatch.index).trim();
    } else {
      result.city = remaining;
    }
  } else {
    const provMatch = cityBlock.match(/\b([A-Z]{2})$/);
    if (provMatch && VALID_PROVINCES.has(provMatch[1])) {
      result.prov = provMatch[1];
      result.city = cityBlock.substring(0, provMatch.index).trim();
    } else {
      result.city = cityBlock;
    }
  }
  // CRA's slip sizes: the street line takes 30 characters, the city 28. cuts: what was shortened, for the warnings.
  result.cuts = [['address line', result.addr_l1, 30], ['city', result.city, 28]].filter(([, v, max]) => v.length > max);
  result.addr_l1 = result.addr_l1.substring(0, 30);
  result.city = result.city.substring(0, 28);
  return result;
}

// ============================================================
// XML HELPERS
// ============================================================
function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlTag(tag, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<${tag}>${escapeXml(value)}</${tag}>`;
}

function get(key) {
  const idx = columnMap[key];
  if (idx === undefined || idx < 0) return '';
  return row[idx] ?? '';
}

function parsePhone(phone) {
  const parts = String(phone).match(/(\d{3})\D*(\d{3})\D*(\d{4})/);
  if (parts) return { area: parts[1], num: parts[2] + '-' + parts[3] };
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length >= 10) return { area: digits.substring(0,3), num: digits.substring(3,6) + '-' + digits.substring(6,10) };
  return { area: '000', num: '000-0000' };
}

// ============================================================
// INLINE VALIDATION (sanitizeBN / isValidSIN live in js/validate.js)
// ============================================================
function clearFieldErrors() {
  document.querySelectorAll('#step-3 .field-error').forEach(el => el.remove());
  document.querySelectorAll('#step-3 .has-error').forEach(el => el.classList.remove('has-error'));
  showGenerateErrors([]);
}

function fieldError(id, msg) {
  const el = document.getElementById(id);
  el.classList.add('has-error');
  const span = document.createElement('span');
  span.className = 'field-error';
  span.textContent = msg;
  el.closest('.form-group').appendChild(span);
}

// Row-level / data errors shown above the Generate button. Empty list hides the box.
// firstField: column key of the first bad cell (GA4); inTable: the errors are cells marked in the Step 2 table.
function showGenerateErrors(errors, firstField, inTable) {
  const box = document.getElementById('generate-errors');
  box.innerHTML = errors.length
    ? `<h4>Fix ${errors.length} problem(s) before generating</h4><ul>${errors.map(e => `<li>${escapeXml(e)}</li>`).join('')}</ul>` +
      (inTable ? '<p>Go back to Step 2 to fix them in the table, where these cells are marked in red.</p>' : '')
    : '';
  box.classList.toggle('hidden', !errors.length);
  if (errors.length) track('validation_failed', { return_type: getSelectedReturnType(), error_count: errors.length, error_category: 'row_data',
                                                  first_error_field: analyticsField(firstField) });
}

// Validates Step 3. extraChecks: [{ id, test: value => bool, msg }] for return-specific rules.
// Returns false (and marks every bad field) if anything fails.
function validateFilingDetails(requiredIds, extraChecks = []) {
  clearFieldErrors();
  const bad = new Set();
  requiredIds.forEach(id => {
    if (!document.getElementById(id).value.trim()) { fieldError(id, 'Required.'); bad.add(id); }
  });
  // T619: the transmitter account number, the RepID, or both (T619 2027 spec)
  if (!document.getElementById('tx-bn').value.trim() && !document.getElementById('tx-repid').value.trim()) {
    fieldError('tx-bn', 'Enter the transmitter CRA account number, a RepID, or both.'); bad.add('tx-bn');
  }
  const checks = [
    { id: 'tx-bn', test: v => transmitterAccountTag(cleanBN(v)), msg: v => `Use the account you sign in to IFT with: a 15-character BN (e.g. 123456789RP0001), a 9-digit BN (My Business Account sign-in only), a trust account (e.g. T12345678) or a non-resident account (e.g. NRA123456). You entered ${cleanBN(v).length} characters.` },
    { id: 'tx-repid', test: v => REPID_PATTERN.test(cleanBN(v)), msg: 'RepID: up to 7 letters or digits.' },
    { id: 'tx-ref', test: v => SUBMISSION_REF_PATTERN.test(v.trim()), msg: 'Use up to 8 letters or digits, no spaces, hyphens or other characters (CRA rule).' },
    { id: 'tx-email', test: v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()), msg: 'Enter a valid email address.' },
    { id: 'py-postal', test: v => CA_POSTAL_PATTERN.test(v.trim()), msg: 'Use the Canadian postal code format A1A 1A1.' },
    { id: 'tax-year', test: isTaxYear, msg: 'Enter the 4-digit taxation year, e.g. 2025.' },
    ...extraChecks,
  ];
  checks.forEach(c => {
    const v = document.getElementById(c.id).value;
    if (!bad.has(c.id) && v.trim() && !c.test(v)) { fieldError(c.id, typeof c.msg === 'function' ? c.msg(v) : c.msg); bad.add(c.id); }
  });
  const first = document.querySelector('#step-3 .has-error');
  if (first) first.focus();
  if (bad.size) track('validation_failed', { return_type: getSelectedReturnType(), error_count: bad.size, error_category: 'filing_details',
                                             first_error_field: analyticsField([...bad][0]) });
  return bad.size === 0;
}

const PAYER_BN_CHECK = { id: 'py-bn', test: v => BN_PATTERN.test(cleanBN(v)), msg: 'Must be exactly 15 characters: 9 digits + 2 letters + 4 digits (e.g. 123456789RP0001).' };
// T4 slips and summary: bnRPType, the employer's payroll (RP) program account
const T4_PAYER_BN_CHECK = { id: 'py-bn', test: v => /^\d{9}RP\d{4}$/.test(cleanBN(v)),
  msg: v => `T4 employer account must use the RP (payroll) program, e.g. 123456789RP0001; you entered ${cleanBN(v)}.` };
// T5018 period end: a real calendar date (dayType 1-31, monthType 1-12, yearType)
const T5018_DATE_CHECK = { id: 't5018-fiscal-day', test: () => {
  const [d, m, y] = ['day', 'month', 'year'].map(p => document.getElementById(`t5018-fiscal-${p}`).value.trim());
  return isTaxYear(y) && /^\d{1,2}$/.test(d) && /^\d{1,2}$/.test(m) && isRealDate(+y, +m, +d);
}, msg: () => `Fiscal period end: ${['year', 'month', 'day'].map(p => document.getElementById(`t5018-fiscal-${p}`).value.trim()).join('-')} isn't a real date.` };
// T5018 is filed under the payer's RZ (information return) program account
const T5018_PAYER_BN_CHECK = { id: 'py-bn', test: v => /^\d{9}RZ\d{4}$/.test(cleanBN(v)),
  msg: v => `T5018 payer account must use the RZ program, e.g. 123456789RZ0001; you entered ${cleanBN(v)}.` };

// ============================================================
// ROW CHECKS: one pure function per row, shared by the Step 2 editor (live) and generate*XML (on Generate),
// so both show the same messages word for word
// ============================================================
const LEADING_ZERO_FIX = 'If your spreadsheet dropped a leading zero, format the column as Text and re-open the file.';

// Returns the 9-digit SIN to put on the slip, or null after recording a hard-stop error.
// raw is the cell as parsed (a number if Excel stored it as one). Blank → CRA's 000000000 placeholder with a warning.
function checkSIN(raw, who, key, { warn, err }) {
  who = who || '(no name)';
  const sin = sinDigits(raw);
  if (!sin && String(raw ?? '').trim()) {
    err(key, who, `SIN "${raw}" is not a whole number. Format the column as Text, type the 9 digits, and re-open the file.`);
    return null;
  }
  if (!sin) {
    warn(key, `"${who}" has no SIN — using 000000000`);
    return '000000000';
  }
  if (!isValidSIN(sin)) {
    err(key, who,
      !/^\d+$/.test(sin) ? `SIN "${raw}" is not a whole number. Format the column as Text, type the 9 digits, and re-open the file.`
      : sin.length !== 9 ? `SIN "${raw}" has ${sin.length} digits; a SIN must be 9 digits. ${LEADING_ZERO_FIX}`
      : `SIN "${raw}" fails the SIN checksum. Check it for a typo.`);
    return null;
  }
  if (padIdNumber(raw) !== raw) warn(key, `"${who}" SIN ${raw} was stored as a number, so the leading zero was restored: ${sin}. Check it.`);
  return sin;
}

// Returns a valid 15-char recipient BN, or null after recording a hard-stop error.
// Blank → the given CRA placeholder with a warning; a bare 9-digit root is expanded with a warning.
function checkRecipientBN(raw, program, placeholder, who, key, { warn, err }) {
  who = who || '(no name)';
  const cleaned = cleanBN(padIdNumber(raw));
  if (!cleaned || cleaned === '(BLANK)') {
    warn(key, `"${who}" has no BN — using ${placeholder}`);
    return placeholder;
  }
  const bn = sanitizeBN(cleaned, program);
  if (!BN_PATTERN.test(bn)) {
    err(key, who, `BN "${raw}" is invalid: use the 15-character BN (9 digits + 2 letters + 4 digits, e.g. 123456789${program}0001) or its 9-digit root. Got ${cleaned.length} characters.${/^\d+$/.test(cleaned) ? ' ' + LEADING_ZERO_FIX : ''}`);
    return null;
  }
  if (bn !== cleaned) warn(key, `"${who}" BN root ${cleaned} expanded to ${bn} — confirm the program account`);
  return bn;
}

// T5018 recipient type: blank is a corporation (as before); anything else unrecognized is null
function t5018RecipientType(raw) {
  const typeStr = raw.toLowerCase();
  if (!typeStr) return '3';
  if (BIZ_TYPE_MAP[typeStr]) return BIZ_TYPE_MAP[typeStr];
  if (typeStr.includes('individual')) return '1';
  if (typeStr.includes('partnership')) return '4';
  if (typeStr.includes('corp')) return '3';
  return null;
}

const PROV_CHOICES = `${PROVINCES.join(', ')}, US (United States) or ZZ (another country)`;
const YES_NO = { '': false, YES: true, Y: true, NO: false, N: false };
const EXEMPT = { '': '0', 0: '0', 1: '1', YES: '1', Y: '1', NO: '0', N: '0' };
const MONEY_ERRORS = {
  not_amount: "isn't a dollar amount. Use digits with up to 2 decimals, e.g. 1234.56, 1,234.56 or $1234.56.",
  negative: "can't be negative: CRA slips take amounts of 0 or more.",
  decimals: 'has more than 2 decimals; CRA takes dollars and cents.',
  too_big: 'is over the CRA maximum of {max} for this box.',
};

// One data row (index i in parsedData) -> null when it's blank for this return (skipped like a blank spreadsheet
// row), else { ok, issues, get, amt, ...the cleaned values generate*XML needs }. ok is false after any error.
// issues: [{ row: i, field: our column key, severity: 'error' | 'warning', message }]. Every problem in the row is reported.
function checkRow(rt, row, i, map = columnMap, hdrs = headers) {
  const get = key => (map[key] >= 0 ? row[map[key]] ?? '' : '');
  const str = key => String(get(key)).trim();
  const fields = RETURN_TYPES[rt].fields;
  const issues = [];
  const ck = {
    warn: (field, msg) => issues.push({ row: i, field, severity: 'warning', message: `Row ${i + 2}: ${msg}` }),
    // `Row 2, column "SIN" (John Doe): <problem and fix>`
    err: (field, who, msg) => {
      const col = hdrs[map[field]];
      issues.push({ row: i, field, severity: 'error', message: `Row ${i + 2}${col ? `, column "${col}"` : ''} (${who || 'no name'}): ${msg}` });
    },
  };
  // Names and address lines longer than the slip takes are cut, with a warning (never silently)
  const cut = (field, who, what, value, max) => {
    if (value.length > max) ck.warn(field, `"${who}" ${what} is ${value.length} characters; the slip takes ${max}, so it will be cut to "${value.substring(0, max)}".`);
  };
  const cutName = (field, who, name, individual) => {
    if (individual) {
      const parts = name.split(/\s+/);
      cut(field, who, 'last name', parts[parts.length - 1], 20);
      if (parts.length > 1) cut(field, who, 'first name', parts[0], 12);
    } else cut(field, who, 'name', name, 60);
  };
  const cutAddress = (who, addr) => addr.cuts.forEach(([what, v, max]) => cut('address', who, what, v, max));
  // Every amount column: { key: number } for the XML, 0 when blank
  const amounts = who => {
    const amt = {};
    for (const f of fields.filter(f => f.type === 'money')) {
      const raw = get(f.key);
      const r = parseMoney(raw, f.digits);
      if (r.error) ck.err(f.key, who, `${f.label} "${String(raw).trim()}" ${MONEY_ERRORS[r.error].replace('{max}', formatMoney(10 ** f.digits - 0.01))}`);
      amt[f.key] = r.value || 0;
    }
    return amt;
  };
  const done = values => ({ ok: !issues.some(x => x.severity === 'error'), issues, get, ...values });

  if (rt === 'T4') {
    let lastName = str('empe_snm');
    let firstName = str('empe_gvn_nm');
    // One full-name column mapped to both name fields: last word is the surname, the rest the given name(s)
    if (map.empe_snm >= 0 && map.empe_snm === map.empe_gvn_nm) {
      const parts = lastName.split(/\s+/);
      lastName = parts.pop();
      firstName = parts.join(' ');
    }
    const addressRaw = str('address');
    if (!lastName && !str('sin')) return null;
    const who = `${firstName} ${lastName}`.trim();
    const sinVal = checkSIN(get('sin'), who, 'sin', ck);
    // Box 10: a code from the list. Blank: the address's province; no province column at all: that, or ON.
    let empProvCd = normCode(get('empt_prov_cd'));
    if (empProvCd && !T4_PROVINCES.has(empProvCd)) {
      ck.err('empt_prov_cd', who, `province of employment "${str('empt_prov_cd')}" isn't a province or territory code. Use ${PROV_CHOICES}.`);
    } else if (!empProvCd) {
      empProvCd = parseAddress(addressRaw).prov || (map.empt_prov_cd >= 0 ? '' : 'ON');
      if (empProvCd) ck.warn('empt_prov_cd', `"${firstName} ${lastName}" province of employment not specified, defaulting to ${empProvCd}`);
      else ck.err('empt_prov_cd', who, `province of employment is blank. Use ${PROV_CHOICES}.`);
    }
    const xmpt = {};
    for (const key of ['cpp_qpp_xmpt_cd', 'ei_xmpt_cd']) {
      xmpt[key] = EXEMPT[normCode(get(key))];
      if (!xmpt[key]) ck.err(key, who, `${fields.find(f => f.key === key).label} "${str(key)}" must be 0 (not exempt) or 1 (exempt); Yes and No work too.`);
    }
    cut('empe_snm', who, 'last name', lastName, 20);
    cut('empe_gvn_nm', who, 'first name', firstName, 12);
    cutAddress(who, parseAddress(addressRaw));
    const amt = amounts(who);
    return done({ lastName, firstName, sinVal, empProvCd, addressRaw, xmpt, amt });
  }

  if (rt === 'T1204' || rt === 'T5018') {
    const [nameKey, idKey] = rt === 'T1204' ? ['vendor_name', 'vendor_bn'] : ['rcpnt_name', 'rcpnt_bn'];
    const name = str(nameKey);
    if (!name && !str(idKey)) return null;
    const typeKey = rt === 'T1204' ? 'biz_type' : 'rcpnt_type';
    const typeRaw = str(typeKey);
    const rcpntTcd = rt === 'T1204' ? BIZ_TYPE_MAP[typeRaw.toLowerCase()] : t5018RecipientType(typeRaw);
    let idVal = null;
    if (!rcpntTcd) {
      // without the type there's no telling whether the ID is a SIN or a BN
      ck.err(typeKey, name, `${rt === 'T1204' ? 'business' : 'recipient'} type "${typeRaw}" isn't recognized. Use Individual (or Sole proprietor), Corporation, Partnership, or the CRA code 1, 3 or 4.`);
    } else {
      idVal = rcpntTcd === '1'
        ? checkSIN(get(idKey), name, idKey, ck)
        : checkRecipientBN(get(idKey), rt === 'T1204' ? 'RT' : 'RZ', rt === 'T1204' ? '000000000RC0000' : '000000000RZ0000', name, idKey, ck);
    }
    let svcOnly = false;
    if (rt === 'T1204') {
      svcOnly = YES_NO[normCode(get('svc_only'))];
      if (svcOnly === undefined) ck.err('svc_only', name, `service payments only "${str('svc_only')}" must be Yes or No.`);
    }
    cutName(nameKey, name, name, false);
    if (rcpntTcd === '1') cutName(nameKey, name, name, true);
    cutAddress(name, parseAddress(str('address')));
    const amt = amounts(name);
    return done({ name, rcpntTcd, idVal, svcOnly, amt });
  }

  // NR4
  const name = str('rcpnt_name');
  const fssn = str('fssn_nbr');
  if (!name && !fssn) return null;
  const rowErr = (key, msg) => ck.err(key, name, msg);
  const typeRaw = str('rcpnt_type').toLowerCase();
  const rcpntTcd = /^[1-5]$/.test(typeRaw) ? typeRaw : NR4_RCPNT_TYPE_MAP[typeRaw];
  const cntryRaw = str('tx_cntry_cd').toUpperCase();
  const cntry = COUNTRY_MAP[cntryRaw] || cntryRaw;
  const incRaw = str('inc_1_tcd');
  const incCd = incRaw ? incRaw.padStart(2, '0') : '';
  const crcy = str('crcy_1_cd').toUpperCase();
  const xmptCd = str('tx_xmpt_1_cd').toUpperCase();
  const steCd = normCode(get('ste_cd'));
  const postal = foreignPostal(get('fgn_pstl_cd'));
  const fssnCell = get('fssn_nbr');
  if (!name) rowErr('rcpnt_name', 'the recipient name is missing.');
  if (!rcpntTcd) rowErr('rcpnt_type', `recipient type "${typeRaw}" isn't recognized. Use Individual, Joint account, Corporation, Other, Government, or 1–5.`);
  if (!fssn) rowErr('fssn_nbr', 'the foreign tax ID is missing (CRA requires it).');
  else if (typeof fssnCell === 'number' && !Number.isSafeInteger(fssnCell)) rowErr('fssn_nbr', `foreign tax ID "${fssn}" was stored as a number and may have been rounded. Format the column as Text, retype it, and re-open the file.`);
  else if (fssn.length > 20) rowErr('fssn_nbr', 'the foreign tax ID is longer than 20 characters.');
  if (!/^[A-Z]{3}$/.test(cntry)) rowErr('tx_cntry_cd', `country of residence "${cntryRaw}" must be a 3-letter code (e.g. USA, GBR).`);
  if (incCd && !/^\d{2}$/.test(incCd)) rowErr('inc_1_tcd', `income code "${incRaw}" must be 2 digits.`);
  if (crcy && !/^[A-Z]{3}$/.test(crcy)) rowErr('crcy_1_cd', `currency "${crcy}" must be a 3-letter code (e.g. CAD, USD).`);
  if (xmptCd.length > 1) rowErr('tx_xmpt_1_cd', `exemption code "${xmptCd}" must be 1 character.`);
  else if (xmptCd && !/^[A-Z]$/.test(xmptCd)) rowErr('tx_xmpt_1_cd', `exemption code "${xmptCd}" must be a letter.`);
  if (steCd && !NR4_STATES.has(steCd)) rowErr('ste_cd', `state or province "${str('ste_cd')}" isn't a state or province code. Use the 2-letter code, e.g. WA, NY or ON.`);
  if (postal === null) rowErr('fgn_pstl_cd', `postal or ZIP code "${str('fgn_pstl_cd')}" can only have up to 10 letters, digits, spaces and hyphens.`);
  const withCIN = targetSchema(new Date()) === '1-27-1';
  const cin = withCIN && nr4CIN(get('cin'));
  if (withCIN && !cin) rowErr('cin', `Canadian tax ID "${get('cin')}" must be a 9-digit SIN/TTN/ITN, a 15-character BN (e.g. 123456789RC0001) or a trust account (e.g. T12345678). Leave it blank if the recipient has none.`);
  cutName('rcpnt_name', name, name, rcpntTcd === '1' || rcpntTcd === '2');
  cut('addr_l1', name, 'address line', str('addr_l1'), 30);
  cut('city', name, 'city', str('city'), 28);
  const amt = amounts(name);
  return done({ name, fssn, rcpntTcd, cntry, incCd, crcy, xmptCd, cin, steCd, postal, amt });
}

// Every row problem for a return: what the editor marks live and what Generate blocks on (errors) or lists (warnings)
function validateRows(rt = getSelectedReturnType(), rows = parsedData, map = columnMap, hdrs = headers) {
  return rows.flatMap((row, i) => checkRow(rt, row, i, map, hdrs)?.issues || []);
}

// After a generate*XML row loop: shows the row errors (or "no valid rows") and returns null, else the Step 4 warnings
function finishRows(issues, slipCount, noun) {
  const errors = issues.filter(x => x.severity === 'error');
  if (errors.length) track('table_error_state', { ...tableContext(), trigger: 'generate' });
  if (errors.length || !slipCount) {
    showGenerateErrors(errors.length ? errors.map(x => x.message) : [`No valid ${noun} rows found. Please check the columns in Step 2.`],
                       errors[0]?.field, errors.length > 0);
    return null;
  }
  return issues.filter(x => x.severity === 'warning').map(x => x.message);
}

// ============================================================
// MASTER GENERATE FUNCTION — dispatches to return-type handler
// ============================================================
// Without these columns every slip would silently get a placeholder or 0.00 (e.g. a file for another return)
function unmappedRequired() {
  return getReturnConfig().fields.filter(f => f.required && !(columnMap[f.key] >= 0));
}

// Shows (or clears) the Step 2 error for required fields with no column. True when none are missing.
function checkRequiredColumns() {
  const unmapped = unmappedRequired();
  const box = document.getElementById('editor-errors');
  box.innerHTML = unmapped.length
    ? `<h4>Pick a column for ${unmapped.length === 1 ? 'this required field' : `these ${unmapped.length} required fields`} before you continue</h4>` +
      `<ul>${unmapped.map(f => `<li>${escapeXml(f.label)}</li>`).join('')}</ul>` +
      `<p>Put the column of your file that holds it under that CRA column: move it there with ← and → beside its name, drag it there, or, if it's under Ignored columns, pick the CRA column in its “Use column” menu. If none fits, add that column to your spreadsheet and open it again, or check that ${getSelectedReturnType()} is the right return for this file.</p>`
    : '';
  box.classList.toggle('hidden', !unmapped.length);
  return !unmapped.length;
}

// Step 2 "Continue": stop here, not after the user has filled in Step 3, when a required field has no column.
// Row errors don't block here; Generate blocks on them.
function continueFromEditor() {
  if (checkRequiredColumns()) goToStep(3);
  else track('table_error_state', { ...tableContext(), trigger: 'continue' });
}

function generateXML() {
  track('generate_clicked', { return_type: getSelectedReturnType() });
  try {
    const config = getReturnConfig();
    const unmapped = unmappedRequired();
    if (unmapped.length) {
      clearFieldErrors();
      track('table_error_state', { ...tableContext(), trigger: 'generate' });
      showGenerateErrors(unmapped.map(f => `No column is set to "${f.label}". Move a column under it in Step 2, or check that ${getSelectedReturnType()} is the right return for this file.`));
      return;
    }
    config.generateXML();
  } catch (err) {
    // A bug, not a problem with the user's data: fixed message on screen (err.message can hold cell values), scrubbed report out
    const box = document.getElementById('generate-errors');
    box.innerHTML = '<h4>Something went wrong while building the XML</h4><p>This is a problem on our side, not in your file. ' +
      'Nothing from your spreadsheet was sent. Try again, or use the Feedback (Contact us) link at the top of the page to tell us which return you were filing.</p>';
    box.classList.remove('hidden');
    reportCrash('xml_generate_failed', err);
  }
}

// ============================================================
// T1204 XML GENERATION (existing logic)
// ============================================================
function generateT1204XML() {
  if (!validateFilingDetails(['tx-name','tx-ref','tx-contact','tx-phone','tx-email',
                              'py-bn','py-name','py-addr','py-city','py-prov','py-postal','py-contact','py-phone'],
                             [PAYER_BN_CHECK])) return;

  const pyPhone = parsePhone(document.getElementById('py-phone').value);
  const taxYear = document.getElementById('tax-year').value;
  const reportType = document.getElementById('report-type').value;
  const payerBn = cleanBN(document.getElementById('py-bn').value);
  const issues = [];

  let totalSrvc = 0, totalMxd = 0, slipCount = 0;
  let slipsXml = '';

  for (let i = 0; i < parsedData.length; i++) {
    const v = checkRow('T1204', parsedData[i], i);
    if (!v) continue;
    issues.push(...v.issues);
    if (!v.ok) continue;
    const { name: vendorName, rcpntTcd, idVal, svcOnly, amt, get } = v;
    const amount = amt.amount;
    const address = String(get('address')).trim();
    const addr = parseAddress(address);
    const amtStr = amount.toFixed(2);

    let rcpntNmXml = '';
    let sinXml = '';
    let bnXml = '';

    if (rcpntTcd === '1') {
      const nameParts = vendorName.split(/\s+/);
      const snm = (nameParts[nameParts.length - 1] || '').substring(0, 20);
      const gvnNm = nameParts.length > 1 ? nameParts[0].substring(0, 12) : '';
      const init = nameParts.length > 2 ? nameParts[1][0] || '' : '';

      rcpntNmXml = `<RCPNT_NM>${xmlTag('snm', snm)}${gvnNm ? xmlTag('gvn_nm', gvnNm) : ''}${init ? xmlTag('init', init) : ''}</RCPNT_NM>`;
      sinXml = xmlTag('sin', idVal);
      bnXml = xmlTag('rcpnt_bn', '000000000RT0000');
    } else {
      sinXml = xmlTag('sin', '000000000');
      bnXml = xmlTag('rcpnt_bn', idVal);
    }

    const nameStr = vendorName.substring(0, 60);
    const l1Nm = nameStr.substring(0, 30);
    const l2Nm = nameStr.length > 30 ? nameStr.substring(30, 60) : '';

    let amtXml = '';
    if (svcOnly) {
      amtXml = xmlTag('srvc_pay_amt', amtStr);
      totalSrvc += amount;
    } else {
      amtXml = xmlTag('mxd_gd_pay_amt', amtStr);
      totalMxd += amount;
    }

    slipsXml += `
      <T1204Slip>
        ${rcpntNmXml}
        ${sinXml}
        ${bnXml}
        <RCPNT_BUS_NM>${xmlTag('l1_nm', l1Nm)}${l2Nm ? xmlTag('l2_nm', l2Nm) : ''}</RCPNT_BUS_NM>
        ${xmlTag('rcpnt_tcd', rcpntTcd)}
        <RCPNT_BUS_ADDR>
          ${addr.addr_l1 ? xmlTag('addr_l1_txt', addr.addr_l1) : ''}
          ${addr.city ? xmlTag('cty_nm', addr.city) : ''}
          ${addr.prov ? xmlTag('prov_cd', addr.prov) : ''}
          ${addr.country ? xmlTag('cntry_cd', addr.country) : ''}
          ${addr.postal ? xmlTag('pstl_cd', addr.postal) : ''}
        </RCPNT_BUS_ADDR>
        ${xmlTag('payr_bn', payerBn)}
        <T1204_AMT>${amtXml}</T1204_AMT>
        ${xmlTag('rpt_tcd', reportType)}
      </T1204Slip>`;

    slipCount++;
  }

  const warnings = finishRows(issues, slipCount, 'vendor');
  if (!warnings) return;

  const postalClean = document.getElementById('py-postal').value.trim().replace(/\s/g, '');
  const summaryXml = `
      <T1204Summary>
        ${xmlTag('bn', payerBn)}
        <PAYR_NM>${xmlTag('l1_nm', document.getElementById('py-name').value.trim())}</PAYR_NM>
        <PAYR_ADDR>
          ${xmlTag('addr_l1_txt', document.getElementById('py-addr').value.trim())}
          ${xmlTag('cty_nm', document.getElementById('py-city').value.trim())}
          ${xmlTag('prov_cd', document.getElementById('py-prov').value)}
          ${xmlTag('cntry_cd', 'CAN')}
          ${xmlTag('pstl_cd', postalClean)}
        </PAYR_ADDR>
        <CNTC>
          ${xmlTag('cntc_nm', document.getElementById('py-contact').value.trim())}
          ${xmlTag('cntc_area_cd', pyPhone.area)}
          ${xmlTag('cntc_phn_nbr', pyPhone.num)}
        </CNTC>
        ${xmlTag('tx_yr', taxYear)}
        ${xmlTag('slp_cnt', String(slipCount))}
        ${xmlTag('rpt_tcd', reportType)}
        <T1204_TAMT>
          ${totalSrvc > 0 ? xmlTag('tot_srvc_pay_amt', totalSrvc.toFixed(2)) : ''}
          ${totalMxd > 0 ? xmlTag('tot_mxd_gd_pay_amt', totalMxd.toFixed(2)) : ''}
        </T1204_TAMT>
      </T1204Summary>`;

  xmlOutput = buildT619Wrapper('T1204', slipsXml, summaryXml);
  xmlOutput = xmlOutput.replace(/^\s*\n/gm, '');

  showResults(slipCount, [
    { label: 'Slips Generated', value: slipCount },
    { label: 'Service Payments', value: `$${totalSrvc.toLocaleString('en-CA', {minimumFractionDigits:2})}` },
    { label: 'Mixed Payments', value: `$${totalMxd.toLocaleString('en-CA', {minimumFractionDigits:2})}` },
  ], warnings);
  goToStep(4);
}

// ============================================================
// T4 XML GENERATION
// ============================================================
function generateT4XML() {
  // Validate required form fields — T4 uses py-* for employer
  if (!validateFilingDetails(['tx-name','tx-ref','tx-contact','tx-phone','tx-email',
                              'py-bn','py-name','py-contact','py-phone'],
                             [T4_PAYER_BN_CHECK])) return;

  const pyPhone = parsePhone(document.getElementById('py-phone').value);
  const taxYear = document.getElementById('tax-year').value;
  const reportType = document.getElementById('report-type').value;
  const employerBn = cleanBN(document.getElementById('py-bn').value);
  const issues = [];

  // Dental benefit code from form
  const dentalCode = document.getElementById('t4-dental-code')?.value || '1';
  let slipCount = 0;
  let slipsXml = '';

  // Accumulators for summary totals
  let totEmptInc = 0, totCpp = 0, totCppe = 0, totEi = 0, totRpp = 0, totItx = 0, totPadj = 0;

  for (let i = 0; i < parsedData.length; i++) {
    const v = checkRow('T4', parsedData[i], i);
    if (!v) continue;
    issues.push(...v.issues);
    if (!v.ok) continue;
    const { lastName, firstName, sinVal, empProvCd, addressRaw, xmpt, amt } = v;
    const emptyIncome = amt.empt_incamt;
    const cppAmt = amt.cpp_cntrb_amt;
    const cppeAmt = amt.cppe_cntrb_amt;
    const qppAmt = amt.qpp_cntrb_amt;
    const eiAmt = amt.empe_eip_amt;
    const rppAmt = amt.rpp_cntrb_amt;
    const itxAmt = amt.itx_ddct_amt;
    const eiInsEarn = amt.ei_insu_ern_amt;
    const cppQppEarn = amt.cpp_qpp_ern_amt;
    const unnDues = amt.unn_dues_amt;

    // Parse employee address
    const addr = parseAddress(addressRaw);

    // Accumulate totals
    totEmptInc += emptyIncome;
    totCpp += cppAmt;
    totCppe += cppeAmt;
    totEi += eiAmt;
    totRpp += rppAmt;
    totItx += itxAmt;

    // Build employee name
    const snm = lastName.substring(0, 20) || 'UNKNOWN';
    const gvnNm = firstName.substring(0, 12);

    // Build slip
    slipsXml += `
      <T4Slip>
        <EMPE_NM>
          ${xmlTag('snm', snm)}
          ${gvnNm ? xmlTag('gvn_nm', gvnNm) : ''}
        </EMPE_NM>
        ${addressRaw ? `<EMPE_ADDR>
          ${addr.addr_l1 ? xmlTag('addr_l1_txt', addr.addr_l1) : ''}
          ${addr.city ? xmlTag('cty_nm', addr.city) : ''}
          ${addr.prov ? xmlTag('prov_cd', addr.prov) : ''}
          ${addr.country ? xmlTag('cntry_cd', addr.country) : ''}
          ${addr.postal ? xmlTag('pstl_cd', addr.postal) : ''}
        </EMPE_ADDR>` : ''}
        ${xmlTag('sin', sinVal)}
        ${xmlTag('bn', employerBn)}
        ${xmlTag('cpp_qpp_xmpt_cd', xmpt.cpp_qpp_xmpt_cd)}
        ${xmlTag('ei_xmpt_cd', xmpt.ei_xmpt_cd)}
        ${xmlTag('rpt_tcd', reportType)}
        ${xmlTag('empt_prov_cd', empProvCd)}
        ${xmlTag('empr_dntl_ben_rpt_cd', dentalCode)}
        <T4_AMT>
          ${emptyIncome > 0 ? xmlTag('empt_incamt', emptyIncome.toFixed(2)) : ''}
          ${cppAmt > 0 ? xmlTag('cpp_cntrb_amt', cppAmt.toFixed(2)) : ''}
          ${cppeAmt > 0 ? xmlTag('cppe_cntrb_amt', cppeAmt.toFixed(2)) : ''}
          ${qppAmt > 0 ? xmlTag('qpp_cntrb_amt', qppAmt.toFixed(2)) : ''}
          ${eiAmt > 0 ? xmlTag('empe_eip_amt', eiAmt.toFixed(2)) : ''}
          ${rppAmt > 0 ? xmlTag('rpp_cntrb_amt', rppAmt.toFixed(2)) : ''}
          ${itxAmt > 0 ? xmlTag('itx_ddct_amt', itxAmt.toFixed(2)) : ''}
          ${xmlTag('ei_insu_ern_amt', eiInsEarn.toFixed(2))}
          ${xmlTag('cpp_qpp_ern_amt', cppQppEarn.toFixed(2))}
          ${unnDues > 0 ? xmlTag('unn_dues_amt', unnDues.toFixed(2)) : ''}
        </T4_AMT>
      </T4Slip>`;

    slipCount++;
  }

  const warnings = finishRows(issues, slipCount, 'employee');
  if (!warnings) return;

  // Build T4 Summary
  const pyAddr = document.getElementById('py-addr')?.value?.trim() || '';
  const pyCity = document.getElementById('py-city')?.value?.trim() || '';
  const pyProv = document.getElementById('py-prov')?.value || '';
  const pyPostal = (document.getElementById('py-postal')?.value || '').trim().replace(/\s/g, '');

  // Employer CPP/EI (employer match — typically same as employee)
  const totEmprCpp = totCpp; // employer matches employee CPP
  const totEmprCppe = totCppe;
  const totEmprEi = totEi * 1.4; // employer EI is 1.4x employee (standard rate)

  const summaryXml = `
      <T4Summary>
        ${xmlTag('bn', employerBn)}
        <EMPR_NM>
          ${xmlTag('l1_nm', document.getElementById('py-name').value.trim())}
        </EMPR_NM>
        ${(pyAddr || pyCity) ? `<EMPR_ADDR>
          ${pyAddr ? xmlTag('addr_l1_txt', pyAddr) : ''}
          ${pyCity ? xmlTag('cty_nm', pyCity) : ''}
          ${pyProv ? xmlTag('prov_cd', pyProv) : ''}
          ${xmlTag('cntry_cd', 'CAN')}
          ${pyPostal ? xmlTag('pstl_cd', pyPostal) : ''}
        </EMPR_ADDR>` : ''}
        <CNTC>
          ${xmlTag('cntc_nm', document.getElementById('py-contact').value.trim())}
          ${xmlTag('cntc_area_cd', pyPhone.area)}
          ${xmlTag('cntc_phn_nbr', pyPhone.num)}
        </CNTC>
        ${xmlTag('tx_yr', taxYear)}
        ${xmlTag('slp_cnt', String(slipCount))}
        ${xmlTag('rpt_tcd', reportType)}
        <T4_TAMT>
          ${totEmptInc > 0 ? xmlTag('tot_empt_incamt', totEmptInc.toFixed(2)) : ''}
          ${totCpp > 0 ? xmlTag('tot_empe_cpp_amt', totCpp.toFixed(2)) : ''}
          ${totCppe > 0 ? xmlTag('tot_empe_cppe_amt', totCppe.toFixed(2)) : ''}
          ${totEi > 0 ? xmlTag('tot_empe_eip_amt', totEi.toFixed(2)) : ''}
          ${totRpp > 0 ? xmlTag('tot_rpp_cntrb_amt', totRpp.toFixed(2)) : ''}
          ${totItx > 0 ? xmlTag('tot_itx_ddct_amt', totItx.toFixed(2)) : ''}
          ${totEmprCpp > 0 ? xmlTag('tot_empr_cpp_amt', totEmprCpp.toFixed(2)) : ''}
          ${totEmprCppe > 0 ? xmlTag('tot_empr_cppe_amt', totEmprCppe.toFixed(2)) : ''}
          ${totEmprEi > 0 ? xmlTag('tot_empr_eip_amt', totEmprEi.toFixed(2)) : ''}
        </T4_TAMT>
      </T4Summary>`;

  xmlOutput = buildT619Wrapper('T4', slipsXml, summaryXml);
  xmlOutput = xmlOutput.replace(/^\s*\n/gm, '');

  showResults(slipCount, [
    { label: 'Slips Generated', value: slipCount },
    { label: 'Total Employment Income', value: `$${totEmptInc.toLocaleString('en-CA', {minimumFractionDigits:2})}` },
    { label: 'Total Tax Deducted', value: `$${totItx.toLocaleString('en-CA', {minimumFractionDigits:2})}` },
  ], warnings);
  goToStep(4);
}

// ============================================================
// T5018 XML GENERATION
// ============================================================
function generateT5018XML() {
  // Validate required form fields, including fiscal period end date
  if (!validateFilingDetails(['tx-name','tx-ref','tx-contact','tx-phone','tx-email',
                              'py-bn','py-name','py-contact','py-phone',
                              't5018-fiscal-day','t5018-fiscal-month','t5018-fiscal-year'],
                             [T5018_PAYER_BN_CHECK, T5018_DATE_CHECK])) return;

  const fiscalDay = document.getElementById('t5018-fiscal-day').value;
  const fiscalMonth = document.getElementById('t5018-fiscal-month').value;
  const fiscalYear = document.getElementById('t5018-fiscal-year').value;
  const pyPhone = parsePhone(document.getElementById('py-phone').value);
  const reportType = document.getElementById('report-type').value;
  const payerBn = cleanBN(document.getElementById('py-bn').value);
  const issues = [];

  let totalSubcontractor = 0, slipCount = 0;
  let slipsXml = '';

  for (let i = 0; i < parsedData.length; i++) {
    const v = checkRow('T5018', parsedData[i], i);
    if (!v) continue;
    issues.push(...v.issues);
    if (!v.ok) continue;
    const { name: recipientName, rcpntTcd, idVal, amt, get } = v;
    const subAmt = amt.sbctrcr_amt;
    const addressRaw = String(get('address')).trim();
    const addr = parseAddress(addressRaw);

    // Build name XML
    let rcpntNmXml = '';
    let sinXml = '';
    let bnXml = '';

    if (rcpntTcd === '1') {
      // Individual — parse name into surname/given/initial
      const nameParts = recipientName.split(/\s+/);
      const snm = (nameParts[nameParts.length - 1] || '').substring(0, 20);
      const gvnNm = nameParts.length > 1 ? nameParts[0].substring(0, 12) : '';
      const init = nameParts.length > 2 ? nameParts[1][0] || '' : '';

      rcpntNmXml = `<RCPNT_NM>${xmlTag('snm', snm)}${gvnNm ? xmlTag('gvn_nm', gvnNm) : ''}${init ? xmlTag('init', init) : ''}</RCPNT_NM>`;
      sinXml = xmlTag('sin', idVal);
      bnXml = xmlTag('rcpnt_bn', '000000000RC0000');
    } else {
      // Corporation or Partnership
      sinXml = xmlTag('sin', '000000000');
      bnXml = xmlTag('rcpnt_bn', idVal);
    }

    // Corp/Partnership name
    const nameStr = recipientName.substring(0, 60);
    const l1Nm = nameStr.substring(0, 30);
    const l2Nm = nameStr.length > 30 ? nameStr.substring(30, 60) : '';

    totalSubcontractor += subAmt;

    slipsXml += `
      <T5018Slip>
        ${rcpntNmXml}
        ${sinXml}
        ${bnXml}
        <CORP_PTNRP_NM>${xmlTag('l1_nm', l1Nm)}${l2Nm ? xmlTag('l2_nm', l2Nm) : ''}</CORP_PTNRP_NM>
        ${xmlTag('rcpnt_tcd', rcpntTcd)}
        <RCPNT_ADDR>
          ${addr.addr_l1 ? xmlTag('addr_l1_txt', addr.addr_l1) : ''}
          ${addr.city ? xmlTag('cty_nm', addr.city) : ''}
          ${addr.prov ? xmlTag('prov_cd', addr.prov) : ''}
          ${addr.country ? xmlTag('cntry_cd', addr.country) : ''}
          ${addr.postal ? xmlTag('pstl_cd', addr.postal) : ''}
        </RCPNT_ADDR>
        ${xmlTag('bn', payerBn)}
        ${subAmt > 0 ? xmlTag('sbctrcr_amt', subAmt.toFixed(2)) : ''}
        ${xmlTag('rpt_tcd', reportType)}
      </T5018Slip>`;

    slipCount++;
  }

  const warnings = finishRows(issues, slipCount, 'contractor');
  if (!warnings) return;

  // Build T5018 Summary
  const pyAddr = document.getElementById('py-addr')?.value?.trim() || '';
  const pyCity = document.getElementById('py-city')?.value?.trim() || '';
  const pyProv = document.getElementById('py-prov')?.value || '';
  const pyPostal = (document.getElementById('py-postal')?.value || '').trim().replace(/\s/g, '');

  const summaryXml = `
      <T5018Summary>
        ${xmlTag('bn', payerBn)}
        <PAYR_NM>
          ${xmlTag('l1_nm', document.getElementById('py-name').value.trim())}
        </PAYR_NM>
        ${(pyAddr || pyCity) ? `<PAYR_ADDR>
          ${pyAddr ? xmlTag('addr_l1_txt', pyAddr) : ''}
          ${pyCity ? xmlTag('cty_nm', pyCity) : ''}
          ${pyProv ? xmlTag('prov_cd', pyProv) : ''}
          ${xmlTag('cntry_cd', 'CAN')}
          ${pyPostal ? xmlTag('pstl_cd', pyPostal) : ''}
        </PAYR_ADDR>` : ''}
        <CNTC>
          ${xmlTag('cntc_nm', document.getElementById('py-contact').value.trim())}
          ${xmlTag('cntc_area_cd', pyPhone.area)}
          ${xmlTag('cntc_phn_nbr', pyPhone.num)}
        </CNTC>
        <PRD_END_DT>
          ${xmlTag('dy', fiscalDay.padStart(2, '0'))}
          ${xmlTag('mo', fiscalMonth.padStart(2, '0'))}
          ${xmlTag('yr', fiscalYear)}
        </PRD_END_DT>
        ${xmlTag('slp_cnt', String(slipCount))}
        ${xmlTag('tot_sbctrcr_amt', totalSubcontractor.toFixed(2))}
        ${xmlTag('rpt_tcd', reportType)}
      </T5018Summary>`;

  xmlOutput = buildT619Wrapper('T5018', slipsXml, summaryXml);
  xmlOutput = xmlOutput.replace(/^\s*\n/gm, '');

  showResults(slipCount, [
    { label: 'Slips Generated', value: slipCount },
    { label: 'Total Sub-contractor Payments', value: `$${totalSubcontractor.toLocaleString('en-CA', {minimumFractionDigits:2})}` },
  ], warnings);
  goToStep(4);
}

// ============================================================
// NR4 XML GENERATION (nr4.xsd / T619_NR4.xsd)
// ============================================================
function generateNR4XML() {
  if (!validateFilingDetails(['tx-name','tx-ref','tx-contact','tx-phone','tx-email',
                              'nr4-acct','py-name','py-contact','py-phone'],
                             [{ id: 'nr4-acct', test: v => NR_ACCT_PATTERN.test(cleanBN(v)), msg: 'Must be 3 letters + 6 digits (e.g. NRA123456).' }])) return;

  const nrAcct = cleanBN(document.getElementById('nr4-acct').value);
  const withCIN = targetSchema(new Date()) === '1-27-1';
  const pyPhone = parsePhone(document.getElementById('py-phone').value);
  const taxYear = document.getElementById('tax-year').value;
  const reportType = document.getElementById('report-type').value;
  const issues = [];

  let totGross = 0, totTax = 0, slipCount = 0;
  let slipsXml = '';
  const currencies = new Set();

  for (let i = 0; i < parsedData.length; i++) {
    const v = checkRow('NR4', parsedData[i], i);
    if (!v) continue;
    issues.push(...v.issues);
    if (!v.ok) continue;
    const { name, fssn, rcpntTcd, cntry, incCd, crcy, xmptCd, cin, steCd, postal, amt, get } = v;
    const gross = amt.gro_1_incamt;
    const tax = amt.nr_tx_1_amt;

    // Individuals and joint accounts use RCPNT_NM; corporations, other and government use ENTPRS_NM
    let nameXml;
    if (rcpntTcd === '1' || rcpntTcd === '2') {
      const nameParts = name.split(/\s+/);
      const snm = nameParts[nameParts.length - 1].substring(0, 20);
      const gvnNm = nameParts.length > 1 ? nameParts[0].substring(0, 12) : '';
      nameXml = `<RCPNT_NM>${xmlTag('snm', snm)}${xmlTag('gvn_nm', gvnNm)}</RCPNT_NM>`;
    } else {
      const nameStr = name.substring(0, 60);
      nameXml = `<ENTPRS_NM>${xmlTag('l1_nm', nameStr.substring(0, 30))}${xmlTag('l2_nm', nameStr.substring(30, 60))}</ENTPRS_NM>`;
    }

    // ponytail: address country = tax-residence country; add an address-country column if they ever differ
    const addrInner = [
      xmlTag('addr_l1_txt', String(get('addr_l1')).trim().substring(0, 30)),
      xmlTag('cty_nm', String(get('city')).trim().substring(0, 28)),
      xmlTag('ste_cd', steCd),
      xmlTag('fgn_pstl_cd', postal),
    ].join('');
    const addrXml = addrInner ? `<RCPNT_ADDR>${addrInner}${xmlTag('cntry_cd', cntry)}</RCPNT_ADDR>` : '';

    const amtInner = (gross > 0 ? xmlTag('gro_1_incamt', gross.toFixed(2)) : '') +
                     (tax > 0 ? xmlTag('nr_tx_1_amt', tax.toFixed(2)) : '');

    totGross += gross;
    totTax += tax;
    currencies.add(crcy || 'CAD');

    slipsXml += `
      <NR4Slip>
        ${nameXml}
        ${addrXml}
        ${xmlTag('tx_cntry_cd', cntry)}
        ${cin ? `<CIN>${xmlTag(cin[0], cin[1])}</CIN>` : ''}
        ${xmlTag('fssn_nbr', fssn)}
        ${xmlTag('nr_acct_nbr', nrAcct)}
        ${xmlTag('rcpnt_tcd', rcpntTcd)}
        ${xmlTag('inc_1_tcd', incCd)}
        ${xmlTag('crcy_1_cd', crcy)}
        ${amtInner ? `<NR4_AMT>${amtInner}</NR4_AMT>` : ''}
        ${xmlTag('tx_xmpt_1_cd', xmptCd)}
        ${xmlTag('rpt_tcd', reportType)}
      </NR4Slip>`;

    slipCount++;
  }

  const warnings = finishRows(issues, slipCount, 'recipient');
  if (!warnings) return;
  if (!withCIN && columnMap.cin >= 0) warnings.push('The Canadian Tax ID column is left out: CRA only takes it in files built to the 2027 schema (1-27-1), which this tool makes from December 22, 2026.');
  if (currencies.size > 1) warnings.push(`Slips use more than one currency (${[...currencies].join(', ')}) — the summary totals add them together as-is. Check them before filing.`);

  const pyAddr = document.getElementById('py-addr').value.trim();
  const pyCity = document.getElementById('py-city').value.trim();
  const pyProv = document.getElementById('py-prov').value;
  const pyPostal = document.getElementById('py-postal').value.trim().replace(/\s/g, '');
  const totInner = (totGross > 0 ? xmlTag('tot_gro_1_incamt', totGross.toFixed(2)) : '') +
                   (totTax > 0 ? xmlTag('tot_nr_tx_1_amt', totTax.toFixed(2)) : '');

  // NR4 summary rpt_tcd has no "C": cancelled slips are filed under an amended (A) summary
  const summaryXml = `
      <NR4Summary>
        ${xmlTag('nr_acct_nbr', nrAcct)}
        <PAYR_NM>${xmlTag('l1_nm', document.getElementById('py-name').value.trim())}</PAYR_NM>
        ${(pyAddr || pyCity) ? `<PAYR_ADDR>
          ${xmlTag('addr_l1_txt', pyAddr)}
          ${xmlTag('cty_nm', pyCity)}
          ${xmlTag('prov_cd', pyProv)}
          ${xmlTag('cntry_cd', 'CAN')}
          ${xmlTag('pstl_cd', pyPostal)}
        </PAYR_ADDR>` : ''}
        <CNTC>
          ${xmlTag('cntc_nm', document.getElementById('py-contact').value.trim())}
          ${xmlTag('cntc_area_cd', pyPhone.area)}
          ${xmlTag('cntc_phn_nbr', pyPhone.num)}
        </CNTC>
        ${xmlTag('tx_yr', taxYear)}
        ${xmlTag('slp_cnt', String(slipCount))}
        ${xmlTag('rpt_tcd', reportType === 'C' ? 'A' : reportType)}
        ${totInner ? `<NR4_TAMT>${totInner}</NR4_TAMT>` : ''}
      </NR4Summary>`;

  xmlOutput = buildT619Wrapper('NR4', slipsXml, summaryXml);
  xmlOutput = xmlOutput.replace(/^\s*\n/gm, '');

  showResults(slipCount, [
    { label: 'Slips Generated', value: slipCount },
    { label: 'Total Gross Income', value: `$${totGross.toLocaleString('en-CA', {minimumFractionDigits:2})}` },
    { label: 'Total Tax Withheld', value: `$${totTax.toLocaleString('en-CA', {minimumFractionDigits:2})}` },
  ], warnings);
  goToStep(4);
}

// ============================================================
// T619 WRAPPER (shared by all return types)
// ============================================================
function buildT619Wrapper(returnType, slipsXml, summaryXml) {
  const txPhone = parsePhone(document.getElementById('tx-phone').value);
  const acct = cleanBN(document.getElementById('tx-bn').value);
  const repId = cleanBN(document.getElementById('tx-repid').value);
  // The XSD requires <TransmitterAccountNumber>; with a RepID only it stays empty
  return `<?xml version="1.0" encoding="UTF-8"?>
<Submission xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <T619>
    <TransmitterAccountNumber>${acct ? xmlTag(transmitterAccountTag(acct), acct) : ''}</TransmitterAccountNumber>
    ${repId ? `<TransmitterRepID>${xmlTag('RepID', repId)}</TransmitterRepID>` : ''}
    ${xmlTag('sbmt_ref_id', document.getElementById('tx-ref').value.trim())}
    ${xmlTag('summ_cnt', '1')}
    ${xmlTag('lang_cd', document.getElementById('tx-lang').value)}
    <TransmitterName>${xmlTag('l1_nm', document.getElementById('tx-name').value.trim())}</TransmitterName>
    ${xmlTag('TransmitterCountryCode', 'CAN')}
    <CNTC>
      ${xmlTag('cntc_nm', document.getElementById('tx-contact').value.trim())}
      ${xmlTag('cntc_area_cd', txPhone.area)}
      ${xmlTag('cntc_phn_nbr', txPhone.num)}
      ${xmlTag('cntc_email_area', document.getElementById('tx-email').value.trim())}
    </CNTC>
  </T619>
  <Return>
    <${returnType}>
      ${slipsXml}
      ${summaryXml}
    </${returnType}>
  </Return>
</Submission>`;
}

// ============================================================
// RESULTS & DOWNLOAD
// ============================================================
const REPORT_TYPE_NAMES = { O: 'Original', A: 'Amendment', C: 'Cancel' };

function showResults(slips, stats, warnings) {
  track('validation_passed', { return_type: getSelectedReturnType() });
  const rt = getSelectedReturnType();
  const taxYear = document.getElementById('tax-year').value;
  const fileName = `${rt}_submission_${taxYear}.xml`;
  const rptCd = document.getElementById('report-type').value;
  const period = rt === 'T5018'
    ? `fiscal period ending ${['year', 'month', 'day'].map(p => document.getElementById(`t5018-fiscal-${p}`).value.padStart(2, '0')).join('-')}`
    : `taxation year ${taxYear}`;

  const rows = [
    ['File', fileName, true],
    ['Return', `${rt}, ${period}`],
    ['Report type', `${REPORT_TYPE_NAMES[rptCd]} (${rptCd})`],
    ['Submission ref. ID', document.getElementById('tx-ref').value.trim(), true],
    ['CRA XML schema', rt !== 'NR4' ? '1-26-3 and 1-27-1' : targetSchema(new Date()) === '1-27-1'
      ? '1-27-1 (CRA accepts it from January 11, 2027)' : '1-26-3 (CRA accepts it until December 22, 2026)'],
    ['Slips', slips],
    ...stats.filter(s => s.label !== 'Slips Generated').map(s => [s.label, s.value]),
  ];
  document.getElementById('result-heading').textContent = `Your ${rt} file is ready`;
  document.getElementById('receipt').innerHTML = rows.map(([dt, dd, mono]) =>
    `<dt>${dt}</dt><dd${mono ? ' class="mono"' : ''}>${escapeXml(String(dd))}</dd>`
  ).join('');
  document.getElementById('btn-download').textContent = `Download ${fileName}`;

  const wBox = document.getElementById('warnings-box');
  if (warnings.length > 0) {
    const n = warnings.length;
    wBox.innerHTML = `<h4>${slips} slips · ${n} warning${n === 1 ? '' : 's'} to review</h4><ul>${warnings.map(w => `<li>${escapeXml(w)}</li>`).join('')}</ul>`;
    wBox.classList.remove('hidden');
  } else {
    wBox.classList.add('hidden');
  }
}

// GA4 event. gtag() only pushes onto dataLayer, so it queues fine before gtag.js has loaded.
// Analytics must never break the app.
function track(name, params) {
  try { if (window.gtag) gtag('event', name, params); } catch (e) { /* ignore */ }
}

// Unexpected errors -> js/report.js (scrubbed, de-duplicated, app_error + Worker POST when allowed). Never throws.
function reportCrash(kind, err) {
  try { if (window.taxxmlReport) window.taxxmlReport.crash(kind, err); } catch (e) { /* ignore */ }
}
// What js/report.js may attach to a report: the return type and step, nothing from the file or Step 3
function reportContext() {
  return { return_type: getSelectedReturnType(), step: currentStep };
}

// Field names safe to send to GA4: our own column keys (sin, empt_incamt, ...) and Step 3 input ids.
// Never a header the user typed or a cell value; anything not on this list is reported as 'other'.
function analyticsFieldAllowlist() {
  return new Set([
    ...Object.values(RETURN_TYPES).flatMap(rt => rt.fields.map(f => f.key)),
    ...SAVED_FIELDS, 't5018-fiscal-day', 't5018-fiscal-month', 't5018-fiscal-year',
    'ignore', 'full_name', // Step 2 editor choices that aren't a single column key
  ]);
}

// Our own templates/*_Sample.csv files: header row + first cell of the first row. A real file built on the template
// has different rows, so it isn't counted. Only the true/false result is sent, never the file's contents or name.
const SAMPLE_SIGNATURES = new Set([
  'Last Name|First Name|SIN|Box 14 - Employment Income|Box 16 - CPP Deductions|Box 18 - EI Premiums|Box 22 - Income Tax Deducted|' +
    'Box 24 - EI Insurable Earnings|Box 26 - CPP Pensionable Earnings|Province of Employment|Doe',
  'Vendor Name|Vendor BN|Amount Paid|Business Type|Service Payments Only|Address|Acme Corp',
  'Subcontractor Name|Subcontractor BN/SIN|Total Construction Payments|Recipient Type|Address|BuildIt Inc',
  'Recipient Name|Recipient Type|Foreign Tax ID|Country of Residence|Income Code|Currency|Gross Income|Tax Withheld|' +
    'Exemption Code|Address|City|State/Province|Postal Code|Canadian Tax ID|John Smith',
]);

function isSampleFile() {
  return SAMPLE_SIGNATURES.has([...headers, String(parsedData[0][0]).trim()].join('|'));
}

function analyticsField(field) {
  return analyticsFieldAllowlist().has(field) ? field : 'other';
}

function rowsBucket(n) {
  return n === 0 ? '0' : n === 1 ? '1' : n <= 5 ? '2-5' : n <= 20 ? '6-20' : n <= 100 ? '21-100' : '100+';
}
function colsBucket(n) {
  return n <= 8 ? '1-8' : n <= 16 ? '9-16' : n <= 24 ? '17-24' : '25+';
}

// The Step 2 table for GA4 (table_shown, table_error_state, table_exited): sizes, and problem cells counted by our
// own column key in CRA order. Never a cell, a header or a message (the messages hold names and SINs).
function tableContext() {
  const issues = [...rowIssues.values()].flat();
  const cells = list => [...new Set(list.map(x => `${x.row}|${analyticsField(x.field)}`))].map(k => k.split('|')[1]);
  const errors = cells(issues.filter(x => x.severity === 'error'));
  const byField = {};
  errors.forEach(f => { byField[f] = (byField[f] || 0) + 1; });
  const fields = [...getReturnConfig().fields.map(f => f.key), 'other'].filter(f => byField[f]);
  const n = errors.length;
  return {
    return_type: getSelectedReturnType(), is_sample: parsedData.length > 0 && isSampleFile(),
    rows_bucket: rowsBucket(parsedData.length), cols_bucket: colsBucket(headers.length), required_unmapped: unmappedRequired().length,
    error_cells: n, warning_cells: cells(issues.filter(x => x.severity === 'warning' && placed(x))).length,
    error_cells_bucket: n === 0 ? '0' : n <= 2 ? '1-2' : n <= 10 ? '3-10' : '11+',
    ...(n ? { first_error_field: errors[0] } : {}),
    error_field_list: fields.join(','), error_by_field: fields.map(f => `${f}:${byField[f]}`).join(','),
  };
}

// A visit starts when the table shows with a file loaded: timer and counters from zero
function tableShown() {
  if (!headers.length) return;
  step2Visit = { start: Date.now(), remaps: 0, edits: 0, deletes: 0, tips: new Set(), hscroll: false };
  track('table_shown', tableContext());
}
const tableCount = k => { if (step2Visit) step2Visit[k]++; };

// ...and ends once: reason 'continue' | 'back' | 'reset' | 'pagehide'
function tableExited(reason) {
  if (!step2Visit) return;
  const { start, remaps, edits, deletes } = step2Visit;
  step2Visit = null;
  const s = Math.max(0, Math.floor((Date.now() - start) / 1000));
  track('table_exited', { ...tableContext(), exit_reason: reason, step2_seconds: s,
    step2_seconds_bucket: s <= 10 ? '0-10' : s <= 30 ? '11-30' : s <= 60 ? '31-60' : s <= 180 ? '61-180' : '181+',
    remaps_count: remaps, edits_count: edits, deletes_count: deletes,
    ...(reason === 'pagehide' ? { transport_type: 'beacon' } : {}) }); // the page is going: GA's beacon transport still delivers it
}

function downloadXML() {
  if (!xmlOutput) return;
  const rt = getSelectedReturnType();
  const url = URL.createObjectURL(new Blob([xmlOutput], { type: 'application/xml;charset=utf-8' }));
  track('xml_downloaded', { return_type: rt }); // before the click, so nothing in the download path can skip it
  const a = document.createElement('a');
  a.href = url;
  a.download = `${rt}_submission_${document.getElementById('tax-year').value}.xml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000); // revoking right away can cancel the download in Firefox/Safari
}

// ============================================================
// EVENT LISTENERS
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Sync Transmitter to Payer if "Same as transmitter" is checked
  const syncFields = ['bn', 'name', 'contact', 'phone'];
  syncFields.forEach(field => {
    const txInput = document.getElementById(`tx-${field}`);
    const pyInput = document.getElementById(`py-${field}`);
    
    // Sync downwards as user types
    if (txInput) {
      txInput.addEventListener('input', () => {
        const checkbox = document.getElementById('same-as-tx');
        if (checkbox && checkbox.checked && pyInput) {
          pyInput.value = txInput.value;
        }
      });
    }
    
    // Uncheck box if user edits the payer field manually
    if (pyInput) {
      pyInput.addEventListener('input', () => {
        const checkbox = document.getElementById('same-as-tx');
        if (checkbox && checkbox.checked) {
          checkbox.checked = false;
        }
      });
    }
  });
  
  // Auto-format phone numbers (###-###-####)
  ['tx-phone', 'py-phone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', function(e) {
        let x = e.target.value.replace(/\D/g, '').match(/(\d{0,3})(\d{0,3})(\d{0,4})/);
        e.target.value = !x[2] ? x[1] : x[1] + '-' + x[2] + (x[3] ? '-' + x[3] : '');
      });
    }
  });

  // Clear a field's inline error as soon as the user edits it
  document.getElementById('step-3').addEventListener('input', e => {
    if (!e.target.classList.contains('has-error')) return;
    e.target.classList.remove('has-error');
    e.target.closest('.form-group').querySelector('.field-error')?.remove();
  });

  // Auto-format postal code (A1A 1A1)
  const postalInput = document.getElementById('py-postal');
  if (postalInput) {
    postalInput.addEventListener('input', function(e) {
      let x = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (x.length > 3) {
        e.target.value = x.substring(0, 3) + ' ' + x.substring(3, 6);
      } else {
        e.target.value = x;
      }
    });
  }
});

// ============================================================
// FILING DETAILS PERSISTENCE (localStorage)
// Saves all Step 3 fields automatically so corrections don't
// require re-entering transmitter/payer info from scratch.
// ============================================================
const SAVED_FIELDS = [
  'tx-bn','tx-repid','tx-name','tx-ref','tx-lang','tx-contact','tx-phone','tx-email',
  'py-bn','py-name','py-addr','py-city','py-prov','py-postal','py-contact','py-phone',
  't4-dental-code','nr4-acct'
];
const STORAGE_KEY = 'taxxml_filing_details';

function saveFilingDetails() {
  const data = {};
  SAVED_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el && !isDemoValue(id, el.value)) data[id] = el.value;
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function restoreFilingDetails() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  let data;
  try { data = JSON.parse(raw); } catch(e) { return; }

  let anyRestored = false;
  SAVED_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el && data[id]) {
      el.value = data[id];
      anyRestored = true;
    }
  });

  if (anyRestored) {
    // Auto-increment the saved submission ref ID to prevent duplicate rejections (A→B, 1→2, 9→A)
    const refEl = document.getElementById('tx-ref');
    if (refEl && data['tx-ref']) refEl.value = nextSubmissionRef(refEl.value.trim());

    // Restore notice with a visible way out; saved data is only removed when the user clicks Start fresh
    const notice = document.createElement('p');
    notice.id = 'restore-notice';
    notice.className = 'form-hint';
    notice.innerHTML = '✓ Filled in from your last session on this computer. Check every field, especially the Submission Reference ID. ' +
      '<button type="button" class="btn btn-ghost" onclick="clearFilingDetails()">Start fresh</button>';
    const card = document.querySelector('#step-3 .card');
    if (card && !document.getElementById('restore-notice')) {
      card.insertBefore(notice, card.firstChild);
    }
  }
}

function clearFilingDetails() {
  track('start_fresh', {});
  localStorage.removeItem(STORAGE_KEY);
  const notice = document.getElementById('restore-notice');
  if (notice) notice.remove();
  SAVED_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = el.options ? el.options[0].value : ''; // selects go back to their first (default) option
  });
  suggestSubmissionRef();
}

// Attach save listeners to all Step 3 fields
window.addEventListener('DOMContentLoaded', () => {
  SAVED_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveFilingDetails);
    if (el && el.tagName === 'INPUT') el.addEventListener('blur', saveFilingDetails);
  });
  restoreFilingDetails();
});

// ============================================================
// ONE-CLICK SAMPLE DATA
// templates/<RT>_Sample.csv is fetched and opened like a user's file. Step 3 gets obviously fake demo
// details, but only in empty fields; they are never saved, and opening a real file clears them.
// ============================================================
function demoDetails(rt) {
  return {
    'tx-bn': '123456789MM0001', 'tx-name': 'DEMO Transmitter Inc', 'tx-ref': 'DEMO1', 'tx-contact': 'Demo Contact',
    'tx-phone': '555-555-0100', 'tx-email': 'demo@example.com',
    'py-bn': rt === 'T5018' ? '123456789RZ0001' : '123456789RP0001', 'py-name': 'DEMO Payer Ltd',
    'py-addr': '1 Demo Street', 'py-city': 'Demo City', 'py-prov': 'ON', 'py-postal': 'K1A 0B1',
    'py-contact': 'Demo Contact', 'py-phone': '555-555-0100', 'nr4-acct': 'NRA123456',
    't5018-fiscal-day': '31', 't5018-fiscal-month': '12',
    't5018-fiscal-year': document.getElementById('tax-year').value || String(new Date().getFullYear() - 1),
  };
}
let demoFilled = {}; // field id -> the demo value we put there

function isDemoValue(id, value) {
  return demoFilled[id] === value;
}

function fillDemoDetails(rt) {
  for (const [id, v] of Object.entries(demoDetails(rt))) {
    const el = document.getElementById(id);
    if (el.value.trim() && demoFilled[id] !== el.value) continue; // keep what the user typed or restored
    el.value = demoFilled[id] = v;
  }
}

function setDemoMode(on) {
  document.getElementById('demo-banner').classList.toggle('hidden', !on);
  if (on) return;
  for (const [id, v] of Object.entries(demoFilled)) {
    const el = document.getElementById(id);
    if (el.value === v) el.value = '';
  }
  demoFilled = {};
}

// page: 'home' (button in Step 1) or 'landing' (a generator page's /?return=RT&sample=1 link)
function loadSample(rt, page) {
  const sel = document.getElementById('return-type');
  if (sel.value !== rt) { sel.value = rt; onReturnTypeChange(); } // silent: file_opened then reports source 'default'
  showFileError('');
  return fetch(`templates/${rt}_Sample.csv`)
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
    .then(buf => {
      fillDemoDetails(rt);
      track('sample_loaded', { return_type: rt, page });
      openWorkbook(buf, `${rt}_Sample.csv (sample data)`, 'csv', true);
    })
    .catch(() => showFileError(`Couldn't load the ${rt} sample data. Check your connection, or download the sample spreadsheet below and open it.`));
}

// ============================================================
// STEP 1: WHAT YOU'LL NEED + RETURN SUMMARY
// Payer accounts: canada.ca T4 Summary / T1204 Summary (RP), T5018 Summary (RZ); NR account format: T619 2026 spec.
// ============================================================
const NEEDS = {
  T4: ["The employer's 15-character payroll account number (RP), for example 123456789RP0001.",
       'One row per employee: name, SIN and the T4 box amounts.'],
  T5018: ["The payer's 15-character account number on the RZ program, for example 123456789RZ0001.",
          'One row per subcontractor: name, BN or SIN, and the amount paid.',
          'The end date of your reporting period (calendar year or fiscal period).'],
  NR4: ['Your non-resident (NR) account number: 3 letters + 6 digits, as on your NR76 statement of account.',
        'One row per recipient: name, foreign tax ID, country of residence, income code, gross income and tax withheld.'],
  T1204: ["The department's 15-character payroll account number (RP), for example 123456789RP0001, and its mailing address.",
          'One row per contractor: name, BN or SIN, amount paid, business type, whether it was for services only, and address.'],
};
const DUE_NOTES = {
  T5018: " if you report by calendar year; with a fiscal period it's 6 months after the period ends",
  NR4: '; estates and trusts have 90 days after their tax year ends',
};
const WHEN_TO_FILE_URL = 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/file-information-returns-slip-summaries/when-to-file.html';

function renderNeeds(rt) {
  const { year, due } = nextFilingDue(rt);
  const items = [...NEEDS[rt],
    'For the T619 transmitter record: the CRA account number you will sign in to Internet File Transfer with (usually a 15-character business number).',
    'A contact name and phone number for the transmitter and for the payer, and an email for the transmitter.'];
  document.getElementById('needs').innerHTML =
    `<h4>What you'll need</h4><ul>${items.map(i => `<li>${escapeXml(i)}</li>`).join('')}</ul>` +
    `<p class="needs-due">The ${rt} return for ${year} is due ${formatDue(due)}${DUE_NOTES[rt] || ''} ` +
    `(<a href="${WHEN_TO_FILE_URL}" target="_blank" rel="noopener">CRA due dates</a>). ` +
    `<button type="button" class="link-btn" onclick="addReminder()" data-cta="reminder">Remind me 2 weeks before</button></p>`;
}

function showReturnSelect() {
  document.getElementById('return-select-group').classList.remove('hidden');
  document.getElementById('return-type').focus();
}

// ============================================================
// FILING DEADLINE REMINDER (.ics, built in the browser, no personal data)
// canada.ca "When to file information returns": T4 last day of February, T1204 March 31, T5018 6 months after
// the reporting period (calendar year assumed); NR4 March 31 (canada.ca "Get ready to file").
// A due date on a Saturday, Sunday or CRA public holiday moves to the next business day.
// ============================================================
const DAY_MS = 864e5;
const DUE_DATES = { T4: [2, 0], NR4: [2, 31], T1204: [2, 31], T5018: [5, 30] }; // [month index, day]; day 0 = last day of the month before

function easterUTC(y) { // anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
        f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
        i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return Date.UTC(y, Math.floor(n / 31) - 1, (n % 31) + 1);
}

// Due date (YYYY-MM-DD) of the return for calendar year `year`.
// ponytail: only the holidays that can follow these dates (Good Friday, Easter Monday, Canada Day); add more if a date changes
function filingDueDate(rt, year) {
  const [mo, dy] = DUE_DATES[rt];
  const easter = easterUTC(year + 1);
  const holidays = [easter - 2 * DAY_MS, easter + DAY_MS, Date.UTC(year + 1, 6, 1)];
  let t = Date.UTC(year + 1, mo, dy);
  while ([0, 6].includes(new Date(t).getUTCDay()) || holidays.includes(t)) t += DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

// The next deadline on or after `today` (local date): { year: calendar year reported, due: 'YYYY-MM-DD' }
function nextFilingDue(rt, today = new Date()) {
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const year = filingDueDate(rt, today.getFullYear() - 1) >= ymd ? today.getFullYear() - 1 : today.getFullYear();
  return { year, due: filingDueDate(rt, year) };
}

function formatDue(iso) { // 'Monday, March 1, 2027'
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// All-day event 2 weeks before the due date, with a 9:00 alarm that day. Generic text only.
function reminderICS(rt, today = new Date()) {
  const { year, due } = nextFilingDue(rt, today);
  const ymd = t => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
  const start = Date.parse(due) - 14 * DAY_MS;
  const text = s => s.replace(/[\;,]/g, '\\$&');
  const summary = `File your ${rt} information return: due ${formatDue(due)}`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TaxXML.ca//Deadline reminder//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${rt.toLowerCase()}-${year}-${ymd(start)}@taxxml.ca`,
    `DTSTAMP:${today.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${ymd(start)}`,
    `DTEND;VALUE=DATE:${ymd(start + DAY_MS)}`,
    `SUMMARY:${text(summary)}`,
    `DESCRIPTION:${text(`Your ${rt} information return for ${year} is due to the CRA by ${formatDue(due)}${DUE_NOTES[rt] || ''}.`)}` +
      `\\n\\nMake the XML file: https://taxxml.ca/?return=${rt}#converter\\n\\nCheck the due date on canada.ca: ${WHEN_TO_FILE_URL}`,
    `URL:https://taxxml.ca/?return=${rt}#converter`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(summary)}`, 'TRIGGER;RELATED=START:PT9H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(l => l.match(/.{1,74}/g).join('\r\n ')).join('\r\n') + '\r\n'; // fold to 75 octets (ASCII only)
}

function addReminder() {
  const rt = getSelectedReturnType();
  const url = URL.createObjectURL(new Blob([reminderICS(rt)], { type: 'text/calendar;charset=utf-8' }));
  track('reminder_added', { return_type: rt });
  const a = document.createElement('a');
  a.href = url;
  a.download = `${rt}-filing-deadline.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ============================================================
// HERO INTENT CHIP: one optional question, asked once per browser session
// ============================================================
const INTENTS = ['filing_now', 'exploring_format', 'for_client'];
const INTENT_KEY = 'taxxml_intent_asked';

function chooseIntent(intent) {
  if (!INTENTS.includes(intent)) return;
  track('intent_selected', { intent });
  dismissIntent();
}

function dismissIntent() {
  try { sessionStorage.setItem(INTENT_KEY, '1'); } catch (e) { /* storage blocked: just hide */ }
  document.getElementById('intent').classList.add('hidden');
}

// ---- Page load ----
{
  let asked = false;
  try { asked = !!sessionStorage.getItem(INTENT_KEY); } catch (e) { /* ask */ }
  document.getElementById('intent').classList.toggle('hidden', asked);
  // This filing season's tax year (still editable), then the return from the URL or the default
  const year = defaultTaxYear(new Date());
  document.getElementById('tax-year').value = year;
  document.getElementById('t5018-fiscal-year').value = year;
  const fromUrl = returnFromUrl(location.search);
  if (fromUrl) document.getElementById('return-type').value = fromUrl;
  onReturnTypeChange(fromUrl ? 'landing' : null);
  // "Try it with sample data" links on other pages: /?return=<RT>&sample=1#converter
  if (fromUrl && /[?&]sample=1(?:[&#]|$)/.test(location.search)) loadSample(fromUrl, 'landing');
}

// ============================================================
// DEV TOOL — localhost only, invisible on production
// ============================================================
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  const devBar = document.createElement('div');
  devBar.innerHTML = `
    <div style="
      position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 9999;
      background: rgba(15,15,25,0.92); border: 1px solid #3b3b5c;
      border-radius: 2rem; padding: 0.4rem 0.75rem;
      display: flex; align-items: center; gap: 0.5rem;
      font-family: monospace; font-size: 0.75rem; color: #8888bb;
      backdrop-filter: blur(8px); box-shadow: 0 4px 24px rgba(0,0,0,0.5);
    ">
      <span style="margin-right:0.25rem; opacity:0.5;">DEV</span>
      ${[1,2,3,4].map(n => `
        <button onclick="goToStep(${n})" style="
          background: transparent; border: 1px solid #3b3b5c;
          color: #aaaacc; border-radius: 1rem;
          padding: 0.2rem 0.6rem; cursor: pointer; font-family: monospace;
          font-size: 0.75rem; transition: all 0.15s;
        " onmouseover="this.style.borderColor='#7c6fff';this.style.color='#fff'"
           onmouseout="this.style.borderColor='#3b3b5c';this.style.color='#aaaacc'"
        >Step ${n}</button>
      `).join('')}
    </div>
  `;
  document.body.appendChild(devBar);
}


