// pilot-fallback-harness.cjs - the israel.html legacy-gateway fallback this
// file used to test was REMOVED 2026-09-06 (a live LP-routing bug: a stale
// pre-2026-08-05 link could still be probed against the retired, Drive-
// trashed ju-cayman GAS project - a dead backend with every recovery trigger
// also permanently suspended, so a real LP session that fell back there was
// silently stranded rather than recovered. See DECISIONS-PARKED.md
// 2026-09-06 for the full incident and why removal, not a token, was the
// fix). This file now proves the removal is real and behaves correctly:
// ju-service is the ONLY host israel.html ever calls, in every shape a
// "primary does not recognize this token" response can take.
//
//   R1  a token-unknown envelope (ju-service's real answer for a bad/expired/
//       stale/pre-flip token: HTTP 200, well-formed config base, flowType
//       empty, not completed) lands on the broken-link gate directly - no
//       second host is ever contacted.
//   R2  fresh no-token session: same single-host behaviour, unchanged.
//   R3  primary HTTP failure / network error: same single-host behaviour,
//       normal retry-then-gate path, never a second host.
//   R4  a real, known token boots the form normally, single host throughout,
//       including the subsequent save_page POST.
//   R5  israel.html carries no trace of the removed mechanism (drift guard -
//       a regression here should fail loud, not silently resurrect the bug).
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

const HTML = fs.readFileSync(path.join(__dirname, '..', 'israel.html'), 'utf8');
const mPrimary = HTML.match(/var gasUrl = '([^']+)';/);
if (!mPrimary) {
  console.log('FAIL cannot extract gasUrl constant from israel.html');
  process.exit(1);
}
const PRIMARY = mPrimary[1];
const isPrimary = (u) => String(u).indexOf(PRIMARY) === 0;

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

async function R1_tokenUnknownGatesDirectly() {
  const rig = await loadIsraelForm({
    configFetch: (url, jsonResp) => (isPrimary(url) ? jsonResp(tokenUnknownCfg('OLDTOKEN')) : null)
  });
  ok('R1 exactly one config call, to the primary', rig.configCalls.length === 1 && isPrimary(rig.configCalls[0]),
    JSON.stringify(rig.configCalls));
  ok('R1 broken-link gate shows', rig.document.documentElement.classList.contains('lvp-gate-mode'));
  ok('R1 CFG.gatewayUrl stays primary', rig.window.ISRAEL_CFG.gatewayUrl === PRIMARY,
    rig.window.ISRAEL_CFG.gatewayUrl);
  ok('R1 no sessionStorage stickiness key of any shape was written',
    Object.keys(rig.window.sessionStorage).every((k) => k.indexOf('legacy_gw') === -1));
}

async function R2_freshNoToken() {
  let rig = await loadIsraelForm({
    cfg: { token: '', flowType: '', lane: '', completed: false, resumePage: '' },
    configFetch: (url, jsonResp) => (isPrimary(url) ? jsonResp(tokenUnknownCfg('')) : null)
  });
  ok('R2 tokenless boot: exactly one config call, to the primary',
    rig.configCalls.length === 1 && isPrimary(rig.configCalls[0]), JSON.stringify(rig.configCalls));
  ok('R2 tokenless boot: gate shows', rig.document.documentElement.classList.contains('lvp-gate-mode'));

  rig = await loadIsraelForm({
    cfg: { token: '' },
    configFetch: (url) => (isPrimary(url) ? Promise.reject(new TypeError('network down')) : null)
  });
  ok('R2 tokenless + network error: primary was the only host attempted',
    rig.configCalls.every(isPrimary) && rig.configCalls.length >= 1, JSON.stringify(rig.configCalls));
}

async function R3_primaryFailureStaysSingleHost() {
  let rig = await loadIsraelForm({
    configFetch: (url) => (isPrimary(url) ? http500(tokenUnknownCfg('TESTTOKEN')) : null)
  });
  ok('R3 primary 500: only the primary was ever called',
    rig.configCalls.every(isPrimary), JSON.stringify(rig.configCalls));
  ok('R3 primary 500: normal error path (broken-link gate) shows',
    rig.document.documentElement.classList.contains('lvp-gate-mode'));

  rig = await loadIsraelForm({
    configFetch: (url) => (isPrimary(url) ? Promise.reject(new TypeError('network down')) : null)
  });
  ok('R3 primary network error: only the primary was ever called',
    rig.configCalls.every(isPrimary), JSON.stringify(rig.configCalls));
  ok('R3 primary network error: gatewayUrl stays primary',
    rig.window.ISRAEL_CFG.gatewayUrl === PRIMARY, rig.window.ISRAEL_CFG.gatewayUrl);

  rig = await loadIsraelForm({
    configFetch: (url, jsonResp) => (isPrimary(url) ? jsonResp({ ok: false, error: 'unknown route' }) : null)
  });
  ok('R3 generic JSON error body: only the primary was ever called',
    rig.configCalls.every(isPrimary), JSON.stringify(rig.configCalls));
  ok('R3 generic JSON error body: normal error path (broken-link gate) shows',
    rig.document.documentElement.classList.contains('lvp-gate-mode'));
}

async function R4_realTokenBootsNormally() {
  const rig = await loadIsraelForm({}); // default: primary recognizes the token
  const d = rig.document;
  ok('R4 exactly one config call, to the primary',
    rig.configCalls.length === 1 && isPrimary(rig.configCalls[0]), JSON.stringify(rig.configCalls));
  ok('R4 form boots (no gate)', !d.documentElement.classList.contains('lvp-gate-mode'));
  ok('R4 CFG.gatewayUrl is the primary', rig.window.ISRAEL_CFG.gatewayUrl === PRIMARY,
    rig.window.ISRAEL_CFG.gatewayUrl);
  await clickNext(d);
  await sleep(50);
  const saves = rig.gatewayCalls.filter((c) => c.body && c.body.action === 'save_page');
  ok('R4 save_page POST goes to the primary gateway',
    saves.length >= 1 && saves.every((c) => isPrimary(c.url)),
    JSON.stringify(saves.map((c) => c.url)));
  ok('R4 every gateway call in the session hit the primary, none other',
    rig.gatewayCalls.every((c) => isPrimary(c.url)),
    JSON.stringify(rig.gatewayCalls.map((c) => c.url)));
}

function R5_noLeftoverLegacyPlumbing() {
  ok('R5 israel.html carries no LEGACY_GATEWAY / useLegacyGateway / probeLegacyGateway_ / cfgTokenUnknown_ / stickToLegacyGateway_',
    !/LEGACY_GATEWAY|useLegacyGateway|activeGatewayUrl_|probeLegacyGateway_|cfgTokenUnknown_|stickToLegacyGateway_/.test(HTML));
}

(async () => {
  await R1_tokenUnknownGatesDirectly();
  await R2_freshNoToken();
  await R3_primaryFailureStaysSingleHost();
  await R4_realTokenBootsNormally();
  R5_noLeftoverLegacyPlumbing();
  console.log('\n' + (fail ? 'PILOT-FALLBACK FAILED: ' : 'PILOT-FALLBACK PASSED: ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness crashed:', e); process.exit(1); });
