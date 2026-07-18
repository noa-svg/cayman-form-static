// Index (Cayman lane) honesty harness (2026-07-16, harden/cayman-lane port of
// the israel.html 2026-07-15 Bremington hardenings). Extracts the LIVE
// functions from index.html (house pattern, same as client-honesty-harness.cjs)
// and drives the REAL form through the rig, proving:
//   I1  proof-of-progress gate truth table: every genuine Cayman onboarding
//       success shape passes (CaymanGateway.ts caymanSubmitOnboarding_ + the
//       idempotent replay guard, read 2026-07-16); a bare replay answer and
//       every evidence-free / off-stage / not-ok shape is refused.
//   I2  build-tag self-consistency: index.html stamps window.__BUILD_TAG
//       exactly once with the index- prefix, and the guard's own extraction
//       regex cannot self-match.
//   I3  stale-guard behavior: differing live tag -> save_page flush + reload
//       (1s cap if the flush hangs) and the continuation is NOT called; same
//       tag / no tag / fetch error / throwing savePage -> fail open.
//   I4  source wiring: the submit .then is gated (no unguarded success path),
//       the >24h submit-path stale gate is wired BEFORE the POST, and the
//       idempotency key is minted once outside the retry loop.
//   I5  end-to-end (jsdom, REAL form): (a) a bare replay {ok:true,
//       stage:'submitted', detail:{replay:true}} does NOT paint success and
//       routes to the existing failure copy; (b) a genuine first-submit shape
//       WITH a marker paints success; (c) a client timeout quietly retries
//       once, 5s later, with the SAME idempotency key, spinner up throughout,
//       and paints success when the retry succeeds; (d) a non-timeout server
//       error shows the failure surface with NO retry.
// Run: node test/index-honesty-harness.cjs   (takes ~20s: real 5s retry waits)
'use strict';
const fs = require('fs');
const path = require('path');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- I1: proof-of-progress gate truth table --------------------------------
(function () {
  const m = indexHtml.match(/var SUBMIT_OK_STAGES_[\s\S]*?function submitShowsProgress_\(res\) \{[\s\S]*?\n    \}/);
  if (!m) { fail++; console.log('FAIL I1 could not extract submitShowsProgress_'); return; }
  const gate = new Function(m[0] + '; return submitShowsProgress_;')();

  // The Bremington fake success: MUST be refused.
  ok('I1 replay-only refused', gate({ ok: true, stage: 'submitted', nextUrl: '', detail: { replay: true } }) === false);
  // Every genuine Cayman onboarding submit success shape the mono gateway
  // emits after the caymanHandleLpAction_ envelope (publicDetail -> detail):
  ok('I1 submitted+signersPlanned (pending multi-signer)', gate({ ok: true, stage: 'submitted', nextUrl: '', detail: { signersPlanned: 2 } }) === true);
  ok('I1 signing+nextUrl (multi-signer advanced)', gate({ ok: true, stage: 'signing', nextUrl: 'https://x/sign', detail: { signerXofY: '2 of 3' } }) === true);
  ok('I1 signing+signerXofY only (no-first-signer fallback)', gate({ ok: true, stage: 'signing', detail: { signerXofY: '1 of 2' } }) === true);
  ok('I1 all_signed+seal note (deferred seal)', gate({ ok: true, stage: 'all_signed', detail: { note: 'seal in progress' } }) === true);
  ok('I1 all_signed+1of1 (single signer)', gate({ ok: true, stage: 'all_signed', detail: { signerXofY: '1 of 1' } }) === true);
  ok('I1 genuine replay with signing evidence passes', gate({ ok: true, stage: 'submitted', detail: { replay: true, signersPlanned: 2, signerXofY: '1 of 2' } }) === true);
  // Refusals.
  ok('I1 evidence-free ok refused', gate({ ok: true, stage: 'submitted', detail: {} }) === false);
  ok('I1 no detail refused', gate({ ok: true, stage: 'submitted' }) === false);
  ok('I1 replay with null counts refused', gate({ ok: true, stage: 'submitted', detail: { replay: true, signersPlanned: null } }) === false);
  ok('I1 off-stage refused', gate({ ok: true, stage: 'opened', detail: { signerXofY: '1 of 1' } }) === false);
  ok('I1 needs_attention refused', gate({ ok: true, stage: 'needs_attention', detail: { signerXofY: '1 of 1' } }) === false);
  ok('I1 ok:false refused', gate({ ok: false, stage: 'signing', nextUrl: 'https://x' }) === false);
  ok('I1 ok missing refused', gate({ stage: 'signing', nextUrl: 'https://x' }) === false);
  ok('I1 null refused', gate(null) === false);
})();

