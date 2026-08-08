// mint-pick-binding-harness.cjs (2026-08-08).
//
// Regression lock for the 2026-08-08 live incident: a board-search "Start
// onboarding" pick of an explicit Monday contact reached the mint WITHOUT its
// Monday item id (this client dropped it at the pick() autofill), so the
// server's find-by-email dedup silently REBOUND the process to a different
// real People item that happened to hold the typed investor email, and
// completion synced the test submission's data onto that unrelated real row.
//
// What this proves, against the REAL extracted code (never a hand copy):
//   1. pick() (the shared __onbPick autofill both the pending-submission
//      picker and the board-search onboarding shortcut funnel through) stores
//      the picked itemId + email on window.__onbPickItemId/__onbPickEmail.
//   2. clearPick() drops the binding with the chip.
//   3. openOnboarding() resets any stale binding before handing over, so a
//      blank "add as a new contact" start can never inherit an earlier pick.
//   4. The mint request builder sends &mondayItemId= ONLY while the typed
//      email still equals the picked record's email (an operator who re-typed
//      a different address is no longer minting the picked identity), for
//      BOTH engines (the juApiFetch and apiFetch arms share one URL string).
//
// Run: node test/mint-pick-binding-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }

// ---- extract the onboarding-picker IIFE (brace-counting, real code) -------
function extractIife(anchor) {
  const start = html.indexOf(anchor);
  if (start < 0) throw new Error('IIFE anchor not found (boot contract changed): ' + anchor.slice(0, 60));
  let i = html.indexOf('{', start), depth = 0, end = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const closeParen = html.indexOf('()', end);
  return html.slice(start, closeParen + 2);
}
const pickerSrc = extractIife("(function(){\n    var loadBtn=document.getElementById('onbLoadBtn')");
if (pickerSrc.indexOf('window.__onbPick=pick') === -1) throw new Error('extracted block is not the onboarding picker (boot contract changed)');

(async () => {
  // 1 + 2: pick() stores the binding; clearPick() drops it.
  {
    const dom = new JSDOM('<!doctype html><body><button id="onbLoadBtn"></button><div id="onbResults" hidden></div><div id="onbPicked" hidden></div><span id="onbStatus"></span><input id="name"><input id="nameHebrew"><input id="nickname"><input id="email"></body>');
    const document = dom.window.document;
    const window_ = {};
    function esc2(s) { return String(s == null ? '' : s); }
    function apiFetch() { return Promise.resolve({ ok: true, submissions: [] }); }
    const fn = new dom.window.Function('document', 'window', 'apiFetch', 'esc2', pickerSrc);
    fn(document, window_, apiFetch, esc2);
    ok('picker exposes __onbPick', typeof window_.__onbPick === 'function');
    window_.__onbPick({ itemId: '3052718037', nameEn: 'Omry Segal', nameHe: '', nickname: '', email: 'Pick.Ed@Example.com' });
    ok('pick() stores the picked Monday item id', window_.__onbPickItemId === '3052718037', window_.__onbPickItemId);
    ok('pick() stores the picked email normalized (trim+lowercase)', window_.__onbPickEmail === 'pick.ed@example.com', window_.__onbPickEmail);
    ok('pick() autofills the email field as before', document.getElementById('email').value === 'Pick.Ed@Example.com');
    // clearPick is internal; the chip's X (id=onbClear) is its only real caller.
    const x = document.getElementById('onbClear');
    ok('pick() renders the clear chip', !!x);
    x.click();
    ok('clearPick() drops the item-id binding', window_.__onbPickItemId === '');
    ok('clearPick() drops the email binding', window_.__onbPickEmail === '');
  }

  // 3: openOnboarding resets stale bindings at the source (static, on the real
  // function body - openOnboarding lives inside the huge board-search IIFE and
  // needs the whole pipeline booted to drive live, so the reset is asserted on
  // the extracted source instead).
  {
    const fnStart = html.indexOf('function openOnboarding(e,prefill){');
    ok('openOnboarding exists', fnStart > -1);
    const body = html.slice(fnStart, html.indexOf('window.__pendingOnboardingPick', fnStart));
    ok('openOnboarding resets __onbPickItemId/__onbPickEmail BEFORE storing the new pending pick',
      /window\.__onbPickItemId='';\s*window\.__onbPickEmail='';/.test(body), body.slice(-200));
  }

  // 4: the mint request builder carries the pick, guarded by email equality,
  // on the ONE URL string both engines share.
  {
    const mintIdx = html.indexOf("var mintViaJu=(state.lane==='israel');");
    ok('mint branch point exists', mintIdx > -1);
    const mintBlock = html.slice(mintIdx - 1200, html.indexOf('.then(function(res){', mintIdx));
    ok('the mint computes onbPickedId gated on email equality with the picked record',
      /var onbPickedId=\(window\.__onbPickItemId&&window\.__onbPickEmail&&email\.trim\(\)\.toLowerCase\(\)===window\.__onbPickEmail\)\?window\.__onbPickItemId:''/.test(mintBlock));
    ok('the shared mint URL sends &mondayItemId= when a valid pick is bound',
      mintBlock.indexOf("(onbPickedId?'&mondayItemId='+encodeURIComponent(onbPickedId):'')") > -1);
    ok('the pick rides the SHARED URL string (one build for juApiFetch AND apiFetch, no per-engine drift)',
      /\(mintViaJu\?juApiFetch:apiFetch\)\('\?admin=mintLink/.test(mintBlock));
  }

  // caymanClearCreateForm drops the binding after a completed mint (static).
  {
    const cIdx = html.indexOf('function caymanClearCreateForm(){');
    ok('caymanClearCreateForm exists', cIdx > -1);
    const cBody = html.slice(cIdx, cIdx + 600);
    ok('caymanClearCreateForm drops the pick binding', /window\.__onbPickItemId='';\s*window\.__onbPickEmail='';/.test(cBody));
  }

  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
