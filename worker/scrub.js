// Second scrub for the Worker: a byte-for-byte copy of the block in js/report.js (indentation included).
// Edit both together; tests/worker.test.js fails if they differ.
  // ---- scrub: shared with js/report.js ----
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

export { scrubText, scrubStack, cleanCrash, cleanFeedback };
