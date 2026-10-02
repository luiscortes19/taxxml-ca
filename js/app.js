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

// ============================================================
// RETURN TYPE REGISTRY
// ============================================================
const RETURN_TYPES = {
  T1204: {
    label: 'T1204 — Government Service Contract Payments',
    fields: [
      { key: 'vendor_name',   label: 'Vendor Name',            autoMatch: ['vendor name', 'recipient name', 'payee name'] },
      { key: 'vendor_bn',     label: 'Vendor BN / SIN',        autoMatch: ['vendor bn', 'vendor business', 'vendor sin', 'recipient bn', 'recipient business', 'payee bn', 'payee sin'] },
      { key: 'amount',        label: 'Amount Paid',            autoMatch: ['amount paid', 'amount', 'payment amount', 'total paid'] },
      { key: 'biz_type',      label: 'Business Type',          autoMatch: ['business type', 'recipient type', 'entity type'] },
      { key: 'svc_only',      label: 'Service Payments Only',  autoMatch: ['service payments', 'service only', 'services only'] },
      { key: 'address',       label: 'Address',                autoMatch: ['vendor address', 'recipient address', 'address', 'addr'] },
    ],
    summaryLabel: 'T1204 Summary — Payer Information',
    summaryHint: 'The government department that made the payments.',
    generateXML: generateT1204XML,
  },
  T4: {
    label: 'T4 — Statement of Remuneration Paid',
    fields: [
      { key: 'empe_snm',       label: 'Last Name (Box 12)',        autoMatch: ['last name', 'surname', 'family name', 'snm'] },
      { key: 'empe_gvn_nm',    label: 'First Name',                autoMatch: ['first name', 'given name', 'gvn'] },
      { key: 'sin',             label: 'SIN (Box 12)',              autoMatch: ['sin', 'social insurance'] },
      { key: 'empt_incamt',    label: 'Employment Income (Box 14)', autoMatch: ['employment income', 'box 14', 'salary', 'wages', 'gross pay', 'income'] },
      { key: 'cpp_cntrb_amt',  label: 'CPP Contributions (Box 16)', autoMatch: ['cpp', 'pension plan', 'box 16', 'cpp contrib'] },
      { key: 'cppe_cntrb_amt', label: 'CPP2 Contributions (Box 16A)', autoMatch: ['cpp2', 'second cpp', 'box 16a', 'cppe'] },
      { key: 'qpp_cntrb_amt',  label: 'QPP Contributions (Box 17)', autoMatch: ['qpp', 'quebec pension', 'box 17'] },
      { key: 'empe_eip_amt',   label: 'EI Premiums (Box 18)',      autoMatch: ['ei premium', 'employment insurance', 'box 18', 'ei'] },
      { key: 'rpp_cntrb_amt',  label: 'RPP Contributions (Box 20)', autoMatch: ['rpp', 'registered pension', 'box 20'] },
      { key: 'itx_ddct_amt',   label: 'Income Tax Deducted (Box 22)', autoMatch: ['income tax', 'tax deducted', 'box 22', 'tax withheld'] },
      { key: 'ei_insu_ern_amt', label: 'EI Insurable Earnings (Box 24)', autoMatch: ['insurable earnings', 'box 24', 'ei earn'] },
      { key: 'cpp_qpp_ern_amt', label: 'CPP/QPP Pensionable Earnings (Box 26)', autoMatch: ['pensionable earnings', 'box 26', 'cpp earn', 'qpp earn'] },
      { key: 'unn_dues_amt',   label: 'Union Dues (Box 44)',       autoMatch: ['union dues', 'box 44', 'union'] },
      { key: 'empt_prov_cd',   label: 'Province of Employment (Box 10)', autoMatch: ['province of employment', 'box 10', 'prov emp', 'employment prov'] },
      { key: 'address',        label: 'Employee Address',          autoMatch: ['address', 'addr', 'employee address'] },
    ],
    summaryLabel: 'T4 Summary — Employer Information',
    summaryHint: 'The employer who paid the remuneration.',
    generateXML: generateT4XML,
  },
  T5018: {
    label: 'T5018 — Statement of Contract Payments',
    fields: [
      { key: 'rcpnt_name',    label: 'Recipient Name',             autoMatch: ['contractor name', 'recipient name', 'subcontractor', 'payee name', 'company name', 'name'] },
      { key: 'rcpnt_bn',      label: 'Recipient BN / SIN (Box 24)', autoMatch: ['contractor bn', 'recipient bn', 'subcontractor bn', 'contractor sin', 'recipient sin', 'business number'] },
      { key: 'sbctrcr_amt',   label: 'Sub-contractor Payments (Box 22)', autoMatch: ['sub-contractor', 'subcontractor payment', 'contract payment', 'amount paid', 'amount', 'payment'] },
      { key: 'rcpnt_type',    label: 'Recipient Type',             autoMatch: ['recipient type', 'contractor type', 'entity type', 'type'] },
      { key: 'address',       label: 'Recipient Address',          autoMatch: ['contractor address', 'recipient address', 'subcontractor address', 'address', 'addr'] },
    ],
    summaryLabel: 'T5018 Summary — Payer Information',
    summaryHint: 'The business that made the contract payments.',
    generateXML: generateT5018XML,
  },
  NR4: {
    label: 'NR4 — Statement of Amounts Paid or Credited to Non-Residents of Canada',
    fields: [
      { key: 'rcpnt_name',   label: 'Recipient Name',                autoMatch: ['recipient name', 'payee name', 'name'] },
      { key: 'rcpnt_type',   label: 'Recipient Type',                autoMatch: ['recipient type', 'payee type', 'entity type', 'type'] },
      { key: 'fssn_nbr',     label: 'Foreign Tax ID',                autoMatch: ['foreign tax id', 'foreign tax', 'tax identification', 'fssn', 'tax id'] },
      { key: 'tx_cntry_cd',  label: 'Country of Residence (3 letters)', autoMatch: ['country of residence', 'residence country', 'tax country', 'country'] },
      { key: 'inc_1_tcd',    label: 'Income Code (Box 14)',          autoMatch: ['income code', 'income type', 'type of income', 'box 14'] },
      { key: 'crcy_1_cd',    label: 'Currency Code (Box 15)',        autoMatch: ['currency', 'crcy', 'box 15'] },
      { key: 'gro_1_incamt', label: 'Gross Income (Box 16)',         autoMatch: ['gross income', 'gross amount', 'gross', 'box 16'] },
      { key: 'nr_tx_1_amt',  label: 'Non-Resident Tax Withheld (Box 17)', autoMatch: ['tax withheld', 'non-resident tax', 'withholding', 'box 17'] },
      { key: 'tx_xmpt_1_cd', label: 'Exemption Code (Box 18)',       autoMatch: ['exemption code', 'exemption', 'exempt', 'box 18'] },
      { key: 'addr_l1',      label: 'Address Line 1',                autoMatch: ['street address', 'address line', 'address', 'addr'] },
      { key: 'city',         label: 'City',                          autoMatch: ['city'] },
      { key: 'ste_cd',       label: 'State / Province (2 letters)',  autoMatch: ['state/province', 'state', 'province'] },
      { key: 'fgn_pstl_cd',  label: 'Postal / ZIP Code',             autoMatch: ['postal code', 'zip code', 'postal', 'zip'] },
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
const VALID_PROVINCES = new Set(['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT']);
const ALL_PROV_CODES = new Set(['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT','US','ZZ']);
const COUNTRY_MAP = { 'CA': 'CAN', 'US': 'USA', 'CAN': 'CAN', 'USA': 'USA' };
const BIZ_TYPE_MAP = { 'Corporation': '3', 'Sole Proprietorship': '1', 'Partnership': '4' };
const NR4_RCPNT_TYPE_MAP = { 'individual': '1', 'joint account': '2', 'joint': '2', 'corporation': '3', 'other': '4', 'government': '5' };

// ============================================================
// STEP NAVIGATION
// ============================================================
function goToStep(step) {
  document.querySelectorAll('.wizard-step').forEach(el => el.classList.add('hidden'));
  document.getElementById(`step-${step}`).classList.remove('hidden');

  document.querySelectorAll('.progress-step').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.remove('active', 'done');
    if (s === step) el.classList.add('active');
    else if (s < step) el.classList.add('done');
  });

  currentStep = step;
  document.getElementById('converter').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetAll() {
  parsedData = [];
  headers = [];
  xmlOutput = '';
  columnMap = {};
  document.getElementById('file-info').classList.add('hidden');
  document.getElementById('file-input').value = '';
  goToStep(1);
}

// ============================================================
// RETURN TYPE SWITCHER — updates Step 3 form
// ============================================================
function onReturnTypeChange() {
  const rt = getSelectedReturnType();
  const config = RETURN_TYPES[rt];

  // Update step 1 description + sample link
  const step1Data = { T4: 'T4 payroll', T5018: 'T5018 sub-contractor payment', NR4: 'NR4 non-resident payment', T1204: 'T1204 payment' };
  document.querySelector('#step-1 .card > p').textContent =
    `Choose the return, then open the .xlsx or .csv file with your ${step1Data[rt]} data.`;
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

  // If data is already loaded, re-map
  if (parsedData.length > 0) {
    autoMapColumns();
    buildPreview();
    goToStep(2); // Jump back to step 2 automatically if they change type mid-flow
  }
}

// ============================================================
// STEP 1: FILE UPLOAD
// ============================================================
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e => { if (e.target.files.length) handleFile(e.target.files[0]); });

// Listen for return type changes
document.getElementById('return-type').addEventListener('change', onReturnTypeChange);

// Hero return picker: preselect the return and jump to Step 1
document.querySelectorAll('.return-pick').forEach(btn => btn.addEventListener('click', () => {
  const sel = document.getElementById('return-type');
  sel.value = btn.dataset.return;
  sel.dispatchEvent(new Event('change'));
  document.getElementById('converter').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));

function showFileError(msg) {
  const el = document.getElementById('file-error');
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

function handleFile(file) {
  showFileError('');
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx', 'xls', 'csv'].includes(ext)) {
    showFileError('Please upload a valid Excel (.xlsx, .xls) or CSV file.');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      if (raw.length < 2) { showFileError('File has no data rows.'); return; }

      headers = raw[0].map(h => String(h || '').trim());
      parsedData = raw.slice(1).filter(row => row.some(cell => cell !== ''));

      const info = document.getElementById('file-info');
      info.innerHTML = `<i data-lucide="check-circle" class="icon-sm"></i> ${file.name} &mdash; ${parsedData.length} rows, ${headers.length} columns`;
      info.classList.remove('hidden');
      document.getElementById('step1-actions').classList.remove('hidden');
      if (window.lucide) window.lucide.createIcons();

      autoMapColumns();
      buildPreview();
      goToStep(2);
    } catch (err) {
      showFileError('Error reading file: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ============================================================
// STEP 2: COLUMN MAPPING & PREVIEW
// ============================================================
function autoMapColumns() {
  const config = getReturnConfig();
  columnMap = {};
  const usedColumns = new Set();

  // Score each (field, column) pair by keyword match length (longer = more specific = better)
  const candidates = [];
  config.fields.forEach(field => {
    headers.forEach((h, colIdx) => {
      const hl = h.toLowerCase();
      field.autoMatch.forEach(keyword => {
        if (hl.includes(keyword)) {
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

function buildPreview() {
  const config = getReturnConfig();
  const tbody = document.getElementById('mapping-tbody');
  tbody.innerHTML = '';

  config.fields.forEach(field => {
    const tr = document.createElement('tr');
    const mappedIdx = columnMap[field.key];
    const isMapped = mappedIdx !== undefined && mappedIdx >= 0;

    // Column 1: CRA field name
    // Display only: "Employment Income (Box 14)" renders as [14] Employment Income
    const tdField = document.createElement('td');
    const box = field.label.match(/^(.*?)\s*\(Box (\w+)\)$/);
    if (box) {
      const tag = document.createElement('span');
      tag.className = 'box-tag';
      tag.title = `Box ${box[2]}`;
      tag.textContent = box[2];
      tdField.append(tag, box[1]);
    } else {
      tdField.textContent = field.label;
    }
    tr.appendChild(tdField);

    // Column 2: Status icon
    const tdStatus = document.createElement('td');
    const icon = document.createElement('span');
    icon.className = 'mapping-status-icon ' + (isMapped ? 'matched' : 'unmatched');
    icon.textContent = isMapped ? '✓' : '○';
    icon.id = `status-${field.key}`;
    tdStatus.appendChild(icon);
    tr.appendChild(tdStatus);

    // Column 3: Excel column dropdown
    const tdSelect = document.createElement('td');
    const select = document.createElement('select');
    select.className = 'mapping-select' + (isMapped ? ' is-mapped' : '');
    select.id = `map-${field.key}`;
    select.innerHTML = '<option value="-1">— Not mapped —</option>' +
      headers.map((h, i) => `<option value="${i}" ${columnMap[field.key] === i ? 'selected' : ''}>${h}</option>`).join('');
    select.addEventListener('change', () => {
      columnMap[field.key] = parseInt(select.value);
      const mapped = select.value !== '-1';
      select.className = 'mapping-select' + (mapped ? ' is-mapped' : '');
      const statusIcon = document.getElementById(`status-${field.key}`);
      statusIcon.className = 'mapping-status-icon ' + (mapped ? 'matched' : 'unmatched');
      statusIcon.textContent = mapped ? '✓' : '○';
      updateMappingSummary();
      renderPreviewTable();
    });
    tdSelect.appendChild(select);
    tr.appendChild(tdSelect);

    tbody.appendChild(tr);
  });

  updateMappingSummary();
  renderPreviewTable();
}

function updateMappingSummary() {
  const config = getReturnConfig();
  let matched = 0, unmatched = 0;
  config.fields.forEach(f => {
    if (columnMap[f.key] !== undefined && columnMap[f.key] >= 0) matched++;
    else unmatched++;
  });
  document.getElementById('count-matched').textContent = matched;
  document.getElementById('count-unmatched').textContent = unmatched;
}

function renderPreviewTable() {
  const config = getReturnConfig();
  const thead = document.getElementById('preview-thead');
  const tbody = document.getElementById('preview-tbody');
  document.getElementById('row-count-badge').textContent = `${parsedData.length} rows`;

  const mappedFields = config.fields.filter(f => columnMap[f.key] >= 0);
  thead.innerHTML = '<tr>' + mappedFields.map(f => `<th>${f.label}</th>`).join('') + '</tr>';

  const preview = parsedData.slice(0, 10);
  tbody.innerHTML = preview.map(row =>
    '<tr>' + mappedFields.map(f => `<td>${row[columnMap[f.key]] ?? ''}</td>`).join('') + '</tr>'
  ).join('');
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
  const result = { addr_l1: '', city: '', prov: '', postal: '', country: 'CAN' };
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
    result.addr_l1 = parts[0].substring(0, 30);
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
      result.city = remaining.substring(0, provMatch.index).trim().substring(0, 28);
    } else {
      result.city = remaining.substring(0, 28);
    }
  } else {
    const provMatch = cityBlock.match(/\b([A-Z]{2})$/);
    if (provMatch && VALID_PROVINCES.has(provMatch[1])) {
      result.prov = provMatch[1];
      result.city = cityBlock.substring(0, provMatch.index).trim().substring(0, 28);
    } else {
      result.city = cityBlock.substring(0, 28);
    }
  }
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

function getVal(row, key) {
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
function showGenerateErrors(errors) {
  const box = document.getElementById('generate-errors');
  box.innerHTML = errors.length
    ? `<h4>Fix ${errors.length} problem(s) before generating</h4><ul>${errors.map(e => `<li>${escapeXml(e)}</li>`).join('')}</ul>`
    : '';
  box.classList.toggle('hidden', !errors.length);
}

// Validates Step 3. extraChecks: [{ id, test: value => bool, msg }] for return-specific rules.
// Returns false (and marks every bad field) if anything fails.
function validateFilingDetails(requiredIds, extraChecks = []) {
  clearFieldErrors();
  const bad = new Set();
  requiredIds.forEach(id => {
    if (!document.getElementById(id).value.trim()) { fieldError(id, 'Required.'); bad.add(id); }
  });
  const checks = [
    { id: 'tx-bn', test: v => BN_PATTERN.test(cleanBN(v)), msg: 'Must be exactly 15 characters: 9 digits + 2 letters + 4 digits (e.g. 123456789MM0001).' },
    { id: 'tx-email', test: v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()), msg: 'Enter a valid email address.' },
    ...extraChecks,
  ];
  checks.forEach(c => {
    const v = document.getElementById(c.id).value;
    if (!bad.has(c.id) && v.trim() && !c.test(v)) { fieldError(c.id, c.msg); bad.add(c.id); }
  });
  const first = document.querySelector('#step-3 .has-error');
  if (first) first.focus();
  return bad.size === 0;
}

const PAYER_BN_CHECK = { id: 'py-bn', test: v => BN_PATTERN.test(cleanBN(v)), msg: 'Must be exactly 15 characters: 9 digits + 2 letters + 4 digits (e.g. 123456789RP0001).' };

// Returns the 9-digit SIN to put on the slip, or null after recording a hard-stop error.
// Blank → CRA's 000000000 placeholder with a warning (recipient didn't provide one).
function checkSIN(raw, who, rowNum, warnings, errors) {
  who = who || '(no name)';
  const sin = String(raw).replace(/\D/g, '');
  if (!sin) {
    warnings.push(`Row ${rowNum}: "${who}" has no SIN — using 000000000`);
    return '000000000';
  }
  if (!isValidSIN(sin)) {
    errors.push(`Row ${rowNum}: "${who}" SIN "${raw}" is invalid — ${sin.length !== 9 ? `has ${sin.length} digits, needs 9` : 'fails the SIN checksum (check for a typo)'}`);
    return null;
  }
  return sin;
}

// Returns a valid 15-char recipient BN, or null after recording a hard-stop error.
// Blank → the given CRA placeholder with a warning; a bare 9-digit root is expanded with a warning.
function checkRecipientBN(raw, program, placeholder, who, rowNum, warnings, errors) {
  who = who || '(no name)';
  const cleaned = cleanBN(raw);
  if (!cleaned || cleaned === '(BLANK)') {
    warnings.push(`Row ${rowNum}: "${who}" has no BN — using ${placeholder}`);
    return placeholder;
  }
  const bn = sanitizeBN(cleaned, program);
  if (!BN_PATTERN.test(bn)) {
    errors.push(`Row ${rowNum}: "${who}" BN "${raw}" is invalid — must be 15 characters (9 digits + 2 letters + 4 digits), got ${cleaned.length}`);
    return null;
  }
  if (bn !== cleaned) warnings.push(`Row ${rowNum}: "${who}" BN root ${cleaned} expanded to ${bn} — confirm the program account`);
  return bn;
}

// ============================================================
// MASTER GENERATE FUNCTION — dispatches to return-type handler
// ============================================================
function generateXML() {
  const config = getReturnConfig();
  config.generateXML();
}

// ============================================================
// T1204 XML GENERATION (existing logic)
// ============================================================
function generateT1204XML() {
  if (!validateFilingDetails(['tx-bn','tx-name','tx-ref','tx-contact','tx-phone','tx-email',
                              'py-bn','py-name','py-addr','py-city','py-prov','py-postal','py-contact','py-phone'],
                             [PAYER_BN_CHECK])) return;

  const pyPhone = parsePhone(document.getElementById('py-phone').value);
  const taxYear = document.getElementById('tax-year').value;
  const reportType = document.getElementById('report-type').value;
  const payerBn = cleanBN(document.getElementById('py-bn').value);
  const warnings = [];
  const errors = [];

  let totalSrvc = 0, totalMxd = 0, slipCount = 0;
  let slipsXml = '';

  for (let i = 0; i < parsedData.length; i++) {
    const row = parsedData[i];
    const vendorName = String(getVal(row, 'vendor_name')).trim();
    const vendorBn = String(getVal(row, 'vendor_bn')).trim();
    const amount = parseFloat(getVal(row, 'amount')) || 0;
    const bizType = String(getVal(row, 'biz_type')).trim();
    const svcOnly = String(getVal(row, 'svc_only')).trim().toLowerCase();
    const address = String(getVal(row, 'address')).trim();

    if (!vendorName && !vendorBn) continue;

    const rcpntTcd = BIZ_TYPE_MAP[bizType] || '3';
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

      const sinVal = checkSIN(vendorBn, vendorName, i + 2, warnings, errors);
      if (!sinVal) continue;
      sinXml = xmlTag('sin', sinVal);
      bnXml = xmlTag('rcpnt_bn', '000000000RT0000');
    } else {
      sinXml = xmlTag('sin', '000000000');
      const bnVal = checkRecipientBN(vendorBn, 'RT', '000000000RC0000', vendorName, i + 2, warnings, errors);
      if (!bnVal) continue;
      bnXml = xmlTag('rcpnt_bn', bnVal);
    }

    const nameStr = vendorName.substring(0, 60);
    const l1Nm = nameStr.substring(0, 30);
    const l2Nm = nameStr.length > 30 ? nameStr.substring(30, 60) : '';

    let amtXml = '';
    if (svcOnly === 'yes') {
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

  if (!errors.length && slipCount === 0) errors.push('No valid vendor rows found. Please check your column mapping.');
  if (errors.length) { showGenerateErrors(errors); return; }

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
  if (!validateFilingDetails(['tx-bn','tx-name','tx-ref','tx-contact','tx-phone','tx-email',
                              'py-bn','py-name','py-contact','py-phone'],
                             [PAYER_BN_CHECK])) return;

  const pyPhone = parsePhone(document.getElementById('py-phone').value);
  const taxYear = document.getElementById('tax-year').value;
  const reportType = document.getElementById('report-type').value;
  const employerBn = cleanBN(document.getElementById('py-bn').value);
  const warnings = [];
  const errors = [];

  // Dental benefit code from form
  const dentalCode = document.getElementById('t4-dental-code')?.value || '1';
  // Default CPP/EI exempt codes
  const cppExemptDefault = '0';
  const eiExemptDefault = '0';

  let slipCount = 0;
  let slipsXml = '';

  // Accumulators for summary totals
  let totEmptInc = 0, totCpp = 0, totCppe = 0, totEi = 0, totRpp = 0, totItx = 0, totPadj = 0;

  for (let i = 0; i < parsedData.length; i++) {
    const row = parsedData[i];
    const lastName = String(getVal(row, 'empe_snm')).trim();
    const firstName = String(getVal(row, 'empe_gvn_nm')).trim();
    const sinRaw = String(getVal(row, 'sin')).trim();
    const emptyIncome = parseFloat(getVal(row, 'empt_incamt')) || 0;
    const cppAmt = parseFloat(getVal(row, 'cpp_cntrb_amt')) || 0;
    const cppeAmt = parseFloat(getVal(row, 'cppe_cntrb_amt')) || 0;
    const qppAmt = parseFloat(getVal(row, 'qpp_cntrb_amt')) || 0;
    const eiAmt = parseFloat(getVal(row, 'empe_eip_amt')) || 0;
    const rppAmt = parseFloat(getVal(row, 'rpp_cntrb_amt')) || 0;
    const itxAmt = parseFloat(getVal(row, 'itx_ddct_amt')) || 0;
    const eiInsEarn = parseFloat(getVal(row, 'ei_insu_ern_amt')) || 0;
    const cppQppEarn = parseFloat(getVal(row, 'cpp_qpp_ern_amt')) || 0;
    const unnDues = parseFloat(getVal(row, 'unn_dues_amt')) || 0;
    const provCdRaw = String(getVal(row, 'empt_prov_cd')).trim().toUpperCase();
    const addressRaw = String(getVal(row, 'address')).trim();

    // Skip empty rows
    if (!lastName && !sinRaw) continue;

    // SIN validation — invalid SIN is a hard stop
    const sinVal = checkSIN(sinRaw, `${firstName} ${lastName}`.trim(), i + 2, warnings, errors);
    if (!sinVal) continue;

    // Province of employment
    let empProvCd = provCdRaw;
    if (!ALL_PROV_CODES.has(empProvCd)) {
      // Try to derive from address
      const addr = parseAddress(addressRaw);
      empProvCd = addr.prov || 'ON'; // default ON if unknown
      if (!provCdRaw) {
        warnings.push(`Row ${i+2}: "${firstName} ${lastName}" province of employment not specified, defaulting to ${empProvCd}`);
      }
    }

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
        ${xmlTag('cpp_qpp_xmpt_cd', cppExemptDefault)}
        ${xmlTag('ei_xmpt_cd', eiExemptDefault)}
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

  if (!errors.length && slipCount === 0) errors.push('No valid employee rows found. Please check your column mapping.');
  if (errors.length) { showGenerateErrors(errors); return; }

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
  if (!validateFilingDetails(['tx-bn','tx-name','tx-ref','tx-contact','tx-phone','tx-email',
                              'py-bn','py-name','py-contact','py-phone',
                              't5018-fiscal-day','t5018-fiscal-month','t5018-fiscal-year'],
                             [PAYER_BN_CHECK])) return;

  const fiscalDay = document.getElementById('t5018-fiscal-day').value;
  const fiscalMonth = document.getElementById('t5018-fiscal-month').value;
  const fiscalYear = document.getElementById('t5018-fiscal-year').value;
  const pyPhone = parsePhone(document.getElementById('py-phone').value);
  const reportType = document.getElementById('report-type').value;
  const payerBn = cleanBN(document.getElementById('py-bn').value);
  const warnings = [];
  const errors = [];

  let totalSubcontractor = 0, slipCount = 0;
  let slipsXml = '';

  for (let i = 0; i < parsedData.length; i++) {
    const row = parsedData[i];
    const recipientName = String(getVal(row, 'rcpnt_name')).trim();
    const recipientBnRaw = String(getVal(row, 'rcpnt_bn')).trim();
    const subAmt = parseFloat(getVal(row, 'sbctrcr_amt')) || 0;
    const rcpntTypeRaw = String(getVal(row, 'rcpnt_type')).trim();
    const addressRaw = String(getVal(row, 'address')).trim();

    if (!recipientName && !recipientBnRaw) continue;

    // Determine recipient type code
    let rcpntTcd = '3'; // default corporation
    const typeStr = rcpntTypeRaw.toLowerCase();
    if (BIZ_TYPE_MAP[rcpntTypeRaw]) {
      rcpntTcd = BIZ_TYPE_MAP[rcpntTypeRaw];
    } else if (typeStr.includes('individual') || typeStr === '1') {
      rcpntTcd = '1';
    } else if (typeStr.includes('partnership') || typeStr === '4') {
      rcpntTcd = '4';
    } else if (typeStr.includes('corp') || typeStr === '3') {
      rcpntTcd = '3';
    }

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

      const sinVal = checkSIN(recipientBnRaw, recipientName, i + 2, warnings, errors);
      if (!sinVal) continue;
      sinXml = xmlTag('sin', sinVal);
      bnXml = xmlTag('rcpnt_bn', '000000000RC0000');
    } else {
      // Corporation or Partnership
      sinXml = xmlTag('sin', '000000000');
      const bnVal = checkRecipientBN(recipientBnRaw, 'RZ', '000000000RZ0000', recipientName, i + 2, warnings, errors);
      if (!bnVal) continue;
      bnXml = xmlTag('rcpnt_bn', bnVal);
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

  if (!errors.length && slipCount === 0) errors.push('No valid contractor rows found. Please check your column mapping.');
  if (errors.length) { showGenerateErrors(errors); return; }

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
  if (!validateFilingDetails(['tx-bn','tx-name','tx-ref','tx-contact','tx-phone','tx-email',
                              'nr4-acct','py-name','py-contact','py-phone'],
                             [{ id: 'nr4-acct', test: v => NR_ACCT_PATTERN.test(cleanBN(v)), msg: 'Must be 3 letters + 6 digits (e.g. NRA123456).' }])) return;

  const nrAcct = cleanBN(document.getElementById('nr4-acct').value);
  const pyPhone = parsePhone(document.getElementById('py-phone').value);
  const taxYear = document.getElementById('tax-year').value;
  const reportType = document.getElementById('report-type').value;
  const warnings = [];
  const errors = [];

  let totGross = 0, totTax = 0, slipCount = 0;
  let slipsXml = '';
  const currencies = new Set();

  for (let i = 0; i < parsedData.length; i++) {
    const row = parsedData[i];
    const name = String(getVal(row, 'rcpnt_name')).trim();
    const fssn = String(getVal(row, 'fssn_nbr')).trim();
    if (!name && !fssn) continue;

    const rowErr = msg => errors.push(`Row ${i+2}: "${name}" ${msg}`);
    const typeRaw = String(getVal(row, 'rcpnt_type')).trim().toLowerCase();
    const rcpntTcd = /^[1-5]$/.test(typeRaw) ? typeRaw : NR4_RCPNT_TYPE_MAP[typeRaw];
    const cntryRaw = String(getVal(row, 'tx_cntry_cd')).trim().toUpperCase();
    const cntry = COUNTRY_MAP[cntryRaw] || cntryRaw;
    const incRaw = String(getVal(row, 'inc_1_tcd')).trim();
    const incCd = incRaw ? incRaw.padStart(2, '0') : '';
    const crcy = String(getVal(row, 'crcy_1_cd')).trim().toUpperCase();
    const xmptCd = String(getVal(row, 'tx_xmpt_1_cd')).trim().toUpperCase();
    const gross = parseFloat(getVal(row, 'gro_1_incamt')) || 0;
    const tax = parseFloat(getVal(row, 'nr_tx_1_amt')) || 0;
    const steCd = String(getVal(row, 'ste_cd')).trim().toUpperCase();

    const before = errors.length;
    if (!name) rowErr('is missing a recipient name');
    if (!rcpntTcd) rowErr(`has an unrecognized recipient type "${typeRaw}" — use Individual, Joint account, Corporation, Other, Government, or 1–5`);
    if (!fssn) rowErr('is missing a foreign tax ID (required by CRA)');
    else if (fssn.length > 20) rowErr('foreign tax ID is longer than 20 characters');
    if (!/^[A-Z]{3}$/.test(cntry)) rowErr(`country of residence "${cntryRaw}" must be a 3-letter code (e.g. USA, GBR)`);
    if (incCd && !/^\d{2}$/.test(incCd)) rowErr(`income code "${incRaw}" must be 2 digits`);
    if (crcy && !/^[A-Z]{3}$/.test(crcy)) rowErr(`currency "${crcy}" must be a 3-letter code (e.g. CAD, USD)`);
    if (xmptCd.length > 1) rowErr(`exemption code "${xmptCd}" must be 1 character`);
    if (errors.length > before) continue;

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
      xmlTag('addr_l1_txt', String(getVal(row, 'addr_l1')).trim().substring(0, 30)),
      xmlTag('cty_nm', String(getVal(row, 'city')).trim().substring(0, 28)),
      /^[A-Z]{2}$/.test(steCd) ? xmlTag('ste_cd', steCd) : '',
      xmlTag('fgn_pstl_cd', String(getVal(row, 'fgn_pstl_cd')).trim().replace(/\s/g, '').toUpperCase()),
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

  if (!errors.length && slipCount === 0) errors.push('No valid recipient rows found. Please check your column mapping.');
  if (errors.length) { showGenerateErrors(errors); return; }
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
  return `<?xml version="1.0" encoding="UTF-8"?>
<Submission xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <T619>
    <TransmitterAccountNumber>${xmlTag('bn15', cleanBN(document.getElementById('tx-bn').value))}</TransmitterAccountNumber>
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

function downloadXML() {
  const rt = getSelectedReturnType();
  const blob = new Blob([xmlOutput], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${rt}_submission_${document.getElementById('tax-year').value}.xml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
  'tx-bn','tx-name','tx-ref','tx-lang','tx-contact','tx-phone','tx-email',
  'py-bn','py-name','py-addr','py-city','py-prov','py-postal','py-contact','py-phone',
  't4-dental-code','nr4-acct'
];
const STORAGE_KEY = 'taxxml_filing_details';

function saveFilingDetails() {
  const data = {};
  SAVED_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) data[id] = el.value;
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
    // Auto-increment the submission ref ID to prevent duplicate rejections
    const refEl = document.getElementById('tx-ref');
    if (refEl && refEl.value) {
      const val = refEl.value.trim();
      // Increment last character: A→B, B→C, ... Z→ZA, 1→2, etc.
      const last = val.slice(-1);
      if (/[A-Za-z]/.test(last)) {
        const next = last === 'Z' ? 'ZA' : String.fromCharCode(last.toUpperCase().charCodeAt(0) + 1);
        refEl.value = val.slice(0, -1) + next;
      } else if (/[0-9]/.test(last)) {
        refEl.value = val.slice(0, -1) + (parseInt(last) + 1);
      }
    }

    // Show a small unobtrusive restore notice
    const notice = document.createElement('p');
    notice.id = 'restore-notice';
    notice.style.cssText = 'font-size:0.8rem;color:var(--text-muted);margin-top:0.5rem;';
    notice.innerHTML = '✓ Filing details restored from last session. <a href="#" onclick="clearFilingDetails();return false;" style="color:var(--text-secondary);text-decoration:underline;">Clear</a>';
    const card = document.querySelector('#step-3 .card');
    if (card && !document.getElementById('restore-notice')) {
      card.insertBefore(notice, card.firstChild);
    }
  }
}

function clearFilingDetails() {
  localStorage.removeItem(STORAGE_KEY);
  const notice = document.getElementById('restore-notice');
  if (notice) notice.remove();
  SAVED_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
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


