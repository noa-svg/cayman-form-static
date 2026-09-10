// zz-console-approved-hash.cjs - the approved-letter guard must actually FIRE.
//
// ju-service merged domain/wireLetterFacts.ts: ?api=opRenderMonthLetter returns
// a factsHash over the letter's material facts, and
// ?api=opGenerateMonthlyWireLetter refuses when a recompose disagrees with a
// hash the caller supplied. The guard is `if (expectedHash)`, so a console that
// sends nothing leaves the whole protection inert in production: a letter the
// sheet changed between review and generate still shipped, silently.
//
// This file locks the console side of it.
//
//   H1  The render stores the facts of the letter now on screen, and clears
//       them on entry so an in-flight or failed render can never leave a stale
//       hash behind a newer letter.
//   H2  The generate click sends the hash ONLY when the stored render is this
//       exact month and currency, and sends nothing otherwise - unwired
//       generate must behave exactly as it did before.
//   H3  No LP name, amount or bank line rides in the query string: ids and
//       digests only.
//   H4  A refusal is READ BACK and turned into an operator-visible outcome, and
//       the operator can CLEAR it without leaving the screen.
//   H5  The parameter names are the ones ju-service actually reads, checked
//       against the mono repo's origin/main rather than against memory.
//   H6  A render that FAILED leaves Generate disarmed. Fail closed: the arm
//       that follows a failed render is not the same case as the arm that
//       follows no render at all, and only the second one may run unhashed.
//   H7  The refusal recovery cannot repaint over something the operator did
//       while it was in flight.
//   H8  A TRACKER WRITE INVALIDATES THE REVIEW. Every row action that writes
//       the sheet (park, un-park, move to next month, money arrived) closes the
//       gate at the instant of the write, and no click after any of them can
//       reach opGenerateMonthlyWireLetter without a hash.
//   P1  The structure that makes H8 hold: renderLetter closes the gate on
//       entry, and has exactly one call site.
//
// WHY ROUND 4 EXISTED (2026-09-10). Rounds 1 to 3 each fixed the named defect
// and left the class open, because this rig stubbed opPeekAwaitingMoney and
// opPeekParked as {ok:true, rows:[]}: no row card was ever drawn, so no row
// action button existed in the booted DOM, so the four call sites that MUTATE
// the tracker were untestable and untested. The rig now serves real rows and
// drives the real buttons.
//
// H4 IS EXECUTED, NOT GREPPED (rewritten 2026-09-10). The first cut of H4 was
// ten string-index and regex matches over the HTML source. All ten passed over
// code that could not run: the refusal guard sat in wlDoGenerate's .then, and
// apiFetch throws on EVERY {ok:false} (console/index.html:5335), so the branch
// the assertions were reading was unreachable and the operator saw the server's
// raw sentence naming row keys, with Generate still armed and the refused
// letter still on screen. A test that reads source text cannot tell a live
// branch from a dead one, which is exactly how that shipped green. So H4 now
// boots the REAL console in jsdom, drives the REAL apiFetch with the REAL
// {ok:false, factsMismatch} envelope ju-service sends, and asserts on what the
// operator ends up looking at.
//
// Run: node test/zz-console-approved-hash.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { monoSource } = require('./lib-mono-source.cjs');

let pass = 0, fail = 0;
function ok(l, c, x) { if (c) { pass++; console.log('ok   ' + l); } else { fail++; console.log('FAIL ' + l + (x === undefined ? '' : ' :: ' + String(x).slice(0, 300))); } }

const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');

// Brace-counting extractor, the house pattern (console-harness.cjs).
// Returns '' when the function is absent. A missing piece must come back as a
// named FAIL, never as a stack trace: a harness that crashes reports the same
// exit code for "the guard is gone" and "the rig is broken".
function rawFn(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) return '';
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  return '';
}
function esc2Src() { return (html.match(/function esc2\(s\)\{[^\n]*\}/) || [''])[0]; }

