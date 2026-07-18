// Client-honesty harness (2026-07-15, Bremington incident hardening).
// Extracts the LIVE functions from israel.html / flow.html (house pattern, same
// as sign-preview-race-harness.cjs) and proves:
//   G1  proof-of-progress gate truth table: every genuine gateway success shape
//       passes; a bare replay answer (the Bremington fake success) and every
//       evidence-free / off-stage / not-ok shape is refused.
//   G2  gateway() tightening: a JSON body WITHOUT ok rejects (was treated as
//       success), ok:false rejects with the server error, ok:true resolves,
//       an AbortError surfaces as 'timeout'.
//   G3  build-tag self-consistency: each file stamps window.__BUILD_TAG exactly
//       once, and the guard's own extraction regex finds THAT stamp first
//       (the regex literal inside the guard must not self-match).
//   G4  stale-guard behavior: differing live tag -> snapshot + reload and the
//       submit continuation is NOT called; same tag / no tag / fetch error ->
//       fail open, submit continuation runs, no reload.
//   G5  done-mode boot (jsdom): cfg.completed:true at config-fetch time flips
//       .lvp-done-mode on <html>; cfg.completed:false does not. #lvp-done
//       markup and its display CSS exist.
// Run: node test/client-honesty-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const israelHtml = fs.readFileSync(path.join(__dirname, '..', 'israel.html'), 'utf8');
const flowHtml = fs.readFileSync(path.join(__dirname, '..', 'flow.html'), 'utf8');
const signerHtml = fs.readFileSync(path.join(__dirname, '..', 'signer.html'), 'utf8');
// Batch D shared transport source: evaluated inside each test's stubbed env
// (injected fetch/timers) so the extracted gateway() wrapper exercises the
// REAL module, not a reimplementation.
const gatewayModuleSrc = fs.readFileSync(path.join(__dirname, '..', 'lvp-gateway.js'), 'utf8');
function buildGatewayModule(fetchImpl, setTimeoutImpl, clearTimeoutImpl, AbortControllerImpl) {
  const holder = { exports: {} };
  new Function('module', 'fetch', 'setTimeout', 'clearTimeout', 'AbortController', gatewayModuleSrc)(
    holder, fetchImpl, setTimeoutImpl, clearTimeoutImpl, AbortControllerImpl
  );
  return holder.exports;
}
// jsdom boots (G5) run with runScripts:'dangerously', which does not fetch
// external <script src>; inline the module the same way rig-israel.cjs does.
const GW_TAG = '<script src="lvp-gateway.js"></script>';
if (israelHtml.indexOf(GW_TAG) === -1) { console.log('FAIL lvp-gateway.js script tag missing from israel.html'); process.exit(1); }
const israelHtmlInlined = israelHtml.replace(GW_TAG, '<script>\n' + gatewayModuleSrc + '\n</script>');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); } }

