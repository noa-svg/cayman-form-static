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
//   K5  attnRowHtml: the needs-a-look strip row carries reason + failReason +
//       daysStuck and the processId for the drawer (item 3).
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
    + extractFn('currentSignerHtml')
    + '; return { signerTsLine: signerTsLine, currentSignerHtml: currentSignerHtml, fmtTs: fmtTs };';
  const { signerTsLine, currentSignerHtml, fmtTs } = new Function(src)();
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
})();

// ---- K5: needs-a-look strip row ----------------------------------------------
(function () {
  const src = extractFn('esc2') + ';' + extractFn('attnRowHtml') + '; return attnRowHtml;';
  const attnRowHtml = new Function(src)();
  const row = attnRowHtml({ processId: 'p8', displayName: 'Failed LP', reason: 'Process flagged an error', failReason: 'fatca_status_out_of_scope', daysStuck: 4 });
  ok('K5 carries the name', row.includes('Failed LP'));
  ok('K5 carries reason + failReason', row.includes('Process flagged an error - fatca_status_out_of_scope'));
  ok('K5 carries daysStuck', row.includes('4d'));
  ok('K5 carries the pid for the drawer', row.includes('data-pid="p8"'));
  const noFail = attnRowHtml({ processId: 'p4', displayName: 'Stale LP', reason: 'Invite sent but not opened', failReason: '', daysStuck: 8 });
  ok('K5 no failReason -> reason alone', noFail.includes('Invite sent but not opened') && !noFail.includes(' - </span>'));
  const unknownDays = attnRowHtml({ processId: 'x', displayName: 'X', reason: 'r', daysStuck: 999 });
  ok('K5 999 sentinel days hidden', !unknownDays.includes('999d'));
})();

// ---- K6: source-level wiring assertions ---------------------------------------
(function () {
  const loadSrc = extractFn('load');
  ok('K6 board fetch keys includeDone off the toggles', loadSrc.includes("includeDone='+(wantDone?'1':'0')"));
  ok('K6 board fetch always sends the lane', loadSrc.includes("'?api=list&lane='+state.lane"));
  ok('K6 attention strip rides the board load', loadSrc.includes('loadAttention()'));
  ok('K6 no unconditional includeDone=1 fetch left', !loadSrc.includes('includeDone=1'));
  const drawerSrc = extractFn('renderDrawer');
  ok('K6 drawer renders d.people pre-submit (P1 #6)', drawerSrc.includes('d.people&&d.people.length'));
  ok('K6 drawer renders the current-signer block', drawerSrc.includes('currentSignerHtml(d.currentSigner)'));
  ok('K6 drawer renders the events timeline', drawerSrc.includes('d.events&&d.events.length'));
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

console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