// ---- H1: the render owns the facts, and clears them first -----------------
const renderFn = rawFn('renderLetter');
ok('H1 renderLetter is present', renderFn.length > 0);
// Comments are stripped first: the entry block carries the reasoning for the
// three statements it opens with, and an assertion that breaks when someone
// documents the code is an assertion people delete.
const renderFnCode = renderFn.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
ok('H1 renderLetter clears the stored facts before anything else',
  /^function renderLetter\(\)\{\s*wlApproved=null;/.test(renderFnCode), renderFnCode.slice(0, 120));
// ---- P1: THE STRUCTURE, not another patched call site ----------------------
// Round 3 routed 3 of 7 entry points through wlRelookAndReview and left the
// four that write the tracker firing renderLetter() bare. Two properties make a
// fifth round of the same defect unrepresentable rather than merely unshipped:
// the gate closes INSIDE renderLetter (so a bare call fails closed instead of
// leaving a stale arm), and there is exactly ONE call site (so a bare call
// cannot strand the gate closed either).
ok('P1 renderLetter DISARMS THE GATE on entry, in the same block that clears the facts',
  /^function renderLetter\(\)\{\s*wlApproved=null;\s*wlRenderState='pending';\s*wlCloseGate\(/.test(renderFnCode),
  renderFnCode.slice(0, 200));
// THE ROUND-5 TRIPWIRE. Any new `renderLetter(...)` call anywhere in the file
// fails this by name, with the offending line quoted. Comment lines are
// excluded: they describe the call, they cannot make one.
const renderCallSites = (function () {
  const out = [];
  const lines = html.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\/\//.test(lines[i])) continue;
    const re = /renderLetter\s*\(/g; let m;
    while ((m = re.exec(lines[i]))) {
      if (/function\s+$/.test(lines[i].slice(0, m.index))) continue; // the definition
      out.push((i + 1) + ': ' + lines[i].trim());
    }
  }
  return out;
})();
ok('P1 renderLetter has exactly ONE call site, and it is wlRelookAndReview',
  renderCallSites.length === 1 && /return renderLetter\(\)\.then\(after,after\);$/.test(renderCallSites[0]),
  renderCallSites.join(' | ') || 'no call site at all');
ok('H1 the stored facts come from the render response, never from the page',
  /if\(r\.factsHash\)wlApproved=\{month:month,currency:ccy,hash:String\(r\.factsHash\),rowFacts:String\(r\.rowFacts\|\|''\)\}/.test(renderFn),
  renderFn.slice(renderFn.indexOf('factsHash') - 80, renderFn.indexOf('factsHash') + 200));
ok('H1 a render that answers with no hash leaves nothing stored',
  renderFn.indexOf('wlApproved={') === renderFn.lastIndexOf('wlApproved={'));

// ---- H2: the generate click, executed for real -----------------------------
// The shipped expression itself is pulled out and RUN against fabricated
// state. Asserting on the source text alone would pass on an expression that
// reads the wrong field.
// EXTRACTED BY BOUNDARY, NOT BY A NON-GREEDY TAIL. The old pattern ended at the
// first `:'';` after `var facts=`, so a builder that grew a second conditional
// was sliced mid-statement and `new Function` threw `SyntaxError: Unexpected
// token if` from inside the rig. A harness that reds by crashing reports the
// same exit code for "the guard changed shape" and "the rig is broken", which
// is not a test. The slice now runs to the apiFetch call that consumes it, and
// a source that will not compile is a NAMED failure.
const qsSrc = (function () {
  const start = html.indexOf('var facts=(wlApproved');
  if (start < 0) return '';
  const end = html.indexOf('apiFetch(', start);
  return end < 0 ? '' : html.slice(start, end).trim();
})();
ok('H2 the generate handler builds a facts query', qsSrc.length > 0);
// Absent or uncompilable = the wiring changed shape, which is exactly what this
// file exists to catch; every case below then FAILS by name, not by a stack.
let buildQs = function () { return null; };
let qsCompileErr = '';
if (qsSrc) {
  try { buildQs = new Function('wlApproved', 'snap', qsSrc + ' return factsQs;'); }
  catch (e) { qsCompileErr = String((e && e.message) || e); }
}
ok('H2 the extracted facts-query source compiles (a rig that throws is not a rig that reds)',
  qsSrc.length > 0 && !qsCompileErr, qsCompileErr || qsSrc.slice(0, 200));
const RENDERED = { month: '09/2026', currency: 'NIS', hash: 'abc123hash', rowFacts: 'MR-1:aaaaaaaaaaaa,row12:bbbbbbbbbbbb' };

const sent = buildQs(RENDERED, { month: '09/2026', currency: 'NIS' }) || '';
ok('H2 a matching render sends the hash', sent.indexOf('&expectedFactsHash=abc123hash') === 0, sent);
ok('H2 a matching render sends the row facts too',
  sent.indexOf('&expectedRowFacts=' + encodeURIComponent(RENDERED.rowFacts)) > 0, sent);
ok('H2 nothing is sent when nothing was rendered', buildQs(null, { month: '09/2026', currency: 'NIS' }) === '');
ok('H2 nothing is sent when the render was another month',
  buildQs(RENDERED, { month: '08/2026', currency: 'NIS' }) === '');
ok('H2 nothing is sent when the render was another currency',
  buildQs(RENDERED, { month: '09/2026', currency: 'USD' }) === '');
ok('H2 nothing is sent when the render answered without a hash',
  buildQs({ month: '09/2026', currency: 'NIS', hash: '', rowFacts: '' }, { month: '09/2026', currency: 'NIS' }) === '');

// ---- H3: ids and digests only ----------------------------------------------
ok('H3 the query carries the hash and the row facts and nothing else',
  (sent.match(/&[a-zA-Z]+=/g) || []).join(',') === '&expectedFactsHash=,&expectedRowFacts=', sent);
ok('H3 the console never puts a transfer name or amount on this query',
  !/expected[A-Za-z]*=.{0,40}(name|amount|bank)/i.test(qsSrc), qsSrc);

// ---- H4: the refusal, EXECUTED end to end -----------------------------------
// The renderer alone, run for real. Kept because these are pure-function
// properties (escaping, empty lists, a malformed payload) that are cheaper to
// pin here than through a whole boot.
const parts = [esc2Src(), rawFn('wlRowKeyWords'), rawFn('wlFactsMismatchList'), rawFn('wlFactsMismatchHtml')];
const rendererPresent = parts.every((p) => p.length > 0);
ok('H4 the plain-language refusal renderer is present', rendererPresent,
  ['esc2', 'wlRowKeyWords', 'wlFactsMismatchList', 'wlFactsMismatchHtml'].filter((n, i) => !parts[i].length).join(', ') + ' missing');
const mismatchHtml = rendererPresent
  ? new Function(parts.join(';') + '; return wlFactsMismatchHtml;')()
  : function () { return ''; };
const totalsOnly = mismatchHtml({ changed: [], removed: [], added: [], reasons: ['the letter totals, row count, month or currency changed since review (no individual row differs)'] });
ok('H4 a mismatch that names no row still says what changed',
  /totals, row count, month or currency/.test(totalsOnly), totalsOnly);
const noDetail = mismatchHtml({ reasons: [] });
ok('H4 a refusal with no detail at all still refuses in words',
  /no longer matches the one you reviewed/.test(noDetail), noDetail);
ok('H4 a malformed refusal does not throw', typeof mismatchHtml(undefined) === 'string');
ok('H4 the row keys are escaped on the way out',
  mismatchHtml({ changed: ['<img src=x>'] }).indexOf('<img') < 0);

// ---- the live rig ----------------------------------------------------------
// The console is SSO-gated; it reads only the exp/email claims client-side, so
// an unexpired unsigned token is enough to reach the board without DEMO
// fixtures. Same approach as api-fetch-nonjson-harness.cjs.
const TOKEN_KEY = 'lvp_op_token_v1';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeIdToken = () => b64u({ alg: 'RS256', typ: 'JWT' }) + '.'
  + b64u({ email: 'noa@legacyvpartners.com', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig';
const settle = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 250 : ms));

const MONTH = '09/2026';
// The letter the operator is looking at, and the letter the tracker now holds.
// Two hashes, because the whole point of the guard is that they disagree.
const HASH_APPROVED = 'hash-as-reviewed';
const HASH_NOW = 'hash-as-the-tracker-stands';
const ROWFACTS_APPROVED = 'MR-4417:aaaaaaaaaaaa,row12:bbbbbbbbbbbb';

// THE SERVER'S OWN REFUSAL ENVELOPE, copied from
// apps/ju-service/src/domain/generateWireLetter.ts:345-358. ok:false, a
// sentence naming raw row keys, and the structured diff beside it.
const REFUSAL = {
  ok: false,
  error: 'this month changed since the letter you reviewed; nothing was generated. rows edited since review: MR-4417; rows gone since review: row12',
  monthTab: MONTH,
  currency: 'NIS',
  factsMismatch: {
    changed: ['MR-4417'], removed: ['row12'], added: [],
    reasons: ['rows edited since review: MR-4417', 'rows gone since review: row12'],
    expectedHash: HASH_APPROVED, actualHash: HASH_NOW,
    rowFacts: 'MR-4417:cccccccccccc', rowCount: 1,
    incomingTotal: '0', outgoingTotal: '1000',
  },
};

// Route-programmable stub. `plan` is mutated between phases so the SAME booted
// console sees the tracker change underneath it, which is the real sequence.
const plan = {
  letterHash: HASH_APPROVED,
  generate: null,   // set per phase
  verify: { ok: true, go: true, docUrl: 'https://drive.google.com/file/d/verifydoc/view', docId: 'verifydoc' },
  renderFail: null, // when set, opRenderMonthLetter refuses with this sentence
  renderBare: false,// when set, opRenderMonthLetter answers with a bodiless {}
  renderEmpty: false,// when set, opRenderMonthLetter answers ok with no rows
  holdRender: null, // when set, opRenderMonthLetter parks here until released
  peekRowsFail: null,// when set, opPeekMonthTransfers refuses with this sentence
  // The three ways the REVIEW itself ends without a verdict. Each one used to
  // return out of runReview writing nothing, leaving the transient "the letter
  // is being re-read" promise standing forever (H13).
  reviewFail: null, // an ok:false dry run, which apiFetch turns into a throw
  reviewBare: false,// a body with no ok field at all, the `!r.ok` arm
  reviewNull: false,// no body at all, the `!r` arm
  calls: [],
  writes: [],       // every tracker-write route the console actually called
};
// THE WRITE ROUTES, NAMED ONCE. This list is both the rig's stub table and the
// contract H10's static sweep holds the console to, so a new tracker route
// cannot be stubbed here without also being required to close the gate.
const TRACKER_WRITE_ROUTES = [
  'opParkRow', 'opUnparkRow', 'opMarkMoneyReceived', 'diagCorrectTrackerDate',
  'opAddManualTransferRow', 'opSetRowAmount', 'opSetRowBankDetails', 'diagOpenMonthTab',
];
const DRAWER_PID = 'P-FIXTURE-DRAWER';
const RID_AWAIT = 'MR-FIXTURE-AWAIT';
const RID_PARKED = 'MR-FIXTURE-PARKED';
function answerFor(q) {
  const api = (q.match(/^\?(?:api|admin)=([A-Za-z0-9_]+)/) || [])[1] || '';
  if (api === 'listTrackerMonthTabs') return { ok: true, months: [MONTH, '08/2026'] };
  if (api === 'opPeekMonthTransfers') {
    if (plan.peekRowsFail) return { ok: false, error: plan.peekRowsFail };
    return { ok: true, transfers: [{ rowNum: 12, name: 'Test Row', amount: 1000, direction: 'out' }] };
  }
  // THE BOARD DRAWER'S OWN PROCESS (round 5). stage 'complete' is what makes
  // renderDrawer emit the "Mark money received" button (console/index.html
  // isCompletedStage -> isComplete -> dactBtns), which is the fifth call site
  // of the same opMarkMoneyReceived route the worklist button uses. Synthetic
  // name only.
  if (api === 'opprocess') {
    return { ok: true, processId: DRAWER_PID, displayName: 'Fixture Drawer LP', stage: 'complete', lane: 'israeli', fields: {}, signers: [] };
  }
  // REAL ROW CARDS (round 4). These two answered {rows:[]} for three rounds, so
  // the booted DOM contained no row-action button at all and the four call
  // sites that WRITE the tracker could not be driven. execStatus 'Pending' is
  // required: anything else lands the row in Blocked, which closes the gate on
  // its own and would mask everything H8 asserts. Synthetic names only.
  if (api === 'opPeekAwaitingMoney') {
    return { ok: true, rows: [{ masterRid: RID_AWAIT, name: 'Fixture Row One', nameEn: 'Fixture Row One', type: 'Increase', amount: 1000, currency: 'NIS', execStatus: 'Pending', ageDays: 3 }] };
  }
  if (api === 'opPeekParked') {
    return { ok: true, rows: [{ masterRid: RID_PARKED, name: 'Fixture Row Two', nameEn: 'Fixture Row Two', type: 'Join', amount: 500, currency: 'NIS', reason: 'fixture park' }] };
  }
  // The four tracker WRITES. ok:true and nothing else: apiFetch throws on every
  // ok:false, and what is under test is what the console does after a write
  // that SUCCEEDED.
  // ROUND 5 ADDS THE FOUR THE REVIEWER DROVE NEXT: the manual-row adder, the
  // two fill-a-cell panels and the board drawer's copy of the money button.
  // Every one of them writes the same sheet wireLetterFacts.ts digests.
  if (TRACKER_WRITE_ROUTES.indexOf(api) > -1) {
    plan.writes.push(api);
    if (api === 'opAddManualTransferRow') return { ok: true, row: 14, masterRid: 'manual__fixture' };
    if (api === 'opSetRowAmount') return { ok: true, tab: MONTH, row: 12, amount: '1000' };
    if (api === 'opSetRowBankDetails') return { ok: true, tab: MONTH, row: 12 };
    if (api === 'opMarkMoneyReceived') return { ok: true, rows: [], drafts: [] };
    return { ok: true };
  }
  if (api === 'opRenderMonthLetter') {
    // ok:false, the shape ju-service actually sends. apiFetch throws on every
    // ok:false (console/index.html:5335), so this lands in renderLetter's
    // .catch, which is where a real render outage lands too.
    if (plan.renderFail) return { ok: false, error: plan.renderFail };
    // A body with no ok and no letter in it. apiFetch passes a bare-data shape
    // straight through (undefined !== false), so this is the one way
    // renderLetter's `!r.ok` branch is actually reached in production.
    if (plan.renderBare) return {};
    // The render route answering ok with NO rows on the letter. The peek and
    // the dry run still report a row, which is the disagreement that makes this
    // worth a case: 'ok' used to be recorded before this early return, so a
    // render that stored no hash reported a good render, and 'ok' is what arms.
    if (plan.renderEmpty) return { ok: true, transfers: [], html: '', factsHash: plan.letterHash, rowFacts: ROWFACTS_APPROVED };
    return { ok: true, transfers: [{ rowNum: 12 }], html: '<p>the letter</p>', factsHash: plan.letterHash, rowFacts: ROWFACTS_APPROVED };
  }
  if (api === 'opGenerateMonthlyWireLetter') {
    if (/dryRun=true/.test(q)) {
      if (plan.reviewFail) return { ok: false, error: plan.reviewFail };
      if (plan.reviewBare) return {};
      if (plan.reviewNull) return null;
      return { ok: true, go: true, counts: { incoming: 0, outgoing: 1, total: 1 } };
    }
    if (/verifyOnly=true/.test(q)) return plan.verify;
    return plan.generate;
  }
  if (api === 'list') return { processes: [], generatedAt: '' };
  if (api === 'opNotes') return { notes: {} };
  if (api === 'w8renewals') return { counts: {}, due: [] };
  if (api === 'messages') return { ok: true, messages: [] };
  return { ok: true, rows: {}, reviews: {}, labels: [], matches: [], processes: [] };
}

async function bootConsole() {
  const dom = new JSDOM(html, {
    url: 'http://localhost:8000/console/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem(TOKEN_KEY, fakeIdToken());
      w.fetch = function (url, o) {
        let q = '';
        try { q = JSON.parse(o.body).q || ''; } catch (e) { q = ''; }
        plan.calls.push(q);
        const body = JSON.stringify(answerFor(q));
        const res = { status: 200, text: () => Promise.resolve(body) };
        // Parking the render is the only way to OBSERVE the moment right after
        // a refusal. Everything in this rig resolves in a microtask, so the
        // closed gate and the recovered gate would otherwise be the same tick.
        if (plan.holdRender && /opRenderMonthLetter/.test(q)) {
          return new Promise((resolve) => { plan.holdRender.push(() => resolve(res)); });
        }
        return Promise.resolve(res);
      };
    },
  });
  await settle(700);
  return dom.window;
}

// A click through the REAL confirm step, not a direct call: wlDoGenerate is a
// closure, and reaching it through the buttons is also the only way to prove
// the gate state the operator is left holding.
async function clickGenerate(win) {
  win.document.getElementById('wlGenerateBtn').click();
  await settle(30);
  const go = win.document.getElementById('wlConfirmGo');
  if (!go || win.document.getElementById('wlConfirm').hidden) return false;
  go.click();
  await settle(400);
  return true;
}
const txt = (win, id) => (win.document.getElementById(id) || {}).textContent || '';
const htm = (win, id) => (win.document.getElementById(id) || {}).innerHTML || '';
const armed = (win) => win.document.getElementById('wlGenerateBtn').getAttribute('aria-disabled') === 'false';
const genQs = () => plan.calls.filter((q) => /opGenerateMonthlyWireLetter/.test(q) && !/dryRun=true/.test(q));
const renders = () => plan.calls.filter((q) => /opRenderMonthLetter/.test(q)).length;
// Re-arms through the shipped month handler rather than by reaching into the
// closure, so every phase below starts from a gate the console itself opened.
async function rearm(win) {
  win.document.getElementById('wlMonth').onchange();
  await settle(400);
}

// ---- H5: the wire names, checked against the server that reads them ---------
const dispatch = monoSource('apps/ju-service/src/routes/consoledispatch.ts');
ok('H5 the ju-service dispatch source could be read (empty = not checked)', dispatch.length > 0);
if (dispatch.length > 0) {
  ok('H5 the server reads params.expectedFactsHash', dispatch.indexOf('params.expectedFactsHash') > 0);
  ok('H5 the server reads params.expectedRowFacts', dispatch.indexOf('params.expectedRowFacts') > 0);
  ok('H5 both reads sit in the opGenerateMonthlyWireLetter branch',
    dispatch.indexOf('params.expectedFactsHash') > dispatch.indexOf("api === 'opGenerateMonthlyWireLetter'"));
}
const render = monoSource('apps/ju-service/src/routes/transferformrender.ts');
ok('H5 the ju-service render source could be read (empty = not checked)', render.length > 0);
if (render.length > 0) {
  ok('H5 the render route returns factsHash', /factsHash:/.test(render));
  ok('H5 the render route returns rowFacts', /rowFacts:/.test(render));
}

(async () => {
  const win = await bootConsole();

  // --- the shipped apiFetch, driven with the shipped envelope ----------------
  // Proves the premise the rest of H4 rests on: this envelope REJECTS. A guard
  // written in the resolve path is dead code, whatever the source text says.
  let resolved = null, thrown = null;
  plan.generate = REFUSAL;
  try { resolved = await win.apiFetch('?api=opGenerateMonthlyWireLetter&monthTab=' + encodeURIComponent(MONTH), false, win.JU_API); }
  catch (e) { thrown = e; }
  ok('H4 the refusal envelope REJECTS apiFetch (a .then guard would be dead code)',
    thrown !== null && resolved === null, 'resolved=' + JSON.stringify(resolved));
  ok('H4 the thrown error carries the whole body, so factsMismatch survives the throw',
    !!(thrown && thrown.body && thrown.body.factsMismatch), thrown && Object.keys(thrown).join(','));
  ok('H4 the existing serverError contract is untouched for every other caller',
    thrown && thrown.serverError === REFUSAL.error, thrown && thrown.serverError);

  // --- boot state: the gate armed itself off a rendered letter ---------------
  ok('H4 the panel armed Generate after its own review', armed(win), txt(win, 'wlGateNote'));
  ok('H4 the letter was rendered before the gate armed',
    plan.calls.some((q) => /opRenderMonthLetter/.test(q)), plan.calls.join(' | '));

  // --- THE REFUSAL, as the operator meets it --------------------------------
  const rendersBefore = plan.calls.filter((q) => /opRenderMonthLetter/.test(q)).length;
  const peeksBefore = plan.calls.filter((q) => /opPeekMonthTransfers/.test(q)).length;
  // The tracker changes underneath her between the render and the click. The
  // recovery render is HELD so the state she is left holding at the instant of
  // the refusal is observable on its own.
  plan.letterHash = HASH_NOW;
  plan.generate = REFUSAL;
  plan.holdRender = [];
  const confirmed = await clickGenerate(win);
  ok('H4 Generate reached its confirm step', confirmed);

  const sentHash = genQs()[genQs().length - 1] || '';
  ok('H4 the refused call actually carried the approved hash',
    sentHash.indexOf('expectedFactsHash=' + encodeURIComponent(HASH_APPROVED)) > 0, sentHash);

  const res = htm(win, 'wlResult');
  ok('H4 the operator is told nothing was generated and nothing settled',
    /Nothing was generated and nothing was settled/.test(res), res.slice(0, 300));
  ok('H4 a row with a reference is named by it, not left as a raw key',
    res.indexOf('reference MR-4417') > 0, res.slice(0, 400));
  ok('H4 a row with no reference is named by its row number, not by "row12"',
    res.indexOf('row 12 on the tab') > 0 && res.indexOf('>row12') < 0, res.slice(0, 400));
  ok('H4 an empty list is not printed as an empty heading', res.indexOf('Added since you looked') < 0);
  ok('H4 the server\'s raw key-naming sentence never reaches the screen',
    res.indexOf('rows gone since review: row12') < 0, res.slice(0, 400));
  ok('H4 no JSON is dumped at the operator', res.indexOf('{') < 0 && res.indexOf('[') < 0, res.slice(0, 300));
  ok('H4 the refusal is spoken to a screen reader too',
    /Nothing was settled/.test(txt(win, 'wlAnnounce')), txt(win, 'wlAnnounce'));
  ok('H4 the refusal closed the gate rather than leaving Generate armed',
    !armed(win), 'aria-disabled=' + win.document.getElementById('wlGenerateBtn').getAttribute('aria-disabled'));
  ok('H4 the rows were re-read from the tracker',
    plan.calls.filter((q) => /opPeekMonthTransfers/.test(q)).length > peeksBefore);
  ok('H4 the letter was re-read from the tracker',
    plan.calls.filter((q) => /opRenderMonthLetter/.test(q)).length > rendersBefore);

  // --- THE LOOP IS CLOSED: the refusal clears itself, in place --------------
  // The trap this file exists to stop: a refusal the operator cannot clear
  // without changing the currency, changing the month, or reloading. Review is
  // hidden (the review runs itself), so nothing on screen re-armed the gate.
  const held = plan.holdRender;
  plan.holdRender = null;
  held.forEach((release) => release());
  await settle(400);
  ok('H4 LOOP the gate re-arms itself once the fresh letter lands, with no reload',
    armed(win), txt(win, 'wlGateNote'));
  ok('H4 LOOP the refusal is still on screen after the recovery, not blanked by it',
    /Nothing was generated and nothing was settled/.test(htm(win, 'wlResult')),
    htm(win, 'wlResult').slice(0, 200));

  plan.generate = { ok: true, go: true, docUrl: 'https://drive.google.com/file/d/doc1/view', counts: { incoming: 0, outgoing: 1, total: 1 }, settled: [] };
  const confirmed2 = await clickGenerate(win);
  ok('H4 LOOP the next Generate goes through instead of refusing again', confirmed2);
  const sent2 = genQs()[genQs().length - 1] || '';
  ok('H4 LOOP that second click carries the letter now on screen, not the refused one',
    sent2.indexOf('expectedFactsHash=' + encodeURIComponent(HASH_NOW)) > 0
    && sent2.indexOf(encodeURIComponent(HASH_APPROVED)) < 0, sent2);
  ok('H4 LOOP and it reads as a settle, not as a second refusal',
    /Rows settled on the tracker/.test(htm(win, 'wlResult')), htm(win, 'wlResult').slice(0, 300));

  // A generic ok:false must still read as the plain error line, unchanged. A
  // successful settle deliberately closes the gate ("Review again to re-run"),
  // so it is re-armed through the shipped month handler, not by reaching into
  // the closure.
  plan.generate = { ok: false, error: 'Sheets quota exceeded' };
  win.document.getElementById('wlMonth').onchange();
  await settle(400);
  ok('H4 the month handler re-armed the gate for the last case', armed(win), txt(win, 'wlGateNote'));
  await clickGenerate(win);
  const generic = htm(win, 'wlResult');
  ok('H4 a plain server error still renders as the ordinary error line',
    /Sheets quota exceeded/.test(generic) && !/Nothing was generated and nothing was settled/.test(generic),
    generic.slice(0, 300));

  // ---- H6: THE FAILED RECOVERY RENDER, FAIL CLOSED ------------------------
  // The money-grade case. renderLetter's .catch renders an error and RESOLVES,
  // and wlRelookAndReview is .then(after,after), so runReview runs either way
  // with wlApproved null. Before the fail-closed rule that produced: the render
  // panel saying the letter could not be rendered, the gate note saying
  // "Reviewed 09/2026 . NIS . 1 row. Generate will settle these 1", Generate
  // aria-disabled=false, and the next click sending NO expectedFactsHash into a
  // server whose guard is `if (expectedHash)` - generate and settle, unchecked,
  // on the sheet whose change caused the refusal.
  plan.renderFail = null;
  plan.letterHash = HASH_APPROVED;
  await rearm(win);
  ok('H6 the gate is armed off a good render before the outage', armed(win), txt(win, 'wlGateNote'));

  plan.renderFail = 'render backend down';
  plan.generate = REFUSAL;
  const rendersBeforeFail = renders();
  const gensBeforeFail = genQs().length;
  await clickGenerate(win);
  ok('H6 the recovery render was actually attempted and failed', renders() > rendersBeforeFail);
  ok('H6 the operator sees the render failure in the letter panel',
    /could not be rendered/.test(htm(win, 'wlRenderPanel')), htm(win, 'wlRenderPanel').slice(0, 200));
  ok('H6 GENERATE IS DISARMED after a failed recovery render',
    !armed(win), 'aria-disabled=' + win.document.getElementById('wlGenerateBtn').getAttribute('aria-disabled'));
  ok('H6 the gate note says the render is why, in operator words, and does not announce a row count',
    /did not render/.test(txt(win, 'wlGateNote')) && !/will settle/.test(txt(win, 'wlGateNote')),
    txt(win, 'wlGateNote'));
  ok('H6 the failure is spoken to a screen reader too',
    /did not render/.test(txt(win, 'wlAnnounce')), txt(win, 'wlAnnounce'));
  ok('H6 the refusal that started it is still on screen, not blanked by the recovery',
    /Nothing was generated and nothing was settled/.test(htm(win, 'wlResult')), htm(win, 'wlResult').slice(0, 200));
  ok('H6 the refusal copy no longer promises the gate will re-arm',
    htm(win, 'wlResult').indexOf('Generate arms itself again once they land') < 0);

  // THE CLICK CANNOT REACH THE NETWORK. Generate stays clickable on purpose
  // (aria-disabled, so a click answers instead of dying silently), so "off" has
  // to be proved at the wire, not at the attribute.
  const gensAfterFail = genQs().length;
  win.document.getElementById('wlGenerateBtn').click();
  await settle(120);
  ok('H6 a click on Generate opens no confirm', win.document.getElementById('wlConfirm').hidden);
  ok('H6 the refused click does not tell her to click the hidden Review button',
    txt(win, 'wlGateNote').indexOf('Review this month first') < 0, txt(win, 'wlGateNote'));
  ok('H6 a click on Generate reaches no settle call at all',
    genQs().length === gensAfterFail && gensAfterFail === gensBeforeFail + 1,
    'before=' + gensBeforeFail + ' after=' + genQs().length);

  // AND SHE CAN RETRY. The Review button is hidden, so the failed render draws
  // its own way back.
  const retry = win.document.getElementById('wlRenderRetry');
  ok('H6 the failed render offers a retry the operator can reach', !!retry);
  plan.renderFail = null;
  plan.letterHash = HASH_NOW;
  if (retry) retry.click();
  await settle(500);
  ok('H6 the retry re-renders and re-arms the gate', armed(win), txt(win, 'wlGateNote'));
  plan.generate = { ok: true, go: true, docUrl: 'https://drive.google.com/file/d/doc2/view', counts: { incoming: 0, outgoing: 1, total: 1 }, settled: [] };
  await clickGenerate(win);
  ok('H6 and the click after the retry carries the letter that actually rendered',
    (genQs()[genQs().length - 1] || '').indexOf('expectedFactsHash=' + encodeURIComponent(HASH_NOW)) > 0,
    genQs()[genQs().length - 1]);

  // A GARBLED RENDER IS A FAILED RENDER. apiFetch throws on {ok:false} but
  // passes a bare body through untouched, so renderLetter's `!r.ok` arm is the
  // live path for a route that answers with nothing usable. It must fail closed
  // exactly like an outage does.
  plan.letterHash = HASH_APPROVED;
  await rearm(win);
  ok('H6 armed before the garbled-render case', armed(win), txt(win, 'wlGateNote'));
  plan.renderBare = true;
  await rearm(win);
  ok('H6 a render that answers with no letter at all also disarms Generate',
    !armed(win), txt(win, 'wlGateNote'));
  ok('H6 and it reads as a failed render, not as one still loading',
    /did not render/.test(txt(win, 'wlGateNote')), txt(win, 'wlGateNote'));
  plan.renderBare = false;

  // THE IN-FLIGHT WINDOW, which is the same fail-open one tick earlier. Render A
  // is held; the month flips and starts render B; A is released alone, so A's
  // review runs while B is still drawing. Before the positive test that armed
  // Generate with no hash stored, against a letter not yet on screen.
  plan.letterHash = HASH_APPROVED;
  await rearm(win);
  plan.holdRender = [];
  win.document.getElementById('wlMonth').onchange(); // chain A, render held
  await settle(60);
  const heldA = plan.holdRender.splice(0);
  win.document.getElementById('wlMonth').onchange(); // chain B, render also held
  await settle(60);
  heldA.forEach((release) => release());              // release A only
  await settle(300);
  ok('H6 a review that lands while a render is still in flight does NOT arm Generate',
    !armed(win), txt(win, 'wlGateNote'));
  ok('H6 and it says so plainly rather than announcing a row count',
    /still being read/.test(txt(win, 'wlGateNote')), txt(win, 'wlGateNote'));
  const heldB0 = plan.holdRender; plan.holdRender = null;
  heldB0.forEach((release) => release());
  await settle(400);
  ok('H6 the gate arms once that render finishes', armed(win), txt(win, 'wlGateNote'));

  // ---- H7: the recovery cannot clobber the operator's own result ----------
  plan.letterHash = HASH_APPROVED;
  await rearm(win);
  ok('H7 armed again for the clobber case', armed(win), txt(win, 'wlGateNote'));
  plan.letterHash = HASH_NOW;
  plan.generate = REFUSAL;
  plan.holdRender = [];
  await clickGenerate(win);
  ok('H7 the refusal is on screen while the re-read is in flight',
    /Nothing was generated and nothing was settled/.test(htm(win, 'wlResult')));
  // She runs a Verification copy in the window between the refusal and the
  // re-read landing. Nothing on screen stops her: the button is live, and the
  // call never settles a row.
  win.document.getElementById('wlVerifyBtn').click();
  await settle(200);
  ok('H7 the verification copy landed on the result line',
    /Verification copy generated/.test(htm(win, 'wlResult')), htm(win, 'wlResult').slice(0, 200));
  const heldB = plan.holdRender; plan.holdRender = null;
  heldB.forEach((release) => release());
  await settle(500);
  ok('H7 THE RECOVERY DOES NOT ERASE HER DOCUMENT: the verification result survives',
    /Verification copy generated/.test(htm(win, 'wlResult')), htm(win, 'wlResult').slice(0, 300));
  ok('H7 and her Drive link is still there',
    htm(win, 'wlResult').indexOf('verifydoc') > 0, htm(win, 'wlResult').slice(0, 300));
  ok('H7 the gate still re-armed behind it, so the recovery still did its job',
    armed(win), txt(win, 'wlGateNote'));

  // ---- H1 EXECUTED: the entry-clear, proved at the wire -------------------
  // Mutation 4 (delete `wlApproved=null` from the top of renderLetter) was
  // caught only by a regex over the HTML source. Here it is at the wire: a
  // render that answers WITHOUT a factsHash, after one that answered with it,
  // must leave nothing stored, so the next generate carries nothing. With the
  // entry-clear gone the stale hash rides along and the console holds the
  // server to a letter nobody is looking at.
  plan.generate = { ok: true, go: true, docUrl: 'https://drive.google.com/file/d/doc3/view', counts: { incoming: 0, outgoing: 1, total: 1 }, settled: [] };
  plan.letterHash = HASH_APPROVED;
  await rearm(win);
  ok('H1 a hash was stored by the first render', armed(win), txt(win, 'wlGateNote'));
  plan.letterHash = null; // an older ju-service: renders fine, returns no hash
  await rearm(win);
  ok('H1 a render with no hash still renders and still arms', armed(win), txt(win, 'wlGateNote'));
  await clickGenerate(win);
  const unhashed = genQs()[genQs().length - 1] || '';
  ok('H1 EXECUTED a hash-less render leaves NOTHING stored, so the click carries no hash',
    unhashed.indexOf('expectedFactsHash') < 0, unhashed);
  ok('H1 EXECUTED and specifically not the previous render\'s hash',
    unhashed.indexOf(encodeURIComponent(HASH_APPROVED)) < 0 && unhashed.indexOf(HASH_APPROVED) < 0, unhashed);

  // ================= H8: A TRACKER WRITE INVALIDATES THE REVIEW =============
  // The four call sites round 3 missed. Each writes the sheet the letter is
  // composed from, so the letter the operator approved stops describing the
  // tracker at the instant the write lands. Driven through the REAL buttons in
  // the booted DOM, which is only possible because the peeks now serve rows.
  const q = (sel) => win.document.querySelector(sel);
  plan.renderFail = null; plan.renderBare = false; plan.renderEmpty = false;
  plan.letterHash = HASH_APPROVED;
  await rearm(win);
  ok('H8 the rig draws a real needs-you row card with its money button',
    !!q('#wlGroups [data-act="markMoneyReceived"]'), htm(win, 'wlAwaiting').slice(0, 200));
  ok('H8 the rig draws the row menu carrying both writing actions',
    !!q('#wlGroups [data-act="rowNextMonth"]') && !!q('#wlGroups [data-act="parkRow"]'));
  ok('H8 the rig draws a real parked row card with its un-park button',
    !!q('#wlParked [data-act="unparkRow"]'), htm(win, 'wlParked').slice(0, 200));
  ok('H8 no blocking row is on the fixture month, so the gate is armed on its own merits',
    armed(win), txt(win, 'wlGateNote'));

  const ACTIONS = [
    { name: 'money arrived', click: () => q('#wlGroups [data-act="markMoneyReceived"]').click() },
    { name: 'move to next month', click: () => q('#wlGroups [data-act="rowNextMonth"]').click() },
    { name: 'park', click: () => {
        q('#wlGroups [data-act="parkRow"]').click();
        const inp = q('.wl-park-in');
        inp.value = 'fixture reason';
        inp.dispatchEvent(new win.Event('input'));
        q('[data-park-go]').click();
      } },
    { name: 'un-park', click: () => q('#wlParked [data-act="unparkRow"]').click() },
  ];

  const genBaselineH8 = genQs().length;
  for (const a of ACTIONS) {
    plan.renderFail = null;
    plan.letterHash = HASH_APPROVED;
    plan.generate = { ok: true, go: true, docUrl: 'https://drive.google.com/file/d/doc8/view', counts: { incoming: 0, outgoing: 1, total: 1 }, settled: [] };
    await rearm(win);
    ok('H8 [' + a.name + '] armed off a good render before the write', armed(win), txt(win, 'wlGateNote'));
    const noteBefore = txt(win, 'wlGateNote');
    const writesBefore = plan.writes.length;
    // The tracker changes because SHE changed it. From here the letter she
    // approved and the letter the sheet would now produce are different
    // letters, which is exactly the case the server guard exists to refuse.
    plan.letterHash = HASH_NOW;
    a.click();
    await settle(80); // the write has landed; the re-read is still 600ms away
    ok('H8 [' + a.name + '] the write actually reached its tracker route',
      plan.writes.length > writesBefore, plan.writes.join(','));
    ok('H8 [' + a.name + '] GENERATE IS DISARMED AT THE WRITE, not a render later',
      !armed(win), 'aria-disabled=' + win.document.getElementById('wlGenerateBtn').getAttribute('aria-disabled'));
    ok('H8 [' + a.name + '] the note tells her the tracker changed, instead of standing byte-identical',
      txt(win, 'wlGateNote') !== noteBefore && /changed the tracker/.test(txt(win, 'wlGateNote')), txt(win, 'wlGateNote'));
    ok('H8 [' + a.name + '] the note no longer announces a row count it cannot stand behind',
      !/will settle/.test(txt(win, 'wlGateNote')), txt(win, 'wlGateNote'));
    ok('H8 [' + a.name + '] the closed gate is spoken to a screen reader too',
      /Generate is off/.test(txt(win, 'wlAnnounce')), txt(win, 'wlAnnounce'));
    // THE IN-FLIGHT WINDOW, proved at the wire. Generate stays clickable on
    // purpose, so "off" is only true if the click reaches no settle call.
    const gensMid = genQs().length;
    win.document.getElementById('wlGenerateBtn').click();
    await settle(80);
    ok('H8 [' + a.name + '] a click inside the re-read window opens no confirm',
      win.document.getElementById('wlConfirm').hidden);
    ok('H8 [' + a.name + '] and reaches no settle call at all',
      genQs().length === gensMid, 'before=' + gensMid + ' after=' + genQs().length);
    await settle(900);
    ok('H8 [' + a.name + '] the gate re-arms itself once the new letter is on screen, with no reload',
      armed(win), txt(win, 'wlGateNote'));
    await clickGenerate(win);
    const afterQs = genQs()[genQs().length - 1] || '';
    ok('H8 [' + a.name + '] the click after the write carries the NEW letter, not the one she approved',
      afterQs.indexOf('expectedFactsHash=' + encodeURIComponent(HASH_NOW)) > 0
      && afterQs.indexOf(encodeURIComponent(HASH_APPROVED)) < 0, afterQs);
  }

  // ROW ACTION THEN FAILED RENDER, for every one of the four. The re-render is
  // the thing that would have re-stored a hash; when it fails there is none, and
  // the gate must stay shut rather than falling back to the pre-write review.
  for (const a of ACTIONS) {
    plan.renderFail = null;
    plan.letterHash = HASH_APPROVED;
    await rearm(win);
    ok('H8 FAILED RENDER [' + a.name + '] armed before the write', armed(win), txt(win, 'wlGateNote'));
    plan.renderFail = 'render backend down';
    const gensBefore = genQs().length;
    a.click();
    await settle(1000);
    ok('H8 FAILED RENDER [' + a.name + '] GENERATE STAYS DISARMED',
      !armed(win), 'aria-disabled=' + win.document.getElementById('wlGenerateBtn').getAttribute('aria-disabled'));
    ok('H8 FAILED RENDER [' + a.name + '] the operator sees the failure in the letter panel',
      /could not be rendered/.test(htm(win, 'wlRenderPanel')), htm(win, 'wlRenderPanel').slice(0, 160));
    ok('H8 FAILED RENDER [' + a.name + '] the note names the render, not a row count',
      /did not render/.test(txt(win, 'wlGateNote')) && !/will settle/.test(txt(win, 'wlGateNote')), txt(win, 'wlGateNote'));
    win.document.getElementById('wlGenerateBtn').click();
    await settle(80);
    ok('H8 FAILED RENDER [' + a.name + '] a click reaches no settle call at all',
      genQs().length === gensBefore, 'before=' + gensBefore + ' after=' + genQs().length);
  }
  plan.renderFail = null;

  // THE WHOLE POINT, stated once at the wire: everything this section sent.
  const unhashedAfterWrites = genQs().slice(genBaselineH8).filter((qs) => qs.indexOf('expectedFactsHash=') < 0);
  ok('H8 AT THE WIRE: no click after any row action reached opGenerateMonthlyWireLetter without a hash',
    unhashedAfterWrites.length === 0, unhashedAfterWrites.join(' | '));
  ok('H8 all four writing routes were actually exercised',
    ['opMarkMoneyReceived', 'diagCorrectTrackerDate', 'opParkRow', 'opUnparkRow'].every((r) => plan.writes.indexOf(r) > -1),
    plan.writes.join(','));

  // ---- P3: 'ok' is recorded only for a render that stored something --------
  plan.letterHash = HASH_APPROVED;
  plan.renderEmpty = true;
  await rearm(win);
  ok('P3 a render that answers with no rows does NOT arm Generate',
    !armed(win), txt(win, 'wlGateNote'));
  ok('P3 and it reads as nothing to wire, not as a failed render and not as a row count',
    /until a row is ready to wire/.test(txt(win, 'wlGateNote'))
    && !/did not render/.test(txt(win, 'wlGateNote'))
    && !/will settle/.test(txt(win, 'wlGateNote')), txt(win, 'wlGateNote'));
  const gensEmpty = genQs().length;
  win.document.getElementById('wlGenerateBtn').click();
  await settle(80);
  ok('P3 a click on that month reaches no settle call',
    genQs().length === gensEmpty, 'before=' + gensEmpty + ' after=' + genQs().length);
  plan.renderEmpty = false;


  // ================= H9: NO CLOSED GATE STRANDS THE OPERATOR ===============
  // Round 4 made a bare renderLetter() call fail CLOSED, which is right. A gate
  // that closes and never reopens is the defect one level down: the operator
  // cannot generate this month's letter at all, and the copy told her to
  // "review again" while the Review button is hidden because the review runs
  // itself. Measured on round 4: typing one character into the Struck-NAV
  // override left Generate disarmed at 1500ms and disarmed after clicking
  // around, with nothing on screen that would re-arm it.
  const GOOD_GEN = { ok: true, go: true, docUrl: 'https://drive.google.com/file/d/doc9/view', counts: { incoming: 0, outgoing: 1, total: 1 }, settled: [] };
  const dryRuns = () => plan.calls.filter((q) => /dryRun=true/.test(q)).length;
  const navEl = () => win.document.getElementById('wlNavMonth');
  function typeNav(v) { const el = navEl(); el.value = v; el.dispatchEvent(new win.Event('input')); }

  plan.renderFail = null; plan.renderBare = false; plan.renderEmpty = false; plan.peekRowsFail = null;
  plan.letterHash = HASH_APPROVED;
  plan.generate = GOOD_GEN;
  await rearm(win);
  ok('H9 NAV armed before the Struck-NAV override is touched', armed(win), txt(win, 'wlGateNote'));
  const dryBeforeNav = dryRuns();
  const rendersBeforeNav = renders();
  typeNav('2026-08');
  await settle(80);
  ok('H9 NAV typing the override closes the gate at the keystroke',
    !armed(win), 'aria-disabled=' + win.document.getElementById('wlGenerateBtn').getAttribute('aria-disabled'));
  ok('H9 NAV the note does not name the Review button, which is hidden',
    !/review again/i.test(txt(win, 'wlGateNote')), txt(win, 'wlGateNote'));
  // THE MEASURED WINDOW. Round 4 was still disarmed here with no pending work.
  await settle(1200);
  ok('H9 NAV THE GATE RE-ARMS ITSELF, with no reload and no button she cannot see',
    armed(win), txt(win, 'wlGateNote'));
  ok('H9 NAV the re-review actually carried the month she typed',
    plan.calls.filter((q) => /dryRun=true/.test(q)).some((q) => q.indexOf('navMonth=2026-08') > 0),
    plan.calls.filter((q) => /dryRun=true/.test(q)).slice(-2).join(' | '));
  ok('H9 NAV exactly one re-review was fired, not one per keystroke',
    dryRuns() === dryBeforeNav + 1, 'before=' + dryBeforeNav + ' after=' + dryRuns());
  // The letter does not vary with navMonth, so re-rendering it would be a
  // round trip that buys nothing and would drop the stored hash for the window
  // it was in flight. Asserted so a later "just call wlRelookAndReview here"
  // has to argue with this line.
  ok('H9 NAV and the letter itself was NOT re-rendered, so the approved hash still stands',
    renders() === rendersBeforeNav, 'renders before=' + rendersBeforeNav + ' after=' + renders());
  await clickGenerate(win);
  ok('H9 NAV the click after the re-review still carries the approved letter',
    (genQs()[genQs().length - 1] || '').indexOf('expectedFactsHash=' + encodeURIComponent(HASH_APPROVED)) > 0,
    genQs()[genQs().length - 1]);
  ok('H9 NAV and it carried the override to the settle call too',
    (genQs()[genQs().length - 1] || '').indexOf('navMonth=2026-08') > 0, genQs()[genQs().length - 1]);

  // A HALF-TYPED OVERRIDE. runReview refuses this state, so firing the timer
  // into it would only re-close the gate with a worse sentence. It must stay
  // shut, fire nothing, and say what fixes it - both of which are this field.
  await rearm(win);
  // She has a Verification copy and its Drive link on the result line while she
  // edits the override. That is what the debounce's own invalid-guard is FOR:
  // runReview refuses a malformed override by writing its refusal over the
  // result line, so firing the timer into that state would wipe her document
  // link on a keystroke, which is the H7 clobber in a new place.
  win.document.getElementById('wlVerifyBtn').click();
  await settle(300);
  ok('H9 NAV her verification copy is on the result line before she touches the override',
    /Verification copy generated/.test(htm(win, 'wlResult')), htm(win, 'wlResult').slice(0, 160));
  typeNav('2026-13');
  await settle(80);
  ok('H9 NAV a malformed override closes the gate', !armed(win));
  ok('H9 NAV and the note names the field and the two ways out of it',
    /must be YYYY-MM/.test(txt(win, 'wlGateNote')) && /clear it/.test(txt(win, 'wlGateNote')), txt(win, 'wlGateNote'));
  const dryAtInvalid = dryRuns();
  await settle(900);
  ok('H9 NAV a malformed override fires no review at all', dryRuns() === dryAtInvalid,
    'before=' + dryAtInvalid + ' after=' + dryRuns());
  ok('H9 NAV AND IT DOES NOT WIPE THE DOCUMENT SHE WAS READING to say so',
    /Verification copy generated/.test(htm(win, 'wlResult')) && htm(win, 'wlResult').indexOf('verifydoc') > 0,
    htm(win, 'wlResult').slice(0, 200));
  ok('H9 NAV and the gate is still shut, still saying how to fix it', !armed(win), txt(win, 'wlGateNote'));
  typeNav('');
  await settle(900);
  ok('H9 NAV CLEARING the override re-arms the gate, so the malformed state is not a trap either',
    armed(win), txt(win, 'wlGateNote'));

  // A ROWS OUTAGE DRAWS ITS OWN WAY BACK. peekRows is always paired with a
  // review, so its close is not the strand the NAV one was - but its failure
  // block was a dead end with no reload, and its copy named the hidden button.
  plan.peekRowsFail = 'tracker read timed out';
  await rearm(win);
  await settle(300);
  const rowsRetry = win.document.getElementById('wlRowsRetry');
  ok('H9 ROWS a rows outage draws a retry the operator can reach', !!rowsRetry, htm(win, 'wlRows').slice(0, 200));
  ok('H9 ROWS and it quotes the server\'s reason rather than a generic line',
    /tracker read timed out/.test(htm(win, 'wlRows')), htm(win, 'wlRows').slice(0, 200));
  const peeksBeforeRetry = plan.calls.filter((q) => /opPeekMonthTransfers/.test(q)).length;
  plan.peekRowsFail = null;
  if (rowsRetry) rowsRetry.click();
  await settle(600);
  ok('H9 ROWS the retry actually re-reads the rows',
    plan.calls.filter((q) => /opPeekMonthTransfers/.test(q)).length > peeksBeforeRetry);
  ok('H9 ROWS and the rows are back on screen with the gate armed',
    armed(win) && !win.document.getElementById('wlRowsRetry'), txt(win, 'wlGateNote'));

  // THE SWEEP, over EVERY close site rather than the two that were reported.
  // A gate note may not name an action that is not on screen. The Review button
  // is hidden (the review runs itself), so every one of these sentences that
  // said "review again" was pointing at nothing.
  const closeReasons = (function () {
    const out = []; const re = /wlCloseGate\(([^\n]*?)\);/g; let m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out;
  })();
  ok('H9 SWEEP every wlCloseGate site was found (empty = the sweep is broken)', closeReasons.length >= 15, closeReasons.length);
  const namesHiddenButton = closeReasons.filter((r) => /review again|re-review above|Review this month/i.test(r));
  ok('H9 SWEEP no closed gate tells the operator to click the hidden Review button',
    namesHiddenButton.length === 0, namesHiddenButton.join(' | '));
  // The armed note and the row-action result lines go through the same rule.
  // Comment lines are stripped first: several of them QUOTE the copy this rule
  // removed, and an assertion that fires on its own changelog is an assertion
  // people delete.
  const htmlCode = html.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  ok('H9 SWEEP no other operator-facing copy sends her to the hidden Review button either',
    htmlCode.indexOf('Review again before generating') < 0
    && htmlCode.indexOf('Re-review above') < 0
    && htmlCode.indexOf('Review again to re-run') < 0,
    [/Review again before generating/, /Re-review above/, /Review again to re-run/]
      .map((re) => (htmlCode.match(re) || [''])[0]).filter(Boolean).join(' | '));

  // ================= H10: EVERY TRACKER WRITE, NOT THE FOUR REPORTED ========
  // Round 4 covered the four row actions inside the worklist IIFE. The console
  // writes the same sheet from three other panels and from the board drawer,
  // and each left Generate armed against the pre-write letter with a
  // byte-identical note. Those fail CLOSED at the server, so this is a false
  // REFUSAL, not a fail-open - a correct generation refused with nothing on
  // screen saying why.
  //
  // The static half first: enumerated from the file, not from the report.
  const writeSites = (function () {
    const out = {}; const re = /apiFetch\(\s*(?:'|")\?api=([A-Za-z0-9_]+)/g; let m;
    while ((m = re.exec(html))) { (out[m[1]] = out[m[1]] || []).push(m.index); }
    // the two sites that build their query in a variable first
    const varRe = /\?api=([A-Za-z0-9_]+)&/g; let v;
    while ((v = varRe.exec(html))) { if (!out[v[1]]) out[v[1]] = []; }
    return out;
  })();
  // Anything write-SHAPED that this file calls must be classified here. A new
  // route lands in NEITHER list and fails by name, which is the whole point:
  // the previous four rounds each fixed the reported sites and left the class.
  const NOT_TRACKER = {
    opSetRowReview: 'state store, not the tracker Sheet (consoledispatch.ts routes it to deps.stateStore); it records who checked a row and is not a letter fact',
    opSetConsoleSettings: 'the operator allowlist, GAS-only, nothing to do with the tracker',
    opCorrectSealedDoc: 'schedules a document re-seal on GAS (console/index.html\'s own note: ju-service has no handler at all); it rewrites a sealed PDF, never a tracker cell, so no letter fact moves',
  };
  const writeShaped = Object.keys(writeSites).filter((r) => /^(opSet|opAdd|opPark|opUnpark|opMark|opDelete|opMove|opCorrect|diagCorrect|diagOpen)/.test(r));
  const unclassified = writeShaped.filter((r) => TRACKER_WRITE_ROUTES.indexOf(r) < 0 && !NOT_TRACKER[r]);
  ok('H10 STATIC the sweep found the write-shaped routes (empty = the sweep is broken)',
    writeShaped.length >= 8, writeShaped.join(','));
  ok('H10 STATIC every write-shaped route this console calls is classified as tracker or not-tracker',
    unclassified.length === 0, unclassified.join(','));
  // And every route classified as a tracker write must close the gate at its
  // own call site. The slice runs from the apiFetch to the NEXT apiFetch, so it
  // cannot borrow a neighbour's hook call.
  // Anchored on the WIRE NAME, not on `apiFetch(`: three of these build their
  // query into a variable first, so an apiFetch-anchored sweep found no call
  // site for them and would have reported them clean by finding nothing. The
  // slice runs to the next ?api= literal anywhere in the file, so a site cannot
  // borrow its neighbour's hook call.
  // A route named in a COMMENT is not a call site, and must not truncate a real
  // one's slice either: wlMarkReceived's own header names ?api=opMarkMoneyReceived
  // nine lines above the call, which reported the live hook below it as missing.
  const isInComment = (at) => html.slice(html.lastIndexOf('\n', at) + 1, at).indexOf('//') > -1;
  const apiLiteralOffsets = (function () { const out = []; const re = /\?api=[A-Za-z0-9_]+/g; let m; while ((m = re.exec(html))) { if (!isInComment(m.index)) out.push(m.index); } return out; })();
  const routeSites = (route) => {
    const out = []; const re = new RegExp('\\?api=' + route + '(?![A-Za-z0-9_])', 'g'); let m;
    while ((m = re.exec(html))) { if (!isInComment(m.index)) out.push(m.index); }
    return out;
  };
  // The two fill-a-cell panels are the deliberate exception: their route name
  // lives in a config object and the write is issued by a SHARED shell, so the
  // hook cannot sit beside the literal. They are held to the shell instead, and
  // to every config carrying the sentence the shell will speak.
  const SHELL_ROUTES = ['opSetRowAmount', 'opSetRowBankDetails'];
  const shell = (function () {
    const at = html.indexOf('function wireFillRowCell_(');
    return at < 0 ? '' : html.slice(at, html.indexOf('function wireFillRowCell_(') + 4000);
  })();
  ok('H10 STATIC the shared fill-a-cell shell closes the gate for both panels it drives',
    /wlNoteTrackerWrite_\(cfg\.wroteWhat\)/.test(shell), shell.slice(0, 80));
  const configsWithoutWhat = (html.match(/wireFillRowCell_\(\{[\s\S]*?\n\s*\}\);/g) || [])
    .filter((c) => c.indexOf('wroteWhat:') < 0);
  ok('H10 STATIC every fill-a-cell config names what it wrote, so the shell has a sentence to speak',
    configsWithoutWhat.length === 0 && (html.match(/wireFillRowCell_\(\{/g) || []).length === 2,
    configsWithoutWhat.join(' | '));

  const notHooked = [];
  TRACKER_WRITE_ROUTES.forEach(function (route) {
    if (SHELL_ROUTES.indexOf(route) > -1) return; // held to the shell, just above
    const sites = routeSites(route);
    if (!sites.length) { notHooked.push(route + ' (no call site found at all)'); return; }
    sites.forEach(function (at) {
      let end = html.length;
      for (const off of apiLiteralOffsets) { if (off > at) { end = off; break; } }
      const slice = html.slice(at, end);
      if (!/wlNoteTrackerWrite_\(|wlAfterTrackerWrite\(/.test(slice)) {
        notHooked.push(route + ' @line ' + html.slice(0, at).split('\n').length);
      }
    });
  });
  ok('H10 STATIC EVERY tracker-writing call site routes through the gate door',
    notHooked.length === 0, notHooked.join(' | '));
  ok('H10 STATIC the door is one function, so a writer cannot half-implement it',
    (html.match(/function wlNoteTrackerWrite_\(/g) || []).length === 1
    && (html.match(/wlTrackerWriteHook_=wlAfterTrackerWrite;/g) || []).length === 1);

  // THE EXECUTED HALF. Four more real buttons in the booted DOM, driven the way
  // the operator drives them.
  const setVal = (id, v) => { const el = win.document.getElementById(id); el.value = v; };
  const EXTRA_ACTIONS = [
    { name: 'add a row by hand', route: 'opAddManualTransferRow', click: () => {
        setVal('mrName', 'Fixture Manual Row'); setVal('mrAmount', '250');
        win.document.getElementById('mrAddBtn').click();
      } },
    { name: 'fill an amount', route: 'opSetRowAmount', click: () => {
        setVal('sraRid', 'manual__fixture'); setVal('sraAmount', '250');
        win.document.getElementById('sraSetBtn').click();
      } },
    { name: 'fill bank details', route: 'opSetRowBankDetails', click: () => {
        setVal('sbdRid', 'manual__fixture'); setVal('sbdBank', 'Bank 12 branch 345 account 67890');
        win.document.getElementById('sbdSetBtn').click();
      } },
    { name: 'money arrived, from the board drawer', route: 'opMarkMoneyReceived', click: () => {
        win.openDrawer(DRAWER_PID);
      }, after: async () => {
        await settle(300);
        const b = win.document.querySelector('#drawer [data-act="markMoneyReceived"]');
        if (!b) return false;
        b.click(); await settle(40);
        const go = win.document.getElementById('dacGo');
        if (!go || win.document.getElementById('dactConfirm').hidden) return false;
        go.click();
        return true;
      } },
  ];

  const genBaselineH10 = genQs().length;
  for (const a of EXTRA_ACTIONS) {
    plan.renderFail = null; plan.peekRowsFail = null;
    plan.letterHash = HASH_APPROVED;
    plan.generate = GOOD_GEN;
    await rearm(win);
    ok('H10 [' + a.name + '] armed off a good render before the write', armed(win), txt(win, 'wlGateNote'));
    const noteBefore = txt(win, 'wlGateNote');
    const writesBefore = plan.writes.length;
    plan.letterHash = HASH_NOW; // the sheet now composes a different letter
    a.click();
    if (a.after) { const reached = await a.after(); ok('H10 [' + a.name + '] the real control was reachable and driven', reached !== false); }
    await settle(120); // the write has landed; the re-read is still 600ms away
    ok('H10 [' + a.name + '] the write actually reached ' + a.route,
      plan.writes.length > writesBefore && plan.writes[plan.writes.length - 1] === a.route, plan.writes.slice(-3).join(','));
    ok('H10 [' + a.name + '] GENERATE IS DISARMED AT THE WRITE',
      !armed(win), 'aria-disabled=' + win.document.getElementById('wlGenerateBtn').getAttribute('aria-disabled'));
    ok('H10 [' + a.name + '] the note stops standing byte-identical over a letter that changed',
      txt(win, 'wlGateNote') !== noteBefore && /changed the tracker/.test(txt(win, 'wlGateNote')), txt(win, 'wlGateNote'));
    const gensMid = genQs().length;
    win.document.getElementById('wlGenerateBtn').click();
    await settle(80);
    ok('H10 [' + a.name + '] a click inside the re-read window reaches no settle call',
      genQs().length === gensMid && win.document.getElementById('wlConfirm').hidden,
      'before=' + gensMid + ' after=' + genQs().length);
    await settle(1000);
    ok('H10 [' + a.name + '] the gate re-arms itself once the new letter is on screen',
      armed(win), txt(win, 'wlGateNote'));
    await clickGenerate(win);
    const after = genQs()[genQs().length - 1] || '';
    ok('H10 [' + a.name + '] the click after the write carries the NEW letter, not the one she approved',
      after.indexOf('expectedFactsHash=' + encodeURIComponent(HASH_NOW)) > 0
      && after.indexOf(encodeURIComponent(HASH_APPROVED)) < 0, after);
  }
  const unhashedH10 = genQs().slice(genBaselineH10).filter((qs) => qs.indexOf('expectedFactsHash=') < 0);
  ok('H10 AT THE WIRE: no click after any of the four reached the settle route without a hash',
    unhashedH10.length === 0, unhashedH10.join(' | '));
  ok('H10 all eight tracker-writing routes were exercised for real',
    TRACKER_WRITE_ROUTES.filter((r) => r !== 'diagOpenMonthTab').every((r) => plan.writes.indexOf(r) > -1),
    plan.writes.join(','));

  // ================= H11: THE SCREEN SAYS WHAT THE WIRE ALREADY KNOWS =======
  // After a row action whose render SUCCEEDS the settle correctly carries the
  // new hash - and the persistent gate note was byte-identical before and
  // after, so the operator had no signal at all that what she approved had been
  // replaced. The wire knew; the screen did not.
  const noteClass = () => (win.document.getElementById('wlGateNote').className || '');
  plan.letterHash = HASH_APPROVED;
  plan.generate = GOOD_GEN;
  await rearm(win);
  const cleanNote = txt(win, 'wlGateNote');
  ok('H11 a plain review arms with the ordinary note and no alarm on it',
    armed(win) && /Generate will settle/.test(cleanNote) && noteClass() === '', cleanNote + ' :: class=' + noteClass());
  plan.letterHash = HASH_NOW;
  q('#wlGroups [data-act="markMoneyReceived"]').click();
  await settle(1100);
  const changedNote = txt(win, 'wlGateNote');
  ok('H11 the gate re-armed after the write', armed(win), changedNote);
  ok('H11 THE NOTE IS NO LONGER BYTE-IDENTICAL to the one standing before the write',
    changedNote !== cleanNote, 'before=' + cleanNote + ' after=' + changedNote);
  ok('H11 and it says in words that this is a different letter',
    /NEW letter/.test(changedNote) && /not the one you were looking at/.test(changedNote), changedNote);
  ok('H11 it names WHICH change replaced it, not just that something did',
    /marked as money arrived/.test(changedNote), changedNote);
  ok('H11 the note is visually marked, so it does not read as the line that was already there',
    noteClass() === 'wl-gate-changed', 'class=' + noteClass());
  ok('H11 the style for that mark actually exists in the sheet',
    html.indexOf('.wl-gate-changed{') > 0);
  ok('H11 the replacement is spoken to a screen reader too',
    /NEW letter/.test(txt(win, 'wlAnnounce')), txt(win, 'wlAnnounce'));
  ok('H11 it still says what Generate will do, so the alarm did not eat the instruction',
    /Generate will settle/.test(changedNote), changedNote);
  // ---- H12: THE WARNING DOES NOT ERASE ITSELF ------------------------------
  // Round 5 consumed the flag in the review that SAID it, so the warning lived
  // exactly until the next review repainted the note - measured at ~600ms, and
  // the note it was replaced by was byte-identical to the pre-write one. The
  // state the operator was left holding therefore said nothing had happened.
  //
  // Re-reviewed through the STRUCK-NAV OVERRIDE, not through the month select:
  // the month and currency handlers clear the pending writes themselves (a
  // different letter by her own doing), so re-arming through either of them
  // proves nothing about persistence. The override fires runReview with the
  // list untouched, which is the path the wipe actually happened on.
  const dryBeforeStick = dryRuns();
  typeNav('2026-08');
  await settle(1000);
  ok('H12 the override re-ran the review with nothing else changed',
    dryRuns() > dryBeforeStick && armed(win), txt(win, 'wlGateNote'));
  ok('H12 THE WARNING SURVIVES the next review instead of being wiped by it',
    /NEW letter/.test(txt(win, 'wlGateNote')) && noteClass() === 'wl-gate-changed',
    txt(win, 'wlGateNote') + ' :: class=' + noteClass());
  typeNav('');
  await settle(900);
  ok('H12 and it survives the review after that one too',
    armed(win) && /NEW letter/.test(txt(win, 'wlGateNote')) && noteClass() === 'wl-gate-changed',
    txt(win, 'wlGateNote') + ' :: class=' + noteClass());

  // THE REPORTED REPRODUCTION: two row actions less than 600ms apart. The first
  // re-review painted the warning; the second landed behind it with nothing
  // left to say and repainted the pre-write sentence over it.
  plan.letterHash = HASH_APPROVED;
  await rearm(win);
  const cleanNote2 = txt(win, 'wlGateNote');
  ok('H12 RAPID armed clean before the two clicks',
    armed(win) && noteClass() === '' && !/NEW letter/.test(cleanNote2), cleanNote2 + ' :: class=' + noteClass());
  plan.letterHash = HASH_NOW;
  q('#wlGroups [data-act="markMoneyReceived"]').click();
  await settle(300);   // inside the first write's own 600ms re-read window
  q('#wlParked [data-act="unparkRow"]').click();
  await settle(700);   // the first re-review has landed and said it
  ok('H12 RAPID the warning is on the note after the first re-review',
    /NEW letter/.test(txt(win, 'wlGateNote')), txt(win, 'wlGateNote'));
  await settle(1400);  // the second write's re-review has landed too
  const afterBoth = txt(win, 'wlGateNote');
  ok('H12 RAPID THE SECOND RE-REVIEW DOES NOT WIPE IT',
    /NEW letter/.test(afterBoth) && noteClass() === 'wl-gate-changed', afterBoth + ' :: class=' + noteClass());
  ok('H12 RAPID so the note she is left holding is not byte-identical to the pre-write one',
    afterBoth !== cleanNote2, afterBoth);
  ok('H12 RAPID and it names BOTH changes, not only the one that spoke last',
    /money arrived/.test(afterBoth) && /un-parked/.test(afterBoth), afterBoth);
  ok('H12 RAPID the gate is armed while it says so, so this is a warning and not a block',
    armed(win), 'aria-disabled=' + win.document.getElementById('wlGenerateBtn').getAttribute('aria-disabled'));

  // SPENT ONLY WHERE SHE HAS SEEN IT AT THE POINT OF DECISION. The confirm is
  // the last screen before rows are settled, so the substitution is restated
  // there and only then does the note stop carrying it.
  win.document.getElementById('wlGenerateBtn').click();
  await settle(60);
  const cm = htm(win, 'wlConfirmMsg');
  ok('H12 SEEN the confirm step restates the substitution before anything settles',
    /re-read after you changed the tracker/.test(cm) && /money arrived/.test(cm), cm.slice(0, 400));
  ok('H12 SEEN and it still states the batch it is settling',
    /Settle 1 row/.test(cm), cm.slice(0, 200));
  win.document.getElementById('wlConfirmCancel').click();
  await settle(60);
  const dryBeforeSeen = dryRuns();
  typeNav('2026-08');
  await settle(1000);
  ok('H12 SEEN the next review then arms clean, so the alarm is not decoration by the second month',
    dryRuns() > dryBeforeSeen && armed(win) && noteClass() === '' && !/NEW letter/.test(txt(win, 'wlGateNote')),
    txt(win, 'wlGateNote') + ' :: class=' + noteClass());
  typeNav('');
  await settle(900);
  // A month or currency change is a different letter by her own doing, and must
  // not be dressed up as a substitution underneath her. The flip has to happen
  // INSIDE the re-read window, while the flag is still set: after the review has
  // armed, the flag is already spent and any handler would look correct.
  // ASSERTED BEFORE THE WRITE'S OWN RE-READ LANDS. wlAfterTrackerWrite schedules
  // its re-review 600ms out; that later review consumes the flag and arms clean
  // whatever the handler did, so an assertion taken after it passes on a handler
  // that clears nothing. Each flip is checked inside its own window.
  for (const nm of ['wlCurrency', 'wlMonth']) {
    plan.letterHash = HASH_APPROVED;
    await rearm(win);
    plan.letterHash = HASH_NOW;
    q('#wlGroups [data-act="markMoneyReceived"]').click();
    await settle(60);
    ok('H11 [' + nm + '] the write is still unspoken at the moment she uses the select',
      !armed(win) && /changed the tracker/.test(txt(win, 'wlGateNote')), txt(win, 'wlGateNote'));
    win.document.getElementById(nm).onchange();
    await settle(300); // the select's own review has landed; the write's has not
    ok('H11 [' + nm + '] a change she made herself is not dressed up as a letter substituted underneath her',
      armed(win) && noteClass() === '' && !/NEW letter/.test(txt(win, 'wlGateNote')),
      txt(win, 'wlGateNote') + ' :: class=' + noteClass());
    await settle(1000); // let the write's own re-read land before the next case
  }

  // ============ H13: NO EARLY RETURN LEAVES A PERMANENT FALSE PROMISE =======
  // Every path into runReview arrives behind a TRANSIENT note: "the letter is
  // being re-read", "re-reading the month now", each promising that Generate
  // arms itself once the new letter is on screen. That promise is only true if
  // the review that follows writes a note of its own. Five early returns wrote
  // none, so the sentence stood forever over a shut gate, naming an event that
  // would never happen and no control that would cause it.
  //
  // THE FALSE PROMISE IS THE THING ASSERTED ON, not a wording. A note claiming
  // the letter is IN FLIGHT while nothing is in flight is the defect: it
  // promises an arrival, requires nothing of the operator, and never resolves.
  // A note that says the gate arms itself once SHE does the named thing is not
  // that, which is why the control is asserted beside every one of these.
  const claimsInFlight = () => /being re-read|Re-reading|still being read/.test(txt(win, 'wlGateNote'));
  plan.renderFail = null; plan.renderBare = false; plan.renderEmpty = false; plan.peekRowsFail = null;
  plan.reviewFail = null; plan.reviewBare = false; plan.reviewNull = false;
  plan.letterHash = HASH_APPROVED;
  plan.generate = GOOD_GEN;

  // --- THE REPORTED INSTANCE: an invalid override, then any other re-read ----
  await rearm(win);
  ok('H13 armed before the override is made invalid', armed(win), txt(win, 'wlGateNote'));
  typeNav('2026-13');
  await settle(900);
  ok('H13 the malformed override alone still names the field and the two ways out',
    /must be YYYY-MM/.test(txt(win, 'wlGateNote')) && /clear it/.test(txt(win, 'wlGateNote')), txt(win, 'wlGateNote'));
  // A TRACKER WRITE while the override is invalid. This is the re-read that
  // reached the invalid-override return before it could write a real reason.
  q('#wlGroups [data-act="markMoneyReceived"]').click();
  await settle(1400);
  const strandedA = txt(win, 'wlGateNote');
  ok('H13 WRITE the gate is shut and stays shut, which is correct on an invalid override', !armed(win), strandedA);
  ok('H13 WRITE THE NOTE CLAIMS NO RE-READ THAT IS NOT HAPPENING',
    !claimsInFlight(), strandedA);
  ok('H13 WRITE it says what is actually wrong', /must be YYYY-MM/.test(strandedA), strandedA);
  ok('H13 WRITE and it names the field that fixes it, not "the letter"',
    /Struck NAV month/.test(strandedA) && /clear it/.test(strandedA), strandedA);
  await settle(1200);
  ok('H13 WRITE the note is terminal: nothing lands later to correct it',
    txt(win, 'wlGateNote') === strandedA, txt(win, 'wlGateNote'));
  // --- the same stranding through the MONTH select --------------------------
  win.document.getElementById('wlMonth').onchange();
  await settle(1200);
  ok('H13 MONTH a month change with the override invalid strands no in-flight claim either',
    !claimsInFlight() && /must be YYYY-MM/.test(txt(win, 'wlGateNote')), txt(win, 'wlGateNote'));
  // AND THE WAY OUT WORKS: the field it names is the field that re-arms it.
  typeNav('');
  await settle(1200);
  ok('H13 clearing the field the note names re-arms the gate', armed(win), txt(win, 'wlGateNote'));

  // --- NO MONTH AT ALL, the other pre-flight return -------------------------
  const monthSel = win.document.getElementById('wlMonth');
  const keepMonth = monthSel.value;
  monthSel.value = '';
  monthSel.onchange();
  await settle(900);
  ok('H13 NO MONTH the gate note claims no letter that is not coming',
    !claimsInFlight(), txt(win, 'wlGateNote'));
  ok('H13 NO MONTH it says what is missing and where to fix it',
    /No month is selected/.test(txt(win, 'wlGateNote')) && /Pick a month above/.test(txt(win, 'wlGateNote')),
    txt(win, 'wlGateNote'));
  monthSel.value = keepMonth;
  monthSel.onchange();
  await settle(900);
  ok('H13 NO MONTH picking one again re-arms the gate', armed(win), txt(win, 'wlGateNote'));

  // --- THE THREE WAYS THE REVIEW CALL ITSELF ENDS WITHOUT A VERDICT ---------
  const REVIEW_OUTAGES = [
    { name: 'ok:false', set: () => { plan.reviewFail = 'dry run backend down'; }, quote: /dry run backend down/ },
    { name: 'a body with no ok field', set: () => { plan.reviewBare = true; }, quote: /Review failed/ },
    { name: 'no body at all', set: () => { plan.reviewNull = true; }, quote: /No response/ },
  ];
  for (const o of REVIEW_OUTAGES) {
    plan.reviewFail = null; plan.reviewBare = false; plan.reviewNull = false;
    plan.letterHash = HASH_APPROVED;
    await rearm(win);
    ok('H13 REVIEW [' + o.name + '] armed before the outage', armed(win), txt(win, 'wlGateNote'));
    o.set();
    const gensBefore = genQs().length;
    win.document.getElementById('wlMonth').onchange();
    await settle(900);
    ok('H13 REVIEW [' + o.name + '] GENERATE IS DISARMED', !armed(win),
      'aria-disabled=' + win.document.getElementById('wlGenerateBtn').getAttribute('aria-disabled'));
    ok('H13 REVIEW [' + o.name + '] the note claims no re-read that is not happening',
      !claimsInFlight(), txt(win, 'wlGateNote'));
    ok('H13 REVIEW [' + o.name + '] and it names the control that re-runs it',
      /Retry the review above/.test(txt(win, 'wlGateNote')), txt(win, 'wlGateNote'));
    ok('H13 REVIEW [' + o.name + '] the failure quotes the server rather than a generic line',
      o.quote.test(htm(win, 'wlFindings')), htm(win, 'wlFindings').slice(0, 200));
    win.document.getElementById('wlGenerateBtn').click();
    await settle(80);
    ok('H13 REVIEW [' + o.name + '] a click reaches no settle call at all',
      genQs().length === gensBefore && win.document.getElementById('wlConfirm').hidden,
      'before=' + gensBefore + ' after=' + genQs().length);
    // THE CONTROL THE NOTE NAMES EXISTS AND WORKS.
    const rr = win.document.getElementById('wlReviewRetry');
    ok('H13 REVIEW [' + o.name + '] the failed review draws the retry it names', !!rr, htm(win, 'wlFindings').slice(0, 200));
    plan.reviewFail = null; plan.reviewBare = false; plan.reviewNull = false;
    if (rr) rr.click();
    await settle(900);
    ok('H13 REVIEW [' + o.name + '] the retry re-arms the gate with no reload and no hidden button',
      armed(win), txt(win, 'wlGateNote'));
  }

  // --- THE CLASS, held structurally ----------------------------------------
  // The PREVENT half. Every `return;` inside runReview must be preceded, since
  // the previous return, by a call that writes the persistent note. A sixth
  // early return added later fails here by name rather than shipping another
  // permanent false promise.
  const reviewSrc = rawFn('runReview');
  ok('H13 CLASS runReview was found (empty = the sweep is broken)', reviewSrc.length > 0);
  const silentReturns = (function () {
    const out = [];
    // wlCloseGate('') is NOT a note-writer: it disarms and leaves whatever
    // sentence is standing. Counting it let a silent return borrow the
    // pre-flight disarm and report clean, which is this sweep failing the same
    // way the code did.
    const stripped = reviewSrc.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
      .split("wlCloseGate('')").join('wlDisarmOnly_()');
    let last = 0; const re = /\breturn;/g; let m;
    while ((m = re.exec(stripped))) {
      const window_ = stripped.slice(last, m.index);
      if (!/wlReviewStop_\(|wlCloseGate\(|wlGateNote_\(/.test(window_)) {
        out.push(stripped.slice(Math.max(0, m.index - 90), m.index + 8).replace(/\s+/g, ' '));
      }
      last = m.index;
    }
    return out;
  })();
  ok('H13 CLASS the sweep found runReview\'s returns (empty = the sweep is broken)',
    (reviewSrc.match(/\breturn;/g) || []).length >= 5, (reviewSrc.match(/\breturn;/g) || []).length);
  ok('H13 CLASS EVERY early return in runReview writes the note it leaves the operator with',
    silentReturns.length === 0, silentReturns.join(' | '));
  // The .catch arm has no `return;` to sweep, and it is an exit like any other.
  const catchArm = (function () {
    const at = reviewSrc.indexOf('}).catch(function(err){');
    return at < 0 ? '' : reviewSrc.slice(at);
  })();
  ok('H13 CLASS the unreachable-server exit writes a note too', /wlReviewStop_\(/.test(catchArm),
    catchArm.replace(/\s+/g, ' ').slice(0, 200));

  win.close();
  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL harness threw :: ' + (e && e.stack || e)); process.exit(1); });

