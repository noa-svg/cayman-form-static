// board-search-lp-directory-harness.cjs (2026-08-02).
//
// Proves console/index.html's board-search LP-directory feature (Noa: "search
// flow being buried in a menu, i dont want that menu"). The SAME board search
// box that filters the visible pipeline now also queries the full (server-
// filtered, LP-only, type-tagged) LP directory and offers Increase/Withdrawal
// directly per match - no NEW-menu detour, no separate Individual/Entity
// prompt.
//
// Extracts the REAL IIFE from the live file (brace-counting) and drives it
// against a real jsdom DOM with stubbed externals (apiFetch/state/open/etc),
// so this fails if a future edit breaks the wiring - not just if someone
// breaks a hand-written copy. The server-side LP-only + type filter itself is
// proven separately in ju-cayman/test/console-search-lps-lp-only-harness.cjs;
// this test's job is the CLIENT wiring on top of that server contract.
//
// Run: node test/board-search-lp-directory-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }

function extractIife() {
  const anchor = '(function(){\n    var si=document.getElementById("boardSearch"),box=document.getElementById("boardLpResults");';
  const start = html.indexOf(anchor);
  if (start < 0) throw new Error('board-search IIFE anchor not found (boot contract changed)');
  let i = html.indexOf('{', start), depth = 0, end = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  // The IIFE is invoked immediately in the file ("})();"); capture through the "()".
  const closeParen = html.indexOf('()', end);
  return html.slice(start, closeParen + 2);
}
const iifeSrc = extractIife();
if (iifeSrc.indexOf("data-proc=\"increase\"") === -1 || iifeSrc.indexOf("data-proc=\"withdrawal\"") === -1) {
  throw new Error('extracted block missing the expected action buttons (boot contract changed)');
}

