// console-honest-status-harness.cjs (2026-09-07).
//
// Four ways the operator console told Noa something was fine when it was not.
// All four were measured against the file this harness loads, and every one of
// them is a FALSE ALL-CLEAR over live money, which is the same failure class as
// the "Nothing in flight" the ok:false envelope used to paint (2026-07-17).
//
//   H1  A failed engine leg with rows surviving: the board keeps the rows (the
//       fail-open posture is deliberate) but the operator is TOLD.
//   H2  A failed engine leg with nothing surviving: the board must NOT render
//       the flat all-clear "Nothing in flight." An outage and an empty pipeline
//       are different facts and must not share a screen.
//   H3  A failed NON-list leg (opNotes / opBoardDetail) still counts as
//       degraded: a whole engine can go missing one leg at a time.
//   H4  A console that never completed a load asserts no freshness at all -
//       neither the markup's old static "Synced" nor a stale "synced 2m ago".
//   H5  A FAILED REFRESH after a good load does not leave the good load's
//       freshness claim standing unqualified.
//   H6  A lane switch does not leave the previous lane's money in the sidebar
//       under the new lane's name.
//   H7  An APPROVED needs_attention row wears neither the alarm word nor the
//       alarm rail, while an unapproved one beside it still wears both.
//   H8  A FAILED opGetRowReview fetch is not a state change: the approved row
//       does not oscillate back into the alarm on one unlucky refresh.
//   H9  #ver-line-sr (item 3, q62 follow-up) speaks the three sync states to
//       a screen reader, and does NOT re-announce an unchanged state merely
//       because the visible line's relative age redrew (the 45s auto-refresh
//       tick landing on the same state, most of all).
//
// This drives the REAL console/index.html in jsdom (runScripts:'dangerously')
// with a scriptable window.fetch, rather than extracting functions into a
// synthetic scope. The board is Google-SSO gated in production, so the harness
// seeds a syntactically valid, unexpired id_token in localStorage - the console
// only reads its `exp`/`email` claims client-side and lets the server be the
// real boundary, so this reaches the authed board without touching DEMO mode
// and its fixtures.
//
// Run: node test/console-honest-status-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const HTML_PATH = path.join(__dirname, '..', 'console', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('FAIL', label, extra === undefined ? '' : String(extra).slice(0, 400)); }
}

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function fakeIdToken() {
  return b64u({ alg: 'RS256', typ: 'JWT' }) + '.'
    + b64u({ email: 'noa@legacyvpartners.com', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig';
}

const GW_HOST = 'script.google.com';
// The feed's own stamp shape ("2026-08-06T09:30"), no zone suffix - which the
// console parses as LOCAL time. Built from local components rather than sliced
// off an ISO/UTC string, or the harness would read hours-old on any machine
// away from UTC and trip the console's own 6h staleness threshold.
function localStamp(msAgo) {
  const d = new Date(Date.now() - msAgo);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
const FRESH = localStamp(5 * 60 * 1000); // "synced 5m ago", never stale

// A row shaped like the board feeds actually emit.
function P(id, name, stage, extra) {
  return Object.assign({
    processId: id, displayName: name, currentStage: stage, ageDays: 3,
    flowType: 'israeli_increase', lane: 'israeli', nextActionPhrase: '',
    investmentAmount: 250000, investmentCurrency: 'ILS',
  }, extra || {});
}

// ---------------------------------------------------------------------------
// The scriptable gateway. `plan` maps engine ('gw'|'ju') + route to either a
// payload object or the string 'FAIL' (the fetch itself rejects, which is what
// a dead engine looks like to apiFetch), or 'HANG' (never settles).
// ---------------------------------------------------------------------------
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
        const engine = String(url).indexOf(GW_HOST) >= 0 ? 'gw' : 'ju';
        const route = (q.match(/^\?(?:api|admin)=([A-Za-z0-9_]+)/) || [])[1] || '';
        state.fetches.push(engine + ':' + route);
        const answer = state.plan(engine, route, q);
        if (answer === 'HANG') return new Promise(() => {});
        if (answer === 'FAIL') return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve(JSON.stringify(answer)),
        });
      };
    },
  });
  const doc = dom.window.document;
  return {
    dom, doc, win: dom.window,
    setPlan(p) { state.plan = p; },
    fetches: state.fetches,
    verLine() { const v = doc.getElementById('ver-line'); return { text: v.textContent, color: v.style.color }; },
    verLineSr() { const v = doc.getElementById('ver-line-sr'); return v ? v.textContent : null; },
    listHtml() { return doc.getElementById('list').innerHTML; },
    rows() { return Array.prototype.slice.call(doc.querySelectorAll('#list .row')); },
    rowFor(pid) { return doc.querySelector('#list .row[data-pid="' + pid + '"]'); },
    sideStat(id) { const e = doc.getElementById(id); return e ? e.textContent : null; },
    sideHidden() { const e = doc.getElementById('sideStats'); return !e || e.hidden; },
  };
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 220 : ms));

