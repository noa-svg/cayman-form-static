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
function extractVar(name) {
  const m = html.match(new RegExp('var ' + name + '=[^\\n]*;'));
  if (!m) throw new Error('var not found: ' + name);
  return m[0];
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
  const sortRows = new Function(extractFn('sortRows') + '; return sortRows;')();
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
    + extractFn('isTerminalStage') + ';' + extractFn('inflightTotals')
    + '; return { fmtAmount: fmtAmount, inflightTotals: inflightTotals };';
  const { fmtAmount, inflightTotals } = new Function(src)();
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
  const src = extractFn('esc2') + ';' + extractFn('fmtTs') + ';' + extractFn('signerTsLine') + ';'
    + extractFn('signerReminders') + ';' + extractFn('reminderHistLine') + ';'
    + extractFn('currentSignerHtml')
    + '; return { signerTsLine: signerTsLine, currentSignerHtml: currentSignerHtml, fmtTs: fmtTs, reminderHistLine: reminderHistLine };';
  const { signerTsLine, currentSignerHtml, fmtTs, reminderHistLine } = new Function(src)();
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
  ok('K6 board fetch keys includeDone off the toggles', loadSrc.includes("includeDone='+(wantDone?'1':'0')"));
  ok('K6 board fetch always sends the lane', loadSrc.includes("'?api=list&lane='+state.lane"));
  ok('K6 no unconditional includeDone=1 fetch left', !loadSrc.includes('includeDone=1'));
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

// ---- K10: board-row reminder status + drawer comms extras (2026-07-20, Noa's
// top priority: "I need to remind some people maybe") -------------------------
(function () {
  // Source-level: the board fetch maps reminderCount/lastReminderAt off the
  // server row, and rowHtml renders a chip for signing-stage rows only.
  ok('K10 board row mapping carries reminderCount', html.includes('reminderCount:it.reminderCount||0'));
  ok('K10 board row mapping carries lastReminderAt', html.includes('lastReminderAt:it.lastReminderAt||null'));
  const rowSrc = extractFn('rowHtml');
  ok('K10 rowHtml renders the never-reminded chip', rowSrc.includes('not reminded'));
  ok('K10 rowHtml renders the reminded-N-times chip', rowSrc.includes(">reminded '+r.reminderCount+'x</span>"));
  // 2026-07-21: assertion updated to the CURRENT deliberate behavior. The chip
  // was signing-stage-only when K10 was written; the 2026-07-20 stage-routed
  // reminders work (wiki tools/ju.md "Reminders are stage-routed") deliberately
  // widened it to every chase-able stage (link_sent/opened/in_progress/signing,
  // matching the two reminder routes ?admin=resendInvite / ?admin=nudge). The
  // stale signing-only assertion was the only red in this harness and, via the
  // pre-push gate, blocked deploys of unrelated fixes.
  ok('K10 reminder chip covers every chase-able stage', /r\.stage===['"]link_sent['"]\|\|r\.stage===['"]opened['"]\|\|r\.stage===['"]in_progress['"]\|\|r\.stage===['"]signing['"]/.test(rowSrc));
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
  // currentSignerHtml.
  const src = extractFn('esc2') + ';' + extractVar('SEALING_STAGES') + ';' + extractVarObj('STAGE_TO_MILESTONE') + ';'
    + extractVar('RAIL_MILESTONES') + ';' + extractFn('railHtml') + ';' + extractFn('isTerminalStage') + ';'
    + extractFn('isCompletedStage') + ';' + extractFn('signerFraction') + ';' + extractFn('fmtAmount') + ';'
    + extractVar('CCY_SYMBOL') + ';' + extractVar('CCY_ALIASES') + ';'
    + extractVar('RCOPY_ICON') + ';' + extractVar('RNOTE_ICON') + ';'
    + extractFn('rowHtml') + '; return rowHtml;';
  const rowHtml = new Function(src)();

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
})();

(function () {
  // Source-level assertions on load(): opNotes is fetched and merged, never
  // relying on ?api=list to carry PII (see the CaymanGateway.ts opNotes route
  // comment for why - this is the client-side half of that same invariant).
  const loadSrc = extractFn('load');
  ok('K11 load() fetches the separate PII-gated opNotes route', loadSrc.includes("apiFetch('?api=opNotes')"));
  ok('K11 opNotes fetch is soft-failed (never blocks the board)', /notesFetch=apiFetch\('\?api=opNotes'\)\.catch/.test(loadSrc));
  ok('K11 list and opNotes are fetched together via Promise.all', loadSrc.includes('Promise.all('));
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

console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
