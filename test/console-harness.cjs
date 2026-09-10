// Console harness (2026-07-15 console wiring). Extracts the LIVE functions from
// console/index.html (house pattern, same as client-honesty-harness.cjs) and
// proves the top-5 wiring behaviors client-side:
//   K1  sortRows pins needs_attention rows first, then last-activity recency
//       (item 3: attention-first ordering survived being buried by the pure
//       recency sort).
//   K2  fmtAmount / inflightTotals: amount column formatting + the sidebar
//       in-flight total per currency, pre-submit rows contributing nothing
//       (item 4).
//   K3  refreshDelayMs: silent-refresh scheduling fires 5 minutes before
//       expiry, clamped to [0, 12h] (item 5); the silent flow uses prompt=none
//       while the interactive sign-in keeps prompt=select_account.
//   K4  signerTsLine / currentSignerHtml: per-signer invited/signed timestamps
//       and the current-signer block carrying name, email, X of Y, the
//       copyable link and the Remind (nudge) action (items 1+2).
//   K6  source-level wiring: the board fetch defaults includeDone to the
//       toggle state (0 until a toggle asks), sends &lane=, renderDrawer has
//       the d.people pre-submit branch (P1 #6), and the removed unauthenticated
//       curl routes (linkToOperator / nudgeSigner) are referenced nowhere.
// Run: node test/console-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); } }

// Brace-counting extractor: grabs `function NAME(...) { ... }` from the live source.
// The three stage predicates now DERIVE from BOARD_TERMINAL_ (2026-09-07: the
// terminal vocabulary was hand-written in three places that disagreed, and an
// abandoned row that only one of them retired blanked the live board). Every
// composition below that pulls one of them needs the map in scope, so
// extractFn carries it rather than making fourteen call sites remember. `var`
// redeclaration inside one Function body is legal, so pulling two predicates
// at once is harmless.
const VOCAB_DEPENDENTS = ['isTerminalStage', 'isCompletedStage', 'isCanceledStage'];
// stageMilestone reads RETIRED_LABEL for the same reason: what to CALL a
// retired row became a lookup instead of an equality chain, so the chain could
// not drift from the vocabulary that decides which rows are retired at all.
const LABEL_DEPENDENTS = ['stageMilestone'];
// paintVerLine_ composes sinceDur's output through agoPhrase. Carrying it here
// rather than at each call site is the same bargain the two lists above make:
// a rig that pulled the painter alone got a ReferenceError, and load()'s catch
// swallowed it into an unrelated board-error path.
const AGO_DEPENDENTS = ['paintVerLine_'];
// rowHtml delegates its who-cell to nameCellHtml (2026-09-10). Two separate
// call sites below build a rowHtml sandbox; naming the dependency here rather
// than in each of their string lists is what keeps the second one from
// throwing ReferenceError the next time either list is edited.
const NAMECELL_DEPENDENTS = ['rowHtml'];
function extractFn(name) {
  if (VOCAB_DEPENDENTS.includes(name)) return extractVarObj('BOARD_TERMINAL_') + rawFn(name);
  if (LABEL_DEPENDENTS.includes(name)) return extractVarObj('RETIRED_LABEL') + rawFn(name);
  if (AGO_DEPENDENTS.includes(name)) return rawFn('agoPhrase') + ';' + rawFn(name);
  if (NAMECELL_DEPENDENTS.includes(name)) return rawFn('nameCellHtml') + ';' + rawFn(name);
  return rawFn(name);
}
function rawFn(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}
function extractVar(name) {
  // \s* before '=' tolerates both spacing conventions this file mixes (e.g.
  // 'var GW = ...' vs 'var RCOPY_ICON=...').
  const m = html.match(new RegExp('var ' + name + '\\s*=[^\\n]*;'));
  if (!m) throw new Error('var not found: ' + name);
  return m[0];
}
// Same brace-counting technique as extractFn, for a multi-line `var NAME=[...];`
// array literal (the RECOVERY_ACTIONS registry).
function extractVarArr(name) {
  const start = html.indexOf('var ' + name + '=[');
  if (start < 0) throw new Error('array var not found: ' + name);
  let i = html.indexOf('[', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') { depth--; if (depth === 0) return html.slice(start, i + 1) + ';'; }
  }
  throw new Error('unbalanced brackets for ' + name);
}
// Same brace-counting technique as extractFn, for a multi-line `var NAME={...};`
// object literal (extractVar's single-line regex can't span these).
function extractVarObj(name) {
  const start = html.indexOf('var ' + name + '={');
  if (start < 0) throw new Error('var object not found: ' + name);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  return html.slice(start, i + 1) + ';';
}

// ---- K1: sortRows attention-first -------------------------------------------
(function () {
  // isAttnRow joined this composition on 2026-09-02: sortRows now asks it
  // whether a row wants attention, rather than re-deriving that from the stage.
  // The harness evaluates these functions in isolation, so a new dependency has
  // to be named here - which is the point, and is how it caught the omission
  // before the console shipped.
  const sortRows = new Function(
    extractFn('isAttnStage') + ';' + extractFn('isCompletedStage') + ';' +
    extractFn('isManualRow_') + ';' +
    extractFn('isAttnRow') + ';' + extractFn('sortRows') + '; return sortRows;',
  )();
  const rows = [
    { pid: 'new', stage: 'signing', lastActivityTs: '2026-07-15T09:00:00Z' },
    { pid: 'attn-old', stage: 'needs_attention', lastActivityTs: '2026-07-01T09:00:00Z' },
    { pid: 'mid', stage: 'submitted', lastActivityTs: '2026-07-10T09:00:00Z' },
    { pid: 'attn-new', stage: 'needs_attention', lastActivityTs: '2026-07-14T09:00:00Z' },
  ];
  const order = sortRows(rows).map((r) => r.pid);
  ok('K1 attention rows pinned first', order[0] === 'attn-new' && order[1] === 'attn-old', order.join(','));
  ok('K1 recency ordering below the pin', order[2] === 'new' && order[3] === 'mid', order.join(','));
  // ageNum fallback path (no lastActivityTs anywhere): smaller age first.
  const byAge = sortRows([{ pid: 'a', stage: 'signing', ageNum: 5 }, { pid: 'b', stage: 'signing', ageNum: 1 }]).map((r) => r.pid);
  ok('K1 ageNum fallback', byAge[0] === 'b', byAge.join(','));
})();

// ---- K2: fmtAmount / inflightTotals ------------------------------------------
(function () {
  // CCY_ALIASES added 928c28c (Hebrew currency words); fmtAmount depends on it.
  const src = extractVar('CCY_SYMBOL') + ';' + extractVar('CCY_ALIASES') + ';' + extractFn('fmtAmount') + ';'
    + extractFn('isTerminalStage') + ';' + extractFn('inflightTotals') + ';' + extractFn('unattributedTotals')
    + '; return { fmtAmount: fmtAmount, inflightTotals: inflightTotals, unattributedTotals: unattributedTotals };';
  const { fmtAmount, inflightTotals, unattributedTotals } = new Function(src)();
  ok('K2 Hebrew ccy word normalizes', fmtAmount(250000, 'שקל') === '₪250,000', fmtAmount(250000, 'שקל'));
  ok('K2 ILS symbol', fmtAmount(250000, 'ILS') === '₪250,000', fmtAmount(250000, 'ILS'));
  ok('K2 USD symbol', fmtAmount(50000, 'USD') === '$50,000', fmtAmount(50000, 'USD'));
  ok('K2 unknown ccy suffix', fmtAmount(100, 'CHF') === '100 CHF', fmtAmount(100, 'CHF'));
  ok('K2 blank for null', fmtAmount(null, 'ILS') === '');
  ok('K2 blank for non-numeric', fmtAmount('abc', 'ILS') === '');
  const t = inflightTotals([
    { stage: 'signing', amountNum: 100000, ccy: 'ILS' },
    { stage: 'submitted', amountNum: 50000, ccy: 'ILS' },
    { stage: 'signing', amountNum: 25000, ccy: 'USD' },
    { stage: 'complete', amountNum: 999999, ccy: 'ILS' },   // terminal: excluded
    { stage: 'signing', amountNum: null, ccy: 'ILS' },       // pre-submit: excluded
  ]);
  ok('K2 totals per currency', t.ILS === 150000 && t.USD === 25000, JSON.stringify(t));
  ok('K2 empty rows -> empty totals', Object.keys(inflightTotals([])).length === 0);

  // A LANE-LESS ROW IS NEVER THIS FUND'S MONEY (2026-09-10).
  //
  // Noa opened the Cayman board and it read "3,000,000 IN FLIGHT" in SHEKELS.
  // The whole figure was one Israeli limited partnership's manual transfer row
  // (manual__c27ed14e...), which carries ju-service's 'unknown' lane sentinel
  // and is therefore shown on BOTH fund tabs so neither operator loses it. The
  // Cayman fund's money is USD and it has no in-flight money at all, and the
  // same 3,000,000 was simultaneously absent from Israel's total.
  //
  // Showing the row on both tabs is correct. Summing it into a tab's total is a
  // separate act and it states something nobody can state: which fund's money
  // it is. opAddManualTransferRow takes no lane and writes no registry row.
  const laneless = [
    { stage: 'needs_attention', amountNum: 3000000, ccy: 'ILS', lane: 'unknown' },
    { stage: 'signing', amountNum: 100000, ccy: 'ILS', lane: 'israeli' },
  ];
  const lt = inflightTotals(laneless);
  ok('K2 a lane-unknown row is NOT counted in a fund total', lt.ILS === 100000, JSON.stringify(lt));
  const ut = unattributedTotals(laneless);
  ok('K2 it is reported on its own, so the money is never simply lost', ut.ILS === 3000000, JSON.stringify(ut));
  ok('K2 the two are disjoint: a laned row never appears as unattributed',
    Object.keys(unattributedTotals([{ stage: 'signing', amountNum: 5, ccy: 'USD', lane: 'cayman' }])).length === 0);
  // The sentinel is the literal string 'unknown', not emptiness. A row with no
  // lane at all is an ordinary row of the tab it was fetched for, and folding
  // the two together would silently drop every normal row out of the total.
  ok('K2 a blank lane is NOT the unknown sentinel',
    inflightTotals([{ stage: 'signing', amountNum: 7, ccy: 'USD', lane: '' }]).USD === 7);
  ok('K2 a missing lane field is NOT the unknown sentinel',
    inflightTotals([{ stage: 'signing', amountNum: 7, ccy: 'USD' }]).USD === 7);
  // Terminal and figure-less rows stay excluded from BOTH, same as before.
  ok('K2 unattributed still excludes terminal and figure-less rows',
    Object.keys(unattributedTotals([
      { stage: 'complete', amountNum: 1, ccy: 'ILS', lane: 'unknown' },
      { stage: 'needs_attention', amountNum: null, ccy: 'ILS', lane: 'unknown' },
    ])).length === 0);
})();

