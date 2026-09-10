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
ok('H1 renderLetter clears the stored facts before anything else',
  /^function renderLetter\(\)\{\s*wlApproved=null;/.test(renderFn), renderFn.slice(0, 120));
ok('H1 the stored facts come from the render response, never from the page',
  /if\(r\.factsHash\)wlApproved=\{month:month,currency:ccy,hash:String\(r\.factsHash\),rowFacts:String\(r\.rowFacts\|\|''\)\}/.test(renderFn),
  renderFn.slice(renderFn.indexOf('factsHash') - 80, renderFn.indexOf('factsHash') + 200));
ok('H1 a render that answers with no hash leaves nothing stored',
  renderFn.indexOf('wlApproved={') === renderFn.lastIndexOf('wlApproved={'));

// ---- H2: the generate click, executed for real -----------------------------
// The shipped expression itself is pulled out and RUN against fabricated
// state. Asserting on the source text alone would pass on an expression that
// reads the wrong field.
const qsSrc = (html.match(/var facts=\(wlApproved[\s\S]*?:'';/) || [''])[0];
ok('H2 the generate handler builds a facts query', qsSrc.length > 0);
// Absent = the wiring is gone, which is exactly what this file exists to
// catch; every case below then FAILS by name instead of the rig throwing.
const buildQs = qsSrc ? new Function('wlApproved', 'snap', qsSrc + ' return factsQs;') : function () { return null; };
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
  holdRender: null, // when set, opRenderMonthLetter parks here until released
  calls: [],
};
function answerFor(q) {
  const api = (q.match(/^\?(?:api|admin)=([A-Za-z0-9_]+)/) || [])[1] || '';
  if (api === 'listTrackerMonthTabs') return { ok: true, months: [MONTH, '08/2026'] };
  if (api === 'opPeekMonthTransfers') return { ok: true, transfers: [{ rowNum: 12, name: 'Test Row', amount: 1000, direction: 'out' }] };
  if (api === 'opPeekAwaitingMoney' || api === 'opPeekParked') return { ok: true, rows: [] };
  if (api === 'opRenderMonthLetter') {
    return { ok: true, transfers: [{ rowNum: 12 }], html: '<p>the letter</p>', factsHash: plan.letterHash, rowFacts: ROWFACTS_APPROVED };
  }
  if (api === 'opGenerateMonthlyWireLetter') {
    if (/dryRun=true/.test(q)) return { ok: true, go: true, counts: { incoming: 0, outgoing: 1, total: 1 } };
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

  win.close();
  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL harness threw :: ' + (e && e.stack || e)); process.exit(1); });