// ---- G1: proof-of-progress gate truth table --------------------------------
(function () {
  const m = israelHtml.match(/var SUBMIT_OK_STAGES_[\s\S]*?function submitShowsProgress_\(res\) \{[\s\S]*?\n    \}/);
  if (!m) { fail++; console.log('FAIL G1 could not extract submitShowsProgress_'); return; }
  const gate = new Function(m[0] + '; return submitShowsProgress_;')();

  // The Bremington fake success: MUST be refused.
  ok('G1 replay-only refused', gate({ ok: true, stage: 'submitted', nextUrl: '', detail: { replay: true } }) === false);
  // Every genuine success shape the mono gateway emits (read 2026-07-15).
  ok('G1 submitted+signersPlanned', gate({ ok: true, stage: 'submitted', detail: { signersPlanned: 2 } }) === true);
  ok('G1 signing+nextUrl', gate({ ok: true, stage: 'signing', nextUrl: 'https://x/sign', detail: {} }) === true);
  ok('G1 signing+signerXofY', gate({ ok: true, stage: 'signing', detail: { signerXofY: '1 of 2' } }) === true);
  ok('G1 signing+lawyerEmailed', gate({ ok: true, stage: 'signing', detail: { lawyerEmailed: true, signerXofY: '1/3' } }) === true);
  ok('G1 signing+coHolderEmailed', gate({ ok: true, stage: 'signing', detail: { coHolderEmailed: true } }) === true);
  ok('G1 all_signed+seal note', gate({ ok: true, stage: 'all_signed', detail: { note: 'seal in progress' } }) === true);
  ok('G1 all_signed+1of1', gate({ ok: true, stage: 'all_signed', detail: { signerXofY: '1 of 1' } }) === true);
  // Refusals.
  ok('G1 evidence-free ok refused', gate({ ok: true, stage: 'submitted', detail: {} }) === false);
  ok('G1 no detail refused', gate({ ok: true, stage: 'submitted' }) === false);
  ok('G1 off-stage refused', gate({ ok: true, stage: 'opened', detail: { signerXofY: '1 of 1' } }) === false);
  ok('G1 needs_attention refused', gate({ ok: true, stage: 'needs_attention', detail: { signerXofY: '1 of 1' } }) === false);
  ok('G1 ok:false refused', gate({ ok: false, stage: 'signing', nextUrl: 'https://x' }) === false);
  ok('G1 ok missing refused', gate({ stage: 'signing', nextUrl: 'https://x' }) === false);
  ok('G1 null refused', gate(null) === false);
  ok('G1 replay+real evidence passes', gate({ ok: true, stage: 'submitted', detail: { replay: true, signerXofY: '1 of 2' } }) === true);
})();

// ---- G2: gateway() rejection tightening -------------------------------------
(async function () {
  const m = israelHtml.match(/function gateway\(action, payload, timeoutOverrideMs\) \{[\s\S]*?\n    \}\n    function savePage/);
  if (!m) { fail++; console.log('FAIL G2 could not extract gateway'); return; }
  const src = m[0].replace(/\n    \}\n    function savePage$/, '\n    }');
  let fetchImpl;
  const logs = [];
  const consoleStub = { log: (...a) => logs.push(a.join(' ')), warn: () => {} };
  // Build the REAL shared module in the same stubbed env, then hand it to the
  // extracted wrapper on the window stub (production wiring).
  const LVPGatewayStub = buildGatewayModule(
    (...a) => fetchImpl(...a),
    () => 0, () => 0,
    undefined            // no AbortController: timer stays null, no abort path
  );
  const gw = new Function(
    'CFG', 'fetch', 'window', 'AbortController', 'setTimeout', 'clearTimeout', 'console',
    src + '; return gateway;'
  )(
    { token: 'T', gatewayUrl: 'https://gw.invalid/exec' },
    (...a) => fetchImpl(...a),
    { console: consoleStub, LVPGateway: LVPGatewayStub },
    undefined,
    () => 0, () => 0,
    consoleStub
  );

  // A) JSON body WITHOUT ok -> reject (tightened; used to pass as success).
  fetchImpl = () => Promise.resolve({ json: () => Promise.resolve({ weird: 1 }) });
  let rejected = null;
  await gw('submit', {}).catch(e => { rejected = e; });
  ok('G2 no-ok body rejects', !!rejected);
  ok('G2 no-ok body logged', logs.some(l => l.indexOf('gateway submit rejected:') === 0));

  // B) ok:false carries the server error string.
  fetchImpl = () => Promise.resolve({ json: () => Promise.resolve({ ok: false, error: 'ERR-X' }) });
  rejected = null;
  await gw('submit', {}).catch(e => { rejected = e; });
  ok('G2 ok:false rejects with server error', rejected && rejected.message === 'ERR-X');

  // C) ok:true resolves through.
  fetchImpl = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, stage: 'signing' }) });
  const res = await gw('submit', {}).catch(() => null);
  ok('G2 ok:true resolves', res && res.ok === true);

  // D) AbortError surfaces as timeout.
  fetchImpl = () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  rejected = null;
  await gw('submit', {}).catch(e => { rejected = e; });
  ok('G2 abort -> timeout', rejected && rejected.message === 'timeout');
})();

