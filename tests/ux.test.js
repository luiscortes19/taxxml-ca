// Step 2/3 UX: full-name split, restore notice with Start fresh, row+column error messages.
const assert = require('assert');
const { createApp } = require('./harness');

const csv = s => Buffer.from(s);

{ // one "Employee Name" column mapped to both Last and First name -> split, not "John Doe John Doe"
  const app = createApp({ returnType: 'T4' });
  app.loadFile('t4.csv', csv('Employee Name,SIN,Box 14 - Employment Income\r\nJohn Q Doe,046454286,100\r\n'));
  app.run('columnMap.empe_snm = 0; columnMap.empe_gvn_nm = 0');
  app.setDetails();
  const xml = app.generate();
  assert(xml.includes('<snm>Doe</snm>'), xml || app.errors());
  assert(xml.includes('<gvn_nm>John Q</gvn_nm>'));
}

{ // errors name the row, the column and the fix; the preview cell is marked
  const app = createApp({ returnType: 'T4' });
  app.loadFile('t4.csv', csv('Last Name,First Name,SIN,Box 14 - Employment Income\r\nDoe,John,46454286,100\r\nRoe,Jane,123456789,100\r\n'));
  app.setDetails();
  assert.strictEqual(app.generate(), '');
  const html = app.errors();
  assert(/Row 2, column &quot;SIN&quot;/.test(html), html);
  assert(/8 digits/.test(html) && /format the column as Text/i.test(html), html);
  assert(/Row 3, column &quot;SIN&quot;/.test(html) && /checksum/.test(html), html);
  const tbody = app.el('preview-tbody').innerHTML;
  assert.strictEqual((tbody.match(/class="cell-error"/g) || []).length, 2, tbody);
  // fixing the mapping/data and regenerating clears the marks
  app.run('parsedData[0][2] = "046454286"; parsedData[1][2] = "130692544"');
  assert(app.generate().includes('<sin>046454286</sin>'));
  assert(!/cell-error/.test(app.el('preview-tbody').innerHTML));
}

{ // NR4 row errors also point at the column
  const app = createApp({ returnType: 'NR4' });
  app.loadFile('nr4.csv', csv('Recipient Name,Recipient Type,Foreign Tax ID,Country of Residence\r\nJohn,Alien,X1,Narnia\r\n'));
  app.setDetails();
  app.generate();
  const html = app.errors();
  assert(/Row 2, column &quot;Recipient Type&quot;/.test(html), html);
  assert(/Row 2, column &quot;Country of Residence&quot;/.test(html), html);
}

{ // restore notice: visible Start fresh button; clicking it clears saved data and fields (selects back to default)
  const store = { taxxml_filing_details: JSON.stringify({ 'tx-name': 'Old Co', 'tx-ref': 'A1', 'tx-lang': 'F' }) };
  const app = createApp({ returnType: 'T4', withStorage: store });
  app.el('tx-lang').options = [{ value: 'E' }, { value: 'F' }];
  app.run('restoreFilingDetails()');
  assert.strictEqual(app.el('tx-name').value, 'Old Co');
  assert.strictEqual(app.el('tx-ref').value, 'A2');
  const notice = app.created.find(e => e.id === 'restore-notice');
  assert(notice && /Start fresh/.test(notice.innerHTML) && /<button/.test(notice.innerHTML), notice && notice.innerHTML);
  assert('taxxml_filing_details' in store, 'restoring never deletes saved data');
  app.run('clearFilingDetails()');
  assert(!('taxxml_filing_details' in store));
  assert.strictEqual(app.el('tx-name').value, '');
  assert.strictEqual(app.el('tx-lang').value, 'E');
}
console.log('ux.test.js: all passed');
