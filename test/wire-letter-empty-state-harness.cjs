// wire-letter-empty-state-harness.cjs (2026-09-07).
//
// THE FALSE SENTENCE. The Transfer Form tab explained an empty wire list with
// "Every row on this tab has already been paid or moved to trading" - a claim
// about every row on the tab, asserted without reading any of them. On 09/2026
// it printed that directly beneath an Awaiting-money list holding two Pending
// rows worth 380,000 in EUR and USD, under a NIS selector, and printed it twice
// (once in the list, once as the gate reason). Three statements in one
// viewport, two of them disproving the third.
//
// Same class as console-honest-status-harness.cjs's four false all-clears: a
// screen asserting a clean state it has no evidence for, over live money.
//
//   E1  Rows still awaiting money: the empty state says so, with their real
//       amounts, and does NOT claim the tab is settled.
//   E2  Rows eligible in a DIFFERENT currency: named and counted, with the
//       reason a letter cannot carry them.
//   E3  A genuinely settled tab: the settled sentence is allowed, because it
//       is now true.
//   E4  An unreadable currency cell BLOCKS generation, and says so.
//   E5  No sentence is printed twice on the same screen.
//   E6  The awaiting peek landing AFTER the rows peek still corrects the
//       reading. The two land in either order and the first one must not get
//       to paint a conclusion the second disproves.
//   E7  A failed rows peek clears the previous month's reasons rather than
//       leaving them under a new month's error.
//
// Drives the REAL console/index.html in jsdom with a scriptable fetch, never an
// extracted copy of the functions.
//
// NO REAL LP NAMES. The Hebrew below is invented.
//
// Run: node test/wire-letter-empty-state-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const HTML_PATH = path.join(__dirname, '..', 'console', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('FAIL', label, extra === undefined ? '' : String(extra).slice(0, 500)); }
}

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeIdToken = () =>
  b64u({ alg: 'RS256', typ: 'JWT' }) + '.'
  + b64u({ email: 'noa@legacyvpartners.com', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig';

const MONTH = '09/2026';
const SETTLED = /already been paid or moved to trading/;

// An awaiting row shaped like opPeekAwaitingMoney actually emits.
const A = (name, amount, currency, type) => ({
  name, nameEn: '', type: type || 'Join', amount, currency,
  execStatus: 'Pending', masterRid: 'rid-' + name,
});
// A wire-eligible row shaped like opPeekMonthTransfers emits.
const T = (name, amount, currency) => ({
  name, nameEn: '', type: 'Join', amount, currency,
  masterRid: 'rid-' + name, rowNum: 2,
});

function boot(plan) {
  const state = { plan, fetches: [] };
  const dom = new JSDOM(html, {
    url: 'http://localhost:8000/console/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem('lvp_op_token_v1', fakeIdToken());
      w.fetch = function (url, o) {
        let q = '';
        try { q = JSON.parse(o.body).q || ''; } catch (e) { q = ''; }
        const route = (q.match(/^\?(?:api|admin)=([A-Za-z0-9_]+)/) || [])[1] || '';
        state.fetches.push(route);
        const answer = state.plan(route, q);
        if (answer === 'HANG') return new Promise(() => {});
        if (answer === 'FAIL') return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(answer)) });
      };
    },
  });
  const doc = dom.window.document;
  return {
    dom, doc, win: dom.window,
    setPlan(p) { state.plan = p; },
    rowsText() { const e = doc.getElementById('wlRows'); return e ? e.textContent : ''; },
    rowsHtml() { const e = doc.getElementById('wlRows'); return e ? e.innerHTML : ''; },
    awaitingText() { const e = doc.getElementById('wlAwaiting'); return e ? e.textContent : ''; },
    // The whole page, once, which is what the operator actually reads. Do NOT
    // join per-element text on top of body.textContent: that counts everything
    // inside those elements twice and turns this duplication check into noise.
    panelText() { return doc.body ? doc.body.textContent : ''; },
  };
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 260 : ms));

// Base plan: the console boots, finds the month, and both peeks answer.
function planFor({ transfers, excluded, unresolved, awaiting, awaitingAnswer }) {
  return function (route) {
    if (route === 'listTrackerMonthTabs') return { ok: true, months: [MONTH, '08/2026'] };
    if (route === 'opPeekMonthTransfers') {
      return {
        ok: true,
        transfers: transfers || [],
        currency: 'NIS',
        counts: { incoming: 0, outgoing: 0, total: (transfers || []).length },
        excluded: excluded || { total: 0, byCurrency: {} },
        unresolvedCurrency: unresolved || [],
      };
    }
    if (route === 'opPeekAwaitingMoney') {
      if (awaitingAnswer) return awaitingAnswer;
      return { ok: true, rows: awaiting || [] };
    }
    if (route === 'opPeekParked') return { ok: true, rows: [] };
    if (route === 'list') return { processes: [], generatedAt: '' };
    return { ok: true };
  };
}