function build() {
  const dom = new JSDOM('<!doctype html><body><input id="boardSearch"><div id="boardLpResults" hidden></div><div id="list"><div class="empty">No processes match "x".</div></div><div id="newWrap"><div id="newDd"><div class="dd-onboarding"><button class="new-dd-item" data-kind="new">Individual</button></div></div></div></body>');
  const document = dom.window.document;
  const calls = { apiFetch: [], setPick: [], setToggleSilent: [], closeNewDd: 0, open: 0, toggleNewDd: 0 };
  const state = { lane: 'israel', process: '', type: '' };
  let apiFetchImpl = () => Promise.resolve({ ok: true, matches: [] });
  const window_ = {
    __lpSetPick: (m) => { calls.setPick.push(m); },
  };
  function esc2(s) { return String(s == null ? '' : s); } // real escaping already covered by attribute-escaping-harness.cjs; identity here keeps assertions readable
  function apiFetch(url) { calls.apiFetch.push(url); return apiFetchImpl(url); }
  function setToggleSilent(id, key, val) { calls.setToggleSilent.push({ id, key, val }); }
  function closeNewDd() { calls.closeNewDd++; }
  function open() { calls.open++; }
  function toggleNewDd() { calls.toggleNewDd++; }
  const newDd = document.getElementById('newDd');
  // Mirrors the REAL app's own outside-click-closes-NEW listener
  // (document.addEventListener("click", ...) near toggleNewDd's definition) -
  // without this, block 8 below cannot catch the exact 2026-08-02 regression
  // where the onboarding-shortcut button, living outside newWrap, opened NEW
  // and then immediately re-closed it via this same listener on the same click.
  const newWrap = document.getElementById('newWrap');
  document.addEventListener('click', (e) => { if (newWrap && !newWrap.contains(e.target)) closeNewDd(); });
  const fn = new dom.window.Function(
    'document', 'apiFetch', 'state', 'setToggleSilent', 'closeNewDd', 'open', 'esc2', 'window', 'setTimeout', 'clearTimeout', 'toggleNewDd', 'newDd',
    iifeSrc
  );
  fn(document, apiFetch, state, setToggleSilent, closeNewDd, open, esc2, window_, dom.window.setTimeout, dom.window.clearTimeout, toggleNewDd, newDd);
  return { dom, document, calls, state, window_, setApiFetchImpl: (f) => { apiFetchImpl = f; } };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 1. Query too short: no fetch fires, results hidden.
  {
    const t = build();
    const si = t.document.getElementById('boardSearch');
    si.value = 'D';
    si.dispatchEvent(new t.dom.window.Event('input'));
    await sleep(260);
    ok('a 1-char query never fetches', t.calls.apiFetch.length === 0);
    ok('results box stays hidden for a too-short query', t.document.getElementById('boardLpResults').hidden === true);
  }

  // 2. A real query renders LP-only, type-tagged results with two actions each.
  {
    const t = build();
    t.setApiFetchImpl((url) => {
      ok('the fetch hits searchLps with the typed query', url.indexOf('?admin=searchLps&q=Dan') === 0, url);
      return Promise.resolve({ ok: true, matches: [
        { itemId: '1', name: 'Dana Levi', nameHe: '', nameEn: 'Dana Levi', email: 'dana@example.com', type: 'individual' },
        { itemId: '2', name: 'Danco Holdings', nameHe: '', nameEn: 'Danco Holdings', email: '', type: 'entity' },
      ] });
    });
    const si = t.document.getElementById('boardSearch');
    si.value = 'Dan';
    si.dispatchEvent(new t.dom.window.Event('input'));
    await sleep(260);
    const box = t.document.getElementById('boardLpResults');
    ok('results box unhides once matches arrive', box.hidden === false);
    const rows = box.querySelectorAll('.board-lp-row');
    ok('exactly the 2 server-filtered LP matches render, no more no less', rows.length === 2, rows.length);
    const buttons = box.querySelectorAll('.board-lp-actions button');
    ok('each row gets exactly 2 action buttons (Increase, Withdrawal) - no Individual/Entity prompt', buttons.length === 4, buttons.length);
    ok('2026-08-02: the pipeline\'s own "No processes match" empty state hides once the LP directory has results, so the two never read as contradictory', t.document.querySelector('#list .empty').hidden === true);

    // 3. Clicking Increase on the INDIVIDUAL match sets state correctly and picks the LP.
    buttons[0].click(); // row 0 (Dana Levi, individual) -> Increase
    ok('clicking Increase sets state.process=increase', t.state.process === 'increase');
    ok('type is taken from the match (individual), never asked', t.state.type === 'individual');
    ok('the LP is picked via the shared window.__lpSetPick, not a re-implementation', t.calls.setPick.length === 1 && t.calls.setPick[0].itemId === '1');
    ok('the panel opens', t.calls.open === 1);
    ok('language toggle syncs for the israel lane', t.calls.setToggleSilent.length === 1 && t.calls.setToggleSilent[0].val === 'he');
  }

  // 4. Withdrawal on the ENTITY match: type correctly comes out as entity.
  {
    const t = build();
    t.setApiFetchImpl(() => Promise.resolve({ ok: true, matches: [
      { itemId: '2', name: 'Danco Holdings', nameHe: '', nameEn: 'Danco Holdings', email: '', type: 'entity' },
    ] }));
    const si = t.document.getElementById('boardSearch');
    si.value = 'Danco';
    si.dispatchEvent(new t.dom.window.Event('input'));
    await sleep(260);
    const buttons = t.document.getElementById('boardLpResults').querySelectorAll('.board-lp-actions button');
    buttons[1].click(); // Withdrawal on the only row
    ok('clicking Withdrawal sets state.process=withdrawal', t.state.process === 'withdrawal');
    ok('entity-group match yields state.type=entity', t.state.type === 'entity');
  }

  // 5. A stale in-flight response (query changed before it resolved) is dropped.
  {
    const t = build();
    let resolveFirst;
    let call = 0;
    t.setApiFetchImpl(() => {
      call++;
      if (call === 1) return new Promise((r) => { resolveFirst = r; });
      return Promise.resolve({ ok: true, matches: [{ itemId: '9', name: 'Second', nameHe: '', nameEn: 'Second', email: '', type: 'individual' }] });
    });
    const si = t.document.getElementById('boardSearch');
    si.value = 'Fi'; si.dispatchEvent(new t.dom.window.Event('input'));
    await sleep(260); // first debounce fires, fetch #1 now pending (never resolved yet)
    si.value = 'Se'; si.dispatchEvent(new t.dom.window.Event('input'));
    await sleep(260); // second debounce fires, fetch #2 resolves immediately
    resolveFirst({ ok: true, matches: [{ itemId: '1', name: 'First (stale)', nameHe: '', nameEn: 'First (stale)', email: '', type: 'individual' }] });
    await sleep(20);
    const rows = t.document.getElementById('boardLpResults').querySelectorAll('.board-lp-row');
    ok('a stale, late-resolving response never overwrites the newer result', rows.length === 1 && rows[0].textContent.indexOf('First (stale)') === -1, rows.length ? rows[0].textContent : '(empty)');
  }

  // 6. No matches: results box hides cleanly (not an error state), and the
  // pipeline's own empty-state div (suppressed while matches were showing,
  // see assertion in block 2) comes back once there is nothing to conflict with.
  {
    const t = build();
    t.document.querySelector('#list .empty').hidden = true; // simulate: it was suppressed by an earlier populated search
    t.setApiFetchImpl(() => Promise.resolve({ ok: true, matches: [] }));
    const si = t.document.getElementById('boardSearch');
    si.value = 'Nobody'; si.dispatchEvent(new t.dom.window.Event('input'));
    await sleep(260);
    ok('zero matches hides the box rather than showing an empty panel', t.document.getElementById('boardLpResults').hidden === true);
    ok('the pipeline empty-state div is restored once the LP directory has nothing to show', t.document.querySelector('#list .empty').hidden === false);
  }

  // 7. A search error fails soft (hides the block, does not throw / break the local board filter).
  {
    const t = build();
    t.setApiFetchImpl(() => Promise.reject(new Error('network')));
    const si = t.document.getElementById('boardSearch');
    si.value = 'Err'; si.dispatchEvent(new t.dom.window.Event('input'));
    await sleep(260);
    ok('a fetch rejection hides the block instead of throwing', t.document.getElementById('boardLpResults').hidden === true);
  }

  // 8. Zero matches + an email-shaped query offers the NEW->Onboarding shortcut
  // (2026-08-02, Noa: "type in a new email in the search and have that trigger
  // the new"). A non-email zero-match query must NOT show this (block 6 already
  // covers that path staying a plain empty state).
  {
    const t = build();
    t.setApiFetchImpl(() => Promise.resolve({ ok: true, matches: [] }));
    const si = t.document.getElementById('boardSearch');
    si.value = 'newlp@example.com'; si.dispatchEvent(new t.dom.window.Event('input'));
    await sleep(260);
    const box = t.document.getElementById('boardLpResults');
    ok('the box unhides to offer the onboarding shortcut', box.hidden === false);
    const row = t.document.getElementById('boardLpNewRow');
    ok('an onboarding-shortcut row renders', !!row);
    ok('the row names the exact typed email, not a generic label', row.textContent.indexOf('newlp@example.com') !== -1);
    row.click();
    ok('clicking it opens the NEW dropdown via the real toggleNewDd, not a re-implementation', t.calls.toggleNewDd === 1);
    // 2026-08-02 regression: this button lives OUTSIDE newWrap, so its click bubbles
    // to the app's own document-level "click outside NEW closes it" listener - without
    // e.stopPropagation() that listener fires on the SAME click right after toggleNewDd()
    // opens it, immediately closing it again (confirmed live: newDd never visibly opened).
    ok('the click does not also trigger the outside-click-closes-NEW listener on itself', t.calls.closeNewDd === 0);
    ok('the typed email is stashed as a pick for quickPick to consume on the Onboarding pick', t.window_.__pendingOnboardingPick && t.window_.__pendingOnboardingPick.email === 'newlp@example.com');
    ok('the popover closes itself once the shortcut is taken', t.document.getElementById('boardLpResults').hidden === true);
  }

  // 9. A 'pending' match (2026-08-02 widen: real Monday contacts, not yet an
  // LP, now surface too - Noa's mockup: "Monday contact, not yet an LP" +
  // a single Start onboarding action, never Increase/Withdrawal).
  {
    const t = build();
    const pendingMatch = { itemId: '7', name: 'Nora Cohen', nameHe: 'נורה כהן', nameEn: 'Nora Cohen', email: 'nora@example.com', nickname: 'Nora', type: 'pending' };
    t.setApiFetchImpl(() => Promise.resolve({ ok: true, matches: [pendingMatch] }));
    const si = t.document.getElementById('boardSearch');
    si.value = 'Nora'; si.dispatchEvent(new t.dom.window.Event('input'));
    await sleep(260);
    const box = t.document.getElementById('boardLpResults');
    const row = box.querySelector('.board-lp-row');
    ok('a pending match renders its status instead of an Existing-LP label', row.querySelector('.lp-sub').textContent === 'Monday contact, not yet an LP');
    const buttons = row.querySelectorAll('.board-lp-actions button');
    ok('a pending match gets exactly ONE action (Start onboarding), never Increase/Withdrawal', buttons.length === 1 && buttons[0].textContent === 'Start onboarding');
    buttons[0].click();
    ok('clicking it opens NEW via the real toggleNewDd', t.calls.toggleNewDd === 1);
    ok('it does not self-close via the outside-click listener either', t.calls.closeNewDd === 0);
    ok('the FULL Monday record is stashed (name/nameHe/nickname/email), not just an email string', t.window_.__pendingOnboardingPick && t.window_.__pendingOnboardingPick.itemId === '7' && t.window_.__pendingOnboardingPick.nameHe === 'נורה כהן');
  }

  // 10. The persistent "Add as a new contact" footer (2026-08-02: shown even
  // when real matches exist, per Noa's mockup - the operator can always bail
  // to a blank Onboarding start, not only when the search comes up empty).
  {
    const t = build();
    t.setApiFetchImpl(() => Promise.resolve({ ok: true, matches: [
      { itemId: '1', name: 'Dana Levi', nameHe: '', nameEn: 'Dana Levi', email: 'dana@example.com', type: 'individual' },
    ] }));
    const si = t.document.getElementById('boardSearch');
    si.value = 'Dana'; si.dispatchEvent(new t.dom.window.Event('input'));
    await sleep(260);
    const footerBtn = t.document.getElementById('boardLpAddNew');
    ok('the add-new-contact footer renders alongside real matches', !!footerBtn);
    footerBtn.click();
    ok('clicking it opens NEW too', t.calls.toggleNewDd === 1);
    ok('it does not self-close either', t.calls.closeNewDd === 0);
    ok('no prefill is stashed for a blank add-new-contact start', t.window_.__pendingOnboardingPick == null);
  }

  // 11. A loading state shows the instant the debounce fires, before the fetch
  // resolves (2026-08-02, live incident: Noa typed a real name, saw nothing for
  // ~20s on an uncached Monday query, and reasonably concluded search was
  // broken - it was just silent. The box must never sit hidden/empty while a
  // request is genuinely in flight).
  {
    const t = build();
    let resolveFetch;
    t.setApiFetchImpl(() => new Promise((r) => { resolveFetch = r; }));
    const si = t.document.getElementById('boardSearch');
    si.value = 'Slow'; si.dispatchEvent(new t.dom.window.Event('input'));
    await sleep(260); // debounce has fired; the fetch is deliberately left unresolved
    const box = t.document.getElementById('boardLpResults');
    ok('the box unhides immediately once the debounced fetch starts, not only once it resolves', box.hidden === false);
    ok('it shows a loading state, not an empty/blank box that reads as "nothing found"', box.textContent.indexOf('Searching') !== -1);
    resolveFetch({ ok: true, matches: [] });
    await sleep(20);
  }

  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e); process.exit(1); });