// ---- I2: build-tag self-consistency -----------------------------------------
(function () {
  const RE = /window\.__BUILD_TAG = '([^']+)'/;
  const first = indexHtml.match(RE);
  ok('I2 index.html tag present', !!first);
  ok('I2 index.html tag prefix', !!first && first[1].indexOf('index-') === 0);
  const stamps = indexHtml.match(new RegExp(RE.source, 'g')) || [];
  ok('I2 index.html exactly one stamp', stamps.length === 1, 'found ' + stamps.length);
})();

// ---- I3: stale-guard behavior ------------------------------------------------
(async function () {
  const m = indexHtml.match(/var STALE_HIDDEN_MS_[\s\S]*?function staleReloadIfNewer_\(onFresh\) \{[\s\S]*?\n    \}\n    function noteHidden_/);
  if (!m) { fail++; console.log('FAIL I3 could not extract stale guard'); return; }
  const src = m[0].replace(/\n    function noteHidden_$/, '');
  // Controllable timer stub: records callbacks so a test can fire the 1s cap
  // without firing the 4s fetch cap.
  function makeTimers() {
    const q = [];
    return {
      set: (fn, ms) => { q.push({ fn, ms, cleared: false }); return q.length - 1; },
      clear: (id) => { if (q[id]) q[id].cleared = true; },
      fire: (ms) => q.forEach(t => { if (!t.cleared && t.ms === ms) { t.cleared = true; t.fn(); } })
    };
  }
  function build(fetchImpl, tag, savePageImpl) {
    const calls = { reload: 0, fresh: 0, saves: 0 };
    const timers = makeTimers();
    const env = new Function(
      'fetch', 'window', 'location', 'savePage', 'setTimeout', 'clearTimeout', 'console', 'Date',
      src + '; return { staleReloadIfNewer_: staleReloadIfNewer_ };'
    )(
      fetchImpl,
      { __BUILD_TAG: tag, console: { log: () => {} } },
      { pathname: '/index.html', reload: () => { calls.reload++; } },
      function () { calls.saves++; return savePageImpl(); },
      timers.set, timers.clear,
      { log: () => {} },
      Date
    );
    return { env, calls, timers };
  }
  const flush = () => new Promise(r => setTimeout(r, 5));
  const LIVE_NEWER = () => Promise.resolve({ text: () => Promise.resolve("x window.__BUILD_TAG = 'index-NEWER' y") });
  const saveOk = () => Promise.resolve({});

  // A) live tag differs, save settles -> flush first, then reload exactly once,
  //    continuation NOT run.
  let t = build(LIVE_NEWER, 'index-OLD', saveOk);
  t.env.staleReloadIfNewer_(() => { t.calls.fresh++; });
  await flush();
  ok('I3 stale -> save_page flushed', t.calls.saves === 1);
  ok('I3 stale -> reload', t.calls.reload === 1);
  ok('I3 stale -> continuation blocked', t.calls.fresh === 0);
  t.timers.fire(1000);
  ok('I3 stale -> reload latched once', t.calls.reload === 1);

  // B) save hangs -> the 1s cap still reloads (fail open on the flush).
  t = build(LIVE_NEWER, 'index-OLD', () => new Promise(() => {}));
  t.env.staleReloadIfNewer_(() => { t.calls.fresh++; });
  await flush();
  ok('I3 hung save -> no reload yet', t.calls.reload === 0);
  t.timers.fire(1000);
  ok('I3 hung save -> 1s cap reloads', t.calls.reload === 1);

  // C) save throws synchronously -> reload still fires.
  t = build(LIVE_NEWER, 'index-OLD', () => { throw new Error('boom'); });
  t.env.staleReloadIfNewer_(() => { t.calls.fresh++; });
  await flush();
  ok('I3 throwing save -> still reloads', t.calls.reload === 1 && t.calls.fresh === 0);

  // D) same tag -> continuation runs, no reload, no save.
  t = build(() => Promise.resolve({ text: () => Promise.resolve("window.__BUILD_TAG = 'index-SAME'") }), 'index-SAME', saveOk);
  t.env.staleReloadIfNewer_(() => { t.calls.fresh++; });
  await flush();
  ok('I3 same tag -> proceeds', t.calls.fresh === 1 && t.calls.reload === 0 && t.calls.saves === 0);

  // E) fetch failure -> fail open (continuation runs).
  t = build(() => Promise.reject(new Error('offline')), 'index-OLD', saveOk);
  t.env.staleReloadIfNewer_(() => { t.calls.fresh++; });
  await flush();
  ok('I3 fetch error -> fail open', t.calls.fresh === 1 && t.calls.reload === 0);

  // F) response without a tag -> fail open.
  t = build(() => Promise.resolve({ text: () => Promise.resolve('<html>no tag here</html>') }), 'index-OLD', saveOk);
  t.env.staleReloadIfNewer_(() => { t.calls.fresh++; });
  await flush();
  ok('I3 tagless response -> fail open', t.calls.fresh === 1 && t.calls.reload === 0);
})();

