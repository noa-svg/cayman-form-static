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

  // 4: the email-equality gate, driven LIVE on the real console.
  //
  // REPAIRED 2026-09-07. Four assertions used to pin to the literal string
  // `var pickedId=(window.__onbPickItemId&&window.__onbPickEmail`, refactored
  // into onbPickedItemId_ (console/index.html:6922). indexOf returned -1,
  // slice(-1, ...) produced garbage, and all four failed while the protections
  // they name were intact. Same failure mode that killed
  // api-fetch-nonjson-harness: pinned to a spelling, reporting on a copy nobody
  // ships. Now DRIVEN instead of matched.
  {
    const dom = new JSDOM(html, {
      url: 'http://localhost:8000/console/', runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse(w) { w.fetch = function () { return Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":true}') }); }; },
    });
    await new Promise((r) => setTimeout(r, 300));
    const w = dom.window;
    ok('the mint reads its pick through onbPickedItemId_', typeof w.onbPickedItemId_ === 'function');
    w.__onbPickItemId = '3052718037';
    w.__onbPickEmail = 'pick.ed@example.com';
    ok('a matching email binds the picked Monday item id',
      w.onbPickedItemId_('pick.ed@example.com') === '3052718037', w.onbPickedItemId_('pick.ed@example.com'));
    ok('the match ignores case and surrounding space, as the pick stored it',
      w.onbPickedItemId_('  Pick.Ed@Example.COM ') === '3052718037', w.onbPickedItemId_('  Pick.Ed@Example.COM '));
    ok('an operator who RE-TYPED a different email no longer mints the picked identity',
      w.onbPickedItemId_('someone.else@example.com') === '', w.onbPickedItemId_('someone.else@example.com'));
    ok('an empty typed email does not inherit the pick',
      w.onbPickedItemId_('') === '', w.onbPickedItemId_(''));
    w.__onbPickItemId = '';
    w.__onbPickEmail = '';
    ok('with no pick bound, nothing is sent even on the same email',
      w.onbPickedItemId_('pick.ed@example.com') === '', w.onbPickedItemId_('pick.ed@example.com'));
    dom.window.close();
  }

  // 5: the ONBOARDING mint call site carries that id and names its engine.
  // Static, because this is a wiring fact about one line and driving the mint
  // UI to see it would test the UI instead. Anchored on the ROUTE plus its
  // first parameter, which cannot change without changing the server.
  //
  // ?admin=mintLink has TWO call sites; only this one binds a pick. The money
  // lane mints at console/index.html:8986 through moneyMintBaseForLane_ and has
  // no pick. The 2026-08-08 anchor did not distinguish them and a plain indexOf
  // now lands on the money mint, so the count is asserted too.
  {
    const ONB = "apiFetch('?admin=mintLink&type=";
    const mintIdx = html.indexOf(ONB);
    ok('the onboarding mint call site exists', mintIdx > -1);
    ok('there is exactly ONE onboarding mint call site', html.split(ONB).length - 1 === 1,
      html.split(ONB).length - 1);
    ok('exactly one call site in the file binds a pick at all',
      html.split("(pickedId?'&mondayItemId='").length - 1 === 1,
      html.split("(pickedId?'&mondayItemId='").length - 1);
    const endTok = '.then(function(res){';
    const mintStmt = html.slice(mintIdx, html.indexOf(endTok, mintIdx) + endTok.length);
    const preIdx = html.lastIndexOf('var mintBase', mintIdx);
    const preamble = preIdx > -1 ? html.slice(preIdx, mintIdx) : '';
    ok('the mint URL sends &mondayItemId= when a valid pick is bound',
      mintStmt.indexOf("(pickedId?'&mondayItemId='+encodeURIComponent(pickedId):'')") > -1);
    ok('the id it sends comes from the email-equality gate, not from the raw pick',
      /var pickedId\s*=\s*onbPickedItemId_\(/.test(preamble), preamble.slice(-160));
    ok('the mint resolves its engine through the flag-gated per-lane dispatcher',
      /var mintBase\s*=\s*mintBaseForLane_\(state\.lane\);/.test(preamble));
    ok('the mint call PASSES that engine rather than defaulting to one',
      /,\s*false,\s*mintBase\)\.then\(function\(res\)\{$/.test(mintStmt), mintStmt.slice(-70));
  }

  // caymanClearCreateForm drops the binding after a completed mint (static).
  {
    const cIdx = html.indexOf('function caymanClearCreateForm(){');
    ok('caymanClearCreateForm exists', cIdx > -1);
    const cBody = html.slice(cIdx, cIdx + 600);
    ok('caymanClearCreateForm drops the pick binding', /window\.__onbPickItemId='';\s*window\.__onbPickEmail='';/.test(cBody));
  }

  console.log(pass + ' passed, ' + fail + ' failed');
  // Explicit exit: section 4 boots the console, which arms a 45s auto-refresh
  // interval that dom.window.close() does not always drain. Without this the
  // harness passes and then HANGS, which in the gate looks like a stuck runner.
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