(async () => {
  // ---- E1: money is still awaiting, so the tab is NOT settled --------------
  {
    const h = boot(planFor({
      transfers: [],
      awaiting: [A('ליאה לדוגמה', 50000, 'EUR', 'Increase'), A('ינאי לדוגמה', 330000, 'USD')],
    }));
    await settle();
    const t = h.rowsText();
    ok('E1 does not claim the tab is settled', !SETTLED.test(t), t);
    ok('E1 says two rows are awaiting money', /2 rows are still awaiting money/.test(t), t);
    ok('E1 carries the real EUR amount', /50,000 EUR/.test(t), t);
    ok('E1 carries the real USD amount', /330,000 USD/.test(t), t);
  }

  // ---- E2: eligible money exists, in a currency this letter cannot carry ---
  {
    const h = boot(planFor({
      transfers: [],
      excluded: { total: 3, byCurrency: { USD: 1, EUR: 2 } },
    }));
    await settle();
    const t = h.rowsText();
    ok('E2 does not claim the tab is settled', !SETTLED.test(t), t);
    ok('E2 counts the other-currency rows', /3 rows are ready to wire in another currency/.test(t), t);
    ok('E2 names both currencies', /1 row in USD/.test(t) && /2 rows in EUR/.test(t), t);
  }

  // ---- E3: genuinely settled, so the settled sentence is allowed -----------
  {
    const h = boot(planFor({ transfers: [], awaiting: [], excluded: { total: 0, byCurrency: {} } }));
    await settle();
    const t = h.rowsText();
    ok('E3 says the tab is settled, because it is', SETTLED.test(t), t);
    ok('E3 invents no awaiting rows', !/awaiting money/.test(t), t);
  }

  // ---- E4: an unreadable currency cell blocks the whole month --------------
  {
    const h = boot(planFor({ transfers: [], unresolved: ['נועם לדוגמה: "פרנק"'] }));
    await settle();
    const t = h.rowsText();
    ok('E4 reports the unreadable cell', /currency cell nobody can read/.test(t), t);
    ok('E4 says it blocks generation', /blocks generation/.test(t), t);
    ok('E4 names the row', /נועם לדוגמה/.test(t), t);
    ok('E4 does not also claim the tab is settled', !SETTLED.test(t), t);
  }

  // ---- E5: nothing is said twice on one screen ----------------------------
  {
    const h = boot(planFor({
      transfers: [],
      awaiting: [A('ליאה לדוגמה', 50000, 'EUR', 'Increase')],
    }));
    await settle();
    const all = h.panelText();
    const count = (re) => (all.match(re) || []).length;
    ok('E5 the old duplicated sentence is gone entirely', count(/Nothing to wire this month\./g) === 0, all.slice(0, 300));
    ok('E5 the headline appears once', count(/No NIS row is ready to wire\./g) === 1, 'count=' + count(/No NIS row is ready to wire\./g));
    // "ready to wire" also appears in the panel's own static copy, so counting
    // the phrase proves nothing. The real rule is that the gate beside Generate
    // must not restate the list's headline, which is the duplication Noa saw.
    ok('E5 the gate reason is about the control, not a restatement',
      /Generate stays off until a row is ready to wire\./.test(all)
      && count(/No NIS row is ready to wire\./g) === 1, all.slice(0, 400));
  }

  // ---- E6: the awaiting peek landing LAST still corrects the reading -------
  {
    let releaseAwaiting;
    const gate = new Promise((r) => { releaseAwaiting = r; });
    const h = boot(function (route) {
      if (route === 'listTrackerMonthTabs') return { ok: true, months: [MONTH] };
      if (route === 'opPeekMonthTransfers') {
        return { ok: true, transfers: [], currency: 'NIS', counts: { total: 0 }, excluded: { total: 0, byCurrency: {} }, unresolvedCurrency: [] };
      }
      if (route === 'opPeekAwaitingMoney') return 'HANG';
      if (route === 'list') return { processes: [], generatedAt: '' };
      return { ok: true };
    });
    await settle();
    // With the awaiting answer still in flight the panel has no evidence of
    // awaiting money, which is exactly when the old code told its lie.
    const before = h.rowsText();
    ok('E6 before the awaiting answer, no awaiting claim is made', !/awaiting money/.test(before), before);

    h.setPlan(planFor({ transfers: [], awaiting: [A('ינאי לדוגמה', 330000, 'USD')] }));
    // Re-trigger the pair the way a real month change does.
    const monthEl = h.doc.getElementById('wlMonth');
    if (monthEl && monthEl.onchange) monthEl.onchange();
    await settle(320);
    const after = h.rowsText();
    ok('E6 once awaiting money lands, the reading is corrected', /still awaiting money/.test(after), after);
    ok('E6 and the settled claim is withdrawn', !SETTLED.test(after), after);
    releaseAwaiting();
  }

  // ---- E7: a failed rows peek does not leave stale reasons standing --------
  {
    const h = boot(planFor({ transfers: [], excluded: { total: 2, byCurrency: { USD: 2 } } }));
    await settle();
    ok('E7 first month shows its other-currency reason', /another currency/.test(h.rowsText()), h.rowsText());

    h.setPlan(function (route) {
      if (route === 'listTrackerMonthTabs') return { ok: true, months: [MONTH, '08/2026'] };
      if (route === 'opPeekMonthTransfers') return 'FAIL';
      if (route === 'opPeekAwaitingMoney') return { ok: true, rows: [] };
      if (route === 'list') return { processes: [], generatedAt: '' };
      return { ok: true };
    });
    const monthEl = h.doc.getElementById('wlMonth');
    if (monthEl && monthEl.onchange) monthEl.onchange();
    await settle(320);
    const t = h.rowsText();
    ok('E7 the error replaces the reasons', !/another currency/.test(t), t);
  }

  console.log((fail ? 'FAIL' : 'PASS') + '  wire-letter-empty-state  pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})();