// ---- I4: source wiring asserts -----------------------------------------------
(function () {
  const now = indexHtml.indexOf('function doSubmitNow_() {');
  ok('I4 doSubmitNow_ present', now !== -1);
  const gateIdx = indexHtml.indexOf('if (!submitShowsProgress_(res))');
  const firstSuccess = indexHtml.indexOf('showSubmittedCard()', now);
  ok('I4 gate precedes every submit success branch', gateIdx !== -1 && firstSuccess !== -1 && gateIdx < firstSuccess);
  ok('I4 submit-path stale gate wired before the POST', /staleReloadIfNewer_\(function \(\) \{ doSubmitNow_\(\); \}\);/.test(indexHtml));
  ok('I4 idempotency key minted once outside the retry loop', /var idemKey = caymanSubmitIdemKey_\(\);/.test(indexHtml));
  ok('I4 every attempt posts the same key', /idempotencyKey: idemKey/.test(indexHtml) && !/idempotencyKey: caymanSubmitIdemKey_\(\)/.test(indexHtml));
  ok('I4 timeout flag drives the retry', /isTimeout: function \(err\) \{ return !!\(err && err\.lvpTimeout\); \}/.test(indexHtml));
  ok('I4 gateway abort carries the flag', /tErr\.lvpTimeout = true;/.test(indexHtml));
  // The legacy unguarded chain (gateway('submit', ...).then directly painting
  // success) must be gone: the only submit POST goes through attempt().
  const direct = indexHtml.match(/gateway\('submit'/g) || [];
  ok('I4 exactly one submit POST site', direct.length === 1, 'found ' + direct.length);
})();

// ---- I5: end-to-end submit honesty (jsdom, REAL form) ------------------------
// Drives the real form to review (test-positive-submit.cjs pattern), signs via
// the typed-name pad, then scripts the gateway submit responses.
const SLOTS = ['articlesOfIncorporation', 'bankAccountConfirmation', 'certificateOfIncorporation', 'corporateResolution', 'listOfAuthorizedSignatories', 'partnershipAgreement', 'proofOfRegisteredAddress', 'trustAgreement', 'passportPrimary', 'proofOfAddress'];
function cur(d) { const p = d.querySelector('.lvp-page:not([hidden])'); return p ? p.getAttribute('data-page') : null; }
function fh(h) { let el = h; while (el && el.nodeType === 1) { if (el.hasAttribute && el.hasAttribute('hidden')) return true; if (el.style && el.style.display === 'none') return true; el = el.parentElement; } return false; }
function visReq(d) { const p = d.querySelector('.lvp-page:not([hidden])'); if (!p) return []; return Array.from(p.querySelectorAll('[data-required]')).filter(h => !fh(h)); }
function empty(h) { if (h.classList.contains('lvp-dob')) { const iso = h.querySelector('[data-dob-iso]'); return !(iso && /^\d{4}-\d{2}-\d{2}$/.test(iso.value || '')); } const ins = Array.from(h.querySelectorAll('input,select,textarea')); let f = false; ins.forEach(i => { if (i.type === 'radio' || i.type === 'checkbox') { if (i.checked) f = true; } else if (i.hasAttribute('data-upload')) {} else if (i.value && String(i.value).trim()) f = true; }); return !f; }
function fire(el, t) { el.dispatchEvent(new (el.ownerDocument.defaultView.Event)(t, { bubbles: true })); }
function setV(i, v) { i.value = v; fire(i, 'input'); fire(i, 'change'); }
// Validator-aware values (2026-07-16): the inline format gate added 2026-07-14
// (LVP_FIELD_VALIDATORS_ in index.html) rejects generic 'Test'/'123456' fills
// on gated fields, so the walk uses values every gate accepts.
function valueFor(i) {
  const n = String(i.name || '');
  if (/\.idNumber$|\.idOrCompanyNumber$|taxRefNumber$|registrationNumber$/.test(n)) return '123456782'; // checksum-valid Israeli ID
  if (/\.phone$/.test(n)) return '+972501234567';
  if (/\.usTin$/.test(n)) return '123456789';
  if (/\.giin\d*$|mergedGiin$/.test(n)) return 'ABCDEF.ABCDE.IL.123';
  if (/lpBank\.accountNumber$/.test(n)) return '12345678';
  if (/lpBank\.swift$/.test(n)) return 'LUMIILIT';
  if (/amount$/i.test(n)) return '150000';
  if (/\.postCode$/.test(n)) return '6100000';
  if (/taxRefTypeAndNumber$/.test(n)) return 'SSN 123-45-6789';
  return (i.getAttribute('inputmode') === 'numeric') ? '123456' : 'Test';
}
function fill(h) { if (h.classList.contains('lvp-dob')) { const d = h.querySelector('[data-dob-d]'), m = h.querySelector('[data-dob-m]'), y = h.querySelector('[data-dob-y]'), iso = h.querySelector('[data-dob-iso]'); if (d) setV(d, '01'); if (m) setV(m, '01'); if (y) setV(y, '1985'); if (iso && !/^\d{4}/.test(iso.value)) iso.value = '1985-01-01'; return; } const ins = Array.from(h.querySelectorAll('input,select,textarea')); const r = ins.filter(i => i.type === 'radio'); if (r.length) { r[0].checked = true; fire(r[0], 'change'); fire(r[0], 'input'); return; } ins.forEach(i => { if (i.type === 'checkbox') { i.checked = true; fire(i, 'change'); } else if (i.type === 'file') {} else if (i.tagName === 'SELECT') { const o = Array.from(i.options).find(x => x.value); if (o) { i.value = o.value; fire(i, 'change'); fire(i, 'input'); } } else if (i.type === 'date') { setV(i, new Date().toISOString().slice(0, 10)); } else if (i.type === 'email') { setV(i, 't@example.com'); } else setV(i, valueFor(i)); }); }

const FAILURE_COPY = 'We could not submit your subscription just now. Your entries are saved on this page. Please try again, or contact Legacy Value Partners.';
const SUCCESS_COPY = 'Your subscription has been signed and submitted. We are finalizing your documents and will email a confirmation shortly.';

// Boot the real form to review + signed, and script the submit responses.
// script(attemptNo) returns either { reject: err } or { json: obj }.
async function bootToSubmit(script) {
  const { loadForm } = require('./rig.cjs');
  const { document, window } = await loadForm({ cfg: { applicantType: 'individual', prefill: { __testUploads: SLOTS, _pad: '1' } } });
  const next = document.querySelector('[data-action="next"]');
  const submit = document.querySelector('[data-action="submit"]');
  for (let s = 0; s < 40 && cur(document) !== 'review'; s++) { for (let k = 0; k < 5; k++) { const e = visReq(document).filter(empty); if (!e.length) break; e.forEach(fill); await sleep(8); } next.click(); await sleep(10); }
  if (cur(document) !== 'review') throw new Error('did not reach review; stuck on ' + cur(document));
  const submits = [];   // recorded submit envelope bodies
  const of = window.fetch;
  window.fetch = function (u, o) {
    if (String(u).indexOf('source=lp') !== -1 && o && o.body) {
      let body = null;
      try { body = JSON.parse(o.body); } catch (e) {}
      if (body && body.action === 'submit') {
        submits.push(body);
        const step = script(submits.length);
        if (step.reject) return Promise.reject(step.reject);
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(step.json), text: () => Promise.resolve(JSON.stringify(step.json)) });
      }
    }
    return of(u, o);
  };
  const typeBtn = document.querySelector('[data-sig-mode="type"]'); if (typeBtn) { typeBtn.click(); await sleep(8); }
  const ti = document.querySelector('[data-sig-typed-input]'); if (ti) { setV(ti, 'Test Subscriber'); await sleep(8); }
  submit.click();
  return { document, window, submits };
}
function statusText(document) { const s = document.querySelector('[data-status]'); return s ? s.textContent : ''; }
function statusIsError(document) { const s = document.querySelector('[data-status]'); return !!(s && s.classList.contains('lvp-status--error')); }
function resultText(document) { const r = document.querySelector('.lvp-result'); return r ? r.textContent : ''; }