// ---- G3: build-tag self-consistency -----------------------------------------
(function () {
  const RE = /window\.__BUILD_TAG = '([^']+)'/;
  [['israel.html', israelHtml, 'israel-'], ['flow.html', flowHtml, 'flow-'], ['signer.html', signerHtml, 'signer-']].forEach(function ([name, html, prefix]) {
    const first = html.match(RE);
    ok('G3 ' + name + ' tag present', !!first);
    ok('G3 ' + name + ' tag prefix', !!first && first[1].indexOf(prefix) === 0);
    const stamps = html.match(new RegExp(RE.source, 'g')) || [];
    ok('G3 ' + name + ' exactly one stamp', stamps.length === 1, 'found ' + stamps.length);
  });
})();

// ---- G4: stale-guard behavior ------------------------------------------------
(async function () {
  const m = israelHtml.match(/var STALE_HIDDEN_MS_[\s\S]*?function staleReloadIfNewer_\(onFresh\) \{[\s\S]*?\n    \}\n    function noteHidden_/);
  if (!m) { fail++; console.log('FAIL G4 could not extract stale guard'); return; }
  const src = m[0].replace(/\n    function noteHidden_$/, '');
  function build(fetchImpl, tag) {
    const calls = { reload: 0, snap: 0, fresh: 0 };
    const env = new Function(
      'fetch', 'window', 'location', 'saveLocalSnap_', 'setTimeout', 'clearTimeout', 'console', 'Date',
      src + '; return { staleReloadIfNewer_: staleReloadIfNewer_, fetchLiveBuildTag_: fetchLiveBuildTag_ };'
    )(
      fetchImpl,
      { __BUILD_TAG: tag, console: { log: () => {} } },
      { pathname: '/israel.html', reload: () => { calls.reload++; } },
      () => { calls.snap++; },
      (fn) => 0,      // the 4s fail-open timer never fires inside a microtask test
      () => {},
      { log: () => {} },
      Date
    );
    return { env, calls };
  }
  const flush = () => new Promise(r => setTimeout(r, 5));

  // A) live tag differs -> snapshot + reload, continuation NOT run.
  let t = build(() => Promise.resolve({ text: () => Promise.resolve("x window.__BUILD_TAG = 'israel-NEWER' y") }), 'israel-OLD');
  t.env.staleReloadIfNewer_(() => { t.calls.fresh++; });
  await flush();
  ok('G4 stale -> reload', t.calls.reload === 1);
  ok('G4 stale -> snapshot first', t.calls.snap === 1);
  ok('G4 stale -> continuation blocked', t.calls.fresh === 0);

  // B) same tag -> continuation runs, no reload.
  t = build(() => Promise.resolve({ text: () => Promise.resolve("window.__BUILD_TAG = 'israel-SAME'") }), 'israel-SAME');
  t.env.staleReloadIfNewer_(() => { t.calls.fresh++; });
  await flush();
  ok('G4 same tag -> proceeds', t.calls.fresh === 1 && t.calls.reload === 0);

  // C) fetch failure -> fail open (continuation runs).
  t = build(() => Promise.reject(new Error('offline')), 'israel-OLD');
  t.env.staleReloadIfNewer_(() => { t.calls.fresh++; });
  await flush();
  ok('G4 fetch error -> fail open', t.calls.fresh === 1 && t.calls.reload === 0);

  // D) response without a tag -> fail open.
  t = build(() => Promise.resolve({ text: () => Promise.resolve('<html>no tag here</html>') }), 'israel-OLD');
  t.env.staleReloadIfNewer_(() => { t.calls.fresh++; });
  await flush();
  ok('G4 tagless response -> fail open', t.calls.fresh === 1 && t.calls.reload === 0);
})();