// ---- K2b: the lane-less row explains itself on the board ---------------------
(function () {
  // ju-service's routes/consolemanualrows.ts appends ' (lane not recorded)' to
  // nextActionPhrase for this row, and its own comment states the reason: "a
  // row appearing on both fund tabs with no explanation reads as a bug rather
  // than as the honest statement it is". renderRows substitutes its own
  // two-line manual copy and dropped that half, so Noa got an Israeli
  // partnership sitting on the Cayman board with nothing saying why.
  ok('K2b the manual row carries the lane-not-recorded marker',
    /Tracked in the transfer form'\+\(laneless\?' &middot; lane not recorded':''\)/.test(html));
  ok('K2b the marker is driven by the lane sentinel, not by the manual flag',
    /var laneless=String\(\(r&&r\.lane\)\|\|''\)==='unknown';/.test(html));
})();

// ---- K3: silent-refresh scheduling -------------------------------------------
(function () {
  const refreshDelayMs = new Function(extractFn('refreshDelayMs') + '; return refreshDelayMs;')();
  const now = 1000000000000;
  ok('K3 fires 5 min early', refreshDelayMs(now + 3600000, now) === 3600000 - 300000);
  ok('K3 clamps past-due to 0', refreshDelayMs(now - 1000, now) === 0);
  ok('K3 caps at 12h', refreshDelayMs(now + 100 * 3600000, now) === 12 * 3600000);
  ok('K3 no exp -> 0', refreshDelayMs(0, now) === 0);
  const silent = extractFn('silentTokenRefresh');
  ok('K3 silent flow uses prompt=none', /prompt:\s*'none'/.test(silent));
  const interactive = extractFn('startGoogleSignIn');
  ok('K3 interactive sign-in keeps select_account', /prompt:\s*'select_account'/.test(interactive));
  ok('K3 refresh scheduled after auth boot', /scheduleTokenRefresh\(\);/.test(extractFn('initAuth')));
  ok('K3 sign-out kills the refresh timer', /clearTimeout\(_refreshTimer\)/.test(extractFn('clearAuth')));
})();

// ---- K4: drawer signer truth + current-signer block ---------------------------
(function () {
  // currentSignerHtml delegates its recovery controls to recoveryHtml, which
  // reads the RECOVERY_ACTIONS registry - pull all three in, or the block
  // throws on the first call.
  const src = extractFn('esc2') + ';' + extractFn('fmtTs') + ';' + extractFn('signerTsLine') + ';'
    + extractFn('signerReminders') + ';' + extractFn('reminderHistLine') + ';'
    + extractFn('sinceDur') + ';' + extractFn('signerWaitLine') + ';'
    + extractVarArr('RECOVERY_ACTIONS')
    + extractFn('recoveryActionByKey') + ';' + extractFn('recoveryHtml') + ';'
    + extractFn('currentSignerHtml')
    + '; return { signerTsLine: signerTsLine, currentSignerHtml: currentSignerHtml, fmtTs: fmtTs, reminderHistLine: reminderHistLine, recoveryHtml: recoveryHtml, RECOVERY_ACTIONS: RECOVERY_ACTIONS };';
  const { signerTsLine, currentSignerHtml, fmtTs, reminderHistLine, recoveryHtml, RECOVERY_ACTIONS } = new Function(src)();
  ok('K4 signed signer shows signed-at', /^Signed 2026-06-26/.test(signerTsLine({ state: 'done', signedAt: '2026-06-26T14:20:00Z', sentAt: '2026-06-25T09:00:00Z' })));
  ok('K4 awaited signer shows invited-at', /^Invited 2026-06-25/.test(signerTsLine({ state: 'current', sentAt: '2026-06-25T09:00:00Z' })));
  ok('K4 no timestamps -> empty line', signerTsLine({ state: 'waiting' }) === '');
  ok('K4 fmtTs invalid -> empty', fmtTs('not-a-date') === '' && fmtTs('') === '');
  const cs = currentSignerHtml({ role: 'lawyer', name: 'Law Yer', email: 'law@x.com', signerIndex: 2, signerCount: 3, link: 'https://sign.legacyvpartners.com/signer.html?t=tok' });
  ok('K4 block carries name', cs.includes('Law Yer'));
  ok('K4 block carries email', cs.includes('law@x.com'));
  ok('K4 block carries X of Y', cs.includes('2 of 3'));
  ok('K4 block carries copyable link', cs.includes('data-c="https://sign.legacyvpartners.com/signer.html?t=tok"'));
  ok('K4 block carries the nudge action', cs.includes('data-act="nudge"'));
  ok('K4 no signer -> empty block', currentSignerHtml(null) === '');
  ok('K4 html-escapes the name', currentSignerHtml({ name: '<img>', signerIndex: 1, signerCount: 1 }).includes('&lt;img&gt;'));
  // K4b: the recovery-control component. Same registry renders every control,
  // so the per-role visibility rules are now assertable in one place - and the
  // attester's paper-qualification button, the one that shipped rendering but
  // not wired, is a first-class case here.
  const keysFor = (cs) => (recoveryHtml(cs).match(/data-recov="([A-Za-z]+)"/g) || []).map(x => x.slice(12, -1));
  const lawyerKeys = keysFor({ role: 'lawyer', name: 'A B', email: 'a@b.com' });
  ok('K4b attester card offers reassign + stamp + paper qualification',
    lawyerKeys.join(',') === 'reassign,lawyerStamp,paperQualification', lawyerKeys.join(','));
  // The paper-qualification control is ROLE-gated only. It used to also carry
  // `&& !cs.done`, and this assertion used to prove that clause worked - but it
  // only passed because the fixture below hand-set done:true. Nothing anywhere
  // sets .done on a current-signer object, and d.currentSigner is by
  // construction the first signer whose state is not 'done', so the clause
  // could never be false against real data. The test was proving a fiction.
  // What is actually true, and now asserted: the control is offered on every
  // attester card the drawer can render, and the not-yet-signed guarantee comes
  // from how currentSigner is chosen, not from a condition in the registry.
  const doneLawyerKeys = keysFor({ role: 'lawyer', name: 'A B', email: 'a@b.com', done: true });
  ok('K4b the paper-qualification control is role-gated, not done-gated',
    doneLawyerKeys.indexOf('paperQualification') !== -1, doneLawyerKeys.join(','));
  // Comments stripped first: the registry's own prose explains why the .done
  // clause was removed, and an unstripped scan matches that explanation rather
  // than any live code.
  const registryCode = extractVarArr('RECOVERY_ACTIONS').replace(/\/\/[^\n]*/g, '');
  ok('K4b no registry row reads a .done flag the server never sends',
    !/cs\.done/.test(registryCode));
  const subKeys = keysFor({ role: 'subscriber', name: 'A B', email: 'a@b.com' });
  ok('K4b subscriber card offers reassign + company stamp + address fix',
    subKeys.join(',') === 'reassign,companyStamp,fixSecondaryAddress', subKeys.join(','));
  ok('K4b every role gets Reassign', keysFor({ role: 'signatory', name: 'A B' }).join(',') === 'reassign');
  ok('K4b controls render inside one labelled group, not five loose buttons',
    (recoveryHtml({ role: 'lawyer', name: 'A B' }).match(/class="recovs"/g) || []).length === 1);
  ok('K4b no recovery control is left with the old per-action class families',
    !cs.includes('cs-attach-toggle') && !cs.includes('cs-paperq-toggle') && !cs.includes('cs-at-save'));
  ok('K4b registry rows all carry a label, a cta and a run',
    RECOVERY_ACTIONS.every(a => a.key && a.label && a.cta && typeof a.run === 'function'));
  // K4d: the in-flight lock must not become a trap. apiFetch has no timeout, so
  // a hung request never runs .then or .catch and busy(false) is never reached.
  ok('K4d Cancel stays clickable while the control is busy',
    /\.recov\.is-busy \.recov-cancel \{[^}]*pointer-events:\s*auto/.test(html));
  ok('K4d a hung request eventually says so instead of sitting silent',
    /var watchdog=setTimeout\(/.test(html) && /No answer from the server yet/.test(html));
  ok('K4d the watchdog is cleared once the request settles (no message after success)',
    /function settle\(\)\{settled=true;clearTimeout\(watchdog\);\}/.test(html));
  // Scope this to the watchdog CALLBACK, not to a window after the word
  // "watchdog": clearTimeout(watchdog) is followed a few lines later by the
  // legitimate busy(false) on the error path, which a loose window matches.
  const wdBody = (html.match(/var watchdog=setTimeout\(function\(\)\{([\s\S]*?)\},\s*\d+\);/) || [])[1] || '';
  ok('K4d the watchdog callback was found', wdBody.length > 0);
  ok('K4d the watchdog does not re-enable Go (no duplicate write)',
    wdBody.indexOf('busy(') === -1, wdBody);
  ok('K4d the watchdog does not claim the action failed',
    wdBody.indexOf("'error'") === -1 && wdBody.indexOf('"error"') === -1);
  // K4e: one malformed control must not abort the forEach and strand its siblings.
  ok('K4e the wirer bails per element when toggle or body is missing',
    /if\(!toggle\|\|!body\)\{unwired\(/.test(html));
  ok('K4e both bail-outs report rather than silently skipping',
    (html.match(/unwired\("/g) || []).length >= 2);
  // K4c: signer state is told by three DIFFERENT materials, not three tints of
  // one. "Current" is the filled chip; "Signed" is a check; "Waiting" a ring.
  const stateSrc = extractFn('signerStateHtml');
  const st = new Function(stateSrc + '; return signerStateHtml;')();
  ok('K4c current signer is the filled chip', st('current') === '<span class="pstate cur">Current</span>');
  ok('K4c signed signer is a check, not a dot', st('done').includes('ptick') && st('done').includes('Signed'));
  ok('K4c waiting signer keeps the hollow ring', st('waiting').includes('pdot') && st('waiting').includes('Waiting'));
  ok('K4c the three states share no glyph', st('current') !== st('done') && st('done') !== st('waiting'));
  ok('K4c unknown state still renders nothing', st('') === '' && st('weird') === '');
  ok('K4c signerTsLine stays clock-free (purity: no sinceDur/Date.now inside it)',
    !/sinceDur|Date\.now/.test(extractFn('signerTsLine')));
  // Reminder history (2026-07-20, Noa: "it's not appearing that we already
  // reminded him"): the block must say whether, when, and how a reminder went.
  const csNoRem = currentSignerHtml({ name: 'A', signerIndex: 2, signerCount: 2 }, []);
  ok('K4 no reminders -> explicit none line', csNoRem.includes('No reminder sent yet.'));
  ok('K4 no reminders -> button says Remind signer', csNoRem.includes('>Remind signer<'));
  const rems = [
    { ts: '2026-07-14T08:00:00Z', kind: 'manual', signerIndex: 2 },
    { ts: '2026-07-15T09:47:00Z', kind: 'auto', signerIndex: 2 },
  ];
  const csRem = currentSignerHtml({ name: 'A', signerIndex: 2, signerCount: 2 }, rems);
  ok('K4 reminded twice reads as twice', csRem.includes('Reminded twice.'));
  ok('K4 last reminder timestamp + kind shown', /Last 2026-07-15 \d{2}:\d{2} \(automatic\)\./.test(csRem));
  ok('K4 reminded -> button says Remind again', csRem.includes('>Remind again<'));
  // Other-signer reminders don't pollute this signer's line.
  const csOther = currentSignerHtml({ name: 'A', signerIndex: 2, signerCount: 2 }, [{ ts: '2026-07-14T08:00:00Z', kind: 'manual', signerIndex: 1 }]);
  ok('K4 other-signer reminders filtered out', csOther.includes('No reminder sent yet.'));
  // Legacy events without a signerIndex stay visible (never hide a real send).
  ok('K4 index-less reminder stays visible', reminderHistLine({ signerIndex: 2 }, [{ ts: '2026-07-14T08:00:00Z', kind: 'manual', signerIndex: null }]).includes('Reminded once.'));
})();

// ---- K6: source-level wiring assertions ---------------------------------------
(function () {
  const loadSrc = extractFn('load');
  const engineFetchSrc = extractFn('fetchEngineBoard_');
  // 2026-08-12 BOARD READ + ACTION SEAM: load() delegates the actual per-
  // engine fetch to fetchEngineBoard_, so the includeDone/lane wiring now
  // lives there, not in load() itself.
  ok('K6 board fetch keys includeDone off the toggles', engineFetchSrc.includes("includeDone='+(wantDone?'1':'0')"));
  ok('K6 board fetch always sends the lane', engineFetchSrc.includes("'?api=list&lane='+lane"));
  ok('K6 no unconditional includeDone=1 fetch left', !engineFetchSrc.includes('includeDone=1'));
  ok('K6 load() asks enginesForLane_ for the Israeli lane\'s engine set, not a single hardcoded gateway', loadSrc.includes('enginesForLane_(state.lane)'));
  const drawerSrc = extractFn('renderDrawer');
  ok('K6 drawer renders d.people pre-submit (P1 #6)', drawerSrc.includes('d.people&&d.people.length'));
  ok('K6 drawer renders the current-signer block', drawerSrc.includes('currentSignerHtml(d.currentSigner,d.reminders)'));
  ok('K6 drawer renders the events timeline', drawerSrc.includes('d.events&&d.events.length'));
  // 2026-07-20 batch: doc NAMES not a count; reminder events named in the
  // timeline; drawer opens on an instant row-data skeleton; current signer
  // leads the panel (Ive Y2) - Quick links render after it.
  ok('K6 drawer renders per-doc names', drawerSrc.includes('d.docs&&d.docs.length'));
  ok('K6 no bare docsCount line left', !html.includes('docsCount'));
  ok('K6 timeline names reminder events', drawerSrc.includes("'Reminder sent'"));
  ok('K6 current signer precedes quick links', drawerSrc.indexOf('Current signer') < drawerSrc.indexOf('Quick links'));
  const openSrc = extractFn('openDrawer');
  ok('K6 drawer opens with row-data skeleton', /allRows\[ki\]\.pid===pid/.test(openSrc) && openSrc.includes('Loading details...'));
  ok('K6 drawer shows created/updated stamps', drawerSrc.includes('d.createdAt') && drawerSrc.includes('d.updatedAt'));
  // The retired unauthenticated curl routes must not be referenced anywhere client-side.
  ok('K6 no linkToOperator reference', !html.includes('linkToOperator'));
  ok('K6 no nudgeSigner route reference', !html.includes('nudgeSigner'));
  // The drawer nudge stays on the auth-gated admin route.
  ok('K6 nudge drives ?admin=nudge', html.includes("'?admin=nudge&processId='"));
})();

// ---- K7: 2026-07-17 review fixes (honest errors, no double-fire, no token resurrection)
(function () {
  const apiFetch = extractFn('apiFetch');
  // Any {ok:false} envelope must THROW so each panel's .catch renders an honest
  // error state instead of painting the empty response as an all-clear.
  ok('K7 apiFetch throws on any ok:false',
    /d&&d\.ok===false\)\{\s*var e=new Error\('server_error'\)/.test(apiFetch));
  // The guard is strict `===false`, so a bare-data response (no ok field,
  // ok===undefined) still passes through as data.
  ok('K7 apiFetch strict-false guard (bare data passes)',
    apiFetch.includes('d.ok===false') && /return d;/.test(apiFetch));
  // A late silent-refresh iframe must never resurrect a token behind a signed-out
  // console: clearAuth bumps the epoch and tears the iframe down.
  const clearAuth = extractFn('clearAuth');
  ok('K7 clearAuth bumps the refresh epoch', /_refreshEpoch\+\+/.test(clearAuth));
  ok('K7 clearAuth tears down the in-flight refresh iframe',
    /_refreshIframe\.remove\(\)/.test(clearAuth));
  const silent = extractFn('silentTokenRefresh');
  ok('K7 refresh onload aborts when the epoch changed',
    /epoch!==_refreshEpoch/.test(silent));
  // The drawer void/reseal confirm strip cannot re-arm or double-fire while an
  // action is in flight.
  ok('K7 drawer action has an in-flight lock', html.includes('dactBusy'));
  ok('K7 arm path refuses re-arm mid-flight',
    /if\(dactBusy\)return;\s*\/\/ an action is already running/.test(html));
  // A failed allowlist load must block Save so an empty textarea can't wipe the
  // operator allowlist.
  ok('K7 settings Save is gated on a successful load', html.includes('ALLOWLIST_LOADED'));
  ok('K7 Save refuses when the allowlist never loaded',
    /if\(!ALLOWLIST_LOADED\)\{/.test(html));
})();

// ---- K8: OIDC nonce check on the redirect-token capture (2026-07-18) ----------
(function () {
  const src = extractFn('tokenPayload') + ';' + extractFn('nonceMatches_')
    + '; return { nonceMatches_: nonceMatches_ };';
  const { nonceMatches_ } = new Function(src)();
  // Minimal unsigned JWT: header.payload.sig; only the payload is read.
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = (claims) => 'h.' + b64u(claims) + '.s';
  ok('K8 matching nonce is accepted', nonceMatches_(jwt({ nonce: 'abc123', email: 'x@y.com' }), 'abc123') === true);
  ok('K8 mismatched nonce rejected', nonceMatches_(jwt({ nonce: 'abc123' }), 'zzz') === false);
  ok('K8 missing stored nonce rejected', nonceMatches_(jwt({ nonce: 'abc123' }), '') === false);
  ok('K8 token with no nonce claim rejected', nonceMatches_(jwt({ email: 'x@y.com' }), 'abc123') === false);
  ok('K8 empty token rejected', nonceMatches_('', 'abc123') === false);
  ok('K8 undecodable token rejected', nonceMatches_('not-a-jwt', 'abc123') === false);
  // The capture site actually calls the guard (login can only be seeded on a match).
  ok('K8 capture gates token storage on nonceMatches_',
    /if\(t&&nonceMatches_\(t,sessionStorage\.getItem\('gsi_nonce'\)\|\|''\)\)\{/.test(html));
  ok('K8 startGoogleSignIn still mints the nonce it checks against',
    /sessionStorage\.setItem\('gsi_nonce',nonce\)/.test(html));
})();

// ---- K9: entity FATCA classification chip (2026-07-20, Noa: "show what entity
// type = passive/active") ----------------------------------------------------
(function () {
  const src = extractFn('esc2') + ';' + extractFn('entityClassChipHtml') + '; return entityClassChipHtml;';
  const entityClassChipHtml = new Function(src)();
  ok('K9 Active NFFE renders as "Entity, Active" (2026-07-31: "entities are active or passive" / "don\'t say NFFE, just active or passive")',
    entityClassChipHtml({ classification: { chapter4Status: 'Active NFFE (W-8BEN-E Part XXV)' } }).includes('>Entity, Active<'));
  ok('K9 Active NFFE gets the active tone class',
    entityClassChipHtml({ classification: { chapter4Status: 'Active NFFE (W-8BEN-E Part XXV)' } }).includes('st-class-active'));
  ok('K9 Passive NFFE renders as "Entity, Passive"',
    entityClassChipHtml({ classification: { chapter4Status: 'Passive NFFE (W-8BEN-E Part XXVI + Part XXX)' } }).includes('>Entity, Passive<'));
  ok('K9 Passive NFFE gets the amber-tone class (attention-worthy: manual CP legs)',
    entityClassChipHtml({ classification: { chapter4Status: 'Passive NFFE (W-8BEN-E Part XXVI + Part XXX)' } }).includes('st-class-passive'));
  ok('K9 individual classification renders nothing (chip is entity-only)',
    entityClassChipHtml({ classification: { chapter4Status: 'N/A (individual: Chapter 3 nonresident alien)' } }) === '');
  ok('K9 no classification at all renders nothing',
    entityClassChipHtml({}) === '');
  ok('K9 pre-submit Israeli entity falls back to the operator mint-time choice',
    entityClassChipHtml({ entityClassification: 'passive' }).includes('Passive (at mint)') &&
    entityClassChipHtml({ entityClassification: 'passive' }).includes('st-class-passive'));
  ok('K9 pre-submit active mint choice',
    entityClassChipHtml({ entityClassification: 'active' }).includes('Active (at mint)'));
})();

// ---- K10: drawer comms extras (2026-07-20) -----------------------------------
(function () {
  // Drawer: "Also cc'd" section carries the family-office + operator cc
  // extras WITHOUT re-listing named parties already shown in Signers/People
  // (Ive S1 - the server already dedupes; the client just renders what it's given).
  const drawerSrc = extractFn('renderDrawer');
  ok("K10 drawer renders commsExtra under Also cc'd", drawerSrc.includes('d.commsExtra&&d.commsExtra.length') && drawerSrc.includes("Also cc'd"));
})();

// ---- K11: per-row operator-private notes (2026-07-22, Noa: "each row to get
// a little note I can edit, its just for me") -------------------------------
(function () {
  // rowHtml is pure (no document access), so it's testable directly like K4's
  // currentSignerHtml. 2026-08-06 board redesign: the row is a grid of
  // who / flow chip / amount / status(word + rail + waiting-on or attention
  // badge) / age / actions - the extraction list carries the new helpers.
  const src = extractFn('esc2') + ';' + extractVar('SEALING_STAGES') + ';' + extractVarObj('STAGE_TO_MILESTONE') + ';'
    + extractVar('RAIL_MILESTONES') + ';' + extractVarObj('STAGE_WORD') + ';' + extractVarObj('FLOW_CHIP_WORD') + ';'
    + extractFn('humanKey') + ';' + extractFn('stageWord') + ';' + extractFn('sinceDur') + ';'
    + extractFn('isAttnStage') + ';' + extractFn('isCanceledStage') + ';'
    + extractFn('flowChipHtml') + ';' + extractFn('waitLineHtml') + ';'
    + extractFn('attnWhyText') + ';' + extractFn('attnBadgeHtml') + ';'
    + extractFn('foldRuns') + ';' + extractFn('foldedRowsHtml') + ';'
    + extractFn('railHtml') + ';' + extractFn('isTerminalStage') + ';'
    + extractFn('isCompletedStage') + ';' + extractFn('signerFraction') + ';' + extractFn('signerRoleLabel') + ';' + extractFn('fmtAmount') + ';'
    + extractVar('CCY_SYMBOL') + ';' + extractVar('CCY_ALIASES') + ';'
    + extractVar('RCOPY_ICON') + ';' + extractVar('RNOTE_ICON') + ';' + extractVar('GW') + ';'
    + extractFn('isManualRow_') + ';'
    + extractFn('isAttnRow') + ';' + extractFn('rowHtml') + '; return { rowHtml: rowHtml, foldedRowsHtml: foldedRowsHtml, foldRuns: foldRuns };';
  const { rowHtml, foldedRowsHtml, foldRuns } = new Function(src)();

  // ---- K12: redesigned row content (2026-08-06) -----------------------------
  const signingRow = rowHtml({ pid: 's1', name: 'Daniel Rosen', he: 'דניאל רוזן', stage: 'signing',
    typeLabel: 'onboarding', amountNum: 250000, ccy: 'USD', age: '4d',
    waitName: 'Sarah Rosen', waitIndex: 2, waitCount: 3, waitSince: new Date(Date.now() - 2 * 86400000).toISOString() });
  // The secondary line gained a title of its own in K14, so this asserts the
  // whole span rather than the attribute-adjacent-to-text it used to pin.
  ok('K12 row carries the Hebrew name RTL-safe (dir=auto)',
    signingRow.includes('<span class="rhe" dir="auto" title="דניאל רוזן">דניאל רוזן</span>'), signingRow);
  ok('K12 row carries the flow chip word', signingRow.includes('>Join</span>'));
  ok('K12 row carries the amount', signingRow.includes('$250,000'));
  ok('K12 row carries the plain stage word', signingRow.includes('>Signing</span>'));
  ok('K12 signing row names WHO it waits on', signingRow.includes('Waiting on') && signingRow.includes('Sarah Rosen'));
  ok('K12 signing row carries signer X of Y', signingRow.includes('2 of 3'));
  ok('K12 signing row carries the waiting duration', /rw-dur/.test(signingRow) && /2d/.test(signingRow));

  const lpRow = rowHtml({ pid: 's2', name: 'Yael Adler', stage: 'link_sent', typeLabel: 'increase' });
  ok('K12 pre-submit row waits on the LP', lpRow.includes('Waiting on <b>the LP</b>'));
  // REVERSED 2026-09-09, by decision, not by accident. The dash was deliberate
  // and this line pinned it. On a board where most rows are pre-submit, four of
  // five money cells held a dash, and at a glance a dash reads as a datum -
  // four false readings per screen on the only live view of in-flight money.
  // No amount yet is the absence of a figure, not a figure. The column keeps
  // its width so the amounts that DO exist stay aligned for scanning.
  ok('K12 no amount renders blank, not a dash', !lpRow.includes('ramt-none') && !lpRow.includes('&ndash;'));
  ok('K12 the amount cell still exists, so the column stays aligned', /class="ramt"/.test(lpRow));

  const attnRow = rowHtml({ pid: 's3', name: 'Helena Brandt', stage: 'needs_attention',
    wait: 'The wire / money row did not reach the transfer-forms tracker' });
  ok('K12 attention row gets the attn class', attnRow.includes('class="row attn"'));
  ok('K12 attention badge carries the ACTUAL reason', attnRow.includes('Needs you') && attnRow.includes('did not reach the transfer-forms tracker'));

  const sealQ = rowHtml({ pid: 's4', name: 'Liora Katz', stage: 'seal_quarantined', wait: 'Seal failed repeatedly' });
  ok('K12 seal_quarantined is attention-class with its reason', sealQ.includes(' attn"') && sealQ.includes('Seal failed repeatedly'));

  const deadRow = rowHtml({ pid: 's5', name: 'Rivka Sela', stage: 'voided' });
  ok('K12 voided row looks dead (done+dead classes)', deadRow.includes('class="row done dead"'));
  ok('K12 voided row says Canceled in plain words', deadRow.includes('>Canceled</span>'));
  // Was 'token_revoked' until 2026-09-07. That stage was never written to the
  // registry by either engine (revocation is an attribute of the revoked set;
  // its audit trail is a NON-STAGE state-log row), so this asserted a row
  // shape no operator could ever see. 'abandoned' is the real stage with the
  // same shape: retired, canceled bucket, dead class.
  const parkedRow = rowHtml({ pid: 's6', name: 'Ronen Alon', stage: 'abandoned' });
  ok('K12 abandoned reads as Abandoned, dead class', parkedRow.includes('Abandoned') && parkedRow.includes(' dead"'));

  const staleRow = rowHtml({ pid: 's7', name: 'Jonathan Pearl', stage: 'complete', stale: true, wait: 'Sealed, but a records write failed. Needs review' });
  ok('K12 stale-complete row is attention-class, never quietly faded as done', /class="row attn"/.test(staleRow));
  ok('K12 stale-complete badge carries the needs-review reason', staleRow.includes('records write failed'));

  const withNote = rowHtml({ pid: 'p1', name: 'Test LP', stage: 'signing', note: 'told Omri he is joining Sept 1' });
  ok('K11 row with a note gets the has-note class', withNote.includes('class="rnote has-note"'));
  ok('K11 row with a note carries data-note (escaped)', withNote.includes('data-note="told Omri he is joining Sept 1"'));
  ok('K11 row with a note shows the note as the title tooltip', withNote.includes('title="told Omri he is joining Sept 1"'));
  ok('K11 row with a note renders the dot indicator', withNote.includes('rnote-dot'));
  ok('K11 note text is HTML-escaped (XSS discipline, same as esc2 elsewhere)',
    rowHtml({ pid: 'p2', name: 'X', stage: 'signing', note: '<img onerror=alert(1)>' }).includes('&lt;img'));

  const withoutNote = rowHtml({ pid: 'p3', name: 'No Note LP', stage: 'signing', note: '' });
  ok('K11 row with no note has no has-note class', !withoutNote.includes('has-note'));
  ok('K11 row with no note has no dot', !withoutNote.includes('rnote-dot'));
  ok('K11 row with no note shows the Add-a-note tooltip', withoutNote.includes('title="Add a note"'));
  ok('K11 note button always carries data-pid for the popover to key off', withoutNote.includes('data-pid="p3"'));

  // ---- K14: the who-cell is legible in both directions (2026-09-10) --------
  // Two defects found on the live board on 2026-09-09, neither caused by the
  // change being verified at the time:
  //   (a) a long name was truncated with no title and no way to reveal it;
  //   (b) a row with every identity field empty rendered the bare glyph '?'.
  // PREVENT for the whole class: the name is the row's primary job, so it may
  // never render a value the operator cannot read or identify. These lock both
  // halves - the title floor under any truncation, and an honest empty case.
  const LONG_HE = 'גלבוע פאנד אוף פאנדס, שותפות מוגבלת';
  const longRow = rowHtml({ pid: 'k14a', he: LONG_HE, stage: 'signing' });
  ok('K14 a Hebrew-only name renders in the name slot, not the secondary slot',
    longRow.includes('<span class="rn-name" dir="auto" title="' + LONG_HE + '">' + LONG_HE + '</span>'), longRow);
  ok('K14 a long name carries a title so the clipped tail is recoverable',
    longRow.includes('title="' + LONG_HE + '"'));
  ok('K14 a Hebrew-only name is not ALSO repeated on the secondary line',
    (longRow.match(/rhe/g) || []).length === 0, longRow);

  const bothNames = rowHtml({ pid: 'k14b', name: 'Sharon Jospe', he: 'שרון יוספה', stage: 'signing' });
  ok('K14 both name lines get their own title', bothNames.includes('title="Sharon Jospe"') && bothNames.includes('title="שרון יוספה"'));

  // The five live lane_unresolved rows: name/he present as '', not absent.
  const nameless = rowHtml({ pid: 'fa7607da-e3f3-48f0-8b0c-eba8faf8531c', name: '', he: '', lane: '', stage: 'needs_attention', age: '2d' });
  ok('K14 a nameless row never renders the bare glyph ?', nameless.indexOf('>?<') === -1, nameless);
  ok('K14 a nameless row says so in words', nameless.includes('>(no name)<'), nameless);
  ok('K14 a nameless row is muted, not styled as a real name', nameless.includes('class="rn-name is-noname"'));
  ok('K14 a nameless row is still identifiable by its pid', nameless.includes('class="rhe rn-pid" title="Process fa7607da-e3f3-48f0-8b0c-eba8faf8531c">fa7607\u2026faf8531c<'), nameless);
  // The stem must not assume a UUID. Splitting on the first hyphen collapsed 94
  // proof rows onto the identical stem 'proof' and reduced two others to 'w8'
  // and 'b' (pixel pass 2026-09-10). These are the real live pid shapes.
  const stemOf = (pid) => { const m = rowHtml({ pid: pid, name: '', stage: 'needs_attention' }).match(/class="rhe rn-pid"[^>]*>([^<]*)</); return m ? m[1] : null; };
  ok('K14 a long non-UUID pid keeps its tail, not just a shared prefix',
    stemOf('proof-nightly-h1-1788480788638') === 'proof-\u2026' + '80788638', stemOf('proof-nightly-h1-1788480788638'));
  ok('K14 two pids sharing a long prefix render apart',
    stemOf('proof-nightly-h1-1788480788638') !== stemOf('proof-nightly-h1-1788480799999'));
  ok('K14 a short pid is shown whole rather than cut to a meaningless token',
    stemOf('w8-renewal-scan') === 'w8-renewal-scan' && stemOf('b-L06SCwQLI') === 'b-L06SCwQLI',
    stemOf('w8-renewal-scan') + ' / ' + stemOf('b-L06SCwQLI'));
  // WIDTH INVARIANT. .rn-pid is 10px mono and the phone name track is 110px,
  // where 15 characters measure ~93px. The rendered id must never exceed that,
  // whatever shape the pid arrives in - a rule the old 8+4-past-20 form could
  // not state, and `unresolved-10c1e42b` (19 chars, ~118px) slipped through it.
  const SHAPES = ['fa7607da-e3f3-48f0-8b0c-eba8faf8531c', 'proof-nightly-h1-1788480788638',
    'proof-nightly-h1-1788480789072', 'unresolved-10c1e42b', 'w8-renewal-scan', 'b-L06SCwQLI',
    'wi1RJaJVBkE', 'manual__c27ed14e-6c41-4df1-8b57-6731289f08d3', 'x'.repeat(300)];
  const tooWide = SHAPES.filter((pid) => (stemOf(pid) || '').length > 15);
  ok('K14 no pid shape renders an id wider than the phone name track', tooWide.length === 0, JSON.stringify(tooWide.map((p) => [p, stemOf(p)])));
  ok('K14 unresolved-10c1e42b elides rather than overflowing at phone width',
    stemOf('unresolved-10c1e42b') === 'unreso\u2026' + '10c1e42b', stemOf('unresolved-10c1e42b'));
  // The live collision: two nightly proof rows shared a first-8 AND a last-4,
  // so an 8+4 elision printed the identical `proof-ni...9072` for both.
  ok('K14 two proof pids sharing a prefix AND a 4-char tail still render apart',
    stemOf('proof-nightly-h1-1788480789072') !== stemOf('proof-nightly-h1-1788999999072'),
    stemOf('proof-nightly-h1-1788480789072'));
  ok('K14 every distinct shape renders a distinct id',
    new Set(SHAPES.map(stemOf)).size === SHAPES.length, JSON.stringify(SHAPES.map(stemOf)));
  // A JS sentinel that arrived as a STRING is not an identifier.
  ok('K14 a pid of the literal string "undefined" renders no id line at all',
    !rowHtml({ pid: 'undefined', name: '', stage: 'needs_attention' }).includes('rn-pid'),
    rowHtml({ pid: 'undefined', name: '', stage: 'needs_attention' }));
  ok('K14 a pid of the literal string "null" renders no id line at all',
    !rowHtml({ pid: 'null', name: '', stage: 'needs_attention' }).includes('rn-pid'));
  ok('K14 the word undefined never reaches the rendered name cell',
    rowHtml({ pid: 'undefined', name: '', stage: 'needs_attention' }).indexOf('>undefined<') === -1);
  ok('K14 two UUIDs differing only in their tail render apart',
    stemOf('fa7607da-e3f3-48f0-8b0c-eba8faf8531c') !== stemOf('fa7607da-e3f3-48f0-8b0c-eba8faf85999'));
  ok('K14 a nameless row with no pid at all renders no empty second line',
    !rowHtml({ pid: '', name: '', stage: 'needs_attention' }).includes('rn-pid'));
  // Whitespace is the same absence as '' and must not render as a blank cell.
  ok('K14 a whitespace-only name is treated as nameless',
    rowHtml({ pid: 'k14c', name: '   ', he: '', stage: 'signing' }).includes('>(no name)<'));
  // he duplicating name is not a second line (the pre-existing he!==name rule).
  ok('K14 he identical to name does not render twice',
    (rowHtml({ pid: 'k14d', name: 'Oren Jospe', he: 'Oren Jospe', stage: 'signing' }).match(/rhe/g) || []).length === 0);
  ok('K14 the name is HTML-escaped in both the text and the title',
    rowHtml({ pid: 'k14e', name: '<img onerror=alert(1)>', stage: 'signing' }).indexOf('<img onerror') === -1);
})();

(function () {
  // Source-level assertions on load(): opNotes is fetched and merged, never
  // relying on ?api=list to carry PII (see the CaymanGateway.ts opNotes route
  // comment for why - this is the client-side half of that same invariant).
  const loadSrc = extractFn('load');
  const engineFetchSrc = extractFn('fetchEngineBoard_');
  // 2026-08-12 BOARD READ + ACTION SEAM: the per-engine list/opNotes/
  // opBoardDetail fetch (and its own inner Promise.all) now lives in
  // fetchEngineBoard_, one call per engine; load() itself Promise.all's
  // across engines instead.
  ok('K11 load() fetches the separate PII-gated opNotes route', engineFetchSrc.includes("apiFetch('?api=opNotes'"));
  ok('K11 opNotes fetch is soft-failed (never blocks the board)', /notesFetch=apiFetch\('\?api=opNotes'.*?\)\.catch/.test(engineFetchSrc));
  ok('K11 list and opNotes are fetched together via Promise.all', engineFetchSrc.includes('Promise.all('));
  // Was 'load() itself Promise.all's across every engine'. The Promise.all was
  // the DEFECT (it made the board wait on GAS's ~9s floor), not the contract.
  // The contract is that load asks EVERY leg for the lane and merges all of
  // them; how it awaits them is section O's business. Updated 2026-09-06.
  // Widened 2026-09-09 (gate 3 item 1): the unit is now a LEG, not an engine.
  // The orphan/manual tracker rows ride their own leg on ju-service rather than
  // a fourth fetch inside an engine leg, so `engines` is what load asks and
  // `legs` is what it awaits and merges. See O10 for the behavioural half.
  ok('K11 load() asks every leg for the lane', /legs\.forEach\(function\(leg,slotIx\)\{/.test(loadSrc));
  ok('K11 the manual/orphan leg is one of them, and rides ju-service',
    /legs\.push\(\{kind:'manual',base:JU_API\}\)/.test(loadSrc), loadSrc.slice(0, 0));
  ok('K11 load() merges every engine that answers', loadSrc.includes('slots.filter(Boolean)'));
  ok('K11 row mapping pulls note text from the merged notes map, keyed by pid', loadSrc.includes('note:(n&&n.text)||\'\''));

  // Save/Clear ride the same ?source=op tunnel every other admin action uses
  // (never a bare GET with the token in the URL).
  ok('K11 save wired to ?admin=saveNote', html.includes("'?admin=saveNote&processId='"));
  ok('K11 clear wired to ?admin=clearNote', html.includes("'?admin=clearNote&processId='"));

  // Click wiring: same stopPropagation discipline as .rcopy, so opening the
  // popover never also opens the drawer underneath it.
  ok('K11 .rnote click handler stops propagation', /document\.querySelectorAll\("#list \.rnote"\)[\s\S]{0,200}e\.stopPropagation\(\); toggleNotePopover\(btn\);/.test(html));

  // Popover close-on-outside-click is wired globally, same as any other
  // dismissible overlay in this file.
  ok('K11 outside-click closes the note popover', html.includes("document.addEventListener('click',closeAnyNotePopover)"));

  // Length cap enforced client-side too (server hard-truncates independently).
  ok('K11 note textarea caps input at 240 chars', html.includes('maxlength="240"'));
})();

// ---- K13: the board row mapper must read field names the SERVER actually sends
// (2026-08-12). The completed-by-month grouping shipped 2026-08-09 reading
// `lastActivityTs` / `lastActivityAt`, and NO server in legacy-tools-mono has
// ever emitted either name: the pipeline feed emits `updatedAt` +
// `lastTouchedAt` (CaymanPipelineBoard.ts:440/446) and the registry fallback
// emits `updatedAt` (CaymanConsole.ts). Date.parse('') is NaN, so 100% of
// completed rows rendered under a single "Undated" header and sortRows silently
// fell through to its ageNum proxy. The bug class is "client consumes a field
// name no server produces", and it is invisible precisely because the fallback
// is a plausible empty string rather than an error. Lock both halves.
(function () {
  const monthKeyAndLabel_ = new Function(
    extractVar('MONTH_NAMES_') + ';' + extractFn('monthKeyAndLabel_') + '; return monthKeyAndLabel_;'
  )();

  ok('K13 a real ISO timestamp buckets to its own calendar month',
    monthKeyAndLabel_('2026-08-09T16:07:20Z').label === 'August 2026',
    monthKeyAndLabel_('2026-08-09T16:07:20Z').label);
  ok('K13 an empty timestamp is the ONLY thing that reads Undated',
    monthKeyAndLabel_('').label === 'Undated' && monthKeyAndLabel_(undefined).label === 'Undated');
  // Bucketing is by LOCAL calendar month (d.getMonth()), which for this operator
  // is Asia/Jerusalem - the same zone the tracker's own month tabs use. So a
  // UTC-midnight edge legitimately falls in the neighbouring local month; these
  // assertions deliberately sit mid-month so they assert the grouping, not the
  // machine's offset.
  ok('K13 two rows in the same month share a bucket key',
    monthKeyAndLabel_('2026-08-09T16:07:20Z').key === monthKeyAndLabel_('2026-08-21T06:00:00Z').key);
  ok('K13 rows in different months do not',
    monthKeyAndLabel_('2026-08-21T06:00:00Z').key !== monthKeyAndLabel_('2026-09-21T06:00:00Z').key);

  // Source-level half: the mapper must reach at least one name the server sends.
  // Without this, every assertion above still passes while the board shows
  // nothing but "Undated" - which is exactly what shipped for three days.
  const loadSrc = extractFn('load');
  const mapper = /lastActivityTs:([^,]+),/.exec(loadSrc);
  ok('K13 the row mapper assigns lastActivityTs at all', !!mapper);
  ok('K13 the mapper reads a field the server actually emits (updatedAt / lastTouchedAt)',
    !!mapper && /it\.(updatedAt|lastTouchedAt)/.test(mapper[1]),
    mapper && mapper[1]);
})();

// ---- K13: the two compressions (2026-08-25 design-tighten) -----------------
// Both fold repeated content. Both must be provably lossless: nothing that had
// a row before may lose its meaning, and nothing distinct may be merged.
(function () {
  const src = extractFn('esc2') + ';' + extractVar('SEALING_STAGES') + ';' + extractVarObj('STAGE_TO_MILESTONE') + ';'
    + extractVar('RAIL_MILESTONES') + ';' + extractFn('humanKey') + ';'
    + extractFn('stageMilestone') + ';' + extractFn('eventLabel') + ';' + extractFn('collapseEvents')
    + '; return { collapseEvents: collapseEvents, eventLabel: eventLabel };';
  const { collapseEvents } = new Function(src)();
  const ev = (stage, ts, detail) => ({ stage, ts, detail });
  const run12 = [];
  for (let i = 0; i < 12; i++) run12.push(ev('in_progress', '2026-08-2' + (i % 5) + 'T09:0' + (i % 9) + ':00Z'));
  const c = collapseEvents(run12);
  ok('K13 twelve identical events collapse to one line', c.length === 1, JSON.stringify(c.map(x => x.label + 'x' + x.n)));
  ok('K13 the collapsed line keeps the count', c[0].n === 12);
  ok('K13 the collapsed line keeps first AND last, so the span is still readable',
    c[0].first === run12[0] && c[0].last === run12[11]);
  // A stage the process genuinely RETURNED to is a different fact from one it
  // sat in, and must survive as its own line.
  const bounced = [ev('signing', '2026-08-01T09:00:00Z'), ev('needs_attention', '2026-08-02T09:00:00Z'), ev('signing', '2026-08-03T09:00:00Z')];
  ok('K13 a returned-to stage stays a separate line (only CONSECUTIVE runs fold)',
    collapseEvents(bounced).length === 3, collapseEvents(bounced).map(x => x.label).join('|'));
  ok('K13 a run of one renders exactly as before (n === 1)', collapseEvents([ev('signing', '2026-08-01T09:00:00Z')])[0].n === 1);
  ok('K13 no events -> no lines', collapseEvents([]).length === 0 && collapseEvents(null).length === 0);
  // K13 actor honesty (2026-08-26 review). The old test was
  // `prev.actor && ev.actor && prev.actor !== ev.actor`, which short-circuited
  // whenever a later event carried NO actor, so a run whose first event named
  // one kept that name and claimed every event in the run. On a console used
  // for incident triage that is a fabricated attribution.
  const runFirstActorOnly = [ev('in_progress', '2026-08-13T09:10:00Z')];
  runFirstActorOnly[0].actor = 'system';
  for (let i = 1; i < 12; i++) runFirstActorOnly.push(ev('in_progress', '2026-08-' + (13 + i) + 'T09:10:00Z'));
  const collapsedRun = collapseEvents(runFirstActorOnly);
  ok('K13 a run does not inherit an actor the later events never recorded',
    collapsedRun.length === 1 && collapsedRun[0].n === 12 && collapsedRun[0].actor === '',
    JSON.stringify({ n: collapsedRun[0].n, actor: collapsedRun[0].actor }));
  const allSameActor = [ev('signing', '2026-08-01T09:00:00Z'), ev('signing', '2026-08-02T09:00:00Z')];
  allSameActor.forEach(e => { e.actor = 'noa@legacyvpartners.com'; });
  ok('K13 a run where EVERY event names the same actor still keeps it',
    collapseEvents(allSameActor)[0].actor === 'noa@legacyvpartners.com');
  const noneHaveActor = [ev('signing', '2026-08-01T09:00:00Z'), ev('signing', '2026-08-02T09:00:00Z')];
  ok('K13 a run where no event names an actor claims none',
    collapseEvents(noneHaveActor)[0].actor === '');
  // Reminder events keep their own label, so they never fold into the stage
  // line they used to be indistinguishable from.
  const mixed = [ev('signing', '2026-08-01T09:00:00Z'), ev('signing', '2026-08-02T09:00:00Z', '{"nudge":true}'), ev('signing', '2026-08-03T09:00:00Z')];
  ok('K13 a reminder does not fold into the surrounding stage run',
    collapseEvents(mixed).length === 3, collapseEvents(mixed).map(x => x.label).join('|'));
})();
(function () {
  const src = extractFn('esc2') + ';' + extractVar('SEALING_STAGES') + ';' + extractVarObj('STAGE_TO_MILESTONE') + ';'
    + extractVar('RAIL_MILESTONES') + ';' + extractVarObj('STAGE_WORD') + ';' + extractVarObj('FLOW_CHIP_WORD') + ';'
    + extractFn('humanKey') + ';' + extractFn('stageWord') + ';' + extractFn('sinceDur') + ';'
    + extractFn('isAttnStage') + ';' + extractFn('isCanceledStage') + ';'
    + extractFn('flowChipHtml') + ';' + extractFn('waitLineHtml') + ';'
    + extractFn('attnWhyText') + ';' + extractFn('attnBadgeHtml') + ';'
    + extractFn('railHtml') + ';' + extractFn('isTerminalStage') + ';'
    + extractFn('isCompletedStage') + ';' + extractFn('signerFraction') + ';' + extractFn('signerRoleLabel') + ';' + extractFn('fmtAmount') + ';'
    + extractVar('CCY_SYMBOL') + ';' + extractVar('CCY_ALIASES') + ';'
    + extractVar('RCOPY_ICON') + ';' + extractVar('RNOTE_ICON') + ';' + extractVar('GW') + ';'
    + extractFn('isManualRow_') + ';'
    + extractFn('isAttnRow') + ';' + extractFn('rowHtml') + ';' + extractFn('foldRuns') + ';' + extractFn('foldedRowsHtml')
    + '; return { foldedRowsHtml: foldedRowsHtml, foldRuns: foldRuns, rowHtml: rowHtml };';
  const { foldedRowsHtml, foldRuns, rowHtml } = new Function(src)();
  const WHY = 'Bank details could not be written to the tracker. Needs bank recovery.';
  const bank = (n) => ({ pid: 'p' + n, name: 'LP ' + n, stage: 'needs_attention', attnWhy: WHY, age: '3d' });
  const five = [bank(1), bank(2), bank(3), bank(4), bank(5)];
  const out = foldedRowsHtml(five);
  // VISIBLE text only: tooltips are not what the eye is reading five times.
  const visible = out.replace(/title="[^"]*"/g, '');
  ok('K13 five same-reason rows state the reason ONCE on screen',
    (visible.match(/Needs bank recovery/g) || []).length === 1,
    String((visible.match(/Needs bank recovery/g) || []).length));
  ok('K13 the fold header names the reason and the count',
    out.includes('bsub-why') && out.includes('>5 processes<'));
  ok('K13 every folded row still shows it needs her',
    (out.match(/battn-tag/g) || []).length === 5);
  ok('K13 folded rows drop the repeated sentence element',
    (out.match(/battn-why/g) || []).length === 0);
  // Nothing is LOST by folding: the header states it, and every folded row
  // still carries the full sentence as its own tooltip.
  ok('K13 the full sentence survives as a title on the header and on all 5 rows',
    (out.match(/title="Needs bank recovery/g) || []).length === 0
    && (out.split('title="' + WHY).length - 1) === 6,
    String(out.split('title="' + WHY).length - 1));
  // A lone problem must still state itself on its own row.
  const lone = foldedRowsHtml([bank(1)]);
  const mixedRowsForClose = [bank(1), bank(2), bank(3), { pid: 'q', name: 'Tal Amir', stage: 'needs_attention', attnWhy: 'Seal quarantined.', age: '3d' }];
  ok('K13 a run of ONE is not folded', lone.includes('battn-why') && !lone.includes('bsub'));
  // The fold must be a CLOSED group. Without a wrapper it was only a header,
  // and the next attention row - same coral treatment, different reason - sat
  // flush underneath and read as the sixth member of it (2026-08-25 pixels).
  ok('K13 the fold is a wrapped group, not an open-ended header',
    (out.match(/<div class="bfold">/g) || []).length === 1);
  const mixedOut = foldedRowsHtml(mixedRowsForClose);
  ok('K13 the group closes BEFORE a differently-reasoned row follows it',
    mixedOut.indexOf('</div><div class="row') > 0
    && mixedOut.indexOf('Seal quarantined') > mixedOut.lastIndexOf('<div class="bfold">'),
    mixedOut.slice(0, 0));
  // The wrapper holds exactly the rows that share the reason - no more.
  // lastIndexOf, not indexOf: every row boundary is also a '</div><div class="row'
  // seam, and the LAST one in this fixture is the wrapper closing before the
  // one differently-reasoned row.
  const closeAt = mixedOut.lastIndexOf('</div><div class="row');
  const inside = mixedOut.slice(mixedOut.indexOf('<div class="bfold">'), closeAt);
  ok('K13 the wrapper holds exactly the 3 same-reason rows, and the 4th is outside',
    (inside.match(/class="row/g) || []).length === 3 && inside.indexOf('Seal quarantined') === -1,
    String((inside.match(/class="row/g) || []).length));
  // Different reasons never merge.
  const mixedRows = [bank(1), bank(2), { pid: 'x', name: 'Other', stage: 'needs_attention', attnWhy: 'Seal quarantined.', age: '1d' }];
  const runs = foldRuns(mixedRows);
  ok('K13 different reasons stay separate runs', runs.length === 2 && runs[0].rows.length === 2 && runs[1].rows.length === 1,
    runs.map(r => r.rows.length).join(','));
  // Non-attention rows must never fold - they have no reason to share.
  const calm = [{ pid: 'c1', name: 'A', stage: 'signing', age: '1d' }, { pid: 'c2', name: 'B', stage: 'signing', age: '2d' }];
  ok('K13 rows with no attention reason are never folded', !foldedRowsHtml(calm).includes('bsub'));
  ok('K13 folding preserves row count', (foldedRowsHtml(five).match(/class="row/g) || []).length === 5);
  // K13 arity coupling (2026-08-26 review). rowHtml grew a second parameter,
  // `folded`. Array.prototype.map calls back with (element, index, array), so
  // passing rowHtml straight to .map hands it the index: every row after the
  // first is told it sits inside a fold group that does not exist and drops its
  // reason sentence, with no header stating that reason even once. Verified
  // live in the browser: 3 attention rows through .map(rowHtml) render 1 reason
  // and 2 silently folded badges with no .bsub header; through the fixed form,
  // all 3 render their reason.
  // Comments stripped: renderRows explains this exact hazard in prose directly
  // above the call site, and an unstripped scan matches the explanation.
  const htmlCode = html.replace(/^\s*\/\/[^\n]*$/gm, '');
  ok('K13 rowHtml is never passed bare to .map (it would receive the index as `folded`)',
    !/\.map\(rowHtml\)/.test(htmlCode));
  const bare = [bank(1), bank(2), bank(3)].map(rowHtml).join('');
  const wrapped = [bank(1), bank(2), bank(3)].map(function (r) { return rowHtml(r); }).join('');
  ok('K13 the coupling is real, not theoretical: bare .map loses 2 of 3 reasons',
    (bare.match(/battn-why/g) || []).length === 1 && (wrapped.match(/battn-why/g) || []).length === 3,
    (bare.match(/battn-why/g) || []).length + ' vs ' + (wrapped.match(/battn-why/g) || []).length);
})();

// ---- K14: .person is shared by THREE lists, so roster-only rules must be scoped.
// The signers roster, the pre-submit People list and the Also-cc'd list all
// render .person. A min-height added for the roster's vertical rhythm was first
// written unscoped and left the cc rows - which carry an email and nothing else
// - sitting in 26px of dead space. Caught in pixels 2026-08-25; locked here.
(function () {
  ok('K14 the roster-only wrap floor is scoped to .person.sgr',
    /\.person\.sgr \.pn-wrap \{[^}]*min-height/.test(html));
  ok('K14 no UNSCOPED .person .pn-wrap min-height exists',
    !/\.person \.pn-wrap \{[^}]*min-height/.test(html));
  const drawerSrc = extractFn('renderDrawer');
  ok('K14 the signers roster tags its rows .sgr', drawerSrc.includes('class="person sgr'));
  // The other two lists must NOT carry it - that is what makes the scoping real.
  const peopleAndCc = drawerSrc.split('class="person sgr').join('');
  ok('K14 the People and Also-cc\'d lists stay untagged',
    peopleAndCc.includes('<div class="person">') && !peopleAndCc.includes('sgr'));
})();

// ---- K15: the Transfer Form settle gate (2026-08-26 review, findings 1/4/8).
// The gate was a BOOLEAN. Review set it true; changing the Month, the Currency
// or the Struck-NAV override afterwards left it true, so Generate stayed armed
// and would settle a batch nobody had reviewed. Only the empty-month path ever
// closed it, which is the one case where no money moves. Proven live before the
// fix: reviewing 07/2026 then switching to 08/2026 sent
// monthTab=08/2026&currency=USD&navMonth=1999-13.
// This is a ledger write: it stamps SETTLED_AT and advances EXECUTION_STATUS to
// a terminal value on every row of the batch.
(function () {
  ok('K15 the gate holds the reviewed INPUTS, not a boolean',
    /var lastGo=null,/.test(html) && /lastGo=wlInputs\(\);/.test(html));
  ok('K15 there is exactly one function that closes the gate',
    (html.match(/function wlCloseGate\(/g) || []).length === 1);
  ['monthEl.onchange', 'ccyEl.onchange'].forEach(function (h) {
    const m = html.indexOf(h);
    ok('K15 ' + h + ' closes the gate', m > 0 && html.slice(m, m + 220).indexOf('wlCloseGate(') > 0);
  });
  ok('K15 the Struck-NAV override closes the gate',
    /nm\.oninput=function\(\)\{wlCloseGate\(/.test(html));
  ok('K15 a failed rows-peek closes the gate (it used to leave Generate live)',
    (html.match(/wlCloseGate\('Rows could not be loaded/g) || []).length === 2);
  // The belt to the braces: even if a future input forgets to close the gate,
  // the settle must not be able to use it.
  ok('K15 the settle refuses when the live inputs differ from the reviewed ones',
    (html.match(/if\(!wlSameInputs\(/g) || []).length >= 2);
  ok('K15 the settle query is built from the SNAPSHOT, not the live controls',
    /encodeURIComponent\(snap\.month\)/.test(html) && /encodeURIComponent\(snap\.currency\)/.test(html));
  ok('K15 Generate arms a confirm instead of committing on the first click',
    /confirmEl\.hidden=false;/.test(html) && /confirmGoEl\.onclick=wlDoGenerate/.test(html));
  ok('K15 the confirm states the consequence in the operator\'s own terms',
    /stamps SETTLED_AT and moves each row to a terminal execution status/.test(html));
  ok('K15 the button says what it does', />Generate \+ settle</.test(html));
  ok('K15 a successful settle CLOSES the gate rather than re-arming',
    /wlCloseGate\('Settled '\+snap\.month/.test(html));
  // Finding 6: the NAV override guard was the bare digit shape, so 1999-13
  // passed both guards, reached the server, and rendered back as
  // "Verified against the undefined 1999 close".
  const navValid = new Function(extractFn('wlValidNavMonth') + '; return wlValidNavMonth;')();
  ok('K15 a real month is required, not four digits and two digits',
    navValid('2026-07') === true && navValid('1999-13') === false && navValid('2026-00') === false);
  ok('K15 the year must be plausible', navValid('0001-05') === false && navValid('2099-12') === true);
  ok('K15 an empty or malformed override is rejected',
    navValid('') === false && navValid('2026-7') === false && navValid('nope') === false);
  // Finding 9: a disabled .btn had no rule at all, so a closed gate looked open.
  ok('K15 a disabled .btn is visually distinct', /\.btn:disabled,\.btn\[disabled\]\{background:var\(--color-neutral-bg\)/.test(html));
})();

// ---- K16: modal shell, drawer registers, colour semantics (2026-08-26 items 1/3/4).
(function () {
  // Item 1. The overlays are modal now. There is NO app-shell wrapper in this
  // file - #drawer and #panel are siblings of aside.side and div.main - so the
  // inert marking has to cover THREE elements, and #tab-bar is the one that is
  // easy to miss because it lives outside .main.
  ok('K16 the shell-inert helper marks all three shell elements',
    /var SHELL_SEL_=\['aside\.side','div\.main','#tab-bar'\];/.test(html));
  ok('K16 it sets inert AND aria-hidden (inert alone is not universally supported)',
    /setAttribute\('inert',''\)/.test(html) && /setAttribute\('aria-hidden','true'\)/.test(html));
  // Every lifecycle point, including the one that bypasses close()/dclose().
  ['function open(){', 'function close(){', 'function dclose(){'].forEach(function (fn) {
    const i = html.indexOf(fn);
    ok('K16 ' + fn + ' toggles the shell', i > 0 && /setShellInert\(/.test(html.slice(i, i + 700)));
  });
  // Re-pinned 2026-09-09: the drawer is modal BELOW 1400px and a side pane
  // above it, so "always inert" stopped being the contract. Both halves are
  // asserted, because each is a real hazard: a modal overlay that leaves the
  // shell reachable is a focus trap failure, and a side pane that marks the
  // shell inert makes the board it sits beside unusable - which is the whole
  // reason the pane exists.
  ok('K16 a MODAL drawer still locks scroll and marks the shell inert',
    /dscrim\.classList\.add\("on"\); document\.body\.style\.overflow='hidden'; setShellInert\(true\)/.test(html));
  ok('K16 the docked record is chosen by width, not by guesswork',
    /window\.matchMedia\('\(min-width: 1400px\)'\)/.test(html) && /min-width: 1400px/.test(html));
  // The drawer must NOT reuse `side`: this file already owns that class for
  // aside.side. Reusing it collapsed the open record to a 52px sliver under
  // body.side-coll and hid it outright under the mobile rule (2026-09-09 pixel
  // pass, findings 11 and 13). Assert the drawer's docked class is `dock` and
  // that nothing re-introduces a `.panel#drawer.side` rule.
  ok('K16 the docked class is `dock`, never the sidebar\'s own `side`',
    /drawer\.classList\.add\("dock"\)/.test(html) && !/\.panel#drawer\.side\b/.test(html));
  // A branch read once at open time goes stale the moment the window is
  // resized: a non-modal 480px pane over the board with no scrim and no inert
  // shell (finding 12). The listener lives at TOP LEVEL, not inside openDrawer,
  // because both drawer rigs extract that function from a fixed list.
  ok('K16 the presentation is re-evaluated on resize, not frozen at open time',
    /addEventListener\('change',applyDrawerPresentation\)/.test(html)
    && html.indexOf('function applyDrawerPresentation') > html.indexOf('function dclose()'));
  // The board grid needs ~870px and the docked record leaves 660px at a 1400
  // viewport, so the AGE column and the per-row copy/note buttons slid UNDER
  // the pane, unreachable (findings 1, 5 and 9). The existing drop rule is
  // keyed on the VIEWPORT and cannot see a pane, so the drop has to be keyed on
  // the docked state itself, with a scroll container as the backstop.
  ok('K16 docking below ~1650px drops the flow column instead of hiding it under the pane',
    /@media \(min-width: 1400px\) and \(max-width: 1649px\)/.test(html)
    && /body:has\(\.panel#drawer\.dock\.on\) \.rflow/.test(html));
  ok('K16 a docked board scrolls its overflow instead of losing it',
    /body:has\(\.panel#drawer\.dock\.on\) #list \{ overflow-x: auto; \}/.test(html));
  ok('K16 a side pane is NOT modal: it drops aria-modal and never marks the shell inert',
    /if\(side\)\{\s*drawer\.removeAttribute\("aria-modal"\);/.test(html));
  ok('K16 dclose clears the side class too, so a resize cannot strand it',
    /dclose\(\)\{[^}]*drawer\.classList\.remove\("dock"\)/.test(html));
  ok('K16 signOut clears it, or the shell stays inert behind the login screen',
    /try\{setShellInert\(false\);\}catch\(e\)\{\}/.test(html));
  ok('K16 both overlays carry dialog semantics',
    (html.match(/role="dialog" aria-modal="true"/g) || []).length === 2);
  // The trap must filter on real visibility: syncPanelFields hides most of the
  // create panel's 27 controls at any moment, and a selector-only trap parks
  // focus on a hidden field.
  // offsetParent alone is not enough: a visibility:hidden element still has one
  // and is NOT focusable, so an offsetParent-only filter puts the trap's "last"
  // element on something focus() silently refuses and Tab stops wrapping. Found
  // in the keyboard walk, not in the code review.
  ok('K16 the tab trap filters on real visibility, not just offsetParent',
    /function trapCandidates_\(root\)/.test(html)
    && /el\.offsetParent===null\)return false;/.test(html)
    && /cs\.visibility==='hidden'/.test(html)
    && /r\.width>0&&r\.height>0/.test(html));
  // And the one no style check can catch: content inside a CLOSED <details>
  // reports visibility:visible with a real rect, but the browser refuses focus.
  // The panel's #langRow and the Transfer Form's #tfCorrections are both closed
  // by default, so without this the trap's last element was unfocusable and Tab
  // stopped wrapping. Found in the keyboard walk, not in review.
  ok('K16 the trap skips content inside a closed <details>',
    /el\.closest\('details:not\(\[open\]\)'\)\)return false;/.test(html));
  ok('K16 the drawer history rows are keyboard-reachable',
    /class="kv hist" data-pid="'\+esc2\(p\.processId\)\+'" tabindex="0" role="button"/.test(html));
  ok('K16 and they answer Enter and Space like the board row does',
    /rw\.onkeydown=function\(e\)\{if\(e\.key==='Enter'\|\|e\.key===' '\)/.test(html));

  // Item 3. Two registers, applied by modifier class so .dsec h3 stays reusable.
  ok('K16 the reference register exists', /\.dsec h3\.dsec-ref \{/.test(html));
  // It must be QUIETER than the actionable heading but still outrank the body it
  // labels. The first cut used --color-ink-muted, which put these headings below
  // their own content (Also cc'd / Details / Timeline render their body in that
  // same hue at a LARGER size) and took text from 18.42:1 to 3.84:1. ink-sub is
  // 5.69:1 and stays above the body.
  ok('K16 the reference register does not use the faint tone its own body uses',
    !/\.dsec h3\.dsec-ref \{[^}]*--color-ink-muted/.test(html));
  ok('K16 the reference register clears the contrast floor (ink-sub, 5.69:1)',
    /\.dsec h3\.dsec-ref \{[^}]*color: var\(--color-ink-sub\)/.test(html));
  ok('K16 outgoing and incoming transfer badges occupy the same box',
    /\.wl-type-in\{border:1px solid transparent\}/.test(html));
  // Parse the ACTUAL <h3> tags rather than searching for the word anywhere:
  // "People", "Details" and "Documents" all appear in comments in this function.
  const drawerSrc = extractFn('renderDrawer');
  const headings = {};
  const h3Re = /<h3(\s+class="([^"]*)")?>([A-Za-z][^'<+]*)/g;
  let hm;
  while ((hm = h3Re.exec(drawerSrc)) !== null) {
    headings[hm[3].trim().replace(/\\'/g, "'")] = hm[2] || '';
  }
  ok('K16 all drawer headings were parsed', Object.keys(headings).length >= 8, Object.keys(headings).join('|'));
  // Match on prefix: the cc heading is written 'Also cc\\'d' in the source, so its
  // parsed label carries the backslash rather than the apostrophe.
  const headingClass = (prefix) => {
    const k = Object.keys(headings).filter((h) => h.indexOf(prefix) === 0)[0];
    return k === undefined ? null : headings[k];
  };
  ['Signers', 'People', 'Also cc', 'Details', 'Timeline'].forEach(function (sec) {
    const cls = headingClass(sec);
    ok('K16 "' + sec + '" is a REFERENCE section',
      cls !== null && cls.indexOf('dsec-ref') >= 0, JSON.stringify(cls));
  });
  ['Current signer', 'Quick links', 'Documents'].forEach(function (sec) {
    ok('K16 "' + sec + '" stays ACTIONABLE',
      sec in headings && (headings[sec] || '').indexOf('dsec-ref') === -1, JSON.stringify(headings[sec]));
  });

  // Item 4. Coral is attention. Routine outgoing money is not an alert, and an
  // active tab is "you are here", not a warning.
  ok('K16 the board flow chip is off coral', !/\.flowchip\.f-out \{ background: rgba\(216,94,76/.test(html));
  ok('K16 the transfer-form outgoing badge moved with it',
    !/\.wl-type-out\{background:rgba\(216,94,76/.test(html));
  ok('K16 the active mobile tab uses the accent, not the alert colour',
    /\.tab\.on \{ color: var\(--color-atrium\)/.test(html));
  ok('K16 coral still carries the attention row and its fold group',
    /\.row\.attn \{ box-shadow: inset 3px 0 0 0 var\(--color-coral\)/.test(html)
    && /\.bfold \{ border-bottom: 2px solid var\(--color-coral\)/.test(html));
})();

// ---- K17: the W-8 tab opens a process (2026-08-26 review, item 2).
// The rows carried no processId at all: ju-service's w8renewals route mapped
// `name: lpDisplayName || name || partyKey` and a W-8 record has neither of the
// first two, so the NAME column was showing "<processId>:<role>" in production
// and there was nothing to click through to. Fixed server-side (af41194) by
// joining the registry, which also supplies processId and lane.
(function () {
  ok('K17 a W-8 row is interactive ONLY when the feed sent a processId',
    /var pid=String\(r\.processId\|\|''\)\.trim\(\);/.test(html)
    && /var act=pid\?\(' data-pid="'/.test(html));
  ok('K17 the openable class rides the same condition, so it cannot look clickable while inert',
    /'<div class="w8row'\+\(pid\?' is-openable':''\)\+'"'\+act\+'>'/.test(html));
  ok('K17 rows are wired by delegation over data-pid, click and keyboard',
    /wl\.querySelectorAll\('\.w8row\[data-pid\]'\)/.test(html)
    && /if\(e\.key==='Enter'\|\|e\.key===' '\)/.test(html));
  // The demo fixture MUST keep a row with no processId. That row is the only
  // thing standing between this console and shipping a button that does
  // nothing when an older engine (or the GAS fallback) omits the field.
  ok('K17 the demo fixture still carries a row with NO processId',
    /\{name:'Aurelie Marchand',variant:'W-9'/.test(html));

  // Order matters: switchView('board') calls dclose() on entry, so opening the
  // drawer first would immediately close it.
  const openFrom = extractFn('openProcessFromView');
  ok('K17 the view switch precedes the drawer open',
    openFrom.indexOf("switchView('board')") < openFrom.indexOf('openDrawer(pid)'));
  ok('K17 a cross-lane row switches lane through the real switcher, not by setting state',
    /window\.__consoleSetLane\(want\)/.test(openFrom) && !/state\.lane=/.test(openFrom));
  ok('K17 and defers the open to the next completed board load, not a timer',
    /__pendingDrawerPid=pid;/.test(openFrom) && !/setTimeout/.test(openFrom));
  const laneNorm = new Function(extractFn('laneToConsole_') + '; return laneToConsole_;')();
  ok('K17 the registry lane string is normalised (it says israeli, this console says israel)',
    laneNorm('israeli') === 'israel' && laneNorm('israel') === 'israel'
    && laneNorm('cayman') === 'cayman' && laneNorm('') === '' && laneNorm(undefined) === '');
})();

// ---- K18: the W-8 readout says what it excluded (2026-08-26).
// ju-service now drops test processes from the W-8 counts. Production held 99
// records of which 74 were nightly-proof rows, so those counts are about to get
// much smaller; a number that silently shrinks is its own puzzle.
(function () {
  ok('K18 the readout renders the exclusion note when the engine reports one',
    /var te=\(typeof d\.testExcluded==='number'\)\?d\.testExcluded:null;/.test(html)
    && /test row'\+\(te===1\?'':'s'\)\+' excluded/.test(html));
  ok('K18 an engine that sends NO testExcluded shows no note rather than claiming zero',
    /var teNote=\(te&&te>0\)\?/.test(html));
  ok('K18 the note clears the contrast floor (ink-sub, not the faint tone)',
    /\.w8readout \.w8-line3 \{[\s\S]*?color: var\(--color-ink-sub\)/.test(html)
    && !/\.w8readout \.w8-line3 \{[^}]*--color-ink-muted/.test(html));
  ok('K18 the current count is shown even when nothing is due',
    /'<div class="w8-line1">All current<\/div>'\s*\+'<div class="w8-line2">'\+v\+' current<\/div>'\+teNote/.test(html));
  ok('K18 the demo fixture carries testExcluded, so the note path is exercised locally',
    /testExcluded:74/.test(html));
})();

// ---------------------------------------------------------------------------
// K-badge (2026-09-02): the nav badge must count with the SHARED predicate.
// setBoardBadge was the FOURTH consumer of "does this row want her eyes" and
// the one left behind when the other three moved onto isAttnRow, so approving
// גלבוע dropped the sidebar count 2->1 and the row off the pin while the nav
// badge still read 2. Found by clicking the live console, not by a test.
//
// This assertion reads the SOURCE rather than calling the function, because
// setBoardBadge writes to the DOM and this harness has no DOM; the drift being
// guarded is "which predicate is named", which the source answers exactly.
// ---------------------------------------------------------------------------
{
  const badgeSrc = extractFn('setBoardBadge');
  ok('K-badge nav badge counts with isAttnRow',
    /rows\.filter\(isAttnRow\)/.test(badgeSrc), badgeSrc.slice(0, 200));
  ok('K-badge nav badge no longer carries the old inline stage test',
    !/isAttnStage\(r\.stage\)\s*\|\|/.test(badgeSrc), badgeSrc.slice(0, 200));
}

// ---- K-approved: an approved row has no attention reason -------------------
// attnWhyText is the SHARED source of "why does this row want her eyes", and
// foldRuns() calls it UNGATED to group consecutive rows by identical reason.
// Before 2026-09-02 an approved row still returned its old reason there, so it
// was cleared on the sort pin, the sidebar count and the nav badge, and still
// folded into a "<reason> - N processes" run. Five consumers, one predicate.
{
  const src = extractFn('isAttnStage') + ';' + extractFn('isCompletedStage') + ';'
    + extractFn('attnWhyText') + '; return attnWhyText;';
  const attnWhyText = new Function(src)();
  const pending = { stage: 'needs_attention', attnWhy: 'Manual entry, off Ju pipeline - needs review' };
  const approved = { stage: 'needs_attention', attnWhy: 'Manual entry, off Ju pipeline - needs review',
    reviewApproved: true, reviewedBy: 'noa@legacyvpartners.com' };
  ok('K-approved an un-reviewed attention row still states its reason',
    attnWhyText(pending) === 'Manual entry, off Ju pipeline - needs review', attnWhyText(pending));
  ok('K-approved an approved row has NO attention reason (so it cannot fold into a run)',
    attnWhyText(approved) === '', JSON.stringify(attnWhyText(approved)));
}

// ---- M. A manual / off-Ju row is never an attention row -------------------
// 2026-09-06, גלבוע פאנד אוף פאנדס, שותפות מוגבלת. That row is a transfer-forms
// tracker entry with no Ju process (pid 'manual__...'): no session, no signing
// run, no stage machine. The board was rendering it "Stuck", coral-tinted, and
// counting it in NEED A LOOK - for something that was not stuck and that the
// operator had no way to action. The drawer's own text says there is "no
// further detail or action here". An alarm nobody can clear teaches the
// operator to ignore the colour, which is the one thing the board cannot
// afford. These four assertions all FAIL against the pre-fix console.
{
  const src = extractFn('isAttnStage') + ';' + extractFn('isCompletedStage') + ';'
    + extractFn('isManualRow_') + ';' + extractFn('isAttnRow')
    + '; return { isAttnRow: isAttnRow, isManualRow_: isManualRow_ };';
  const { isAttnRow, isManualRow_ } = new Function(src)();

  const gilboa = { pid: 'manual__15c8d2b5-e7a4-4625-95bf-0e95952f0d23',
                   name: 'גלבוע פאנד אוף פאנדס, שותפות מוגבלת', stage: 'needs_attention', age: '6d' };
  const realStuck = { pid: '9c7dd60c-0a7d-43ad-891f-9a94b2b01e6f', name: 'A real Ju process',
                      stage: 'needs_attention', age: '6d' };

  ok('M1 a manual__ row is recognised as off-pipeline', isManualRow_(gilboa) === true);
  ok('M2 a real Ju pid is NOT treated as manual', isManualRow_(realStuck) === false);
  ok('M3 a manual__ row is never an attention row (was "Stuck" + coral + counted)',
    isAttnRow(gilboa) === false, isAttnRow(gilboa));
  ok('M4 a REAL needs_attention row still flags - the fix must not silence genuine alarms',
    isAttnRow(realStuck) === true, isAttnRow(realStuck));
}

// ---- N. The manual row's status word borrows no Ju stage vocabulary -------
// Source-level, because these are render-branch facts rather than pure
// functions: the row template must not hand a manual row a Ju stage word or a
// Ju stage rail, and a REAL needs_attention row must still read "Stuck".
{
  const flat = html.replace(/\s+/g, '');
  ok('N1 needs_attention still maps to "Stuck" for real Ju processes',
    /needs_attention:'Stuck'/.test(flat), 'STAGE_WORD mapping changed');
  // 2026-09-07: the word slot gained a THIRD branch beside these two (an
  // approved attention row says who cleared it instead of reading "Stuck" -
  // see the honest-status harness's H7). The manual branch itself is unchanged
  // and is still what this asserts: manual short-circuits FIRST, so a manual
  // row can never reach either the review branch or stageWord.
  ok('N2 the manual row renders the off-pipeline word instead of a stage word',
    /manual\?'OfftheJupipeline':\(cleared\?reviewedLine:stageWord\(st\)\)/.test(flat), 'off-pipeline word not wired into rowHtml');
  ok('N3 the manual row suppresses the stage rail (no invented pipeline position)',
    /\(manual\?'':railHtml\(r\)\)/.test(flat), 'rail not gated on manual');
  ok('N4 the manual row says where its real state lives',
    /Trackedinthetransferform/.test(flat), 'tracker pointer line missing');
}

// ---- O. Progressive engine paint (2026-09-06) -------------------------------
// load() used to Promise.all over the engines, so the board painted at the pace
// of the SLOWEST one. GAS's floor is ~6-10s per call regardless of payload, so
// that made every board load ~9s. It now paints once per engine ARRIVAL.
//
// The contract this section locks, in order of what would hurt most if broken:
//   O1  the fast engine paints WITHOUT waiting for the slow one
//   O2  no row is lost - the final board is exactly the Promise.all board,
//       including a row only the slow (GAS) engine can produce
//   O3  the dedupe still resolves in DECLARED engine order, not arrival order
//   O4  fail-open is unchanged: a dead engine degrades, never blanks
//   O5  an early paint's late async overlay cannot clobber a later, fuller one
{
  // load()'s partial-paint guard now goes through the renderer's own filters
  // (inflightOf_ / boardWouldReadEmpty_, 2026-09-06), so the composition has to
  // carry them. The O-block keeps its STUB render - it is asserting merge,
  // order, dedupe and fail-open, none of which need real HTML. What a stub
  // render cannot see is the empty-state rule itself; that is block P's job.
  const src = extractFn('isTerminalStage') + ';' + extractFn('isCompletedStage') + ';'
    + extractFn('inflightOf_') + ';' + extractFn('rowHay') + ';' + extractFn('boardWouldReadEmpty_') + ';'
    + extractFn('fetchEngineBoard_')
    // The orphan/manual tracker-rows leg (gate 3 item 1, 2026-09-09). EXTRACTED,
    // never stubbed, for the same reason every other helper here is: a stub
    // would be a second copy of the thing under test.
    + ';' + extractFn('fetchManualRowsLeg_')
    // 2026-09-07: load() reaches for the board-health and review-cache
    // helpers now. They are EXTRACTED, not stubbed, so this rig keeps
    // exercising the real ones (the harness header's standing warning about
    // the stub list being a second copy of the dependency graph).
    + ';' + extractVar('BOARD_HEALTH') + ';' + extractVar('REVIEW_CACHE') + ';'
    + extractFn('boardDegraded_') + ';' + extractFn('paintVerLine_') + ';'
    + extractFn('applyReviewCache_') + ';' + extractFn('reviewOverlayFailed_')
    + ';' + extractFn('load')
    // BOARD_HEALTH is returned, not read off `scope`: it is extracted INTO the
    // rig's own function scope (extractVar above), so the outer scope object
    // never had it and `scope.BOARD_HEALTH` was silently undefined.
    + '; return { load: load, fetchEngineBoard_: fetchEngineBoard_, fetchManualRowsLeg_: fetchManualRowsLeg_, BOARD_HEALTH: BOARD_HEALTH };';

  // One scriptable gateway for both engines. Each apiFetch call parks a
  // deferred keyed by engine so the test decides the arrival ORDER - which is
  // the whole point: real GAS arrives ~20x later than real ju-service.
  function makeRig() {
    const GWU = 'https://gas.example/exec';
    const JUU = 'https://ju.example';
    const parked = { [GWU]: [], [JUU]: [] };
    const painted = [];
    const dead = {};
    const listRows = { [GWU]: [], [JUU]: [] };
    // The manual/orphan leg rides JU_API but is a SEPARATE call, so it parks on
    // its own queue: arrive(JUU) must not settle it, or no test could tell the
    // fast spine leg from the slow tracker leg that is the whole reason the
    // orphan rows got their own slot instead of a fourth fetch inside one.
    const parkedManual = [];
    let manualAnswer = { ok: true, processes: [], generatedAt: '2026-09-09T10:00' };
    // The review overlay is parked SEPARATELY so O5 can resolve an EARLY
    // paint's overlay AFTER a later paint has already rendered - the exact
    // late-clobber shape PAINT_SEQ exists to stop.
    const reviews = [];
    let parkReviews = false;
    function apiFetch(qs, _retried, base) {
      // opGetRowReview always rides JU_API, by design.
      if (qs.indexOf('opGetRowReview') !== -1) {
        if (!parkReviews) return Promise.resolve({ ok: true, reviews: {} });
        return new Promise((resolve) => reviews.push(() => resolve({ ok: true, reviews: {} })));
      }
      if (qs.indexOf('?api=listManualTrackerRows') === 0) {
        if (dead.manual) return Promise.reject(new Error('tracker leg down'));
        return new Promise((resolve) => parkedManual.push(() => resolve(manualAnswer)));
      }
      if (dead[base]) return Promise.reject(new Error('engine down'));
      return new Promise((resolve) => {
        parked[base].push(() => {
          if (qs.indexOf('?api=list') === 0) resolve({ processes: listRows[base], generatedAt: '2026-09-06T10:00' });
          else if (qs.indexOf('?api=opNotes') === 0) resolve({ notes: {} });
          else resolve({ rows: {} });
        });
      });
    }
    const flush = () => new Promise((res) => { let n = 0; (function f() { if (++n > 40) return res(); Promise.resolve().then(f); })(); });
    const arrive = async (base) => { const q = parked[base].splice(0); q.forEach((fn) => fn()); await flush(); };
    const arriveManual = async () => { const q = parkedManual.splice(0); q.forEach((fn) => fn()); await flush(); };
    const listEl = { innerHTML: '' };
    const verEl = { style: {}, textContent: '', title: '' };
    const scope = {
      document: { getElementById: (id) => (id === 'list' ? listEl : (id === 'ver-line' ? verEl : null)), visibilityState: 'hidden' },
      boardSkeleton: () => '<skel>',
      state: { lane: 'cayman' },
      enginesForLane_: () => [GWU, JUU],
      apiFetch,
      // Capture the NAME as well as the pid: O3's dedupe check needs a field
      // that differs between the two engines' copies of the same pid, or an
      // arrival-order merge is indistinguishable from a declared-order one.
      render: (rows) => painted.push(Object.assign(rows.map((r) => r.pid), { names: rows.map((r) => r.name) })),
      JU_API: JUU,
      sinceDur: () => '1m',
      esc2: (s) => String(s == null ? '' : s),
      loadW8: () => {},
      setInterval: () => 0,
    };
    const names = Object.keys(scope);
    const prelude = 'var LOAD_SEQ=0,PAINT_SEQ=0,doneLoaded=false,_autoRefreshArmed=true,_w8BadgeArmed=true;'
      + 'var showDone=false,showCanceled=false,showTest=false;';
    const built = (new Function(...names, prelude + src))(...names.map((n) => scope[n]));
    // newestFirst resolves the LATER paint's overlay before the earlier one's,
    // so the earlier paint's stale `rows` is the last thing to reach render().
    // That ordering is what actually reproduces the clobber; resolving oldest
    // first hides it, because the newer paint's render happens to land last.
    const arriveReviews = async (newestFirst) => {
      const q = reviews.splice(0);
      (newestFirst ? q.reverse() : q).forEach((fn) => fn());
      await flush();
    };
    return {
      load: built.load, painted, arrive, arriveManual, flush, GWU, JUU, listRows, dead,
      setManualAnswer: (v) => { manualAnswer = v; },
      boardHealth: () => built.BOARD_HEALTH,
      arriveReviews, parkReviews: (v) => { parkReviews = v; }, reviewsPending: () => reviews.length,
    };
  }

  // O1 + O2: the fast engine paints alone, then the slow engine's rows merge in.
  (async () => {
    const r = makeRig();
    r.listRows[r.JUU] = [{ processId: 'ju-1', currentStage: 'signing' }];
    // b-L06SCwQLI is the real, live GAS-only row: a pre-Ju EasySend tracker
    // orphan that ju-service's spine-only ?api=list provably cannot reproduce.
    r.listRows[r.GWU] = [{ processId: 'b-L06SCwQLI', currentStage: 'needs_attention' }];
    r.load(false);
    await r.flush();
    await r.arrive(r.JUU);
    ok('O1 the fast engine paints without waiting for the slow one', r.painted.length >= 1, r.painted);
    ok('O1b that first paint carries the fast engine\'s rows',
      r.painted.length >= 1 && r.painted[0].indexOf('ju-1') !== -1, r.painted[0]);
    ok('O1c and does NOT yet carry the slow engine\'s rows',
      r.painted.length >= 1 && r.painted[0].indexOf('b-L06SCwQLI') === -1, r.painted[0]);
    await r.arrive(r.GWU);
    const finalPaint = r.painted[r.painted.length - 1];
    ok('O2 the GAS-only tracker orphan row is NOT lost - it lands on the final board',
      finalPaint.indexOf('b-L06SCwQLI') !== -1, finalPaint);
    ok('O2b the final board is the full union of both engines',
      finalPaint.slice().sort().join(',') === 'b-L06SCwQLI,ju-1', finalPaint);
  })();

  // O3: dedupe stays declared-order (GAS first), even though GAS arrives LAST.
  (async () => {
    const r = makeRig();
    r.listRows[r.GWU] = [{ processId: 'dup', currentStage: 'needs_attention', displayName: 'from-GAS' }];
    r.listRows[r.JUU] = [{ processId: 'dup', currentStage: 'signing', displayName: 'from-JU' }];
    r.load(false);
    await r.flush();
    await r.arrive(r.JUU);
    await r.arrive(r.GWU);
    const finalPaint = r.painted[r.painted.length - 1];
    ok('O3 a pid on both engines is listed exactly once', finalPaint.length === 1, finalPaint);
    // The pid alone cannot distinguish the two copies - assert on a field that
    // differs, so an arrival-order merge fails here instead of passing silently.
    ok('O3b declared engine order (GAS first) wins the dedupe, though GAS arrived LAST',
      finalPaint.names[0] === 'from-GAS', finalPaint.names);
  })();

  // O4: fail-open. fetchEngineBoard_ must still never reject, so one dead
  // engine degrades the board to the other's rows rather than blanking it.
  (async () => {
    const r = makeRig();
    r.dead['https://gas.example/exec'] = true;
    r.listRows[r.JUU] = [{ processId: 'ju-only', currentStage: 'signing' }];
    r.load(false);
    await r.flush();
    await r.arrive(r.JUU);
    await r.flush();
    const finalPaint = r.painted[r.painted.length - 1] || [];
    ok('O4 a dead engine degrades the board instead of blanking it',
      finalPaint.indexOf('ju-only') !== -1, finalPaint);
    ok('O4b and never paints the error state', r.painted.length > 0);
  })();

  // O5 BEHAVIOURAL: the late-overlay clobber. Paint 1 (ju-service only) fires a
  // review overlay; paint 2 (both engines) renders the full board; THEN paint
  // 1's overlay resolves. Both paints share a rid, so the pre-existing
  // rid===LOAD_SEQ check cannot separate them - without PAINT_SEQ, paint 1's
  // stale `rows` re-renders and the GAS-only row disappears with no reload.
  // This is the 2026-09-05 "a row silently vanishes" regression, one level down.
  (async () => {
    const r = makeRig();
    r.parkReviews(true);
    r.listRows[r.JUU] = [{ processId: 'ju-1', currentStage: 'signing' }];
    r.listRows[r.GWU] = [{ processId: 'b-L06SCwQLI', currentStage: 'needs_attention' }];
    r.load(false);
    await r.flush();
    await r.arrive(r.JUU);          // paint 1: ju-service only, overlay parked
    ok('O5 paint 1 parked a review overlay', r.reviewsPending() === 1, r.reviewsPending());
    await r.arrive(r.GWU);          // paint 2: full board, its own overlay parked
    await r.arriveReviews(true);    // paint 2's overlay lands FIRST, paint 1's LAST
    const finalPaint = r.painted[r.painted.length - 1];
    ok('O5 a late overlay from an EARLIER paint cannot clobber the fuller board',
      finalPaint.indexOf('b-L06SCwQLI') !== -1, finalPaint);
    ok('O5b the board still holds both engines\' rows after the overlays settle',
      finalPaint.slice().sort().join(',') === 'b-L06SCwQLI,ju-1', finalPaint);
  })();

  // O7: the false all-clear. On the Cayman tab ju-service holds no non-proof
  // rows at all, so its (fast) paint is legitimately EMPTY and GAS supplies the
  // whole tab ~8s later. Painting an empty partial there renders renderRows'
  // "Nothing in flight." - telling the operator a live money board is clear
  // while an engine is still answering. The skeleton must stay up instead.
  (async () => {
    const r = makeRig();
    r.listRows[r.JUU] = [];                                     // fast engine: nothing (real Cayman shape)
    r.listRows[r.GWU] = [{ processId: 'b-L06SCwQLI', currentStage: 'needs_attention' }];
    r.load(false);
    await r.flush();
    await r.arrive(r.JUU);
    ok('O7 an EMPTY partial paint is suppressed (no false "Nothing in flight")',
      r.painted.length === 0, r.painted);
    await r.arrive(r.GWU);
    ok('O7b once every engine has answered the board paints normally',
      r.painted.length === 1 && r.painted[0].indexOf('b-L06SCwQLI') !== -1, r.painted);
  })();

  // O7c: a genuinely empty board must still reach the empty state once all
  // LEGS are in - the guard suppresses PARTIAL emptiness, not real emptiness.
  // Widened 2026-09-09: "all legs" now includes the orphan/manual tracker leg,
  // and O7d below is the reason that matters rather than being bookkeeping.
  (async () => {
    const r = makeRig();
    r.listRows[r.JUU] = [];
    r.listRows[r.GWU] = [];
    r.load(false);
    await r.flush();
    await r.arrive(r.JUU);
    await r.arrive(r.GWU);
    ok('O7c a truly empty board does NOT render while the orphan leg is still out',
      r.painted.length === 0, r.painted);
    await r.arriveManual();
    ok('O7c2 a truly empty board renders once every leg answered',
      r.painted.length === 1 && r.painted[0].length === 0, r.painted);
  })();

  // O7d: THE MONEY CASE, and the reason the guard had to start counting legs.
  // Both engines answer empty and the orphan leg - the only one carrying the
  // still-owed tracker rows - is still in the air. A guard still comparing
  // against engines.length would call the board complete here and paint
  // "Nothing in flight." over live money, which is the exact class of lie this
  // whole item exists to remove.
  (async () => {
    const r = makeRig();
    r.listRows[r.JUU] = [];
    r.listRows[r.GWU] = [];
    r.setManualAnswer({ ok: true, processes: [{ processId: 'manual__c27ed14e-6c41-4df1-8b57-6731289f08d3', currentStage: 'needs_attention', investmentAmount: 3000000 }] });
    r.load(false);
    await r.flush();
    await r.arrive(r.JUU);
    await r.arrive(r.GWU);
    ok('O7d no false "Nothing in flight" while the orphan money leg is outstanding',
      r.painted.length === 0, r.painted);
    await r.arriveManual();
    ok('O7e the orphan money row lands on the board from ju-service',
      r.painted.length === 1 && r.painted[0].indexOf('manual__c27ed14e-6c41-4df1-8b57-6731289f08d3') !== -1, r.painted);
  })();

  // O8x: the orphan leg's own failure posture. GAS answered a dead tracker with
  // [] and the board painted clean over live money; that silence IS the defect.
  (async () => {
    const r = makeRig();
    r.listRows[r.JUU] = [{ processId: 'ju-1', currentStage: 'signing' }];
    r.listRows[r.GWU] = [];
    r.setManualAnswer({ ok: false, error: 'tracker not wired on this revision' });
    r.load(false);
    await r.flush();
    await r.arrive(r.JUU); await r.arrive(r.GWU); await r.arriveManual();
    ok('O8x an ok:false orphan leg still lets the other legs paint (fail-open)',
      r.painted.length >= 1 && r.painted[r.painted.length - 1].indexOf('ju-1') !== -1, r.painted);
    ok('O8y an ok:false orphan leg marks the board degraded - never a clean empty',
      r.boardHealth().legFail === true, r.boardHealth());
  })();

  // O8z: PARTIAL counts as failed. Some tabs read, some did not, is not a
  // settled tracker, and a board painted from half a read must not look calm.
  (async () => {
    const r = makeRig();
    r.listRows[r.JUU] = [{ processId: 'ju-1', currentStage: 'signing' }];
    r.listRows[r.GWU] = [];
    r.setManualAnswer({ ok: true, partial: true, tabErrors: [{ tab: '08/2026', error: 'read failed' }], processes: [] });
    r.load(false);
    await r.flush();
    await r.arrive(r.JUU); await r.arrive(r.GWU); await r.arriveManual();
    ok('O8z a PARTIAL orphan-leg read marks the board degraded',
      r.boardHealth().legFail === true, r.boardHealth());
  })();

  // O9x: a REJECTED orphan leg must not take the board down with it, and must
  // still go red. Same fail-open posture every engine leg already has.
  (async () => {
    const r = makeRig();
    r.listRows[r.JUU] = [{ processId: 'ju-1', currentStage: 'signing' }];
    r.listRows[r.GWU] = [];
    r.dead.manual = true;
    r.load(false);
    await r.flush();
    await r.arrive(r.JUU); await r.arrive(r.GWU); await r.arriveManual();
    ok('O9x a rejected orphan leg still lets the board paint',
      r.painted.length >= 1 && r.painted[r.painted.length - 1].indexOf('ju-1') !== -1, r.painted);
    ok('O9y a rejected orphan leg marks the board degraded',
      r.boardHealth().legFail === true, r.boardHealth());
  })();

  // O9z: DEDUPE ACROSS THE SEAM. While GW is still in ENGINES_FOR_LANE_ both it
  // and the new leg carry the same orphan row. Leg order is [GW, JU_API,
  // MANUAL] and the merge is first-wins, so the row must appear ONCE, and it
  // must be GAS's copy - which is what makes shipping this leg a no-op on
  // screen and the transition risk-free.
  (async () => {
    const r = makeRig();
    const PID = 'manual__c27ed14e-6c41-4df1-8b57-6731289f08d3';
    r.listRows[r.JUU] = [];
    r.listRows[r.GWU] = [{ processId: PID, currentStage: 'needs_attention', displayName: 'from-gas' }];
    r.setManualAnswer({ ok: true, processes: [{ processId: PID, currentStage: 'needs_attention', displayName: 'from-ju-service' }] });
    r.load(false);
    await r.flush();
    await r.arrive(r.JUU); await r.arrive(r.GWU); await r.arriveManual();
    const final = r.painted[r.painted.length - 1];
    ok('O9z the row both legs carry is listed exactly ONCE',
      final.filter((p) => p === PID).length === 1, final);
    ok('O9z2 and it is GAS\'s copy that wins, per declared leg order',
      final.names[final.indexOf(PID)] === 'from-gas', final.names);
  })();

  // O5c/d: the structural guard itself.
  const loadSrc = extractFn('load');
  // Anchored on the CALL SITE, not on the bare route name. The bare name also
  // appears in load()'s prose above the overlay, and on 2026-09-07 a comment
  // added near the top of load() became the first match - which slid this
  // window past the overlay entirely and reported zero guards, i.e. the check
  // silently stopped checking anything. The call site is unambiguous.
  const reviewCallIx = loadSrc.indexOf("apiFetch('?api=opGetRowReview");
  ok('O5b the review overlay call site is still findable (a miss here makes O5c vacuous)',
    reviewCallIx > 0, reviewCallIx);
  const reviewIife = loadSrc.slice(Math.max(0, reviewCallIx - 2000));
  const renderCalls = (reviewIife.match(/render\(rows\)/g) || []).length;
  const guarded = (reviewIife.match(/pseq!==PAINT_SEQ|pseq===PAINT_SEQ/g) || []).length;
  // Exactly FOUR since 2026-09-07: the early return, the in-flight check, the
  // final render, and the catch - which stopped swallowing and now reapplies
  // the last known-good review state, so it has to be superseded-guarded like
  // every other writer in this chain. It was three before that catch had a
  // body. A >= threshold let a dropped guard survive mutation M4 on
  // 2026-09-06, so this stays an exact count.
  ok('O5c all four PAINT_SEQ guards in the review overlay are present',
    renderCalls > 0 && guarded === 4, 'renders=' + renderCalls + ' guards=' + guarded);
  ok('O5d PAINT_SEQ is declared alongside LOAD_SEQ and bumped per paint',
    /var LOAD_SEQ=0, PAINT_SEQ=0/.test(html) && /var pseq=\+\+PAINT_SEQ;/.test(html));

  // O6: the old blocking shape must not come back, and both engines must stay.
  ok('O6 load() no longer Promise.all-blocks on the engine list',
    !/Promise\.all\(engines\.map/.test(loadSrc), 'Promise.all over engines is back');
  // Still three catches, still fail-open - but since 2026-09-07 each one RECORDS
  // the failure on its way through (`failed.<leg>=true`) so the caller can tell
  // a dead leg from an empty answer. Both halves are asserted: dropping the
  // catch breaks fail-open, dropping the flag brings back the silent outage.
  {
    const feb = extractFn('fetchEngineBoard_');
    ok('O6b fetchEngineBoard_ still fail-opens all three of its fetches',
      (feb.match(/\.catch\(function\(\)\{failed\.[a-z]+=true;return/g) || []).length === 3, feb);
    ok('O6b2 and each of the three failures is RECORDED, never erased',
      ['failed.list=true', 'failed.notes=true', 'failed.extras=true'].every((f) => feb.indexOf(f) >= 0)
      && /failed:failed/.test(feb), feb);
  }
  ok('O6c both lanes still read BOTH engines (dropping GW loses actionable rows)',
    /ENGINES_FOR_LANE_ = \{ cayman: \[GW, JU_API\], israel: \[GW, JU_API\] \}/.test(html));
  ok('O6d the stale "one engine for Cayman" comment is gone',
    !/one engine for Cayman/.test(html), 'stale comment still contradicts the code below it');
}

// ---- P. The false all-clear, against the REAL renderer (2026-09-06) ---------
// WHY THIS BLOCK EXISTS, and why the O-block above did not catch the outage it
// was written to prevent.
//
// #16 (2539c27) shipped a guard meant to stop a partial paint from rendering
// "Nothing in flight." over live rows. It merged, and the ISRAEL tab of the
// live console rendered exactly that within minutes.
//
// The guard was `!rows.length`. The empty state is not decided by rows.length.
// renderRows decides it on the IN-FLIGHT set - rows minus isTerminalStage -
// and an engine can filter a DIFFERENT terminal vocabulary than this client.
// That gap was three-way (seven stages here, three on ju-service, four on
// ju-cayman) until 2026-09-07, when BOARD_TERMINAL_ and ju-service's
// CAYMAN_BOARD_TERMINAL became one vocabulary under a gate. It is not zero:
// ju-cayman is RETIRED and cannot be redeployed, so its literal still ships
// 'sealed' and 'void' at includeDone=0 while this client retires them. So
// ?api=list&includeDone=0 can still return a non-empty list whose board is
// completely empty, the guard counts the list, sees rows, and paints the
// blank. This harness is why that is survivable rather than an outage.
//
// The O-block missed it for two compounding reasons, and this block fixes both:
//   1. Its oracle was a STUB render that recorded pids. A stub render can never
//      show that non-empty `rows` produce an empty board - the whole defect
//      lives inside the renderer the stub replaced. P asserts on the HTML
//      renderRows actually writes into #list.
//   2. Every O case ran state.lane 'cayman', the ONE lane where the broken
//      guard still worked (ju-service holds no non-proof cayman rows, so its
//      partial is empty by both predicates). P runs BOTH tabs.
//
// P1/P1b are the regression proper: RED against 2539c27, green with
// inflightOf_ + boardWouldReadEmpty_.
{
  // The real render chain, composed from the shipped file - no reimplementation
  // of the empty-state rule anywhere in this harness.
  const renderSrc = extractFn('esc2') + ';' + extractVar('SEALING_STAGES') + ';' + extractVarObj('STAGE_TO_MILESTONE') + ';'
    + extractVar('RAIL_MILESTONES') + ';' + extractVarObj('STAGE_WORD') + ';' + extractVarObj('FLOW_CHIP_WORD') + ';'
    + extractVar('CCY_SYMBOL') + ';' + extractVar('CCY_ALIASES') + ';'
    + extractVar('RCOPY_ICON') + ';' + extractVar('RNOTE_ICON') + ';' + extractVar('GW') + ';'
    + extractFn('humanKey') + ';' + extractFn('stageWord') + ';' + extractFn('sinceDur') + ';'
    + extractFn('isAttnStage') + ';' + extractFn('isTerminalStage') + ';'
    + extractFn('isCompletedStage') + ';' + extractFn('isCanceledStage') + ';'
    + extractFn('inflightOf_') + ';' + extractFn('rowHay') + ';' + extractFn('boardWouldReadEmpty_') + ';'
    + extractFn('flowChipHtml') + ';' + extractFn('waitLineHtml') + ';'
    + extractFn('attnWhyText') + ';' + extractFn('attnBadgeHtml') + ';' + extractFn('railHtml') + ';'
    + extractFn('signerFraction') + ';' + extractFn('signerRoleLabel') + ';' + extractFn('fmtAmount') + ';'
    + extractFn('isManualRow_') + ';' + extractFn('isAttnRow') + ';' + extractFn('sortRows') + ';'
    + extractFn('rowHtml') + ';' + extractFn('foldRuns') + ';' + extractFn('foldedRowsHtml') + ';'
    + extractFn('monthKeyAndLabel_') + ';' + extractFn('completedByMonthHtml') + ';'
    + extractFn('renderRows') + ';';

  function makeBoardRig(lane, query) {
    const GWU = 'https://gas.example/exec';
    const JUU = 'https://ju.example';
    const parked = { [GWU]: [], [JUU]: [] };
    const listRows = { [GWU]: [], [JUU]: [] };
    // #list is the surface the operator reads. Everything else is a sink: the
    // filter chips and row handlers are not what this block is about, and a
    // generic stub keeps renderRows' tail from needing a real DOM.
    const listEl = { innerHTML: '' };
    const stub = () => ({
      innerHTML: '', textContent: '', title: '', value: '', hidden: false, disabled: false, style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {}, appendChild() {}, focus() {}, onclick: null, onkeydown: null,
    });
    // boardSearch is a REAL stub carrying the query, not null: applySearch and
    // boardWouldReadEmpty_ both read it, and a null here would quietly skip the
    // search branch in exactly the test written to cover it.
    const searchEl = Object.assign(stub(), { value: query || '' });
    const document = {
      getElementById: (id) => (id === 'list' ? listEl : (id === 'boardSearch' ? searchEl : stub())),
      querySelectorAll: () => [],
      createElement: stub,
      visibilityState: 'hidden',
    };
    function apiFetch(qs, _retried, base) {
      if (qs.indexOf('opGetRowReview') !== -1) return Promise.resolve({ ok: true, reviews: {} });
      // The orphan/manual leg settles immediately and empty here: block P is
      // about the partial-paint guard's PREDICATE, not about this leg's
      // contents, and leaving it outstanding would hold every paint in the
      // block for a reason none of these tests are written about.
      if (qs.indexOf('?api=listManualTrackerRows') === 0) return Promise.resolve({ ok: true, processes: [] });
      return new Promise((resolve) => {
        parked[base].push(() => {
          if (qs.indexOf('?api=list') === 0) resolve({ processes: listRows[base], generatedAt: '2026-09-06T10:00' });
          else if (qs.indexOf('?api=opNotes') === 0) resolve({ notes: {} });
          else resolve({ rows: {} });
        });
      });
    }
    const flush = () => new Promise((res) => { let n = 0; (function f() { if (++n > 40) return res(); Promise.resolve().then(f); })(); });
    const arrive = async (base) => { const q = parked[base].splice(0); q.forEach((fn) => fn()); await flush(); };
    const scope = {
      document,
      boardSkeleton: () => '<skel>',
      state: { lane },
      // The REAL engine selector, so the lane string this block passes is the
      // lane string the shipped code resolves - 'israel' must not silently
      // fall through to a cayman-shaped engine list.
      enginesForLane_: new Function(extractVar('GW') + ';var JU_API=' + JSON.stringify(JUU) + ';'
        + 'var ENGINES_FOR_LANE_={cayman:[' + JSON.stringify(GWU) + ',JU_API],israel:[' + JSON.stringify(GWU) + ',JU_API]};'
        + extractFn('enginesForLane_') + '; return enginesForLane_;')(),
      apiFetch,
      JU_API: JUU,
      sinceDur: () => '1m',
      loadW8: () => {},
      setInterval: () => 0,
      setBoardBadge: () => {},
      setSideStats: () => {},
    };
    const names = Object.keys(scope);
    // The shipped render() does allRows=rows -> setBoardBadge -> setSideStats ->
    // applySearch. The badges are stubbed (not what this block asserts); the
    // REAL applySearch is composed in, so the search branch of the guard is
    // exercised by the same code path the operator's typing goes through.
    const prelude = 'var LOAD_SEQ=0,PAINT_SEQ=0,doneLoaded=false,_autoRefreshArmed=true,_w8BadgeArmed=true;'
      + 'var showDone=false,showCanceled=false,showTest=false,allRows=[];'
      + 'function render(rows){allRows=rows;applySearch();}';
    // 2026-09-07: renderRows now asks boardDegraded_ whether the empty state is
    // honest, and load() carries the board-health + review-cache helpers. All
    // extracted from the live file, never restubbed here.
    const healthSrc = extractVar('BOARD_HEALTH') + ';' + extractVar('REVIEW_CACHE') + ';'
      + extractFn('boardDegraded_') + ';' + extractFn('paintVerLine_') + ';'
      + extractFn('boardErrorHtml_') + ';' + extractFn('wireBoardRetry_') + ';'
      + extractFn('applyReviewCache_') + ';' + extractFn('reviewOverlayFailed_') + ';';
    const built = (new Function(...names, prelude + healthSrc + renderSrc + extractFn('applySearch') + ';'
      + extractFn('fetchEngineBoard_') + ';' + extractFn('fetchManualRowsLeg_') + ';' + extractFn('load')
      + '; return { load: load, renderRows: renderRows };'))(...names.map((n) => scope[n]));
    return { load: built.load, renderRows: built.renderRows, arrive, flush, GWU, JUU, listRows, listEl };
  }

  // The fixture, re-pointed 2026-09-07 at a divergence that still EXISTS.
  // 'abandoned' and 'token_revoked' were the original instances; the shared
  // vocabulary closed the first and deleted the second (it was never a
  // registry stage on either engine). What remains is the GAS residual: the
  // retired ju-cayman engine's own CAYMAN_CONSOLE_TERMINAL_ predates the
  // legacy spellings, so it still ships 'sealed' and 'void' at
  // includeDone=0 while this client retires them - and ju-cayman can never be
  // redeployed to fix it. The guard under test is exactly that shape: a
  // NON-EMPTY answer whose rows all render as nothing.
  const serverKeepsClientHides = [
    { processId: 'ju-ab-1', currentStage: 'sealed', lpDisplayName: 'A', lane: 'israeli' },
    { processId: 'ju-ab-2', currentStage: 'void', lpDisplayName: 'B', lane: 'israeli' },
  ];
  const liveRow = { processId: 'b-L06SCwQLI', currentStage: 'needs_attention', lpDisplayName: 'C', lane: 'israeli' };

  // P1: THE REGRESSION. Israel tab, ju-service (fast) answers with rows that
  // all render as nothing, GAS still outstanding with the live row. RED on
  // 2539c27: listEl.innerHTML reads "Nothing in flight."
  (async () => {
    const r = makeBoardRig('israel');
    r.listRows[r.JUU] = serverKeepsClientHides.slice();
    r.listRows[r.GWU] = [liveRow];
    r.load(false);
    await r.flush();
    await r.arrive(r.JUU);
    ok('P1 ISRAEL: a partial paint whose rows all render as nothing must NOT say "Nothing in flight."',
      r.listEl.innerHTML.indexOf('Nothing in flight.') === -1, r.listEl.innerHTML.slice(0, 120));
    ok('P1b and the skeleton is what stays up while GAS is still answering',
      r.listEl.innerHTML === '<skel>', r.listEl.innerHTML.slice(0, 120));
    await r.arrive(r.GWU);
    ok('P1c once GAS lands, the live row is on the board',
      r.listEl.innerHTML.indexOf('b-L06SCwQLI') !== -1 || r.listEl.innerHTML.indexOf('class="row') !== -1,
      r.listEl.innerHTML.slice(0, 200));
    ok('P1d and the board never claims to be empty', r.listEl.innerHTML.indexOf('Nothing in flight.') === -1);
  })();

  // P2: the SAME assertion on the Cayman tab. #16's guard passed here by luck
  // (ju-service holds no non-proof cayman rows); the contract is not "the fast
  // engine happens to be empty", it is "no empty state while a request is out".
  (async () => {
    const r = makeBoardRig('cayman');
    r.listRows[r.JUU] = [{ processId: 'ju-ab-c', currentStage: 'sealed', lpDisplayName: 'A', lane: 'cayman' }];
    r.listRows[r.GWU] = [{ processId: 'gas-live', currentStage: 'needs_attention', lpDisplayName: 'C', lane: 'cayman' }];
    r.load(false);
    await r.flush();
    await r.arrive(r.JUU);
    ok('P2 CAYMAN: same guard, same fixture, still no false all-clear',
      r.listEl.innerHTML.indexOf('Nothing in flight.') === -1, r.listEl.innerHTML.slice(0, 120));
    await r.arrive(r.GWU);
    ok('P2b the Cayman board fills once both engines answered',
      r.listEl.innerHTML.indexOf('class="row') !== -1, r.listEl.innerHTML.slice(0, 200));
  })();

  // P3: the guard must not become "suppress every partial". A partial that has
  // something real to show still paints immediately - that IS the speed win
  // (Israel first paint 8.51s -> 0.65s), and a guard that swallowed it would
  // pass P1 while quietly reverting #16.
  (async () => {
    const r = makeBoardRig('israel');
    r.listRows[r.JUU] = [{ processId: 'ju-live', currentStage: 'signing', lpDisplayName: 'D', lane: 'israeli' }];
    r.listRows[r.GWU] = [liveRow];
    r.load(false);
    await r.flush();
    await r.arrive(r.JUU);
    ok('P3 a partial paint that HAS in-flight rows still paints without waiting for GAS',
      r.listEl.innerHTML.indexOf('class="row') !== -1 && r.listEl.innerHTML !== '<skel>',
      r.listEl.innerHTML.slice(0, 160));
  })();

  // P4: real emptiness must still reach the operator. The guard suppresses
  // PARTIAL emptiness only - a board that is genuinely clear has to say so once
  // every engine has answered, or the console just hangs on a skeleton forever.
  (async () => {
    const r = makeBoardRig('israel');
    r.listRows[r.JUU] = serverKeepsClientHides.slice();
    r.listRows[r.GWU] = [];
    r.load(false);
    await r.flush();
    await r.arrive(r.JUU);
    ok('P4 still suppressed while one engine is outstanding', r.listEl.innerHTML === '<skel>', r.listEl.innerHTML.slice(0, 120));
    await r.arrive(r.GWU);
    ok('P4b a genuinely empty board DOES say "Nothing in flight." once both engines answered',
      r.listEl.innerHTML.indexOf('Nothing in flight.') !== -1, r.listEl.innerHTML.slice(0, 160));
  })();

  // P4c: the same false all-clear wearing the OTHER empty copy. With a search
  // active, renderRows says 'No processes match "X"' instead of "Nothing in
  // flight." - still a flat claim about a board one engine has not answered
  // for, and still wrong. The operator searching for the LP they are mid-call
  // with is exactly when this lands. The guard applies the live query for this
  // reason; without that branch the partial paints and the console tells her
  // her LP does not exist.
  (async () => {
    const r = makeBoardRig('israel', 'dafna');
    // ju-service answers with a real in-flight row that does NOT match the
    // query; the row she searched for is on the slow engine.
    r.listRows[r.JUU] = [{ processId: 'ju-other', currentStage: 'signing', lpDisplayName: 'Unrelated', lane: 'israeli' }];
    r.listRows[r.GWU] = [{ processId: 'gas-dafna', currentStage: 'needs_attention', lpDisplayName: 'Dafna Levi', lane: 'israeli' }];
    r.load(false);
    await r.flush();
    await r.arrive(r.JUU);
    ok('P4c a partial paint under an active search must not claim "No processes match"',
      r.listEl.innerHTML.indexOf('No processes match') === -1, r.listEl.innerHTML.slice(0, 140));
    await r.arrive(r.GWU);
    ok('P4d once GAS lands, the searched-for row is there and no false no-match stands',
      r.listEl.innerHTML.indexOf('Dafna Levi') !== -1 && r.listEl.innerHTML.indexOf('No processes match') === -1,
      r.listEl.innerHTML.slice(0, 200));
  })();

  // P4e: and a search that genuinely matches nothing still says so, once both
  // engines are in. The guard defers the message, it does not delete it.
  (async () => {
    const r = makeBoardRig('israel', 'zzzznomatch');
    r.listRows[r.JUU] = [{ processId: 'ju-other', currentStage: 'signing', lpDisplayName: 'Unrelated', lane: 'israeli' }];
    r.listRows[r.GWU] = [];
    r.load(false);
    await r.flush();
    await r.arrive(r.JUU);
    await r.arrive(r.GWU);
    ok('P4e a real no-match still reaches the operator once every engine answered',
      r.listEl.innerHTML.indexOf('No processes match') !== -1, r.listEl.innerHTML.slice(0, 160));
  })();

  // P5: the divergence itself, asserted rather than described. Its own note
  // used to say that aligning isTerminalStage with the servers would turn this
  // red so the hazard could be retired DELIBERATELY rather than leaving a stale
  // comment behind. That is what happened on 2026-09-07, and this is the
  // deliberate retirement.
  //
  // What closed: ju-service. BOARD_TERMINAL_ here and CAYMAN_BOARD_TERMINAL
  // there are one vocabulary, held equal by test/terminal-vocab-harness.cjs and
  // by the mono side's terminal-stage-vocabulary.test.mjs.
  // What did NOT close, and cannot: ju-cayman is retired and can never be
  // redeployed, so its CAYMAN_CONSOLE_TERMINAL_ still ships 'sealed' and 'void'
  // at includeDone=0 while this client retires them. The empty-board hazard is
  // therefore SMALLER but still real, which is why the guard above still must
  // ask the renderer rather than count rows.
  {
    const { isTerminalStage } = new Function(extractFn('isTerminalStage') + '; return { isTerminalStage: isTerminalStage };')();
    // ju-cayman server/CaymanConsole.ts CAYMAN_CONSOLE_TERMINAL_, verbatim.
    const GAS_TERMINAL = ['complete', 'voided', 'expired', 'abandoned'];
    const gasShipsClientHides = ['sealed', 'void'].filter((s) => isTerminalStage(s) && GAS_TERMINAL.indexOf(s) === -1);
    ok('P5 the GAS residual is real: rows that engine ships at includeDone=0 and this client hides',
      gasShipsClientHides.length === 2, gasShipsClientHides.join(','));
    ok('P5a and the ju-service half is closed: abandoned is terminal on BOTH sides now',
      isTerminalStage('abandoned') === true);
    ok('P5a2 token_revoked is gone from the vocabulary (it was never a registry stage on either engine)',
      isTerminalStage('token_revoked') === false);
  }

  // P5b: inflightOf_ now carries the C1 (2026-07-19) carve-out - a COMPLETE row
  // whose records write failed is stale, still needs the operator, and stays on
  // the default board. That rule had no test of its own; moving the filter into
  // a named function is the moment to give it one, because the guard reads the
  // same function and a silently dropped carve-out would make BOTH the board and
  // the guard treat a broken completion as finished work.
  {
    const { inflightOf_ } = new Function(extractFn('isTerminalStage') + ';' + extractFn('isCompletedStage') + ';'
      + extractFn('inflightOf_') + '; return { inflightOf_: inflightOf_ };')();
    const staleComplete = { pid: 's', stage: 'complete', stale: true };
    const cleanComplete = { pid: 'c', stage: 'complete', stale: false };
    const signing = { pid: 'g', stage: 'signing' };
    const got = inflightOf_([staleComplete, cleanComplete, signing]).map((r) => r.pid);
    ok('P5b a stale-complete row stays in flight (C1), a clean complete one does not',
      got.join(',') === 's,g', got.join(','));
    ok('P5c the rows that can still blank the board are out of the in-flight set',
      inflightOf_([{ pid: 'a', stage: 'abandoned' }, { pid: 's', stage: 'sealed' }, { pid: 'v', stage: 'void' }]).length === 0);
  }

  // P6 STRUCTURAL: one table, two readers. The renderer and the guard must both
  // go through inflightOf_, and the guard must not carry its own row-count
  // predicate. This is the DETECT for the whole class: it is what makes it
  // impossible to reintroduce #16's bug by editing only one of the two sites.
  {
    const loadSrc = extractFn('load');
    const renderRowsSrc = extractFn('renderRows');
    ok('P6 renderRows derives the in-flight set from inflightOf_',
      /sortRows\(inflightOf_\(rows\)\)/.test(renderRowsSrc), renderRowsSrc.slice(0, 0));
    ok('P6b renderRows keeps no private copy of the terminal filter',
      !/rows\.filter\(function\(r\)\{return !isTerminalStage/.test(renderRowsSrc));
    // Counts LEGS, not engines (2026-09-09): the orphan/manual rows are their
    // own leg, so a guard still comparing against `engines.length` would call
    // the board complete one leg early and could render "Nothing in flight."
    // while the leg carrying the still-owed money rows was still in the air.
    ok('P6c the partial-paint guard asks the renderer\'s question, not the list\'s',
      /perEngine\.length<legs\.length&&boardWouldReadEmpty_\(rows\)/.test(loadSrc), loadSrc.slice(0, 0));
    ok('P6c2 the guard counts every LEG, never just the engines',
      !/perEngine\.length<engines\.length/.test(loadSrc),
      'the guard is back to counting engines - the manual/orphan leg would not be waited for');
    ok('P6d the raw-row-count predicate that shipped in #16 is gone',
      !/perEngine\.length<(engines|legs)\.length&&!rows\.length/.test(loadSrc),
      '#16\'s `!rows.length` guard is back - it blanked the Israel tab on 2026-09-06');
    ok('P6e boardWouldReadEmpty_ reads inflightOf_ rather than reimplementing it',
      /inflightOf_\(visible\)\.length===0/.test(extractFn('boardWouldReadEmpty_')));
  }
}

// Q1: the freshness line's age/suffix pairing. sinceDur returns 'just now' for
// anything under a minute, and paintVerLine_ used to append ' ago' to whatever
// came back, so every sub-minute refresh read "synced just now ago" on both
// lane tabs. The O/P rigs above STUB sinceDur (`() => '1m'`), which is exactly
// why they could not see it: the defect lives in the pairing, not in either
// half. This block stubs neither, and asserts both arms of agoPhrase.
{
  const src = extractVar('BOARD_HEALTH') + ';' + extractFn('boardDegraded_') + ';'
    + extractFn('sinceDur') + ';' + extractFn('paintVerLine_')
    + '; return { paint: paintVerLine_, BOARD_HEALTH: BOARD_HEALTH };';
  // Stamps are derived from the live clock so the rig never depends on a fixed
  // date, and carry the Z so Date.parse does not read them as local time.
  const agoIso = (ms) => new Date(Date.now() - ms).toISOString();
  function paintAt(ms) {
    const verEl = { style: {}, textContent: '', title: '' };
    const scope = { document: { getElementById: (id) => (id === 'ver-line' ? verEl : null) } };
    const names = Object.keys(scope);
    const built = (new Function(...names, src))(...names.map((n) => scope[n]));
    built.BOARD_HEALTH.syncedAt = agoIso(ms);
    built.paint();
    return verEl.textContent;
  }
  const subMinute = paintAt(20 * 1000);
  const normalAge = paintAt(3 * 60 * 1000);
  ok('Q1 a sub-minute sync reads "synced just now", never "just now ago"',
    subMinute === 'synced just now', subMinute);
  ok('Q1b a normal age still carries the suffix',
    normalAge === 'synced 3m ago', normalAge);
  // The DETECT for the class: any future age string composed straight into the
  // line reintroduces the same pairing bug. The suffix belongs to agoPhrase.
  // rawFn, not extractFn: extractFn prepends agoPhrase, whose whole job IS the
  // suffix, so reading through it would assert against the wrong body.
  const painterSrc = rawFn('paintVerLine_');
  ok('Q1c paintVerLine_ never appends the suffix itself',
    !/'\s*ago/.test(painterSrc) && /agoPhrase\(/.test(painterSrc), painterSrc);
}

// The O-block's async IIFEs settle on the microtask queue; report after they do.
setTimeout(function () {
  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
}, 0);