(async function () {
  try {
    // (a) bare replay: MUST NOT paint success; existing failure copy, no retry.
    let t = await bootToSubmit(() => ({ json: { ok: true, stage: 'submitted', nextUrl: '', detail: { replay: true } } }));
    await sleep(150);
    ok('I5a bare replay -> no success card', resultText(t.document).indexOf(SUCCESS_COPY) === -1);
    ok('I5a bare replay -> result card cleared (form restored)', t.document.querySelector('.lvp-result') === null);
    ok('I5a bare replay -> existing failure copy', statusText(t.document) === FAILURE_COPY && statusIsError(t.document));
    ok('I5a bare replay -> exactly one POST (no retry on gate refusal)', t.submits.length === 1, 'posts=' + t.submits.length);

    // (b) genuine first-submit shape WITH a marker: paints success.
    t = await bootToSubmit(() => ({ json: { ok: true, stage: 'all_signed', nextUrl: '', detail: { signerXofY: '1 of 1' } } }));
    await sleep(150);
    ok('I5b genuine success -> success card painted', resultText(t.document).indexOf(SUCCESS_COPY) !== -1);
    ok('I5b genuine success -> no error status', !statusIsError(t.document));
    ok('I5b genuine success -> one POST', t.submits.length === 1);

    // (c) timeout -> ONE quiet retry, 5s later, SAME idempotency key, spinner
    //     stays up in between, success on the second attempt paints success.
    t = await bootToSubmit(n => n === 1
      ? { reject: Object.assign(new Error('aborted'), { name: 'AbortError' }) }
      : { json: { ok: true, stage: 'all_signed', nextUrl: '', detail: { signerXofY: '1 of 1' } } });
    await sleep(300);
    ok('I5c after timeout -> spinner still up (silent retry pending)', resultText(t.document).indexOf('Submitting your subscription') !== -1);
    ok('I5c after timeout -> no failure copy shown', statusText(t.document) === '');
    ok('I5c no early second POST (5s spacing)', t.submits.length === 1, 'posts=' + t.submits.length);
    await sleep(5300);
    ok('I5c retry fired -> two POSTs total', t.submits.length === 2, 'posts=' + t.submits.length);
    const k1 = t.submits[0] && t.submits[0].payload && t.submits[0].payload.idempotencyKey;
    const k2 = t.submits[1] && t.submits[1].payload && t.submits[1].payload.idempotencyKey;
    ok('I5c retry reuses the SAME idempotency key', !!k1 && k1 === k2, k1 + ' vs ' + k2);
    ok('I5c success on retry -> success card painted', resultText(t.document).indexOf(SUCCESS_COPY) !== -1);

    // (d) non-timeout server error -> failure surface, NO retry.
    t = await bootToSubmit(() => ({ json: { ok: false, error: 'boom' } }));
    await sleep(150);
    ok('I5d server error -> existing failure copy', statusText(t.document) === FAILURE_COPY && statusIsError(t.document));
    ok('I5d server error -> no success card', resultText(t.document).indexOf(SUCCESS_COPY) === -1);
    await sleep(5500);
    ok('I5d server error -> still exactly one POST (no retry)', t.submits.length === 1, 'posts=' + t.submits.length);
  } catch (e) {
    fail++; console.log('FAIL I5 rig drive: ' + (e.stack || e));
  }

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
