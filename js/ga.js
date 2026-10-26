// Google Analytics 4, shared by every page (no build step, so each page includes this file in <head>).
// - Local copies (localhost, 127.0.0.1, ::1, file://) never load GA. gtag stays undefined, so app.js's track() is a no-op.
// - ?internal=1 marks this browser as internal (remembered in localStorage; ?internal=0 forgets it). GA still loads,
//   but every hit carries traffic_type=internal, which GA4's "Internal Traffic" data filter excludes.
// - ?debug_mode=1 sends this page load's hits to GA4 DebugView.
// - Clicks on [data-cta] elements send cta_click, and clicks on a template link send sample_downloaded.
//   This is done here and not in app.js because the landing pages don't load app.js.
(function () {
  var ID = 'G-E2F5Q3RZVH', KEY = 'taxxml_internal', host = location.hostname;
  if (location.protocol === 'file:' || !host || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') return;

  var q = new URLSearchParams(location.search), config = {};
  try {
    if (q.get('internal') === '1') localStorage.setItem(KEY, '1');
    if (q.get('internal') === '0') localStorage.removeItem(KEY);
    if (localStorage.getItem(KEY) === '1') config.traffic_type = 'internal';
  } catch (e) { /* storage blocked: count as external */ }
  if (q.get('debug_mode') === '1') config.debug_mode = true; // GA treats any debug_mode value as on, so only ever set true

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', ID, config);
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
  document.head.appendChild(s);

  // Short page id for cta_click: our own fixed list, never the raw path
  var m = /^\/(t4|nr4|t5018|t1204|privacy|terms)\b/.exec(location.pathname), page = m ? m[1] : 'home';
  function send(name, params) {
    try { window.gtag('event', name, params); } catch (e) { /* analytics must never break a click */ }
  }
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('a, button');
    if (!el) return;
    if (el.dataset.cta) send('cta_click', { page: page, cta: el.dataset.cta });
    var sample = /(?:^|\/)(T4|T1204|T5018|NR4)_Sample\.csv$/.exec(el.getAttribute('href') || '');
    if (sample) send('sample_downloaded', { return_type: sample[1] });
  });
})();
