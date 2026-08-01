// signer-config-retry-harness.cjs (2026-08-02, CTO review finding #4).
//
// Proves signer.html's loadSignerForm() now silently auto-retries a timeout
// or network error against ?api=signerform (ported from israel.html's
// fetchCfg(attempt) backoff), instead of dropping a signer straight onto the
// "Link unavailable" retry screen for a transient GAS-cold-start blip that a
// second attempt would have cleared on its own.
//
// Extracts the REAL loadSignerForm source (brace-counting between two exact
// anchors in the live file) and drives it with a controllable XHR + timer
// stub, same pattern already proven for the S2 stale-guard test in
// client-honesty-harness.cjs, so this fails if a future edit removes the
// retry or changes its count/backoff - not just if someone breaks a
// hand-written copy.
//
// Run: node test/signer-config-retry-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'signer.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); } }

const START = 'var signerformRetriesLeft_ = 2;';
const END = "document.getElementById('retry-btn').onclick = loadSignerForm;";
const startIdx = html.indexOf(START);
const endIdx = html.indexOf(END);
if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
  throw new Error('signer-config-retry-harness: could not locate loadSignerForm block (boot contract changed)');
}
const src = html.slice(startIdx, endIdx);

// Controllable timer stub (same shape as client-honesty-harness.cjs's S2
// makeTimers): records scheduled callbacks so a test can fire them on demand
// instead of racing real timers.
function makeTimers() {
  const q = [];
  return {
    set: (fn, ms) => { q.push({ fn, ms, fired: false }); return q.length - 1; },
    fireAll: () => { q.slice().forEach((t) => { if (!t.fired) { t.fired = true; t.fn(); } }); },
    q
  };
}

// Controllable XHR stub: send() does nothing synchronously - the test drives
// completion explicitly via fireTimeout()/fireError()/fireSuccess(), so each
// attempt (a fresh `new XMLHttpRequest()` per real loadSignerForm() call) is
// independently controllable.
function makeXhrCtor(instances) {
  return function XHRStub() {
    const self = this;
    self.open = function () {};
    self.send = function () { instances.push(self); };
  };
}

function build() {
  const calls = { show: [], applyLang: [], setLane: 0, rendered: 0 };
  const timers = makeTimers();
  const xhrInstances = [];
  const env = new Function(
    'XMLHttpRequest', 'setTimeout', 'window', 'GW', 'TOKEN',
    'show', 'applyLang', 'setLaneFromCtx_', 'renderSignerForm',
    src + '; return { loadSignerForm: loadSignerForm };'
  )(
    makeXhrCtor(xhrInstances),
    timers.set,
    { console: { log: () => {} } },
    'https://example.invalid/exec',
    'TESTTOKEN',
    (name) => { calls.show.push(name); },
    (lang) => { calls.applyLang.push(lang); },
    () => { calls.setLane++; },
    () => { calls.rendered++; }
  );
  return { env, calls, timers, xhrInstances };
}

// ---- 1. A single timeout retries silently instead of giving up immediately.
(function () {
  const t = build();
  t.env.loadSignerForm();
  ok('1st attempt fired', t.xhrInstances.length === 1);
  t.xhrInstances[0].readyState = 4;
  t.xhrInstances[0].ontimeout();
  ok('no give-up screen shown yet after first timeout', t.calls.show.indexOf('timeout') === -1);
  ok('a retry was scheduled (backoff timer armed)', t.timers.q.length === 1 && t.timers.q[0].ms === 2500);
  t.timers.fireAll();
  ok('second attempt fired after the backoff timer', t.xhrInstances.length === 2);
})();

// ---- 2. Two timeouts exhaust the retry budget (retries:2) and give up ------
(function () {
  const t = build();
  t.env.loadSignerForm();
  t.xhrInstances[0].ontimeout();
  t.timers.fireAll();
  ok('2nd attempt fired after 1st retry', t.xhrInstances.length === 2);
  t.xhrInstances[1].ontimeout();
  t.timers.fireAll();
  ok('3rd (final) attempt fired after 2nd retry', t.xhrInstances.length === 3);
  ok('still no give-up after 2 retries scheduled', t.calls.show.indexOf('timeout') === -1);
  t.xhrInstances[2].ontimeout();
  ok('retry budget exhausted -> give-up screen shown', t.calls.show.indexOf('timeout') !== -1);
  ok('no further attempt scheduled once exhausted', t.xhrInstances.length === 3);
})();

// ---- 3. A network error (onerror) retries the same way as a timeout -------
(function () {
  const t = build();
  t.env.loadSignerForm();
  t.xhrInstances[0].onerror();
  ok('network error schedules a retry, not an immediate give-up', t.calls.show.indexOf('timeout') === -1 && t.timers.q.length === 1);
  t.timers.fireAll();
  ok('retried attempt fired after a network error', t.xhrInstances.length === 2);
})();

// ---- 4. A retry that then SUCCEEDS proceeds normally, not stuck on retry --
(function () {
  const t = build();
  t.env.loadSignerForm();
  t.xhrInstances[0].ontimeout();
  t.timers.fireAll();
  const x2 = t.xhrInstances[1];
  x2.readyState = 4;
  x2.responseText = JSON.stringify({ ok: true });
  x2.onreadystatechange();
  ok('a successful retry renders the form, no give-up screen', t.calls.rendered === 1 && t.calls.show.indexOf('timeout') === -1);
})();

console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
