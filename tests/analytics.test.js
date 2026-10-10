// GA4: downloadXML must fire exactly one xml_downloaded {return_type} per successful download, before the click.
const assert = require('assert');
const { createApp } = require('./harness');

function setup({ xml = '<Submission/>', createObjectURL } = {}) {
  const log = [];
  const gtag = (...args) => log.push(['gtag', ...args]);
  const URL = {
    createObjectURL: createObjectURL || (() => { log.push(['createObjectURL']); return 'blob:x'; }),
    revokeObjectURL: () => log.push(['revoke']),
  };
  const app = createApp({ returnType: 'NR4', gtag, URL });
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
console.log('analytics.test.js: all passed');
