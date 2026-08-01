// flow-double-submit-harness.cjs (2026-08-02, CTO review finding #5).
//
// Proves flow.html's submit button now carries the same explicit re-entry
// belt signer.html already has (2026-07-15): a `submitting` flag checked at
// the top of the click listener, flipped true synchronously once validation
// passes, and reset only on a genuine failure (restoreSubmitBtn). Before this
// fix, flow.html relied SOLELY on `btn.disabled` inside runSubmitFlow_ - the
// same single-layer protection signer.html's own 2026-07-15 comment argued
// was not enough on its own (double-tap event dispatch, assistive-tech
// synthetic clicks can register a second click before disabled-state takes
// visible effect).
//
// Extracts the REAL click-listener body from the live file (brace-counting)
// and drives it directly, so this fails if a future edit drops the belt -
// not just if someone breaks a hand-written copy. The full submit pipeline
// (validateAllDataPages, LVPGateway, etc.) is stubbed since this test's only
// claim is about re-entry gating, not the network path (that path is already
// covered by israel-flow.cjs / client-honesty-harness.cjs's S3 stale-guard
// test for the same file).
//
// Run: node test/flow-double-submit-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'flow.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); } }

// ---- Static source assertions: the belt exists in the shape described above.
ok('submitting flag declared', /var submitting = false;/.test(html));
ok('click listener checks it first', /if \(submitting\) return;[\s\S]{0,500}Date\.now\(\) - pageOpenedAt_ > STALE_OPEN_MS_/.test(html));
ok('runSubmitFlow_ flips it true before disabling the button', /submitting = true;[\s\S]{0,200}btn\.disabled = true;/.test(html));
ok('restoreSubmitBtn resets it', /function restoreSubmitBtn\(\) \{\s*submitting = false;/.test(html));

// ---- Behavioral extraction: the click listener itself, driven directly. ----
function extractClickListenerBody() {
  const anchor = "document.getElementById('lvp-submit-btn').addEventListener('click', function () {";
  const start = html.indexOf(anchor);
  if (start < 0) throw new Error('click listener anchor not found (boot contract changed)');
  let i = start + anchor.length, depth = 1;
  const bodyStart = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(bodyStart, i); }
  }
  throw new Error('unbalanced braces in click listener');
}
const listenerBody = extractClickListenerBody();

function build() {
  const calls = { runSubmit: 0, staleCheck: 0 };
  let submitting = false;
  const fn = new Function(
    'submittingRef', 'Date', 'pageOpenedAt_', 'STALE_OPEN_MS_', 'staleReloadIfNewer_', 'runSubmitFlow_',
    'var submitting = submittingRef.value;\n' + listenerBody + '\nsubmittingRef.value = submitting;'
  );
  const ref = { value: false };
  function invoke() {
    fn(
      ref, Date, 0, 24 * 3600 * 1000,
      function (cb) { calls.staleCheck++; cb(); },
      function () { calls.runSubmit++; }
    );
  }
  return { invoke, calls, ref };
}

// 1. Fresh tab (not stale): first click runs the submit path once.
(function () {
  const t = build();
  t.invoke();
  ok('first click (fresh tab) runs the submit path', t.calls.runSubmit === 1);
})();

// 2. submitting=true (a real submit already in flight): click is a no-op.
(function () {
  const t = build();
  t.ref.value = true; // simulate: an earlier click already flipped this inside runSubmitFlow_
  t.invoke();
  ok('click while submitting is true never re-runs the submit path', t.calls.runSubmit === 0);
  ok('click while submitting is true never re-runs the stale check either', t.calls.staleCheck === 0);
})();

console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
