// console-board-load-race-harness.cjs (2026-09-11).
//
// Proves the fix for defect-queue.json q62: two distinct bugs behind one root
// enabler. apiFetch had no AbortController anywhere in the file, so a
// superseded load's in-flight requests never died - they sat occupying a
// connection slot until GAS eventually answered them (measured 20-185s).
//
//   BUG A (cold-load race). paintBoard_ recomputed BOARD_HEALTH.legFail from
//       perEngine, which is only the legs that have answered SO FAR. A board
//       with 1 of 3 legs landed - the one that DID answer being perfectly
//       healthy - reported legFail:false and read exactly like a fully-synced
//       clean board. Measured live 2026-09-10: 90s between a false-clean
//       1-row paint and the true 6-row paint, legFail false in both.
//   BUG B (lane-switch race). GW is one fixed origin used by every lane.
//       Nothing cancelled a superseded load's GAS requests, so three lane
//       switches inside GAS's slow window queued up to 9 POSTs to one origin
//       - past Chrome's ~6-connections-per-origin cap - and the newest
//       load's own requests queued behind zombies the rid check had already
//       discarded, waiting the full 185s ceiling. Only a page reload
//       recovered, because navigating away is what actually aborts a
//       document's in-flight fetches.
//
// This drives the REAL console/index.html in jsdom (runScripts:'dangerously')
// with a scriptable window.fetch, the same rig shape console-honest-status-
// harness.cjs uses (real page, real auth token seeded, DEMO never touched),
// extended with the one tool neither of that harness's tests needed: holding
// a leg's response indefinitely and releasing it on command, while tracking
// whether its AbortSignal actually fired.
//
// Run: node test/console-board-load-race-harness.cjs
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
function fakeIdToken() {
  return b64u({ alg: 'RS256', typ: 'JWT' }) + '.'
    + b64u({ email: 'noa@legacyvpartners.com', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig';
}

const GW_HOST = 'script.google.com';
// Local-time stamp shape ("2026-08-06T09:30"), matching the console's own
// parser (console-honest-status-harness's header explains why: built from
// local components, or this reads hours-old on any machine away from UTC).
function localStamp(msAgo) {
  const d = new Date(Date.now() - msAgo);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
const FRESH = localStamp(1000);

function P(id, name, stage, extra) {
  return Object.assign({
    processId: id, displayName: name, currentStage: stage, ageDays: 1,
    flowType: 'cayman_subscription', lane: 'cayman', nextActionPhrase: '',
    investmentAmount: 1000000, investmentCurrency: 'USD',
  }, extra || {});
}

// What a real, browser-native aborted fetch() rejects with.
function mkAbortError() {
  const e = new Error('The operation was aborted.');
  e.name = 'AbortError';
  return e;
}

// ---------------------------------------------------------------------------
// The scriptable gateway. `plan(engine, route, q)` returns a payload object,
// the string 'FAIL' (the fetch rejects - a dead engine), or the string
// 'HOLD' (parked until releaseHeld() answers it - catching a leg genuinely
// mid-flight, which is what this defect needs and console-honest-status-
// harness's fast/dead-only plans never had to do).
// ---------------------------------------------------------------------------
function boot(initialPlan) {
  const state = { fetches: [], held: [] };
  let plan = initialPlan || (() => ({ ok: true }));
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
        const rec = { engine, route, q, aborted: false };
        state.fetches.push(rec);
        const answer = plan(engine, route, q);
        if (answer === 'HOLD') {
          return new Promise((resolve, reject) => {
            const entry = { engine, route, q, resolve, reject, rec };
            state.held.push(entry);
            // This is the actual thing under test: apiFetch must pass the
            // per-load AbortController's signal all the way into fetch()'s
            // own options, or this listener never fires and the held request
            // sits here until manually released - exactly the pre-fix bug.
            if (o.signal) {
              const onAbort = function () {
                rec.aborted = true;
                const ix = state.held.indexOf(entry);
                if (ix >= 0) state.held.splice(ix, 1);
                reject(mkAbortError());
              };
              if (o.signal.aborted) onAbort();
              else o.signal.addEventListener('abort', onAbort);
            }
          });
        }
        if (answer === 'FAIL') return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(answer)) });
      };
    },
  });
  const doc = dom.window.document;
  return {
    dom, doc, win: dom.window,
    setPlan(p) { plan = p; },
    fetches: state.fetches,
    held: state.held,
    // Resolves every currently-held fetch `match(rec)` selects. `valueOrFn`
    // is either one payload for all of them or `(rec)=>payload` so list /
    // opNotes / opBoardDetail can each get their own real shape. Resolved
    // entries are consumed (spliced) - releasing twice is not possible.
    releaseHeld(match, valueOrFn) {
      const remaining = [];
      state.held.slice().forEach(function (e) {
        if (match(e.rec)) {
          const v = (typeof valueOrFn === 'function') ? valueOrFn(e.rec) : valueOrFn;
          e.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(v)) });
        } else remaining.push(e);
      });
      state.held.length = 0;
      remaining.forEach(function (e) { state.held.push(e); });
    },
    verLine() { const v = doc.getElementById('ver-line'); return { text: v.textContent, color: v.style.color }; },
    rows() { return Array.prototype.slice.call(doc.querySelectorAll('#list .row')); },
    sideStat(id) { const e = doc.getElementById(id); return e ? e.textContent : null; },
    sideHidden() { const e = doc.getElementById('sideStats'); return !e || e.hidden; },
  };
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 250 : ms));

