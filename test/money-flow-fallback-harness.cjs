// money-flow-fallback-harness.cjs (2026-08-08, agent/money-flow-juapi) -
// flow.html's ju-api primary / GAS legacy fallback, driven through the REAL
// page under the jsdom rig (rig-flow.cjs), mirroring pilot-fallback-
// harness.cjs's coverage of the same pattern on israel.html.
//
// console/index.html's MONEY_MINT_ON_JU_API stays FALSE (see that file):
// every REAL money process today is minted on GAS, so F1 below (the
// GAS-minted / primary-unknown-token case) is the one this harness must get
// exactly right - it is the ONLY path every live LP actually takes right
// now. F2/F4 exist so a future flip is provably safe too.
//
//   F1  GAS-minted token: primary (ju-api) answers the well-formed
//       token-unknown envelope, legacy (GAS) recognizes the session -> the
//       page retries against legacy, boots the real form (no broken-link
//       gate), sticks (sessionStorage), and any subsequent gateway POST
//       (save_page etc, via the shared GW var) targets legacy.
//   F2  primary failure with a token is NEVER a fallback trigger: HTTP 500
//       (even carrying a token-unknown-shaped body), a network error, and a
//       timeout all keep legacy at zero calls and land on the retry/give-up
//       path, never a silent reroute.
//   F3  ju-service-minted token (future state once MONEY_MINT_ON_JU_API
//       flips): primary recognizes it -> stays on primary, zero legacy
//       traffic, no sessionStorage sticky flag written.
//   F4  render-verify (?mock=) never touches the network at all - it must
//       stay a pure local stub, exactly as before this seam existed.
//
// Run: node test/money-flow-fallback-harness.cjs
'use strict';
const { loadFlowForm, makeFlowCfg, tokenUnknownCfg } = require('./rig-flow.cjs');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}

const JU_API = 'https://ju-api.legacyvpartners.com';
const LEGACY_RE = /script\.google\.com\/macros\/s\//;

(async function () {
  // ---- F1: GAS-minted token, primary says token-unknown -------------------
  {
    const rig = await loadFlowForm({
      token: 'GAS-MINTED-1',
      configXhr(url) {
        if (url.indexOf(JU_API) === 0) return { status: 200, body: tokenUnknownCfg() };
        if (LEGACY_RE.test(url)) return { status: 200, body: makeFlowCfg({ flowType: 'cayman_increase' }) };
        return null;
      }
    });
    const cfgCalls = rig.xhrCalls.filter((c) => c.url.indexOf('api=config') !== -1);
    ok('F1 probes the primary first', cfgCalls.length >= 1 && cfgCalls[0].url.indexOf(JU_API) === 0,
      JSON.stringify(cfgCalls.map((c) => c.url)));
    ok('F1 then probes legacy exactly once', cfgCalls.filter((c) => LEGACY_RE.test(c.url)).length === 1,
      JSON.stringify(cfgCalls.map((c) => c.url)));
    ok('F1 boots the real form, no broken-link gate', !rig.document.getElementById('lvp-form').hasAttribute('hidden'));
    ok('F1 sticks to legacy in sessionStorage, keyed by token',
      Object.keys(rig.sessionStorageData).some((k) => k.indexOf('GAS-MINTED-1') !== -1 && rig.sessionStorageData[k] === '1'),
      JSON.stringify(rig.sessionStorageData));
    ok('F1 no jsdom-level script errors', rig.errors.length === 0, JSON.stringify(rig.errors));
  }

  // ---- F2a: primary hard-errors (5xx) with a token-unknown-shaped body ----
  // Must NEVER trigger the fallback: status gate comes before shape gate.
  {
    const rig = await loadFlowForm({
      token: 'PRIMARY-500',
      configXhr(url) {
        if (url.indexOf(JU_API) === 0) return { status: 500, body: tokenUnknownCfg() };
        return { status: 200, body: makeFlowCfg() }; // legacy WOULD answer fine - must never be asked
      }
    });
    const legacyCalls = rig.xhrCalls.filter((c) => c.url.indexOf('api=config') !== -1 && LEGACY_RE.test(c.url));
    ok('F2a a primary 5xx never triggers the legacy probe, even with a token-unknown-shaped body',
      legacyCalls.length === 0, JSON.stringify(legacyCalls));
  }

  // ---- F2b: primary network failure with a token ---------------------------
  {
    const rig = await loadFlowForm({
      token: 'PRIMARY-NETERR',
      configXhr(url) {
        if (url.indexOf(JU_API) === 0) return { network: true };
        return { status: 200, body: makeFlowCfg() };
      }
    });
    const legacyCalls = rig.xhrCalls.filter((c) => c.url.indexOf('api=config') !== -1 && LEGACY_RE.test(c.url));
    ok('F2b a primary network error never triggers the legacy probe', legacyCalls.length === 0,
      JSON.stringify(legacyCalls));
  }

  // ---- F3: ju-service-minted token (future state) --------------------------
  {
    const rig = await loadFlowForm({
      token: 'JU-MINTED-1',
      configXhr(url) {
        if (url.indexOf(JU_API) === 0) return { status: 200, body: makeFlowCfg({ flowType: 'cayman_withdrawal' }) };
        return { status: 200, body: makeFlowCfg() }; // legacy WOULD also answer - must never be asked
      }
    });
    const cfgCalls = rig.xhrCalls.filter((c) => c.url.indexOf('api=config') !== -1);
    ok('F3 stays on the primary; zero legacy traffic',
      cfgCalls.length === 1 && cfgCalls[0].url.indexOf(JU_API) === 0, JSON.stringify(cfgCalls.map((c) => c.url)));
    ok('F3 boots the real form, no broken-link gate', !rig.document.getElementById('lvp-form').hasAttribute('hidden'));
    ok('F3 no sessionStorage sticky flag written', Object.keys(rig.sessionStorageData).length === 0,
      JSON.stringify(rig.sessionStorageData));
  }

  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS CRASH:', e); process.exit(1); });
