// Feedback form + automatic crash reports, shared by every page (loaded in <head> next to js/ga.js).
// - REPORT_ENDPOINT is the one Worker URL (worker/README.md). Start with the workers.dev URL, later https://api.taxxml.ca.
//   Empty (as committed): nothing is POSTed, and the Feedback links stay plain "Contact us" links to avanza-automation.com.
// - Local copies (localhost, 127.0.0.1, ::1, file://) never POST and never send app_error, even with a URL set.
// - Crash reports leave the browser only after scrubText/scrubStack: no cells, SINs, names, amounts, file names, Step 3 values.
// - GA4 gets app_error { error_kind, return_type } only, through the gtag js/ga.js set up.
(function () {
  var REPORT_ENDPOINT = '';      // e.g. 'https://taxxml-report.<account>.workers.dev', later 'https://api.taxxml.ca'
  var TURNSTILE_SITE_KEY = '';   // Cloudflare Turnstile site key (public). Empty = Feedback form stays off
  var APP_VERSION = '2026.11.17';
  var MAX_REPORTS = 5;           // per page load, so a tight error loop can't flood the Worker

  var host = location.hostname;
  var local = location.protocol === 'file:' || !host || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  var live = !local && !!REPORT_ENDPOINT;
  var feedbackLive = live && !!TURNSTILE_SITE_KEY;
  var m = /^\/(t4|nr4|t5018|t1204|privacy|terms|cra-xml-samples)\b/.exec(location.pathname || ''), page = m ? m[1] : 'home';

  // ---- scrub: shared with worker/scrub.js (tests/worker.test.js keeps both copies identical) ----
  var OWN_FRAME = /\b(js\/(?:app|validate|report|ga)\.js):(\d+)(?::(\d+))?/;
  var KEEP_WORDS = /^(Error|TypeError|RangeError|ReferenceError|SyntaxError|URIError|EvalError|AggregateError|InternalError|DOMException|AbortError|NotFoundError|NotAllowedError|NotSupportedError|SecurityError|QuotaExceededError|NetworkError|Uncaught|Unhandled|Cannot|Unexpected|Invalid|Maximum|Failed|Script|Assignment|Unterminated|Missing|Illegal|Too|The|This|Load|JSON|XML|XLSX|NaN|Infinity|Object|Array|String|Number|Promise|Function|Date|Map|Set|Symbol|Math|RegExp|Uint8Array|ArrayBuffer|TextDecoder|FileReader|Blob|URL|Element|HTMLElement|Node|Document|Window)$/;

  // Error message -> text with no data in it: quoted values, emails, URLs, paths, file names, numbers and
  // capitalised words (names, cities, company names) are replaced. Idempotent, so the Worker can run it again.
  function scrubText(s) {
    return String(s == null ? '' : s).slice(0, 2000)
      .replace(/(["'`])(?:(?!\1)[^\\\n]|\\.)*\1/g, '"?"')
      .replace(/[^\s@]+@[^\s@]+/g, '[email]')
      .replace(/\b(?:https?|blob|file|data):\S*/gi, '[url]')
      .replace(/\S*[\\/]\S*/g, '[path]')
      .replace(/\S*\.(?:xlsx|xlsm|xls|csv|ods|numbers|xml|pdf|txt)\b/gi, '[file]')
      .replace(/[\w-]*[^\x00-\x7F][^\s,;:()]*/g, '[name]')
      .replace(/\d(?:[\d\s.,$\/-]*\d)?/g, '#')
      .replace(/\b[A-Z][A-Za-z]*\b/g, function (w) { return KEEP_WORDS.test(w) ? w : '[name]'; })
      .replace(/[^\w\s#"?.,:;()[\]<>=+*!&|{}$-]/g, '')
      .slice(0, 300);
  }

  // Stack -> our own frames only, as "fn@js/app.js:12:3". Other scripts, extensions and source text are dropped.
  function scrubStack(s) {
    return String(s == null ? '' : s).split('\n').map(function (line) {
      var f = OWN_FRAME.exec(line);
      if (!f) return '';
      var fn = /^\s*(?:at\s+)?(?:async\s+)?([A-Za-z_$][\w$.]*)\s*[@(]/.exec(line);
      return (fn && fn[1] !== 'at' ? fn[1].slice(0, 60) + '@' : '') + f[1] + ':' + f[2] + (f[3] ? ':' + f[3] : '');
    }).filter(Boolean).slice(0, 10).join('\n');
  }

  // Allow-listed, non-personal context sent with both report kinds
  function cleanMeta(r) {
    return {
      return_type: /^(T4|T1204|T5018|NR4)$/.test(r.return_type) ? r.return_type : '',
      step: /^[1-4]$/.test(String(r.step)) ? +r.step : 0,
      browser: /^(chrome|edge|firefox|safari|other)$/.test(r.browser) ? r.browser : 'other',
      version: /^[\w.-]{1,20}$/.test(r.version) ? r.version : '',
      page: /^(home|t4|nr4|t5018|t1204|privacy|terms|cra-xml-samples)$/.test(r.page) ? r.page : 'other',
    };
  }

  function cleanCrash(r) {
    r = r || {};
    var meta = cleanMeta(r);
    return {
      error_kind: /^(js_error|xml_generate_failed|parse_crash)$/.test(r.error_kind) ? r.error_kind : 'js_error',
      message: scrubText(r.message), stack: scrubStack(r.stack),
      return_type: meta.return_type, step: meta.step, browser: meta.browser, version: meta.version, page: meta.page,
    };
  }

  // Typed feedback is sent as written, except SIN/BN-like digit runs, which the form asks people not to paste
  function cleanFeedback(r) {
    r = r || {};
    var meta = cleanMeta(r), email = String(r.email || '').trim();
    return {
      type: /^(feedback|question|bug)$/.test(r.type) ? r.type : 'feedback',
      message: String(r.message || '').slice(0, 2000).replace(/\d(?:[\s-]?\d){8,}/g, '[number removed]').trim(),
      email: /^[^\s@<>|]{1,64}@[^\s@<>|]{1,190}\.[A-Za-z]{2,}$/.test(email) ? email : '',
      return_type: meta.return_type, step: meta.step, browser: meta.browser, version: meta.version, page: meta.page,
    };
  }
  // ---- end scrub ----

  function browser() {
    var ua = (window.navigator && navigator.userAgent) || '';
    return /Edg\//.test(ua) ? 'edge' : /Firefox\//.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'other';
  }
  // return type + step from app.js on the converter page; nothing on the landing pages
  function context() {
    try { return (window.reportContext && window.reportContext()) || {}; } catch (e) { return {}; }
  }
  function meta() {
    var c = context();
    return cleanMeta({ return_type: c.return_type, step: c.step, browser: browser(), version: APP_VERSION, page: page });
  }
  function send(name, params) {
    try { if (!local && window.gtag) window.gtag('event', name, params); } catch (e) { /* analytics must never break the app */ }
  }
  function post(body) {
    if (!live) return Promise.resolve(false);
    try {
      return fetch(REPORT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true })
        .then(function (r) { return !!r.ok; }, function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  // The scrubbed report for an error (what would be POSTed). ctx: { return_type, step } if the caller knows better.
  function buildCrash(kind, err, ctx) {
    var c = ctx || context(), e = err && typeof err === 'object' ? err : { message: err };
    return cleanCrash({ error_kind: kind, message: (e.name ? e.name + ': ' : '') + e.message, stack: e.stack,
                        return_type: c.return_type, step: c.step, browser: browser(), version: APP_VERSION, page: page });
  }

  var seen = {}, count = 0;
  // Reports an unexpected error: GA4 app_error + POST to the Worker (when allowed). Returns the scrubbed report.
  function crash(kind, err) {
    try {
      var r = buildCrash(kind, err);
      if (r.error_kind === 'js_error' && !r.stack) return r; // not from our code (extension, other script): not ours to report
      var key = r.error_kind + r.message + r.stack.split('\n')[0];
      if (seen[key] || count >= MAX_REPORTS) return r;
      seen[key] = 1; count++;
      var ga = { error_kind: r.error_kind };
      if (r.return_type) ga.return_type = r.return_type;
      send('app_error', ga);
      post(Object.assign({ kind: 'crash' }, r));
      return r;
    } catch (e) { /* reporting must never break the app */ }
  }

  window.addEventListener('error', function (e) { crash('js_error', e && (e.error || e.message)); });
  window.addEventListener('unhandledrejection', function (e) { crash('js_error', e && e.reason); });

  // ---- Feedback ----
  // fields: { type, message, email, website (honeypot), turnstile }. Resolves true if the Worker accepted it.
  // The message goes as typed, minus SIN/BN-like digit runs (the Worker removes them again).
  function sendFeedback(fields) {
    if (!feedbackLive) return Promise.resolve(false);
    var f = fields || {}, m = meta();
    return post({ kind: 'feedback', type: f.type, message: cleanFeedback({ message: f.message }).message, email: String(f.email || '').trim(), website: String(f.website || ''),
                  turnstile: String(f.turnstile || ''), return_type: m.return_type, step: m.step, browser: m.browser, version: m.version, page: m.page });
  }

  var FORM = '<dialog id="feedback-dialog" class="feedback-dialog" aria-labelledby="fb-title">' +
    '<form id="fb-form" novalidate>' +
    '<h2 id="fb-title">Send feedback</h2>' +
    '<p class="fb-warn">Don’t paste slip data: no SINs, names, amounts, or your spreadsheet. Describe the problem instead.</p>' +
    '<div class="form-group"><label for="fb-type">Type</label><select id="fb-type" name="type" class="form-control">' +
    '<option value="feedback">Feedback</option><option value="question">Question</option><option value="bug">Bug</option></select></div>' +
    '<div class="form-group"><label for="fb-message">Message</label><textarea id="fb-message" name="message" class="form-control" rows="5" maxlength="2000" required></textarea></div>' +
    '<div class="form-group"><label for="fb-email">Email <span class="optional">(optional, only if you want a reply)</span></label>' +
    '<input id="fb-email" name="email" class="form-control" type="email" maxlength="200" autocomplete="email"></div>' +
    '<div class="fb-hp" aria-hidden="true"><label for="fb-website">Leave this empty</label><input id="fb-website" name="website" tabindex="-1" autocomplete="off"></div>' +
    '<div class="cf-turnstile" data-sitekey="' + TURNSTILE_SITE_KEY + '"></div>' +
    '<p class="fb-status" role="status" aria-live="polite"></p>' +
    '<div class="btn-row"><button type="button" class="btn btn-ghost" id="fb-cancel">Cancel</button>' +
    '<button type="submit" class="btn btn-primary" id="fb-send">Send</button></div>' +
    '</form></dialog>';

  function openFeedback(opener) {
    var d = document.getElementById('feedback-dialog');
    if (!d) {
      document.body.insertAdjacentHTML('beforeend', FORM);
      d = document.getElementById('feedback-dialog');
      var form = d.querySelector('form'), status = d.querySelector('.fb-status'), sendBtn = d.querySelector('#fb-send');
      var s = document.createElement('script'); // Turnstile loads only once someone opens the form
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true;
      document.head.appendChild(s);
      d.querySelector('#fb-cancel').addEventListener('click', function () { d.close(); });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var el = form.elements;
        if (!el.message.value.trim()) { status.textContent = 'Please write a message.'; el.message.focus(); return; }
        var token = el['cf-turnstile-response'] ? el['cf-turnstile-response'].value : '';
        if (!token) { status.textContent = 'Please wait for the security check above to finish, then send again.'; return; }
        sendBtn.disabled = true;
        status.textContent = 'Sending…';
        sendFeedback({ type: el.type.value, message: el.message.value, email: el.email.value, website: el.website.value, turnstile: token })
          .then(function (ok) {
            sendBtn.disabled = false;
            status.textContent = ok ? 'Thank you. Your message was sent.' : 'Sorry, your message could not be sent. Please try again later.';
            if (ok) form.reset();
            try { window.turnstile && window.turnstile.reset(); } catch (err) { /* ignore */ }
          });
      });
    }
    d.querySelector('.fb-status').textContent = '';
    d.addEventListener('close', function () { opener.focus(); }, { once: true });
    d.showModal(); // native dialog: focus stays inside, Escape closes
    d.querySelector('#fb-message').focus();
  }

  if (feedbackLive) {
    // Turn each "Contact us" fallback link into a real Feedback button
    document.addEventListener('DOMContentLoaded', function () {
      Array.prototype.forEach.call(document.querySelectorAll('a[data-feedback]'), function (a) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'link-button';
        b.textContent = 'Feedback';
        b.setAttribute('data-feedback', '');
        b.setAttribute('aria-haspopup', 'dialog');
        a.replaceWith(b);
      });
    });
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest && e.target.closest('[data-feedback]');
      if (!el) return;
      e.preventDefault();
      try { openFeedback(el); } catch (err) { crash('js_error', err); }
    });
  }

  window.taxxmlReport = { crash: crash, buildCrash: buildCrash, scrubText: scrubText, scrubStack: scrubStack, sendFeedback: sendFeedback, feedbackLive: feedbackLive };
})();
