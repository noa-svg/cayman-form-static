// money-flow-fallback-harness.cjs (2026-08-08, agent/money-flow-juapi;
// REWRITTEN 2026-09-12, ju-cayman retirement gate 3 item 6) -
// flow.html's gateway wiring, driven through the REAL page under the jsdom
// rig (rig-flow.cjs). Used to cover a ju-api primary / GAS legacy fallback;
// that fallback was removed (Noa's explicit go, accepted without a live TTL
// confirmation that zero pre-flip money-flow tokens remain - see
// DECISIONS-PARKED.md). This file now locks the POST-removal shape: every
// token, regardless of what the primary answers, stays on ju-api - never a
// GAS probe, never a sessionStorage sticky flag.
//
//   G1  a token-unknown-shaped response from the primary (the exact shape
//       that used to trigger the legacy probe) must NOT trigger one now -
//       proves true removal, not merely "nobody happens to hit this path".
//   G2  a normal, well-formed primary response boots the real form, zero
//       legacy traffic, no sticky flag - the ordinary case.
//   G3  a primary 5xx / network error still never reaches legacy (this was
//       already true before the removal; still true after, for the same
//       reason - there is no fallback code path left to reach).
//   G4  render-verify (?mock=) stays a pure local stub, untouched by this
//       change - the ?mock= GAS pin is a dev tool, not a production path.
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
  // ---- G1: a token-unknown-shaped primary response - the exact old trigger ----
  {
    const rig = await loadFlowForm({
      token: 'WOULD-HAVE-BEEN-GAS-MINTED',
      configXhr(url) {
        if (url.indexOf(JU_API) === 0) return { status: 200, body: tokenUnknownCfg() };
        return { status: 200, body: makeFlowCfg({ flowType: 'cayman_increase' }) }; // legacy WOULD answer - must never be asked
      }
    });
    const cfgCalls = rig.xhrCalls.filter((c) => c.url.indexOf('api=config') !== -1);
    ok('G1 exactly one config call, to the primary', cfgCalls.length === 1 && cfgCalls[0].url.indexOf(JU_API) === 0,
      JSON.stringify(cfgCalls.map((c) => c.url)));
    ok('G1 zero legacy traffic, even on the exact old trigger shape',
      cfgCalls.filter((c) => LEGACY_RE.test(c.url)).length === 0, JSON.stringify(cfgCalls.map((c) => c.url)));
    ok('G1 no sessionStorage sticky flag written', Object.keys(rig.sessionStorageData).length === 0,
      JSON.stringify(rig.sessionStorageData));
    ok('G1 no jsdom-level script errors', rig.errors.length === 0, JSON.stringify(rig.errors));
  }

  // ---- G2: an ordinary ju-service-minted token -----------------------------
  {
    const rig = await loadFlowForm({
      token: 'JU-MINTED-1',
      configXhr(url) {
        if (url.indexOf(JU_API) === 0) return { status: 200, body: makeFlowCfg({ flowType: 'cayman_withdrawal' }) };
        return { status: 200, body: makeFlowCfg() }; // legacy WOULD also answer - must never be asked
      }
    });
    const cfgCalls = rig.xhrCalls.filter((c) => c.url.indexOf('api=config') !== -1);
    ok('G2 stays on the primary; zero legacy traffic',
      cfgCalls.length === 1 && cfgCalls[0].url.indexOf(JU_API) === 0, JSON.stringify(cfgCalls.map((c) => c.url)));
    ok('G2 boots the real form, no broken-link gate', !rig.document.getElementById('lvp-form').hasAttribute('hidden'));
    ok('G2 no sessionStorage sticky flag written', Object.keys(rig.sessionStorageData).length === 0,
      JSON.stringify(rig.sessionStorageData));
  }

  // ---- G3: primary hard-errors (5xx / network) -----------------------------
  {
    const rig = await loadFlowForm({
      token: 'PRIMARY-500',
      configXhr(url) {
        if (url.indexOf(JU_API) === 0) return { status: 500, body: tokenUnknownCfg() };
        return { status: 200, body: makeFlowCfg() }; // legacy WOULD answer fine - must never be asked
      }
    });
    const legacyCalls = rig.xhrCalls.filter((c) => c.url.indexOf('api=config') !== -1 && LEGACY_RE.test(c.url));
    ok('G3a a primary 5xx never reaches legacy, even with a token-unknown-shaped body',
      legacyCalls.length === 0, JSON.stringify(legacyCalls));
  }
  {
    const rig = await loadFlowForm({
      token: 'PRIMARY-NETERR',
      configXhr(url) {
        if (url.indexOf(JU_API) === 0) return { network: true };
        return { status: 200, body: makeFlowCfg() };
      }
    });
    const legacyCalls = rig.xhrCalls.filter((c) => c.url.indexOf('api=config') !== -1 && LEGACY_RE.test(c.url));
    ok('G3b a primary network error never reaches legacy', legacyCalls.length === 0,
      JSON.stringify(legacyCalls));
  }

  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS CRASH:', e); process.exit(1); });