// A healthy default plan: everything answers immediately with `rowsByEngine`.
function healthy(rowsByEngine) {
  return function (engine, route) {
    if (route === 'list') return { processes: rowsByEngine[engine] || [], generatedAt: FRESH };
    if (route === 'opNotes') return { notes: {} };
    if (route === 'opBoardDetail') return { ok: true, rows: {} };
    if (route === 'listManualTrackerRows') return { ok: true, processes: [], generatedAt: FRESH };
    if (route === 'opGetRowReview') return { ok: true, reviews: {} };
    return { ok: true };
  };
}

(async () => {
  // ===========================================================================
  // GROUP A (bug A): a leg genuinely still in flight must read as neither a
  // clean sync nor a failure - and must clear itself the instant it lands.
  // ===========================================================================
  {
    // The fast ju-service leg lands with one row; GW (all three sub-fetches -
    // list/opNotes/opBoardDetail) is held indefinitely, the measured live
    // shape of the 90s window between the false-clean 1-row paint and the
    // true 6-row one.
    const t = boot(function (engine, route) {
      if (route === 'opGetRowReview') return { ok: true, reviews: {} };
      if (engine === 'gw') return 'HOLD';
      if (route === 'list') return { processes: [P('ju-1', 'Dana Levi', 'signing')], generatedAt: FRESH };
      if (route === 'opNotes') return { notes: {} };
      if (route === 'opBoardDetail') return { ok: true, rows: {} };
      if (route === 'listManualTrackerRows') return { ok: true, processes: [], generatedAt: FRESH };
      return { ok: true };
    });
    await settle(300);
    ok('A1 the fast leg\'s row paints while gw is still held (progressive paint is unaffected)',
      t.rows().length === 1, t.rows().length);
    const heldGw = t.held.filter(function (e) { return e.engine === 'gw'; }).map(function (e) { return e.route; }).sort();
    ok('A1 all three gw sub-fetches are genuinely in flight, none faked as answered',
      heldGw.join(',') === 'list,opBoardDetail,opNotes', heldGw);

    const v1 = t.verLine();
    ok('A2 THE DEFECT ITSELF: the board does NOT read as a completed clean sync while a leg is still out',
      !/^synced /.test(v1.text), JSON.stringify(v1));
    ok('A2 nor does it cry wolf as degraded - gw has not failed, it is inside its normal 20-185s window',
      !/may be stale/.test(v1.text) && v1.color !== 'var(--color-danger)', JSON.stringify(v1));
    ok('A2 BOARD_HEALTH says pending, distinctly from legFail',
      t.win.BOARD_HEALTH.pending === true && t.win.BOARD_HEALTH.legFail === false,
      JSON.stringify(t.win.BOARD_HEALTH));

    // Release gw with the five rows the live incident actually had stuck.
    t.releaseHeld(function (rec) { return rec.engine === 'gw'; }, function (rec) {
      if (rec.route === 'list') return {
        processes: [
          P('gw-1', 'Row A', 'needs_attention'), P('gw-2', 'Row B', 'needs_attention'),
          P('gw-3', 'Row C', 'needs_attention'), P('gw-4', 'Row D', 'needs_attention'),
          P('gw-5', 'Row E', 'needs_attention'),
        ], generatedAt: FRESH,
      };
      if (rec.route === 'opNotes') return { notes: {} };
      return { ok: true, rows: {} };
    });
    await settle(300);
    ok('A3 once gw lands, all 6 rows are on the board', t.rows().length === 6, t.rows().length);
    const v2 = t.verLine();
    ok('A3 and the sync line NOW reads clean', /^synced /.test(v2.text), JSON.stringify(v2));
    ok('A3 pending clears itself the moment the load completes - no flag anyone had to reset',
      t.win.BOARD_HEALTH.pending === false, JSON.stringify(t.win.BOARD_HEALTH));
    t.dom.window.close();
  }

  // ===========================================================================
  // GROUP B (bug B): a lane switch must actually ABORT the superseded load's
  // GW leg, not merely discard its eventual paint - and the next load's own
  // GW leg must not be starved behind it.
  // ===========================================================================
  {
    const t = boot(healthy({ gw: [], ju: [] }));
    await settle(200);
    // The page fires its own board load twice at boot (initAuth's load() and
    // the fund-switcher's own initial syncFund(state.lane), independently of
    // this defect) - both complete cleanly under the healthy() plan above, so
    // once settled the fetch log is reset to a clean baseline before this
    // block's own counting starts.
    t.fetches.length = 0;
    // Every gw fetch is held while `holdGw` is true, whichever lane asked for
    // it - lane is not even readable off opNotes' query string (it carries no
    // &lane= param), so the hold is keyed on the engine alone, same as the
    // real bug: GW is one fixed origin regardless of which lane is asking.
    let holdGw = true;
    t.setPlan(function (engine, route) {
      if (route === 'opGetRowReview') return { ok: true, reviews: {} };
      if (engine === 'gw' && holdGw) return 'HOLD';
      if (route === 'list') return { processes: [P('c1', 'Galboa Fund of Funds', 'needs_attention')], generatedAt: FRESH };
      if (route === 'opNotes') return { notes: {} };
      if (route === 'opBoardDetail') return { ok: true, rows: {} };
      if (route === 'listManualTrackerRows') return { ok: true, processes: [], generatedAt: FRESH };
      return { ok: true };
    });

    // Cayman #1: its gw leg goes into flight and is held there, simulating
    // GAS mid-call when the operator switches lanes away from it.
    t.win.__consoleSetLane('cayman');
    const firstCaymanGw = t.held.filter(function (e) { return e.engine === 'gw'; });
    ok('B1 the first Cayman load\'s gw leg (all 3 sub-fetches) is genuinely in flight',
      firstCaymanGw.length === 3, firstCaymanGw.length);
    ok('B1 none of it is aborted yet - the switch away has not happened', firstCaymanGw.every(function (e) { return !e.rec.aborted; }));
    const firstCaymanRecs = firstCaymanGw.map(function (e) { return e.rec; });

    // Israel: THIS switch is what must cancel Cayman #1's zombie leg.
    t.win.__consoleSetLane('israel');
    ok('B2 the FIRST Cayman load\'s gw fetches are all now aborted (AbortController actually fired)',
      firstCaymanRecs.every(function (r) { return r.aborted; }),
      firstCaymanRecs.map(function (r) { return r.aborted; }));
    ok('B2 they are gone from the held queue - only Israel\'s own (still-held) gw leg remains',
      t.held.filter(function (e) { return firstCaymanRecs.indexOf(e.rec) !== -1; }).length === 0);

    // Cayman #2: GAS is free to answer now (holdGw off) - the actual fix
    // under test is that this load's OWN gw requests are not queued behind
    // the zombies from #1/#2, because those zombies are dead, not merely
    // ignored.
    holdGw = false;
    t.win.__consoleSetLane('cayman');
    await settle(300);
    ok('B3 the board actually completed this time - the sync line is clean, not still pending',
      /^synced /.test(t.verLine().text), JSON.stringify(t.verLine()));
    ok('B3 the second Cayman load\'s row is on the board', t.rows().length === 1, t.rows().length);

    // Zero extra apiFetch/retry calls from an aborted, superseded load: each
    // gw route fires exactly three times across this whole test - Cayman #1
    // (aborted), Israel (aborted), Cayman #2 (completed) - never a fourth,
    // which is what an automatic retry off the abort would add. This is the
    // proof apiFetch's non-JSON retry path is unreachable from an AbortError:
    // it rejects the promise before that .then ever runs.
    ['list', 'opNotes', 'opBoardDetail'].forEach(function (route) {
      const n = t.fetches.filter(function (r) { return r.engine === 'gw' && r.route === route; }).length;
      ok('B4 gw:' + route + ' was fetched exactly 3 times (one per load), no retry off any abort', n === 3, n);
    });
    t.dom.window.close();
  }

  // ===========================================================================
  // GROUP D: the lane switch's EXISTING per-lane resets are unaffected -
  // console-honest-status-harness's H6 already covers the sidebar half of
  // this; this block adds the toggle/BOARD_HEALTH.pending half q62 touched.
  // A regression here is a real defect, not something this task asked to
  // change.
  // ===========================================================================
  {
    const t = boot(healthy({ gw: [], ju: [P('i1', 'Michael Stern', 'signing'), P('i5', 'Yossi Barak', 'needs_attention')] }));
    t.win.__consoleSetLane('israel');
    await settle(300);
    // Force every per-lane toggle on so the switch below has something real
    // to reset (F3's own stated intent: "every per-lane view state").
    t.win.showDone = true; t.win.showCanceled = true; t.win.showTest = true; t.win.doneLoaded = true;
    ok('D0 toggles are genuinely on before the switch, not defaulting to the post-switch value already',
      t.win.showDone === true && t.win.showCanceled === true && t.win.showTest === true && t.win.doneLoaded === true);
    ok('D0 the sidebar is populated before the switch',
      !t.sideHidden() && t.sideStat('ss-active') === '2', t.sideStat('ss-active'));

    // Cayman's board never answers this time - the whole window F3/defect 3
    // were about, and q62's own live repro (lane switch stuck at 1 row).
    t.setPlan(function (engine, route) {
      if (route === 'list' || route === 'opNotes' || route === 'opBoardDetail') return 'HOLD';
      return { ok: true };
    });
    t.win.__consoleSetLane('cayman');

    ok('D1 showDone resets on lane switch', t.win.showDone === false);
    ok('D2 showCanceled resets on lane switch', t.win.showCanceled === false);
    ok('D3 showTest resets on lane switch', t.win.showTest === false);
    ok('D4 doneLoaded resets on lane switch', t.win.doneLoaded === false);
    ok('D5 the sidebar does not carry the old lane\'s figures across', t.sideHidden());
    ok('D6 BOARD_HEALTH.legFail resets', t.win.BOARD_HEALTH.legFail === false);
    ok('D7 BOARD_HEALTH.overlayFail resets', t.win.BOARD_HEALTH.overlayFail === false);
    ok('D8 BOARD_HEALTH.pending resets too (the q62 addition to the existing reset)', t.win.BOARD_HEALTH.pending === false);
    ok('D9 BOARD_HEALTH.syncedAt resets', t.win.BOARD_HEALTH.syncedAt === '');
    ok('D10 and no freshness/pending sentence is standing for a lane that has not synced',
      t.verLine().text === '', JSON.stringify(t.verLine()));
    t.dom.window.close();
  }

  console.log('\n' + (fail ? 'CONSOLE BOARD LOAD-RACE HARNESS FAILED: ' : 'CONSOLE BOARD LOAD-RACE HARNESS PASSED: ')
    + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness crashed:', e); process.exit(2); });