// A default plan: everything healthy, `rows` on the named engine.
function healthy(rowsByEngine, reviews) {
  return function (engine, route) {
    if (route === 'list') return { processes: rowsByEngine[engine] || [], generatedAt: FRESH };
    if (route === 'opNotes') return { notes: {} };
    if (route === 'opBoardDetail') return { ok: true, rows: {} };
    if (route === 'opGetRowReview') return { ok: true, reviews: reviews || {} };
    if (route === 'w8renewals') return { counts: {}, due: [] };
    return { ok: true };
  };
}
// Wrap a plan so specific engine:route pairs fail.
function breaking(base, broken) {
  return function (engine, route, q) {
    if (broken.indexOf(engine + ':' + route) >= 0) return 'FAIL';
    return base(engine, route, q);
  };
}

(async () => {
  // ---- H1: a dead leg with rows surviving. Rows stay, operator is told. ----
  {
    const rows = [P('i1', 'Michael Stern', 'signing'), P('i3', 'David Cohen', 'link_sent')];
    const t = boot(breaking(healthy({ ju: rows, gw: [] }), ['gw:list']));
    await settle(400);
    ok('H1 the surviving engine\'s rows still render (fail-open is preserved)',
      t.rows().length === 2, t.rows().length + ' rows / ' + t.listHtml().slice(0, 200));
    const v = t.verLine();
    ok('H1 the sync line says the board may be stale', /may be stale/.test(v.text), JSON.stringify(v));
    ok('H1 the sync line is rendered in the danger colour', /danger/.test(v.color), JSON.stringify(v));
    ok('H1 the sync line does NOT read as a clean completed sync',
      !/^synced /.test(v.text), JSON.stringify(v));
    t.dom.window.close();
  }

  // ---- H2: a dead leg with nothing surviving. NOT a calm empty board. ----
  {
    const t = boot(breaking(healthy({ ju: [], gw: [] }), ['gw:list']));
    await settle(400);
    const h = t.listHtml();
    ok('H2 an outage never renders the flat all-clear "Nothing in flight."',
      h.indexOf('Nothing in flight.') < 0, h.slice(0, 300));
    ok('H2 the board renders its own error state instead',
      h.indexOf('Could not load the board.') >= 0, h.slice(0, 300));
    ok('H2 that error state carries an in-place Retry',
      !!t.doc.getElementById('boardRetry'), h.slice(0, 300));
    ok('H2 the sync line agrees with the board', /danger/.test(t.verLine().color), JSON.stringify(t.verLine()));
    t.dom.window.close();
  }

  // ---- H3: a dead NON-list leg is degradation too. ----
  {
    const rows = [P('i1', 'Michael Stern', 'signing')];
    const t = boot(breaking(healthy({ ju: rows, gw: [] }), ['gw:opBoardDetail']));
    await settle(400);
    ok('H3 rows still render on a failed detail leg', t.rows().length === 1, t.rows().length);
    ok('H3 a failed opBoardDetail leg is reported, not swallowed',
      /may be stale/.test(t.verLine().text), JSON.stringify(t.verLine()));
    t.dom.window.close();
  }

  // ---- H4: never loaded => assert no freshness at all. ----
  {
    ok('H4 the ver-line markup ships EMPTY, not the static word "Synced"',
      /<span id="ver-line"><\/span>/.test(html),
      (html.match(/<span id="ver-line">[^<]*<\/span>/) || ['(not found)'])[0]);
    const t = boot(function () { return 'FAIL'; });
    await settle(400);
    const v = t.verLine();
    ok('H4 a console that never synced never says "Synced"', v.text.indexOf('Synced') < 0, JSON.stringify(v));
    ok('H4 it never claims a sync age either', /synced \d/.test(v.text) === false, JSON.stringify(v));
    ok('H4 it says the board could not load', v.text === 'Could not load the board.', JSON.stringify(v));
    ok('H4 in the danger colour', /danger/.test(v.color), JSON.stringify(v));
    t.dom.window.close();
  }

  // ---- H5: a failed refresh must not leave the last good claim standing. ----
  {
    const rows = [P('i1', 'Michael Stern', 'signing')];
    const t = boot(healthy({ ju: rows, gw: [] }));
    await settle(400);
    const before = t.verLine();
    ok('H5 a clean load reads as a clean sync', /^synced /.test(before.text), JSON.stringify(before));
    ok('H5 a clean load is not coloured danger', !/danger/.test(before.color), JSON.stringify(before));
    // Refresh through a real operator control (the test-rows chip calls load(true)).
    t.setPlan(breaking(healthy({ ju: rows, gw: [] }), ['ju:list', 'gw:list']));
    t.doc.getElementById('showTestToggle').click();
    await settle(400);
    const after = t.verLine();
    ok('H5 the failed refresh no longer reads as a completed sync',
      !/^synced /.test(after.text), JSON.stringify(after));
    ok('H5 it qualifies the freshness it still shows', /may be stale/.test(after.text), JSON.stringify(after));
    ok('H5 and goes danger', /danger/.test(after.color), JSON.stringify(after));
    t.dom.window.close();
  }

  // ---- H6: a lane switch never shows the old lane's money. ----
  {
    const israel = [P('i1', 'Michael Stern', 'signing'), P('i5', 'Yossi Barak', 'needs_attention')];
    const t = boot(healthy({ ju: israel, gw: [] }));
    await settle(400);
    ok('H6 Israel\'s sidebar is populated before the switch',
      !t.sideHidden() && t.sideStat('ss-active') === '2', t.sideStat('ss-active'));
    const totalsBefore = t.doc.getElementById('ssTotals').textContent;
    ok('H6 and shows Israel\'s in-flight money', /500,000/.test(totalsBefore), totalsBefore);
    // Cayman's board never answers: this is the whole window the audit measured.
    t.setPlan(function (engine, route) {
      if (route === 'list' || route === 'opNotes' || route === 'opBoardDetail') return 'HANG';
      return { ok: true };
    });
    t.win.__consoleSetLane('cayman');
    ok('H6 the lane chip moved to Cayman', t.doc.body.getAttribute('data-lane') === 'cayman');
    ok('H6 the sidebar does not survive the switch carrying Israel\'s figures', t.sideHidden(),
      'ss-active=' + t.sideStat('ss-active') + ' totals=' + t.doc.getElementById('ssTotals').textContent);
    ok('H6 Israel\'s money total is gone from the sidebar',
      !/500,000/.test(t.doc.getElementById('ssTotals').textContent),
      t.doc.getElementById('ssTotals').textContent);
    ok('H6 the nav attention badge does not carry across either',
      t.doc.getElementById('nav-board-badge').hidden === true);
    ok('H6 and no freshness is claimed for a lane that has not synced',
      t.verLine().text.indexOf('synced') < 0, JSON.stringify(t.verLine()));
    await settle(300);
    ok('H6 still nothing stale on screen while Cayman is in flight', t.sideHidden());
    t.dom.window.close();
  }

  // ---- H7: an approved attention row wears no alarm; an unapproved one does. ----
  {
    const rows = [
      P('i5', 'Yossi Barak', 'needs_attention', { nextActionPhrase: 'The wire row did not reach the tracker' }),
      P('i9', 'Dana Levi', 'needs_attention', { nextActionPhrase: 'The wire row did not reach the tracker' }),
    ];
    const reviews = { i5: { masterRid: 'i5', state: 'approved', reviewedBy: 'noa@legacyvpartners.com' } };
    const t = boot(healthy({ ju: rows, gw: [] }, reviews));
    await settle(400);
    const approved = t.rowFor('i5');
    const flagged = t.rowFor('i9');
    ok('H7 both rows render', !!approved && !!flagged, t.listHtml().slice(0, 200));
    if (approved && flagged) {
      const aWord = approved.querySelector('.rword').textContent;
      const fWord = flagged.querySelector('.rword').textContent;
      ok('H7 the APPROVED row does not read "Stuck"', aWord.indexOf('Stuck') < 0, aWord);
      ok('H7 it says who cleared it instead', /^Approved by /.test(aWord), aWord);
      ok('H7 the UNAPPROVED row still reads "Stuck" (the gate is on review, not on the stage)',
        fWord === 'Stuck', fWord);
      const aRail = approved.querySelector('.rail').className;
      const fRail = flagged.querySelector('.rail').className;
      ok('H7 the approved rail drops the alarm colour', /\bcleared\b/.test(aRail), aRail);
      ok('H7 the approved rail stays frozen (its beat is still unknown)', /\bfrozen\b/.test(aRail), aRail);
      ok('H7 the unapproved rail keeps the alarm', /\bfrozen\b/.test(fRail) && !/\bcleared\b/.test(fRail), fRail);
      ok('H7 the approved row keeps no coral tint', !approved.classList.contains('attn'), approved.className);
      ok('H7 the unapproved row keeps its coral tint', flagged.classList.contains('attn'), flagged.className);
      ok('H7 the approved row does not repeat its own approval sentence twice',
        (approved.innerHTML.match(/Approved by/g) || []).length === 1, approved.innerHTML);
    }
    ok('H7 exactly one row is counted in NEED A LOOK', t.sideStat('ss-attn') === '1', t.sideStat('ss-attn'));
    // The CSS half of the same claim: .cleared must not resolve to the red token.
    const clearedRules = html.match(/\.rail\.frozen\.cleared \.seg\.current\s*\{[^}]*\}/g) || [];
    ok('H7 a .cleared rail rule exists in every rail palette block', clearedRules.length === 2, clearedRules.join(' | '));
    ok('H7 no .cleared rail rule paints the alarm red',
      clearedRules.every((r) => r.indexOf('--color-red') < 0 && r.indexOf('--color-danger') < 0),
      clearedRules.join(' | '));
    t.dom.window.close();
  }

  // ---- H8: a failed review overlay is not an un-approval. ----
  {
    const rows = [P('i5', 'Yossi Barak', 'needs_attention', { nextActionPhrase: 'The wire row did not reach the tracker' })];
    const reviews = { i5: { masterRid: 'i5', state: 'approved', reviewedBy: 'noa@legacyvpartners.com' } };
    const t = boot(healthy({ ju: rows, gw: [] }, reviews));
    await settle(400);
    ok('H8 the approved row starts cleared', t.sideStat('ss-attn') === '0', t.sideStat('ss-attn'));
    // Same board, same rows, but the review overlay now cannot be reached.
    t.setPlan(breaking(healthy({ ju: rows, gw: [] }, reviews), ['ju:opGetRowReview']));
    t.doc.getElementById('showTestToggle').click();
    await settle(400);
    const row = t.rowFor('i5');
    ok('H8 the row is still on the board', !!row, t.listHtml().slice(0, 200));
    if (row) {
      ok('H8 a dropped overlay fetch does not put the row back in the alarm',
        !row.classList.contains('attn'), row.className);
      ok('H8 nor back to the word "Stuck"', row.querySelector('.rword').textContent.indexOf('Stuck') < 0,
        row.querySelector('.rword').textContent);
      ok('H8 nor back to the alarm rail', /\bcleared\b/.test(row.querySelector('.rail').className),
        row.querySelector('.rail').className);
    }
    ok('H8 nor back into the NEED A LOOK count', t.sideStat('ss-attn') === '0', t.sideStat('ss-attn'));
    ok('H8 and the operator is told the overlay did not answer',
      /danger/.test(t.verLine().color), JSON.stringify(t.verLine()));
    t.dom.window.close();
  }

  // ---- H9: the spoken sync line (item 3) speaks state, not age. ----
  {
    ok('H9 the markup ships the announcer as a genuine live region',
      /<span id="ver-line-sr" class="wl-vh" role="status" aria-live="polite" aria-atomic="true"><\/span>/.test(html),
      (html.match(/<span id="ver-line-sr"[^>]*><\/span>/) || ['(not found)'])[0]);

    // Never synced + a dead leg: the same sentence the visible line carries,
    // since there is no volatile age to strip yet.
    const tDead = boot(function () { return 'FAIL'; });
    await settle(400);
    ok('H9 a console that never synced speaks the same refusal it shows',
      tDead.verLineSr() === 'Could not load the board.', tDead.verLineSr());
    tDead.dom.window.close();

    // A clean sync speaks the state word, not the age.
    const rows = [P('i1', 'Michael Stern', 'signing')];
    const t = boot(healthy({ ju: rows, gw: [] }));
    await settle(400);
    ok('H9 a clean sync speaks "Board synced." with no age in it',
      t.verLineSr() === 'Board synced.', t.verLineSr());
    ok('H9 the VISIBLE line carries an age digit the spoken line does not',
      /^synced /.test(t.verLine().text) && /\d/.test(t.verLine().text) && !/\d/.test(t.verLineSr()),
      JSON.stringify(t.verLine()) + ' / ' + t.verLineSr());

    // A second clean load, later, lands on the SAME state (synced). The
    // announcer must write the identical string again - a same-value write
    // announces nothing new to a screen reader - which is the whole point on
    // a 45s auto-refresh tick that finds nothing wrong.
    const before = t.verLineSr();
    t.doc.getElementById('showTestToggle').click();
    t.doc.getElementById('showTestToggle').click();
    await settle(400);
    ok('H9 back-to-back clean syncs write the IDENTICAL announcer string (no re-announce on an unchanged state)',
      t.verLineSr() === before && t.verLineSr() === 'Board synced.', t.verLineSr());
    t.dom.window.close();

    // A degraded leg speaks the state sentence plus which engine is down,
    // not the elapsed time since the last good sync.
    const t2 = boot(breaking(healthy({ ju: rows, gw: [] }), ['gw:list']));
    await settle(400);
    ok('H9 a degraded board speaks the danger sentence with the dead engine named, no age',
      /^The board may be stale\./.test(t2.verLineSr()) && !/synced \d/.test(t2.verLineSr()),
      t2.verLineSr());
    t2.dom.window.close();
  }

  console.log('\n' + (fail ? 'CONSOLE HONEST-STATUS HARNESS FAILED: ' : 'CONSOLE HONEST-STATUS HARNESS PASSED: ')
    + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness crashed:', e); process.exit(2); });
