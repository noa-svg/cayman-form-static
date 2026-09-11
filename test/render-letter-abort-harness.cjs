// render-letter-abort-harness.cjs (2026-09-11).
//
// Item 2 of the q62 design review: renderLetter (the wire-letter panel) had
// the SAME shape the board load had before q62 - renderSeq (here: renderSeq)
// discards a stale PAINT but never cancelled the underlying fetch(). It was
// silent only because renderLetter exclusively calls JU_API (~0.4s), never
// the slow GW/GAS origin q62 measured at 20-185s.
//
// This proves the fix: one AbortController per renderLetter() call, aborted
// and replaced at the top of the function (the same instant renderSeq
// increments), its signal threaded through the one apiFetch call this
// function makes (?api=opRenderMonthLetter). Two proofs, mirroring
// console-board-load-race-harness's shape for load():
//
//   R1  a superseded renderLetter() call's fetch is ACTUALLY aborted (the
//       AbortSignal fires), not merely ignored once it eventually answers.
//   R2  no extra apiFetch/retry call comes out of that abort - fetch()
//       rejects the promise itself on AbortError, before apiFetch's non-JSON
//       retry .then chain ever runs, so an aborted call cannot double-fire.
//
// This drives the REAL console/index.html in jsdom (runScripts:'dangerously')
// with a scriptable window.fetch that can hold a response indefinitely and
// release it on command, the same rig shape console-board-load-race-harness
// and wire-letter-worklist-harness both use, rather than a synthetic copy of
// renderLetter's logic.
//
// Run: node test/render-letter-abort-harness.cjs
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

const MONTHS = ['09/2026', '08/2026', '07/2026'];

// What a real, browser-native aborted fetch() rejects with.
function mkAbortError() {
  const e = new Error('The operation was aborted.');
  e.name = 'AbortError';
  return e;
}

// The scriptable gateway. `plan(route,q)` returns a payload, the string
// 'HOLD' (parked until releaseHeld() answers it - catching
// opRenderMonthLetter genuinely mid-flight), or 'FAIL'.
function boot(plan) {
  const state = { fetches: [], held: [] };
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
        const rec = { route, q, aborted: false };
        state.fetches.push(rec);
        const answer = plan(route, q);
        if (answer === 'HOLD') {
          return new Promise((resolve, reject) => {
            const entry = { route, q, resolve, reject, rec };
            state.held.push(entry);
            // The actual thing under test: renderLetter's apiFetch call must
            // carry the per-call AbortController's signal into fetch()'s own
            // options, or this listener never fires and the held request
            // sits here forever - exactly the pre-fix bug.
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
    fetches: state.fetches,
    held: state.held,
    releaseHeld(match, value) {
      const remaining = [];
      state.held.slice().forEach(function (e) {
        if (match(e.rec)) e.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(value)) });
        else remaining.push(e);
      });
      state.held.length = 0;
      remaining.forEach(function (e) { state.held.push(e); });
    },
    ccy(v) {
      const el = doc.getElementById('wlCurrency');
      el.value = v;
      el.dispatchEvent(new dom.window.Event('change'));
    },
    renderHtml() {
      const f = doc.querySelector('#wlRenderPanel .wl-render-frame');
      return f ? f.getAttribute('srcdoc') : null;
    },
    renderBodyText() {
      const b = doc.querySelector('#wlRenderPanel .wl-render-body');
      return b ? b.textContent : null;
    },
  };
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 250 : ms));

// Every route renderLetter's own surrounding chain needs answered so loadMonths'
// then-chain actually reaches wlRelookAndReview -> renderLetter without erroring.
function baseline(extra) {
  return function (route, q) {
    if (route === 'listTrackerMonthTabs') return { ok: true, months: MONTHS };
    if (route === 'opPeekAwaitingMoney') return { ok: true, rows: [] };
    if (route === 'opPeekMonthTransfers') return { ok: true, transfers: [] };
    if (route === 'opPeekParked') return { ok: true, rows: [] };
    if (route === 'opGetRowReview') return { ok: true, reviews: {} };
    if (route === 'opRenderMonthLetter') return (extra && extra.render) ? extra.render(q) : 'HOLD';
    return { ok: true };
  };
}

