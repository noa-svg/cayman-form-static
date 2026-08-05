// pilot-fallback-harness.cjs - Phase 4 pilot flip (2026-08-05): in-flight-
// session legacy-gateway fallback on israel.html, driven through the REAL page
// under the jsdom rig (rig-israel.cjs + its configFetch per-host responder).
//
// The flip repointed israel.html's primary gateway to ju-service
// (ju-api.legacyvpartners.com). Sessions minted BEFORE the flip live on the
// old ju-cayman GAS /exec deployment; their emailed resume links carry tokens
// ju-service does not know. ju-service's ?api=config answers every token-
// verify failure with HTTP 200 and the well-formed config base envelope
// carrying flowType:'' (ju-service routes/config.ts) - never an {ok:false}
// error body - so the page detects "primary does not know this token" by that
// SPECIFIC envelope shape and probes the legacy gateway once, then sticks.
//
//   P1  old-token boot: primary answers the token-unknown envelope, legacy
//       recognizes the session -> page retries against legacy, boots the real
//       form (no gate), engages the sticky flag (in-memory CFG.gatewayUrl +
//       sessionStorage mirror), and the subsequent save_page POST goes to the
//       LEGACY gateway.
//   P2  fresh no-token session: never probes legacy - not on a token-unknown
//       shaped answer, not even when the primary hard-errors. ju-service only.
//   P3  primary failure with a token is NEVER a fallback trigger: HTTP 500
//       (even with a token-unknown-shaped body), a network error, and a
//       generic non-config JSON error body all keep legacy at zero calls and
//       land on the normal error path (broken-link gate / retry loop).
//   P4  new-token session (primary recognizes) stays sticky to primary: zero
//       legacy traffic, save_page POSTs to ju-api, no sessionStorage flag.
//
// Run: node test/pilot-fallback-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { loadIsraelForm, makeCfg, clickNext, currentPage, sleep } = require('./rig-israel.cjs');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}

// Extract BOTH gateway constants from the live page (no duplicated literals
// here: if either constant moves or is renamed, this harness fails loud
// instead of silently testing a stale copy).
const HTML = fs.readFileSync(path.join(__dirname, '..', 'israel.html'), 'utf8');
const mPrimary = HTML.match(/var gasUrl = '([^']+)';/);
const mLegacy = HTML.match(/var LEGACY_GATEWAY = '([^']+)';/);
if (!mPrimary || !mLegacy) {
  console.log('FAIL cannot extract gasUrl / LEGACY_GATEWAY constants from israel.html');
  process.exit(1);
}
const PRIMARY = mPrimary[1];
const LEGACY = mLegacy[1];
const isPrimary = (u) => String(u).indexOf(PRIMARY) === 0;
const isLegacy = (u) => String(u).indexOf(LEGACY) === 0;

// ju-service's real broken-token answer (routes/config.ts formConfig base cfg:
// HTTP 200, every base key present, flowType empty, no completed).
function tokenUnknownCfg(token) {
  return {
    gatewayUrl: '', token: token || '', serverBuild: 'srv-test', lane: '',
    flowType: '', countries: [], wire: null, brandLogoUrl: '', brandBgUrl: '',
    applicantType: '', isExistingLp: false, prefill: {}, resumePage: ''
  };
}
const http500 = (body) => Promise.resolve({
  ok: false, status: 500,
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(JSON.stringify(body))
});

async function P1_oldTokenFallsBackAndSticks() {
  const legacyCfg = makeCfg({}); // the OLD backend recognizes the session
  const rig = await loadIsraelForm({
    configFetch: (url, jsonResp) => {
      if (isPrimary(url)) return jsonResp(tokenUnknownCfg('TESTTOKEN'));
      if (isLegacy(url)) return jsonResp(legacyCfg);
      return null;
    }
  });
  const d = rig.document;
  ok('P1 boot probed primary first', rig.configCalls.length >= 1 && isPrimary(rig.configCalls[0]),
    JSON.stringify(rig.configCalls));
  ok('P1 then probed legacy exactly once', rig.configCalls.filter(isLegacy).length === 1,
    JSON.stringify(rig.configCalls));
  ok('P1 form boots (no broken-link gate)', !d.documentElement.classList.contains('lvp-gate-mode'));
  ok('P1 boots on welcome page', currentPage(d) === 'welcome', currentPage(d));
  ok('P1 sticky in-memory: CFG.gatewayUrl is the legacy gateway',
    rig.window.ISRAEL_CFG.gatewayUrl === LEGACY, rig.window.ISRAEL_CFG.gatewayUrl);
  ok('P1 sticky sessionStorage flag set for this token',
    rig.window.sessionStorage.getItem('lvp_il_legacy_gw_v1_TESTTOKEN') === '1');
  // Subsequent call: welcome -> next fires the save_page autosave.
  await clickNext(d);
  await sleep(50);
  const saves = rig.gatewayCalls.filter((c) => c.body && c.body.action === 'save_page');
  ok('P1 subsequent save_page POST goes to the LEGACY gateway',
    saves.length >= 1 && saves.every((c) => isLegacy(c.url)),
    JSON.stringify(saves.map((c) => c.url)));
  ok('P1 zero POSTs ever hit the primary', rig.gatewayCalls.every((c) => !isPrimary(c.url)),
    JSON.stringify(rig.gatewayCalls.map((c) => c.url)));
}