// ---- S1: signer.html proof-of-progress gate truth table ---------------------
(function () {
  const m = signerHtml.match(/var SUBMIT_OK_STAGES_[\s\S]*?function submitShowsProgress_\(res\) \{[\s\S]*?\n    \}/);
  if (!m) { fail++; console.log('FAIL S1 could not extract signer submitShowsProgress_'); return; }
  const gate = new Function(m[0] + '; return submitShowsProgress_;')();

  // The engine's evidence-free replay collapse (already-signed replay reaches
  // the gateway with no signerXofY): MUST be refused, not painted as done.
  ok('S1 replay collapse refused', gate({ ok: true, stage: 'signing', nextUrl: '', detail: {} }) === false);
  ok('S1 replay-only refused', gate({ ok: true, stage: 'signing', detail: { replay: true } }) === false);
  // Every genuine record_signature success shape the mono gateway emits
  // (caymanHandleRecordSignature_, read 2026-07-15).
  ok('S1 signing+signerXofY', gate({ ok: true, stage: 'signing', nextUrl: '', detail: { signerXofY: '2/3' } }) === true);
  ok('S1 signing+nextUrl', gate({ ok: true, stage: 'signing', nextUrl: 'https://x/sign', detail: {} }) === true);
  ok('S1 signing+lawyerEmailed', gate({ ok: true, stage: 'signing', detail: { lawyerEmailed: true, signerXofY: '2/3' } }) === true);
  ok('S1 signing+coHolderEmailed', gate({ ok: true, stage: 'signing', detail: { coHolderEmailed: true } }) === true);
  ok('S1 all_signed+XofY', gate({ ok: true, stage: 'all_signed', detail: { signerXofY: '3/3' } }) === true);
  ok('S1 all_signed+seal note', gate({ ok: true, stage: 'all_signed', detail: { note: 'seal in progress' } }) === true);
  // Refusals: ok-less JSON, ok:false, off-stage, evidence-free.
  ok('S1 ok-less JSON refused', gate({ stage: 'signing', detail: { signerXofY: '1/2' } }) === false);
  ok('S1 ok:false refused', gate({ ok: false, stage: 'signing', detail: { signerXofY: '1/2' } }) === false);
  ok('S1 needs_attention refused', gate({ ok: true, stage: 'needs_attention', detail: { signerXofY: '1/2' } }) === false);
  ok('S1 evidence-free refused', gate({ ok: true, stage: 'all_signed', detail: {} }) === false);
  ok('S1 null refused', gate(null) === false);
})();

