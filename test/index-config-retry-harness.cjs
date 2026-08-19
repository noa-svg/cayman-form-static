// index-config-retry-harness.cjs (2026-08-02, /cto-review follow-up pass).
//
// Proves index.html's ?api=config bootstrap now silently retries on
// failure instead of leaving the LP with no config, no error, and a form
// that only fails opaquely at submit. Ported from israel.html's
// fetchCfg(attempt) (already proven in production); index.html was the one
// LP-facing form without this, confirmed by a fresh CTO review of the
// already-shipped state.
//
// Extracts the REAL fetchCfg source (brace-counting) and drives it with a
// controllable fetch stub, same pattern as signer-config-retry-harness.cjs
// (that one drives XMLHttpRequest; this one drives fetch, since index.html
// uses fetch for its config bootstrap).
//
// Run: node test/index-config-retry-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }

function extractFn(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}
// fetchCfg now calls out to sibling functions (the 2026-08-19 JU_API gateway
// seam - primary+fallback, same pattern israel.html already carries), so all
// of them have to be extracted and put in scope together, not just fetchCfg
// alone. useLegacyGateway/gasOverridden are declared locally (not injected)
// since this file tests retry/backoff behavior, not the fallback probe path
// itself - the probe path is exercised by coupling-check.cjs C1s and by
// rig.cjs booting the real page end to end.
const fetchCfgSrc = [
  'var useLegacyGateway = false;', 'var gasOverridden = false;',
  extractFn('cfgUrlFor_'), extractFn('handleCfgLoaded_'), extractFn('cfgTokenUnknown_'),
  extractFn('activeGatewayUrl_'), extractFn('probeLegacyGateway_'), extractFn('fetchCfg'),
].join('\n');
if (fetchCfgSrc.indexOf('attempt < 3') === -1) throw new Error('fetchCfg no longer retries up to 3 attempts - fix regressed');

// Controllable fetch: each call either resolves with a json() promise or
// rejects, per a scripted queue, so the test can prove attempt-by-attempt
// behavior deterministically.
function makeFetch(behaviors) {
  let call = 0;
  const calls = [];
  return {
    fetch: function (url) {
      calls.push(url);
      const b = behaviors[Math.min(call, behaviors.length - 1)];
      call++;
      if (b === 'reject') return Promise.reject(new Error('network error'));
      return Promise.resolve({ json: () => Promise.resolve(b) });
    },
    calls,
  };
}

function build(behaviors, timers) {
  const document = {
    body: {},
    documentElement: { classList: { added: [], add: function (c) { this.added.push(c); } } },
    querySelector: () => null,
  };
  const { fetch, calls } = makeFetch(behaviors);
  const window = { console: { warn: () => {} } };
  const scheduled = [];
  const setTimeoutStub = (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; };
  const factory = new Function(
    'fetch', 'window', 'document', 'setTimeout', 'p', 'fixtureParam', 'screenshotMode', 'cacheKey',
    'idxToken', 'gasUrl', 'LEGACY_GATEWAY',
    'applyCfgVisuals', 'markDoneIfCompleted',
    fetchCfgSrc + '; return fetchCfg;'
  );
  const fetchCfg = factory(
    fetch, window, document, setTimeoutStub,
    { get: () => '' }, '', '', 'k',
    'test-token', 'https://example.invalid/exec', 'https://example-legacy.invalid/exec',
    () => {}, () => {}
  );
  return { fetchCfg, calls, scheduled, document, window };
}

// 1. First attempt succeeds: no retry scheduled, config applied.
(async () => {
  const { fetchCfg, calls, scheduled } = build([{ flowType: 'x', completed: false }]);
  fetchCfg(1);
  await new Promise((r) => setTimeout(r, 20));
  ok('a successful first attempt makes exactly one fetch call', calls.length === 1);
  ok('a successful first attempt schedules no retry', scheduled.length === 0);
})();

// 2. First attempt fails, second succeeds: retries once, then stops.
(async () => {
  const { fetchCfg, calls, scheduled } = build(['reject', { flowType: 'x', completed: false }]);
  fetchCfg(1);
  await new Promise((r) => setTimeout(r, 20));
  ok('a failed first attempt schedules a retry', scheduled.length === 1 && scheduled[0].ms === 2500 * 1, scheduled);
  scheduled[0].fn();
  await new Promise((r) => setTimeout(r, 20));
  ok('the retry makes a second fetch call', calls.length === 2);
  ok('no further retry is scheduled once the retry succeeds', scheduled.length === 1);
})();

// 3. All 3 attempts fail: gate mode is added once retries are exhausted.
(async () => {
  const { fetchCfg, calls, scheduled, document } = build(['reject', 'reject', 'reject']);
  fetchCfg(1);
  await new Promise((r) => setTimeout(r, 20));
  ok('attempt 1 fails and schedules a retry', scheduled.length === 1);
  scheduled[0].fn();
  await new Promise((r) => setTimeout(r, 20));
  ok('attempt 2 fails and schedules a second retry', scheduled.length === 2);
  scheduled[1].fn();
  await new Promise((r) => setTimeout(r, 20));
  ok('exactly 3 fetch attempts were made total', calls.length === 3);
  ok('no 4th retry is scheduled (retries are capped)', scheduled.length === 2);
  ok('gate mode is added once retries are exhausted with nothing ever applied', document.documentElement.classList.added.indexOf('lvp-gate-mode') !== -1);
})();

setTimeout(() => {
  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
}, 150);
