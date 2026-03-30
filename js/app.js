/* ============================================================
   TaxXML.ca — App Logic (Multi-Return Excel → CRA XML)
   All processing is client-side. No data leaves the browser.
   Supports: T1204, T4
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

  // Update step 1 description
  const step1Desc = document.querySelector('#step-1 .card > p');
  if (rt === 'T4') {
    step1Desc.textContent = 'Drag & drop or click to select your .xlsx or .csv file containing T4 payroll data.';
  } else if (rt === 'T5018') {
    step1Desc.textContent = 'Drag & drop or click to select your .xlsx or .csv file containing T5018 sub-contractor payment data.';
  } else {
    step1Desc.textContent = 'Drag & drop or click to select your .xlsx or .csv file containing T1204 payment data.';
  }

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

function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx', 'xls', 'csv'].includes(ext)) {
    alert('Please upload a valid Excel or CSV file.');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      if (raw.length < 2) { alert('File has no data rows.'); return; }

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
      alert('Error reading file: ' + err.message);
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
    const tdField = document.createElement('td');
    tdField.textContent = field.label;
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

function sanitizeBN(raw) {
  let bn = raw.toUpperCase().trim().replace(/[-\s]/g, '');
  if (bn.length === 9 && /^\d{9}$/.test(bn)) {
    bn += 'RT0001';
  }
  return bn;
}

function sanitizeBN_RP(raw) {
  let bn = raw.toUpperCase().trim().replace(/[-\s]/g, '');
  if (bn.length === 9 && /^\d{9}$/.test(bn)) {
    bn += 'RP0001';
  }
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
  const requiredIds = ['tx-bn','tx-name','tx-ref','tx-contact','tx-phone','tx-email',
                       'py-bn','py-name','py-addr','py-city','py-prov','py-postal','py-contact','py-phone'];
  for (const id of requiredIds) {
    const el = document.getElementById(id);
    if (!el.value.trim()) {
      el.focus();
      el.style.borderColor = 'var(--danger)';
      setTimeout(() => el.style.borderColor = '', 2000);
      alert(`Please fill in: ${el.previousElementSibling?.textContent || id}`);
      return;
    }
  }

  const txPhone = parsePhone(document.getElementById('tx-phone').value);
  const pyPhone = parsePhone(document.getElementById('py-phone').value);
  const taxYear = document.getElementById('tax-year').value;
  const reportType = document.getElementById('report-type').value;
  const payerBn = document.getElementById('py-bn').value.trim();
  const warnings = [];

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

      let sinVal = vendorBn.replace(/\D/g, '');
      if (!sinVal) { sinVal = '000000000'; warnings.push(`Row ${i+2}: "${vendorName}" has no SIN`); }
      else if (sinVal.length !== 9) { warnings.push(`Row ${i+2}: "${vendorName}" SIN has ${sinVal.length} digits`); }
      sinXml = xmlTag('sin', sinVal.substring(0, 9).padEnd(9, '0'));
      bnXml = xmlTag('rcpnt_bn', '000000000RT0000');
    } else {
      sinXml = xmlTag('sin', '000000000');
      let bnVal = sanitizeBN(vendorBn);
      if (!bnVal || bnVal === '(BLANK)') {
        bnVal = '000000000RC0000';
        warnings.push(`Row ${i+2}: "${vendorName}" has no BN`);
      }
      if (bnVal.length !== 15 && bnVal !== '000000000RC0000') {
        warnings.push(`Row ${i+2}: "${vendorName}" BN is ${bnVal.length} chars: ${bnVal}`);
      }
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
  const requiredIds = ['tx-bn','tx-name','tx-ref','tx-contact','tx-phone','tx-email',
                       'py-bn','py-name','py-contact','py-phone'];
  for (const id of requiredIds) {
    const el = document.getElementById(id);
    if (!el || !el.value.trim()) {
      if (el) {
        el.focus();
        el.style.borderColor = 'var(--danger)';
        setTimeout(() => el.style.borderColor = '', 2000);
      }
      alert(`Please fill in: ${el?.previousElementSibling?.textContent || id}`);
      return;
    }
  }

  const txPhone = parsePhone(document.getElementById('tx-phone').value);
  const pyPhone = parsePhone(document.getElementById('py-phone').value);
  const taxYear = document.getElementById('tax-year').value;
  const reportType = document.getElementById('report-type').value;
  const employerBn = sanitizeBN_RP(document.getElementById('py-bn').value.trim());
  const warnings = [];

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

    // SIN validation
    let sinVal = sinRaw.replace(/\D/g, '');
    if (!sinVal) { sinVal = '000000000'; warnings.push(`Row ${i+2}: "${firstName} ${lastName}" has no SIN`); }
    else if (sinVal.length !== 9) {
      warnings.push(`Row ${i+2}: "${firstName} ${lastName}" SIN has ${sinVal.length} digits`);
      sinVal = sinVal.substring(0, 9).padEnd(9, '0');
    }

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

  if (slipCount === 0) {
    alert('No valid employee rows found. Please check your column mapping.');
    return;
  }

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
function sanitizeBN_RZ(raw) {
  let bn = raw.toUpperCase().trim().replace(/[-\s]/g, '');
  if (bn.length === 9 && /^\d{9}$/.test(bn)) {
    bn += 'RZ0001';
  }
  return bn;
}

function generateT5018XML() {
  // Validate required form fields
  const requiredIds = ['tx-bn','tx-name','tx-ref','tx-contact','tx-phone','tx-email',
                       'py-bn','py-name','py-contact','py-phone'];
  for (const id of requiredIds) {
    const el = document.getElementById(id);
    if (!el || !el.value.trim()) {
      if (el) {
        el.focus();
        el.style.borderColor = 'var(--danger)';
        setTimeout(() => el.style.borderColor = '', 2000);
      }
      alert(`Please fill in: ${el?.previousElementSibling?.textContent || id}`);
      return;
    }
  }

  // Validate fiscal period end date
  const fiscalDay = document.getElementById('t5018-fiscal-day')?.value || '';
  const fiscalMonth = document.getElementById('t5018-fiscal-month')?.value || '';
  const fiscalYear = document.getElementById('t5018-fiscal-year')?.value || '';
  if (!fiscalDay || !fiscalMonth || !fiscalYear) {
    alert('Please fill in the Fiscal Period End Date (day, month, year).');
    return;
  }

  const pyPhone = parsePhone(document.getElementById('py-phone').value);
  const reportType = document.getElementById('report-type').value;
  const payerBn = sanitizeBN_RZ(document.getElementById('py-bn').value.trim());
  const warnings = [];

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

      let sinVal = recipientBnRaw.replace(/\D/g, '');
      if (!sinVal) { sinVal = '000000000'; warnings.push(`Row ${i+2}: "${recipientName}" has no SIN`); }
      else if (sinVal.length !== 9) { warnings.push(`Row ${i+2}: "${recipientName}" SIN has ${sinVal.length} digits`); sinVal = sinVal.substring(0, 9).padEnd(9, '0'); }
      sinXml = xmlTag('sin', sinVal);
      bnXml = xmlTag('rcpnt_bn', '000000000RC0000');
    } else {
      // Corporation or Partnership
      sinXml = xmlTag('sin', '000000000');
      let bnVal = sanitizeBN_RZ(recipientBnRaw);
      if (!bnVal || bnVal === '(BLANK)') {
        bnVal = '000000000RZ0000';
        warnings.push(`Row ${i+2}: "${recipientName}" has no BN`);
      }
      if (bnVal.length !== 15 && bnVal !== '000000000RZ0000') {
        warnings.push(`Row ${i+2}: "${recipientName}" BN is ${bnVal.length} chars: ${bnVal}`);
      }
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

  if (slipCount === 0) {
    alert('No valid contractor rows found. Please check your column mapping.');
    return;
  }

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
// T619 WRAPPER (shared by all return types)
// ============================================================
function buildT619Wrapper(returnType, slipsXml, summaryXml) {
  const txPhone = parsePhone(document.getElementById('tx-phone').value);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Submission xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <T619>
    <TransmitterAccountNumber>${xmlTag('bn15', document.getElementById('tx-bn').value.trim())}</TransmitterAccountNumber>
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
function showResults(slips, stats, warnings) {
  document.getElementById('stats-grid').innerHTML = stats.map(s =>
    `<div class="stat-card"><div class="stat-value">${s.value}</div><div class="stat-label">${s.label}</div></div>`
  ).join('');

  const wBox = document.getElementById('warnings-box');
  if (warnings.length > 0) {
    wBox.innerHTML = `<h4>⚠️ ${warnings.length} Warning(s)</h4><ul>${warnings.map(w => `<li>${escapeXml(w)}</li>`).join('')}</ul>`;
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