// ---- S2: signer.html stale guard (XHR variant + autosave flush) --------------
(function () {
  const m = signerHtml.match(/var STALE_HIDDEN_MS_[\s\S]*?function staleReloadIfNewer_\(onFresh\) \{[\s\S]*?\n    \}\n    function noteHidden_/);
  if (!m) { fail++; console.log('FAIL S2 could not extract signer stale guard'); return; }
  const src = m[0].replace(/\n    function noteHidden_$/, '');
  // Controllable timer stub: records callbacks so a test can fire the 1s cap.
  function makeTimers() {
    const q = [];
    return {
      set: (fn, ms) => { q.push({ fn, ms, cleared: false }); return q.length - 1; },
      clear: (id) => { if (q[id]) q[id].cleared = true; },
      fire: (ms) => q.forEach(t => { if (!t.cleared && t.ms === ms) { t.cleared = true; t.fn(); } }),
      q
    };
  }
  function makeXhr(behavior) {
    return function XHRStub() {
      this.open = function () {};
      this.send = function () {
        if (behavior.error) { if (this.onerror) this.onerror(); return; }
        this.readyState = 4;
        this.status = behavior.status !== undefined ? behavior.status : 200;
        this.responseText = behavior.body || '';
        if (this.onreadystatechange) this.onreadystatechange();
      };
    };
  }
  function build(behavior, tag) {
    const calls = { reload: 0, fresh: 0, flush: 0 };
    const timers = makeTimers();
    const env = new Function(
      'XMLHttpRequest', 'window', 'location', 'setTimeout', 'clearTimeout', 'console', 'Date',
      src + '; return { staleReloadIfNewer_: staleReloadIfNewer_, setFlush: function (f) { flushAutosaveForStale_ = f; } };'
    )(
      makeXhr(behavior),
      { __BUILD_TAG: tag, console: { log: () => {}, error: () => {} } },
      { pathname: '/signer.html', reload: () => { calls.reload++; } },
      timers.set, timers.clear,
      { log: () => {}, error: () => {} },
      Date
    );
    return { env, calls, timers };
  }
  const LIVE_NEWER = "x window.__BUILD_TAG = 'signer-NEWER' y";

  // A) stale + flush hook set: flush runs first, reload fires on its callback,
  //    continuation blocked. All synchronous via the stubs.
  let t = build({ body: LIVE_NEWER }, 'signer-OLD');
  t.env.setFlush((done) => { t.calls.flush++; done(); });
  t.env.staleReloadIfNewer_(() => { t.calls.fresh++; });
  ok('S2 stale -> flush called', t.calls.flush === 1);
  ok('S2 stale -> reload after flush', t.calls.reload === 1);
  ok('S2 stale -> continuation blocked', t.calls.fresh === 0);

  // B) stale + flush never calls back: the 1s cap still reloads (fail open).
  t = build({ body: LIVE_NEWER }, 'signer-OLD');
  t.env.setFlush(() => { t.calls.flush++; /* never calls done */ });
  t.env.staleReloadIfNewer_(() => { t.calls.fresh++; });
  ok('S2 hung flush -> no reload yet', t.calls.reload === 0);
  t.timers.fire(1000);
  ok('S2 hung flush -> cap reloads', t.calls.reload === 1);

  // C) stale + no flush hook yet (form not rendered): reload directly.
  t = build({ body: LIVE_NEWER }, 'signer-OLD');
  t.env.staleReloadIfNewer_(() => { t.calls.fresh++; });
  ok('S2 no hook -> still reloads', t.calls.reload === 1 && t.calls.fresh === 0);

  // D) same tag -> continuation runs, no reload, no flush.
  t = build({ body: "window.__BUILD_TAG = 'signer-SAME'" }, 'signer-SAME');
  t.env.setFlush((done) => { t.calls.flush++; done(); });
  t.env.staleReloadIfNewer_(() => { t.calls.fresh++; });
  ok('S2 same tag -> proceeds', t.calls.fresh === 1 && t.calls.reload === 0 && t.calls.flush === 0);

  // E) network error / non-200 / tagless body -> fail open.
  [['net error', { error: true }], ['http 500', { status: 500, body: 'x' }], ['tagless', { body: '<html>none</html>' }]].forEach(function ([label, behavior]) {
    const f = build(behavior, 'signer-OLD');
    f.env.staleReloadIfNewer_(() => { f.calls.fresh++; });
    ok('S2 ' + label + ' -> fail open', f.calls.fresh === 1 && f.calls.reload === 0);
  });
})();

