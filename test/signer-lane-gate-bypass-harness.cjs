// signer-lane-gate-bypass-harness.cjs (2026-08-02, /cto-review follow-up pass).
//
// Proves signer.html's pre-fetch applyLang('he', true) call actually shows
// Hebrew during the unresolved-lane loading window, instead of being
// silently forced to English by the lane gate. Before this fix, LANE was
// always '' at the moment the pre-fetch call ran (it only ever sets from
// setLaneFromCtx_ once the server response lands), so
// applyLang('he')'s own gate (Hebrew only when LANE==='israeli') downgraded
// it to English every time - defeating the whole reason that call exists
// (avoid an English loading screen during a ~20s GAS cold start for an
// Israeli signer).
//
// Extracts the REAL applyLang/laneIsHebrew_/setLaneFromCtx_ from the live
// file (brace-counting) and drives them against a minimal DOM stub.
//
// Run: node test/signer-lane-gate-bypass-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'signer.html'), 'utf8');

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
// Confirm the actual pre-fetch call site still passes the bypass flag -
// this is the concrete regression guard, not just the function's own logic.
if (html.indexOf("applyLang('he', true);") === -1) {
  throw new Error('pre-fetch applyLang(\'he\', true) call site not found - fix regressed');
}

const src = "var LANE = '';" + extractFn('laneIsHebrew_') + ';' + extractFn('setLaneFromCtx_') + ';' + extractFn('applyLang') + ';';

function makeEnv() {
  const els = []; // fake document.querySelectorAll results, always empty - only dir/lang/curLang matter here
  const documentElement = { dir: '', lang: '' };
  const document = {
    documentElement: documentElement,
    querySelectorAll: () => [],
  };
  const factory = new Function(
    'document', 'HE_MAP',
    src + '; return { applyLang: applyLang, setLaneFromCtx_: setLaneFromCtx_, getCurLang: function () { return curLang; } };'
  );
  const api = factory(document, {});
  return { api, documentElement };
}

// 1. Before the lane resolves (fresh boot, matching the real pre-fetch
//    moment), the bypass call actually shows Hebrew.
(function () {
  const { api, documentElement } = makeEnv();
  api.applyLang('he', true);
  ok('pre-fetch bypass call sets Hebrew even though LANE is unresolved', api.getCurLang() === 'he');
  ok('pre-fetch bypass call sets dir=rtl', documentElement.dir === 'rtl');
})();

// 2. Without the bypass, the SAME unresolved-lane state still correctly
//    forces English (the gate itself is unchanged for every other caller).
(function () {
  const { api, documentElement } = makeEnv();
  api.applyLang('he');
  ok('a non-bypass call with unresolved LANE still forces English (gate intact)', api.getCurLang() === 'en');
  ok('a non-bypass call with unresolved LANE sets dir=ltr', documentElement.dir === 'ltr');
})();

// 3. Once the lane resolves to Cayman, a later non-bypass call correctly
//    stays English even if Hebrew was requested (matches the real
//    renderSignerForm flow: setLaneFromCtx_ then applyLang('he')).
(function () {
  const { api } = makeEnv();
  api.applyLang('he', true); // pre-fetch guess
  api.setLaneFromCtx_({ lane: 'cayman' });
  api.applyLang('he'); // renderSignerForm's real call, no bypass
  ok('once LANE resolves to cayman, Hebrew is correctly refused (no lingering bypass leak)', api.getCurLang() === 'en');
})();

// 4. Once the lane resolves to israeli, Hebrew is honored normally (no
//    bypass needed or used).
(function () {
  const { api } = makeEnv();
  api.applyLang('he', true); // pre-fetch guess
  api.setLaneFromCtx_({ lane: 'israeli' });
  api.applyLang('he');
  ok('once LANE resolves to israeli, Hebrew is correctly honored', api.getCurLang() === 'he');
})();

console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
