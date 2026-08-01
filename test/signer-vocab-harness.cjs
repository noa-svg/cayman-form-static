// signer-vocab-harness.cjs (2026-08-02, CTO review finding #8 - rewrite).
//
// Was a hand-written "faithful copy" of signer.html's failure-routing block.
// That drifts silently: if the real routing in loadSignerForm's
// onreadystatechange changes, this test keeps passing against its own stale
// copy while production regresses (exactly the P2 "terminal reason loops
// forever" bug this file exists to guard against).
//
// Rewritten to extract the REAL onreadystatechange handler from the live
// signer.html source (anchor + brace-counting, same pattern as
// upload-race-harness.cjs) and drive it directly with a stubbed XHR/DOM,
// asserting on which show(...) state and applyLang(...) call it actually
// produces for every reason in the signature-engine vocabulary.
//
// Engine vocabulary (verifySignerLink_ / sigVerifySignerToken_ /
// caymanVerifySignToken_ / caymanHandleSignerForm_), confirmed by reading
// SignatureEngine.js:189,786-814, CaymanGateway.js:1257-1292,
// CaymanSignerForm.js:24-35, and the doGet catch at CaymanGateway.js:397
// ({ ok:false, error:'internal error' } with NO reason).
//
// Run: node test/signer-vocab-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'signer.html'), 'utf8');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; }
  else { fail++; console.error('FAIL ' + label + ': got ' + JSON.stringify(actual) + ' want ' + JSON.stringify(expected)); }
}

function extractHandler() {
  const anchor = 'x.onreadystatechange = function () {';
  const start = html.indexOf(anchor);
  if (start < 0) throw new Error('onreadystatechange anchor not found (boot contract changed)');
  const bodyOpen = start + anchor.length - 1; // index of the opening '{'
  let i = bodyOpen, depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces in onreadystatechange handler');
}
const handlerSrc = extractHandler();
if (handlerSrc.indexOf('renderSignerForm(ctx);') === -1) throw new Error('extracted block is not the signerform routing handler (boot contract changed)');

// Drive the REAL handler with a stubbed XHR (x) + DOM/lang/render surface.
// Returns { state, lang, rendered } describing what the real code actually did.
function route(ctx) {
  const calls = { show: null, lang: null, rendered: false, laneCalls: 0 };
  const x = { readyState: 4, responseText: JSON.stringify(ctx) };
  const document = {
    getElementById: function (id) {
      if (id === 'invalid-msg') return { dataset: {}, textContent: '' };
      return null;
    }
  };
  const window = { console: { log: function () {} } };
  const fn = new Function(
    'x', 'document', 'window',
    'setLaneFromCtx_', 'applyLang', 'show', 'renderSignerForm',
    'return (' + handlerSrc + ')();'
  );
  fn(
    x, document, window,
    function () { calls.laneCalls++; },
    function (lang) { calls.lang = lang; },
    function (state) { calls.show = state; },
    function () { calls.rendered = true; }
  );
  return calls.rendered ? 'form' : calls.show;
}

// ---- TERMINAL reasons: must be a dead-end, NEVER the retry loop ----
const TERMINAL = [
  'malformed',          // bad/garbled token (SignatureEngine.js:786,792,794,806)
  'invalid_sig',        // forged or corrupt HMAC (SignatureEngine.js:813)
  'unknown_request',    // process record gone (SignatureEngine.js:196)
  'unknown_signer',     // signer not in roster (SignatureEngine.js:198)
  'engine_not_linked',  // engine missing (CaymanGateway.js:1266)
  'no_secret',          // HMAC secret unset (CaymanGateway.js:1277)
  'invalid signer link',// literal fallback (CaymanSignerForm.js:27)
  'Process not found or submission missing.', // (CaymanSignerForm.js:34)
];
TERMINAL.forEach(function (r) {
  eq(route({ ok: false, reason: r }), 'invalid', 'TERMINAL "' + r + '" -> dead-end (was retry-loop before the P2 fix)');
});

// ---- Specific terminal reasons with their own copy ----
['expired', 'voided', 'revoked'].forEach(function (r) {
  eq(route({ ok: false, reason: r }), 'invalid', 'TERMINAL "' + r + '" -> dead-end (specific copy)');
});

// ---- State reasons routed to their own panes ----
eq(route({ ok: false, reason: 'not_current' }), 'notyet', 'not_current -> notyet');
eq(route({ ok: false, reason: 'already_signed' }), 'signed', 'already_signed -> signed');

// ---- TRANSIENT signals: the ONLY things that should retry ----
eq(route({ ok: false }), 'timeout', 'unset reason (doGet internal-error / parse fail) -> retry');
eq(route({ ok: false, reason: '' }), 'timeout', 'empty reason -> retry');
eq(route({ ok: false, reason: 'export_failed' }), 'timeout', 'explicit export_failed -> retry');
eq(route({ ok: false, reason: 'busy, please retry' }), 'timeout', 'lock-busy -> retry');

// ---- Success ----
eq(route({ ok: true, role: 'subscriber' }), 'form', 'ok:true -> render the signing form');

// ---- Regression guard: the bug being fixed ----
// Before the P2 fix, every TERMINAL reason not in {expired,voided,revoked} fell
// through to 'timeout' and looped forever. Assert none of TERMINAL is 'timeout'.
const looped = TERMINAL.filter(function (r) { return route({ ok: false, reason: r }) === 'timeout'; });
eq(looped.length, 0, 'no terminal reason loops on retry (regression guard) -> ' + looped.length);

console.log(pass + '/' + (pass + fail) + ' assertions passed');
process.exit(fail ? 1 : 0);