// ---- S3: flow.html stale reload flushes the debounced save ------------------
(function () {
  const m = flowHtml.match(/function staleReloadIfNewer_\(onFresh\) \{[\s\S]*?\n      \}\n      function noteHidden_/);
  if (!m) { fail++; console.log('FAIL S3 could not extract flow staleReloadIfNewer_'); return; }
  const src = m[0].replace(/\n      function noteHidden_$/, '');
  function build(saveBehavior) {
    const calls = { reload: 0, fresh: 0, saves: [], timerCleared: 0 };
    const timers = [];
    const env = new Function(
      'fetchLiveBuildTag_', 'saveTimer', 'savePage', 'window', 'location', 'setTimeout', 'clearTimeout', 'console', 'staleCheckBusy_',
      src + '; return staleReloadIfNewer_;'
    )(
      (cb) => cb('flow-NEWER'),                                  // live tag differs
      123,                                                        // a pending debounce timer id
      (page, cb) => { calls.saves.push({ page, hasCb: typeof cb === 'function' }); if (saveBehavior === 'settle' && cb) cb(); },
      { __BUILD_TAG: 'flow-OLD', console: { log: () => {} } },
      { reload: () => { calls.reload++; } },
      (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; },
      (id) => { calls.timerCleared++; },
      { log: () => {} },
      false
    );
    return { env, calls, timers };
  }
  // A) save settles -> reload immediately via the callback, debounce cancelled.
  let t = build('settle');
  t.env(() => { t.calls.fresh++; });
  ok('S3 flush fired with callback', t.calls.saves.length === 1 && t.calls.saves[0].hasCb === true);
  ok('S3 debounce timer cancelled', t.calls.timerCleared >= 1);
  ok('S3 reload after save settles', t.calls.reload === 1);
  ok('S3 continuation blocked', t.calls.fresh === 0);
  // B) save hangs -> the 1s cap reloads (fail open).
  t = build('hang');
  t.env(() => { t.calls.fresh++; });
  ok('S3 hung save -> no reload yet', t.calls.reload === 0);
  const cap = t.timers.find(x => x.ms === 1000);
  ok('S3 1s cap armed', !!cap);
  if (cap) cap.fn();
  ok('S3 hung save -> cap reloads', t.calls.reload === 1);
})();

