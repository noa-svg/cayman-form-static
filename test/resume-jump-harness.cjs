// resume-jump-harness.cjs (2026-08-02, CTO review finding #8 - rewrite).
//
// Was a hand-written "faithful re-implementation" of resolveResumePageIndex_/
// applyResumeJump_/didResumeJump against a fake string-array page model. That
// drifts silently: if the real functions in index.html change, this test
// keeps passing against its own stale copy while production breaks.
//
// Rewritten to extract the REAL resolveResumePageIndex_/applyResumeJump_
// source (brace-counting, same pattern as upload-race-harness.cjs) and drive
// it directly - the actual routing/guard logic under test is now the real
// production code, not a hand copy. visiblePages() itself stays a controlled
// stub (a fixed page-element sequence): the real visiblePages() depends on
// the full applicant()/ALL_PAGES/conditional-page-gate engine, and extracting
// that whole chain is disproportionate for what this test is actually
// claiming (resume-jump routing correctness, not page-visibility rules -
// that engine has its own coverage via test/rig.cjs-backed harnesses).
//
// Run: node test/resume-jump-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); } }

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
const DID_JUMP_DECL = 'var didResumeJump = false;';
if (html.indexOf(DID_JUMP_DECL) === -1) throw new Error('didResumeJump declaration not found verbatim (boot contract changed)');
const src = DID_JUMP_DECL + extractFn('resolveResumePageIndex_') + ';' + extractFn('applyResumeJump_') + ';';

// Real page ids pulled straight from the live markup (not invented), so the
// stub sequence at least matches what the file actually calls its pages -
// confirms the ids this test exercises still exist in production.
const REAL_PAGE_IDS = ['welcome', 'documents', 'individual.subscriber', 'individual.address', 'individual.personal'];
REAL_PAGE_IDS.forEach((id) => {
  if (html.indexOf('data-page="' + id + '"') === -1) throw new Error('page id "' + id + '" no longer exists in index.html (fixture drifted)');
});

function makeApi(pageIds) {
  const calls = { showPage: [] };
  const elements = pageIds.map((id) => ({ getAttribute: (a) => (a === 'data-page' ? id : null) }));
  function visiblePages() { return elements.slice(); } // stub: fixed sequence, see file header
  const factory = new Function(
    'visiblePages', 'showPage',
    src + '; return { resolveResumePageIndex_: resolveResumePageIndex_, applyResumeJump_: applyResumeJump_, getDidResumeJump_: function () { return didResumeJump; } };'
  );
  const api = factory(visiblePages, function (n) { calls.showPage.push(n); });
  return { api, calls };
}

// 1. A known page resolves to its real index in the given sequence.
(function () {
  const { api } = makeApi(REAL_PAGE_IDS);
  ok('resolves a known page to its index', api.resolveResumePageIndex_('individual.subscriber') === 2);
})();

// 2. A page not in the current sequence (filtered out / unknown) -> -1.
(function () {
  const { api } = makeApi(REAL_PAGE_IDS);
  ok('page not in sequence -> -1', api.resolveResumePageIndex_('entity.details') === -1);
  ok('empty/falsy resumePage -> -1, no throw', api.resolveResumePageIndex_('') === -1 && api.resolveResumePageIndex_(null) === -1);
})();

// 3. applyResumeJump_ jumps once to the resolved index and flips the guard.
(function () {
  const { api, calls } = makeApi(REAL_PAGE_IDS);
  api.applyResumeJump_('individual.personal');
  ok('showPage called once with the resolved index', calls.showPage.length === 1 && calls.showPage[0] === 4);
  ok('didResumeJump flips true', api.getDidResumeJump_() === true);
})();

// 4. No double-jump: sync path fires, a later async CFG-arrival call is a
//    no-op even naming a different, otherwise-valid page.
(function () {
  const { api, calls } = makeApi(REAL_PAGE_IDS);
  api.applyResumeJump_('individual.subscriber');
  ok('first (sync) jump fires', calls.showPage.length === 1);
  api.applyResumeJump_('individual.personal');
  ok('second (async) call after a resolved jump is a no-op', calls.showPage.length === 1);
})();

// 5. An UNRESOLVABLE first attempt (e.g. sync boot before the real page
//    filter is known) never flips the guard, so a later resolvable call -
//    e.g. cold-start async CFG arrival - can still win. This is the actual
//    cold-start race this pair of functions exists to handle.
(function () {
  const { api, calls } = makeApi(REAL_PAGE_IDS);
  api.applyResumeJump_('entity.details'); // not in this sequence -> unresolvable
  ok('unresolvable attempt never calls showPage', calls.showPage.length === 0);
  ok('unresolvable attempt leaves didResumeJump false', api.getDidResumeJump_() === false);
  api.applyResumeJump_('individual.address');
  ok('a later resolvable call still jumps (the cold-start race this guards)', calls.showPage.length === 1 && calls.showPage[0] === 3);
})();

console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