async function P2_freshNoTokenNeverFallsBack() {
  // B1: primary answers the no-flow base envelope (the normal tokenless case).
  let rig = await loadIsraelForm({
    cfg: { token: '', flowType: '', lane: '', completed: false, resumePage: '' },
    configFetch: (url, jsonResp) => (isPrimary(url) ? jsonResp(tokenUnknownCfg('')) : null)
  });
  ok('P2 tokenless boot: zero legacy config calls', rig.configCalls.filter(isLegacy).length === 0,
    JSON.stringify(rig.configCalls));
  ok('P2 tokenless boot: gate shows (normal broken-link path)',
    rig.document.documentElement.classList.contains('lvp-gate-mode'));
  ok('P2 tokenless boot: gatewayUrl stays primary',
    rig.window.ISRAEL_CFG.gatewayUrl === PRIMARY, rig.window.ISRAEL_CFG.gatewayUrl);
  // B2: primary hard-errors (network reject) - still zero legacy traffic.
  rig = await loadIsraelForm({
    cfg: { token: '' },
    configFetch: (url) => (isPrimary(url) ? Promise.reject(new TypeError('network down')) : null)
  });
  ok('P2 tokenless + primary network error: zero legacy config calls',
    rig.configCalls.filter(isLegacy).length === 0, JSON.stringify(rig.configCalls));
  ok('P2 tokenless + primary network error: primary was attempted',
    rig.configCalls.filter(isPrimary).length >= 1, JSON.stringify(rig.configCalls));
}

async function P3_primaryFailureNeverReroutes() {
  // C1: HTTP 500 whose body even LOOKS like the token-unknown envelope. The
  // outage case: must NOT reroute (httpOk gate), must land on the normal
  // error path.
  let rig = await loadIsraelForm({
    configFetch: (url) => (isPrimary(url) ? http500(tokenUnknownCfg('TESTTOKEN')) : null)
  });
  ok('P3 primary 500 (token-unknown-shaped body): zero legacy calls',
    rig.configCalls.filter(isLegacy).length === 0, JSON.stringify(rig.configCalls));
  ok('P3 primary 500: normal error path (broken-link gate) shows',
    rig.document.documentElement.classList.contains('lvp-gate-mode'));
  ok('P3 primary 500: no sticky flag written',
    rig.window.sessionStorage.getItem('lvp_il_legacy_gw_v1_TESTTOKEN') === null);
  // C2: network reject with a token present - retry loop, never legacy.
  rig = await loadIsraelForm({
    configFetch: (url) => (isPrimary(url) ? Promise.reject(new TypeError('network down')) : null)
  });
  ok('P3 primary network error with token: zero legacy calls',
    rig.configCalls.filter(isLegacy).length === 0, JSON.stringify(rig.configCalls));
  ok('P3 primary network error: gatewayUrl stays primary',
    rig.window.ISRAEL_CFG.gatewayUrl === PRIMARY, rig.window.ISRAEL_CFG.gatewayUrl);
  // C3: HTTP 200 but a generic non-config JSON error body (e.g. a proxy's
  // {ok:false} envelope). No flowType/resumePage keys -> shape gate holds.
  rig = await loadIsraelForm({
    configFetch: (url, jsonResp) => (isPrimary(url) ? jsonResp({ ok: false, error: 'unknown route' }) : null)
  });
  ok('P3 generic JSON error body: zero legacy calls',
    rig.configCalls.filter(isLegacy).length === 0, JSON.stringify(rig.configCalls));
  ok('P3 generic JSON error body: normal error path (broken-link gate) shows',
    rig.document.documentElement.classList.contains('lvp-gate-mode'));
}

async function P4_newTokenSticksToPrimary() {
  const rig = await loadIsraelForm({}); // default: primary recognizes the token
  const d = rig.document;
  ok('P4 zero legacy config calls', rig.configCalls.filter(isLegacy).length === 0,
    JSON.stringify(rig.configCalls));
  ok('P4 form boots (no gate)', !d.documentElement.classList.contains('lvp-gate-mode'));
  ok('P4 CFG.gatewayUrl stays primary', rig.window.ISRAEL_CFG.gatewayUrl === PRIMARY,
    rig.window.ISRAEL_CFG.gatewayUrl);
  ok('P4 no sticky flag written',
    rig.window.sessionStorage.getItem('lvp_il_legacy_gw_v1_TESTTOKEN') === null);
  await clickNext(d);
  await sleep(50);
  const saves = rig.gatewayCalls.filter((c) => c.body && c.body.action === 'save_page');
  ok('P4 save_page POST goes to the PRIMARY gateway',
    saves.length >= 1 && saves.every((c) => isPrimary(c.url)),
    JSON.stringify(saves.map((c) => c.url)));
  ok('P4 zero POSTs ever hit legacy', rig.gatewayCalls.every((c) => !isLegacy(c.url)),
    JSON.stringify(rig.gatewayCalls.map((c) => c.url)));
}

(async () => {
  await P1_oldTokenFallsBackAndSticks();
  await P2_freshNoTokenNeverFallsBack();
  await P3_primaryFailureNeverReroutes();
  await P4_newTokenSticksToPrimary();
  console.log('\n' + (fail ? 'PILOT-FALLBACK FAILED: ' : 'PILOT-FALLBACK PASSED: ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness crashed:', e); process.exit(1); });