// ---- S4: signer.html double-submit + failure-visibility source asserts ------
(function () {
  const click = signerHtml.indexOf("doneBtn.addEventListener('click', function () {");
  const belt = signerHtml.indexOf('if (submitting) return;');
  ok('S4 click handler present', click !== -1);
  ok('S4 double-submit belt inside handler', belt !== -1 && belt > click && belt - click < 800);
  const disable = signerHtml.indexOf('doneBtn.disabled = true; clearBtn.disabled = true;');
  const send = signerHtml.indexOf('p.send(body);');
  ok('S4 button disabled before POST', disable !== -1 && send !== -1 && disable < send);
  ok('S4 submit-path stale gate wired', /staleReloadIfNewer_\(doSignSubmit_\);/.test(signerHtml));
  ok('S4 gate guards the done screen', /if \(submitShowsProgress_\(res\)\) \{/.test(signerHtml));
  ok('S4 onPostFail logs the envelope', /record_signature failed; status=/.test(signerHtml));
  ok('S4 signerform non-ok logged', /signerform non-ok envelope/.test(signerHtml));
})();

// ---- G5: done-mode boot (jsdom) ----------------------------------------------
(async function () {
  ok('G5 #lvp-done markup present', /<div id="lvp-done">/.test(israelHtml));
  ok('G5 done copy verbatim line 1', israelHtml.indexOf('Your request is complete.') !== -1);
  ok('G5 done copy verbatim line 2', israelHtml.indexOf('A signed copy has been emailed to you.') !== -1);
  ok('G5 done display CSS present', /\.lvp-done-mode #lvp-done \{ display: flex; \}/.test(israelHtml));
  ok('G5 done hides app chrome', /\.lvp-done-mode \.lvp-lang, \.lvp-done-mode \.lvp-app, \.lvp-done-mode #lvp-gate \{ display: none; \}/.test(israelHtml));

  let JSDOM, VirtualConsole;
  try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
  catch (e) { fail++; console.log('FAIL G5 jsdom unavailable'); return; }

  async function boot(completed, sealed) {
    const vc = new VirtualConsole();
    vc.on('jsdomError', () => {});
    const cfg = {
      ok: true, token: 'TESTTOKEN', lane: 'israeli', flowType: 'cayman_onboarding',
      applicantType: 'individual', completed: completed, prefill: {}, resumePage: '',
      language: 'he', wire: null
    };
    if (sealed !== undefined) cfg.sealed = sealed;
    const dom = new JSDOM(israelHtmlInlined, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://sign.legacyvpartners.com/israel.html?t=TESTTOKEN',
      virtualConsole: vc,
      beforeParse(window) {
        window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener: () => {}, addEventListener: () => {} }));
        window.fetch = function (u) {
          if (String(u).indexOf('api=config') !== -1) {
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cfg), text: () => Promise.resolve(JSON.stringify(cfg)) });
          }
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
        };
      }
    });
    await new Promise(r => setTimeout(r, 300));
    return dom;
  }

  // Two-state copy (Noa-approved 2026-07-15): sealed -> Cayman pair;
  // completed without sealed (including the field missing entirely, i.e. an
  // older server) -> partial pair.
  const sealedDom = await boot(true, true);
  const sd = sealedDom.window.document;
  ok('G5 sealed flips lvp-done-mode', sd.documentElement.classList.contains('lvp-done-mode'));
  ok('G5 sealed does not gate', !sd.documentElement.classList.contains('lvp-gate-mode'));
  ok('G5 sealed msg', sd.querySelector('#lvp-done .lvp-done__msg').textContent === 'Your request is complete.');
  ok('G5 sealed sub', sd.querySelector('#lvp-done .lvp-done__sub').textContent === 'A signed copy has been emailed to you.');
  const partialDom = await boot(true, undefined);   // sealed field MISSING -> partial
  const pd = partialDom.window.document;
  ok('G5 partial flips lvp-done-mode', pd.documentElement.classList.contains('lvp-done-mode'));
  ok('G5 partial msg', pd.querySelector('#lvp-done .lvp-done__msg').textContent === 'Your part is complete.');
  ok('G5 partial sub', pd.querySelector('#lvp-done .lvp-done__sub').textContent === 'Once everything is completed and signed, you will receive signed copies by email.');
  const partialFalse = await boot(true, false);     // sealed:false explicit -> partial
  ok('G5 sealed:false partial msg', partialFalse.window.document.querySelector('#lvp-done .lvp-done__msg').textContent === 'Your part is complete.');
  const live = await boot(false, undefined);
  ok('G5 completed:false stays live', !live.window.document.documentElement.classList.contains('lvp-done-mode'));
  // index.html got the same two-state pick; assert its source carries both pairs.
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ok('G5 index.html partial msg present', idx.indexOf("dnMsg.textContent = 'Your part is complete.'") !== -1);
  ok('G5 index.html sealed gate is === true', idx.indexOf('cfg.sealed === true') !== -1);

  // G6: index.html BELT path (main-IIFE window.CAYMAN_CFG check, the path that
  // does not go through the config fetch) must also apply the two-state pick.
  // Boot the REAL index.html via the rig with an injected completed config.
  try {
    const { loadForm } = require('./rig.cjs');
    const sealedIdx = await loadForm({ cfg: { completed: true, sealed: true } });
    ok('G6 index belt sealed msg', sealedIdx.document.querySelector('#lvp-done .lvp-done__msg').textContent === 'Your request is complete.');
    ok('G6 index belt sealed mode', sealedIdx.document.documentElement.classList.contains('lvp-done-mode'));
    const partialIdx = await loadForm({ cfg: { completed: true } });   // sealed missing
    ok('G6 index belt partial msg', partialIdx.document.querySelector('#lvp-done .lvp-done__msg').textContent === 'Your part is complete.');
    ok('G6 index belt partial sub', partialIdx.document.querySelector('#lvp-done .lvp-done__sub').textContent === 'Once everything is completed and signed, you will receive signed copies by email.');
  } catch (e) {
    fail++; console.log('FAIL G6 rig boot: ' + e.message);
  }
})().then(() => {
  // Give the async IIFEs above a beat to settle before the verdict.
  setTimeout(() => {
    console.log(pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  }, 200);
});