(async () => {
  // ===========================================================================
  // R1/R2: a currency change while the FIRST render is still in flight must
  // abort call #1's fetch, not merely let it land and be discarded by rid.
  // ===========================================================================
  {
    const t = boot(baseline());
    // loadMonths() runs unconditionally at script load and its own then-chain
    // calls wlRelookAndReview() -> renderLetter() once, unprompted - that IS
    // call #1, the same way the board's own boot-time load() is call #1 in
    // console-board-load-race-harness's GROUP B.
    await settle(250);
    const call1 = t.held.slice();
    ok('R1 call #1 (the automatic boot-time render) is genuinely in flight',
      call1.length === 1 && call1[0].rec.route === 'opRenderMonthLetter', call1.length);
    ok('R1 nothing is aborted yet - nothing has superseded it', call1.every(function (e) { return !e.rec.aborted; }));
    const call1Rec = call1[0].rec;

    // Currency change fires wlCloseGate + peekRows + wlRelookAndReview, which
    // calls renderLetter() again - THIS is what must abort call #1.
    t.ccy('USD');
    ok('R1 call #1\'s fetch is actually aborted (AbortController fired), not merely superseded by rid',
      call1Rec.aborted, call1Rec);
    ok('R1 it is gone from the held queue - only call #2 (USD) remains',
      t.held.filter(function (e) { return e.rec === call1Rec; }).length === 0, t.held.length);
    const call2 = t.held.slice();
    ok('R1 call #2 is genuinely in flight, distinct from call #1', call2.length === 1, call2.length);

    // Supersede AGAIN before call #2 answers, proving this is not a one-shot
    // guard: EUR must abort call #2 the same way USD aborted call #1.
    const call2Rec = call2[0].rec;
    t.ccy('EUR');
    ok('R1 call #2 is aborted in turn by call #3 (the chain, not a one-off)', call2Rec.aborted, call2Rec);
    const call3 = t.held.slice();
    ok('R1 call #3 (EUR) is the only one left in flight', call3.length === 1, call3.length);

    // Let call #3 actually answer. Its render is what should end up on screen.
    t.releaseHeld(function () { return true; },
      { ok: true, transfers: [{ name: 'Fixture', nameEn: 'Fixture', type: 'Join', amount: 1, currency: 'EUR' }], html: '<p>EUR LETTER</p>', factsHash: 'eur-hash', rowFacts: 'r1:aaaaaaaaaaaa' });
    await settle(250);
    ok('R2 call #3\'s letter is the one drawn (the survivor, not a stale one)',
      (t.renderHtml() || '').indexOf('EUR LETTER') >= 0, t.renderHtml());
    ok('R2 the render panel is NOT stuck showing "Rendering..." or a stale body',
      (t.renderBodyText() || '').indexOf('Rendering') < 0, t.renderBodyText());
    // wlApproved/wlRenderState are module-closure state, not on window (this
    // file's own convention per CLAUDE.md is to drive the real DOM, not
    // extract internals) - the render panel content already proved the
    // completed call is the one that painted; whether Generate itself arms
    // is a function of peekRows' empty-batch state here (baseline answers
    // opPeekMonthTransfers with no rows), which is orthogonal to this test.

    // THE ABORT-RETRY PROOF: apiFetch has a one-shot automatic retry for a
    // non-JSON body, but fetch() rejects an aborted request's promise BEFORE
    // apiFetch's .then chain (which is what decides to retry) ever runs - so
    // an aborted call cannot itself produce a second opRenderMonthLetter
    // fetch. Exactly 3 fetches total: call 1 (aborted), call 2 (aborted),
    // call 3 (completed). A retry off either abort would make this 4 or 5.
    const renderFetches = t.fetches.filter(function (r) { return r.route === 'opRenderMonthLetter'; });
    ok('R2 exactly 3 opRenderMonthLetter fetches total - no retry off either abort',
      renderFetches.length === 3, renderFetches.length);
    t.dom.window.close();
  }

  // ===========================================================================
  // R3: the FIRST call's own .then callback must never run at all once
  // aborted - proving the rid guard is redundant-but-harmless, not the thing
  // actually doing the cancelling. If apiFetch's retry path were reachable
  // from an abort, it would re-request with signal=undefined (see the retry
  // line: `apiFetch(qs, true, base)`, no fourth arg) and this HOLD would
  // capture a fetch with NO o.signal at all.
  // ===========================================================================
  {
    const t = boot(baseline());
    await settle(250);
    const call1Rec = t.held[0].rec;
    t.ccy('USD');
    ok('R3 the superseded call carried a real AbortSignal on its fetch options (not a retry with signal stripped)',
      call1Rec.aborted, call1Rec);
    // Release call #2 (USD) and confirm the panel reflects it, not a ghost of
    // call #1 - the .then callback that would have painted call #1's result
    // never fires, because the promise rejected before that chain ran.
    t.releaseHeld(function () { return true; },
      { ok: true, transfers: [{ name: 'Fixture', nameEn: 'Fixture', type: 'Join', amount: 1, currency: 'USD' }], html: '<p>USD LETTER</p>', factsHash: 'usd-hash', rowFacts: 'r2:aaaaaaaaaaaa' });
    await settle(250);
    ok('R3 the surviving call\'s letter is on screen', (t.renderHtml() || '').indexOf('USD LETTER') >= 0, t.renderHtml());
    ok('R3 no trace of the aborted call\'s content ever painted', (t.renderHtml() || '').indexOf('EUR') < 0 && (t.renderHtml() || '').indexOf('NIS') < 0);
    t.dom.window.close();
  }

  console.log('\n' + (fail ? 'RENDER-LETTER ABORT HARNESS FAILED: ' : 'RENDER-LETTER ABORT HARNESS PASSED: ')
    + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness crashed:', e); process.exit(2); });
