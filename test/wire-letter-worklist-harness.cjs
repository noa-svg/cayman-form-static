// wire-letter-worklist-harness.cjs (2026-09-07).
//
// The Month Worklist: the operator console's money tab, rebuilt from a
// five-column desktop table into one job-grouped list that works on a phone.
// Every assertion below is anchored to something that was measurably WRONG on
// the file this replaced, so a regression reads as the specific defect it is:
//
//   W1  ONE COLUMN IS THE BASE. .wl-await-row was `grid-template-columns:
//       minmax(140px,1fr) 90px 130px 150px 120px` with no media query at all,
//       needing 686px, inside a shell that clips horizontal overflow. At 375px
//       the amount and all three buttons were off-screen and unreachable. The
//       base .wl-card rule must therefore stay single-column, and any
//       multi-column grid for it must live inside a min-width query.
//   W2  GROUPED BY JOB. Blocked / Needs you / Goes on a letter / Done are the
//       headings, not Pending / eligible / settled.
//   W3  ONE PRIMARY PER ROW, 44px, the rest behind a per-row menu whose items
//       are full sentences naming the outcome AND its target.
//   W4  THE NEW AWAITING FIELDS ARE SURFACED, NEVER HIDDEN. `recovered` (the
//       row physically lives on another tab) and `datedFor` (the row is on this
//       tab but dated for another month, so this month's letter will not carry
//       it) both reach the screen, and a service that omits them still renders.
//   W5  AN INVALID EXECUTION TOKEN BLOCKS, VISIBLY. It goes to Blocked, it gets
//       a line in the blocker summary, and that line carries a control that
//       focuses the row.
//   W6  GENERATE IS NEVER SILENTLY GREYED. It is aria-disabled, not disabled,
//       and a click while the gate is shut moves focus to the first blocker and
//       says what is missing.
//   W7  THE ARTIFACT IS STATED BEFORE IT IS MADE: rows, sum, currency, month,
//       and what is being left off with the reason for each.
//   W8  THE MONTH IS THE SCREEN'S CONTEXT: a heading with prev/next, not one
//       select among three peers.
//   W9  MECHANICS FLOOR: for=/id on every control, inputmode on the struck-NAV
//       field, an aria-live region that actually receives the result of a row
//       action, and motion behind prefers-reduced-motion.
//   W10 EMPTY STATES. Every group empty, and one group empty, both say so
//       rather than rendering nothing.
//   W11 RTL. A Hebrew name renders with dir="auto" and is not mangled.
//
// This drives the REAL console/index.html in jsdom (runScripts:'dangerously')
// with a scriptable window.fetch, the same way console-honest-status-harness
// does. It never extracts functions into a synthetic scope: api-fetch-nonjson-
// harness did that and has been dead on main ever since, because a copy of a
// function cannot go stale in a way anything notices.
//
// LAYOUT LIMIT, stated rather than papered over: jsdom does no layout, so
// offsetWidth is 0 and nothing here can measure a real clip at 375px. W1 is
// asserted against the CSS RULES instead, which is where the defect actually
// lived, plus a 375px-wide DOM check that the primary action is present and
// reachable in the tree.
//
// Run: node test/wire-letter-worklist-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const HTML_PATH = path.join(__dirname, '..', 'console', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let pass = 0, fail = 0;
// textContent of a node that may not exist. Every DOM read in this harness goes
// through a guard: a harness that throws on the first missing element reports
// one failure and hides the other thirty, which makes the A/B number a lie.
const TX = (e) => (e ? e.textContent : '');
function ok(label, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('FAIL', label, extra === undefined ? '' : String(extra).slice(0, 500)); }
}

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function fakeIdToken() {
  return b64u({ alg: 'RS256', typ: 'JWT' }) + '.'
    + b64u({ email: 'noa@legacyvpartners.com', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig';
}

// Invented Hebrew names. No real LP ever appears in a fixture.
const HE = {
  a: 'רוני אלקוביץ',
  b: 'תמר בן שחר',
  c: 'יואב מזרחי־לוטן',
  d: 'שירה גורודצקי',
};
const MONTHS = ['09/2026', '08/2026', '07/2026'];

function A(rid, name, extra) {
  return Object.assign({
    masterRid: rid, name: name, nameEn: 'Fixture ' + rid, type: 'Join',
    amount: 250000, currency: 'NIS', execStatus: 'Pending', ageDays: 12,
  }, extra || {});
}
function T(name, type, amount) {
  return { name: name, nameEn: 'Fixture ' + name, type: type, amount: amount, currency: 'NIS' };
}

// The scriptable gateway. `plan(route)` returns a payload, 'FAIL' (the fetch
// rejects, which is what a dead engine looks like to apiFetch), or 'HANG'.
function boot(plan) {
  const state = { plan, fetches: [] };
  const dom = new JSDOM(html, {
    url: 'http://localhost:8000/console/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem('lvp_op_token_v1', fakeIdToken());
      Object.defineProperty(w, 'innerWidth', { value: 375, writable: true, configurable: true });
      Object.defineProperty(w, 'innerHeight', { value: 812, writable: true, configurable: true });
      w.fetch = function (url, o) {
        let q = '';
        try { q = JSON.parse(o.body).q || ''; } catch (e) { q = ''; }
        const route = (q.match(/^\?(?:api|admin)=([A-Za-z0-9_]+)/) || [])[1] || '';
        state.fetches.push(route + (q.replace(/^\?(?:api|admin)=[A-Za-z0-9_]+/, '') || ''));
        const answer = state.plan(route, q);
        if (answer === 'HANG') return new Promise(() => {});
        if (answer === 'FAIL') return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(answer)) });
      };
    },
  });
  const doc = dom.window.document;
  return {
    dom, doc, win: dom.window, fetches: state.fetches,
    setPlan(p) { state.plan = p; },
    el(id) { return doc.getElementById(id); },
    txt(id) { const e = doc.getElementById(id); return e ? e.textContent : null; },
    groupTitles() {
      return Array.prototype.map.call(doc.querySelectorAll('#wlGroups .wl-group-ttl, #wlParked .wl-group-ttl'),
        (e) => e.textContent.trim());
    },
    groupOf(prefix) {
      // The group whose title starts with `prefix`, as an element.
      const t = Array.prototype.find.call(doc.querySelectorAll('.wl-group-ttl'),
        (e) => e.textContent.trim().indexOf(prefix) === 0);
      return t ? t.closest('.wl-group') : null;
    },
    cardsIn(prefix) {
      const g = this.groupOf(prefix);
      return g ? Array.prototype.slice.call(g.querySelectorAll('.wl-card')) : [];
    },
  };
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 260 : ms));

function planOf(awaiting, transfers, parked, extra) {
  return function (route) {
    if (route === 'listTrackerMonthTabs') return { ok: true, months: MONTHS };
    if (route === 'opPeekAwaitingMoney') return { ok: true, rows: awaiting };
    if (route === 'opPeekMonthTransfers') {
      return Object.assign(
        { ok: true, transfers: transfers },
        (extra && extra.peekExtra) || {},
      );
    }
    if (route === 'opPeekParked') return { ok: true, rows: parked };
    if (extra && extra[route] !== undefined) return extra[route];
    return { ok: true };
  };
}

// ---------------------------------------------------------------------------
// W1: the base layout. Pure CSS assertions, because this is where the defect
// lived and because jsdom cannot measure a clip.
// ---------------------------------------------------------------------------
(function () {
  const base = html.match(/\n\.wl-card\{([^}]*)\}/);
  ok('W1 a base .wl-card rule exists', !!base, 'no top-level .wl-card rule found');
  if (base) {
    ok('W1 the BASE .wl-card is not a multi-column grid (the 686px table is what clipped)',
      base[1].indexOf('grid-template-columns') < 0, base[1]);
  }
  // Every multi-column grid-template-columns for .wl-card must sit inside a
  // min-width query: columns are the enhancement, never the base.
  const mq = html.match(/@media \(min-width:760px\)\{[\s\S]*?\n\}/g) || [];
  ok('W1 a min-width enhancement query exists', mq.length >= 1, 'none found');
  ok('W1 the column layout lives inside it',
    mq.some((b) => /\.wl-card\{display:grid;grid-template-columns:/.test(b)), mq.length);
  // And no max-width fallback smuggles the table back in.
  ok('W1 no .wl-card grid is defined in a max-width block',
    !/@media \(max-width:[^)]*\)\{[^}]*\.wl-card\{[^}]*grid-template-columns/.test(html));
  // The old five-column rules are gone, not merely overridden further down.
  ok('W1 the old .wl-await-row five-column grid is gone', !/\.wl-await-row\{display:grid/.test(html));
  ok('W1 the old .wl-await-cols header grid is gone', !/\.wl-await-cols\{display:grid/.test(html));
})();

// ---------------------------------------------------------------------------
// W9 (static half) + W8 (static half): mechanics that are properties of the
// markup rather than of any one data shape.
// ---------------------------------------------------------------------------
(function () {
  ok('W9 the struck-NAV field takes a numeric keypad (it is YYYY-MM, not prose)',
    /<input id="wlNavMonth"[^>]*inputmode="numeric"/.test(html));
  ['wlMonth', 'wlCurrency', 'wlNavMonth', 'wlCreateDraft'].forEach((id) => {
    ok('W9 <label for="' + id + '"> exists', new RegExp('<label for="' + id + '"').test(html));
    ok('W9 a control with id="' + id + '" exists', new RegExp('id="' + id + '"').test(html));
  });
  ok('W9 the announce region is aria-live', /id="wlAnnounce"[^>]*aria-live="polite"/.test(html));
  ok('W9 the announce region is not markup-hidden', !/id="wlAnnounce"[^>]*\shidden/.test(html));
  ok('W9 motion is behind prefers-reduced-motion',
    /@media \(prefers-reduced-motion: reduce\)\{[\s\S]{0,400}\.wl-primary/.test(html));
  ok('W9 the primary action is a 44px target', /\.wl-primary,\.wl-more\{min-height:44px/.test(html));
  ok('W9 the menu items are 44px targets', /\.wl-menu button\{min-height:44px/.test(html));
  ok('W9 the month arrows are 44px targets', /\.wl-month-nav button\{min-height:44px;min-width:44px/.test(html));
  ok('W9 focus is visible on every new control', /\.wl-primary:focus-visible/.test(html) && /\.wl-menu button:focus-visible/.test(html));
  ok('W8 the month is a heading, not a third select',
    /<h2 class="wl-month-ttl" id="wlMonthTtl">/.test(html));
  ok('W8 with prev and next controls',
    /id="wlPrevMonth"/.test(html) && /id="wlNextMonth"/.test(html));
  ok('W6 Generate is aria-disabled, never disabled, in the markup',
    /<button id="wlGenerateBtn" class="btn" aria-disabled="true">/.test(html));
  ok('W6 an aria-disabled .btn is visually distinct', /\.btn\[aria-disabled="true"\]\{background:var\(--color-neutral-bg\)/.test(html));
})();

(async () => {
  // -------------------------------------------------------------------------
  // W2 / W3 / W5 / W7 / W11: a full month with one of everything.
  // -------------------------------------------------------------------------
  {
    const awaiting = [
      A('r-clean', HE.a),
      A('r-bad', HE.b, { execStatus: 'Completed' }),           // invalid token -> Blocked
      A('r-recov', HE.c, { recovered: true, sourceTab: '07/2026' }),
      A('r-dated', HE.d, { datedFor: '10/2026' }),
    ];
    const transfers = [T(HE.a, 'Join', 250000), T('אורי פלדבאום', 'Redemption', 90000)];
    const t = boot(planOf(awaiting, transfers, []));
    await settle(400);

    // W2: the headings are jobs.
    const titles = t.groupTitles().join(' | ');
    ['Blocked', 'Needs you', 'Goes on a letter', 'Done'].forEach((g) => {
      ok('W2 the "' + g + '" group is on screen', titles.indexOf(g) >= 0, titles);
    });
    ok('W2 no group is named after a tracker token',
      !/Awaiting money|Pending|EXECUTION_STATUS/.test(titles), titles);

    // W5: the bad token is in Blocked, not in Needs you.
    const blocked = t.cardsIn('Blocked');
    const needs = t.cardsIn('Needs you');
    ok('W5 exactly one row is blocked', blocked.length === 1, blocked.length);
    ok('W5 it is the row with the invalid execution token',
      blocked.length === 1 && blocked[0].id === 'wl-row-r-bad', blocked.map((c) => c.id).join(','));
    ok('W5 the blocked row names the token it cannot read',
      blocked.length === 1 && TX(blocked[0]).indexOf('Completed') >= 0,
      blocked.length ? TX(blocked[0]).slice(0, 200) : 'no blocked card');
    ok('W5 the other three rows are in Needs you', needs.length === 3, needs.length);

    // W5: the blocker summary above the list, each item focusing its row.
    const bl = t.el('wlBlockers');
    ok('W5 a blocker summary is rendered above the list', !!bl && bl.querySelector('.wl-blockers'),
      bl ? bl.innerHTML.slice(0, 200) : 'no #wlBlockers');
    const focusBtn = bl && bl.querySelector('[data-wl-focus]');
    ok('W5 the blocker item carries a control that focuses the row', !!focusBtn,
      bl ? bl.innerHTML.slice(0, 300) : 'no #wlBlockers');
    ok('W5 and it points at the blocked row',
      !!focusBtn && focusBtn.getAttribute('data-wl-focus') === 'wl-row-r-bad',
      focusBtn && focusBtn.getAttribute('data-wl-focus'));
    if (focusBtn) {
      focusBtn.click();
      ok('W5 clicking it actually moves focus to that row',
        t.doc.activeElement && t.doc.activeElement.id === 'wl-row-r-bad',
        t.doc.activeElement && t.doc.activeElement.id);
    }
    ok('W5 the blockers region announces itself',
      !!(bl && bl.querySelector('[role="alert"]')), bl ? bl.innerHTML.slice(0, 120) : 'no #wlBlockers');

    // W3: one primary per Needs-you row, the rest behind a per-row menu.
    const clean = t.doc.getElementById('wl-row-r-clean');
    ok('W3 the needs-you row exists', !!clean, 'no #wl-row-r-clean: rows carry no addressable id');
    const primaries = clean ? clean.querySelectorAll('.wl-primary') : [];
    ok('W3 exactly ONE primary action on the row', primaries.length === 1, primaries.length);
    ok('W3 and it is "Money arrived"', primaries.length === 1 && primaries[0].textContent.trim() === 'Money arrived',
      primaries.length ? primaries[0].textContent : 'none');
    ok('W3 it routes to the money-received action',
      primaries.length === 1 && primaries[0].getAttribute('data-act') === 'markMoneyReceived',
      primaries.length ? primaries[0].outerHTML.slice(0, 120) : 'none');
    const menu = clean && clean.querySelector('.wl-menu');
    ok('W3 the other actions are in a menu', !!menu);
    ok('W3 the menu starts closed', !!menu && menu.hidden === true);
    const more = clean && clean.querySelector('[data-wl-more]');
    ok('W3 with a disclosure button that says it is closed',
      !!more && more.getAttribute('aria-expanded') === 'false');
    if (more) more.click();
    ok('W3 clicking it opens the menu', !!menu && menu.hidden === false);
    ok('W3 and updates aria-expanded', !!more && more.getAttribute('aria-expanded') === 'true');
    const items = menu ? Array.prototype.slice.call(menu.querySelectorAll('button')) : [];
    ok('W3 the menu holds the two non-primary actions', items.length === 2, items.length);
    const pick = (b, sel) => { const e = b.querySelector(sel); return e ? e.textContent.trim() : ''; };
    const what = items.map((b) => pick(b, '.wl-menu-what'));
    const why = items.map((b) => pick(b, '.wl-menu-why'));
    ok('W3 the move item names its TARGET MONTH, not "Not this month"',
      what[0] === 'Move to October 2026', what.join(' | ') || 'no menu items at all');
    ok('W3 no item is labelled with the old negative', what.join(' ').indexOf('Not this month') < 0, what.join(' | '));
    ok('W3 the move item states the outcome as a sentence',
      why[0] === 'Their money lands next month. The row leaves this list.', why[0] || 'no menu items at all');
    ok('W3 the park item names the act and the outcome',
      what[1] === 'Park this row' && why[1] === 'The money is not coming. Stays visible, off every letter.',
      (what[1] || '?') + ' / ' + (why[1] || '?'));
    ok('W3 both menu items route to real actions',
      items.length === 2 && items[0].getAttribute('data-act') === 'rowNextMonth'
        && items[1].getAttribute('data-act') === 'parkRow',
      items.map((b) => b.getAttribute('data-act')).join(',') || 'no menu items at all');

    // W4: recovered and datedFor are on screen, never hidden.
    const recov = t.doc.getElementById('wl-row-r-recov');
    ok('W4 the recovered row renders', !!recov, 'no #wl-row-r-recov');
    ok('W4 it says the row lives on another tab',
      TX(recov).indexOf('07/2026') >= 0 && /lives on/i.test(TX(recov)), TX(recov).slice(0, 300));
    ok('W4 and names that tab in words, not only as a token',
      TX(recov).indexOf('July 2026') >= 0, TX(recov).slice(0, 300));
    const dated = t.doc.getElementById('wl-row-r-dated');
    ok('W4 the datedFor row renders', !!dated, 'no #wl-row-r-dated');
    ok('W4 it says which month it is dated for',
      TX(dated).indexOf('October 2026') >= 0, TX(dated).slice(0, 300));
    ok('W4 and that this month\'s letter will not carry it',
      /will not carry it/.test(TX(dated)), TX(dated).slice(0, 300));

    // W11: RTL names survive intact and are marked for the bidi algorithm.
    // Looked up through the document, not the card, so the RTL checks still
    // report against a build whose rows carry no id.
    const heSpan = t.doc.querySelector('#wlAwaiting .wl-row-nm-he');
    ok('W11 the Hebrew name is rendered verbatim', !!heSpan && heSpan.textContent === HE.a,
      heSpan ? heSpan.textContent : 'no name element under #wlAwaiting');
    ok('W11 with dir="auto" so a Latin-leading string cannot flip it',
      !!heSpan && heSpan.getAttribute('dir') === 'auto', heSpan ? heSpan.outerHTML.slice(0, 120) : 'none');
    const enSpan = t.doc.querySelector('#wlAwaiting .wl-row-nm-en');
    ok('W11 the English name is pinned LTR beside it', !!enSpan && enSpan.getAttribute('dir') === 'ltr',
      enSpan ? enSpan.outerHTML.slice(0, 120) : 'none');

    // W7: the artifact, stated before it is made.
    const art = t.txt('wlArtifact') || '';
    ok('W7 the artifact names the row count', /2 rows/.test(art), art.slice(0, 300));
    ok('W7 the currency', /NIS/.test(art), art.slice(0, 300));
    ok('W7 the month, in words', /September 2026/.test(art), art.slice(0, 300));
    ok('W7 the incoming sum', /Incoming 250,000 NIS/.test(art), art.slice(0, 400));
    ok('W7 the outgoing sum', /Outgoing 90,000 NIS/.test(art), art.slice(0, 400));
    ok('W7 it states what is LEFT OFF', /Left off, and why/.test(art), art.slice(0, 400));
    ok('W7 including the rows still awaiting money', /3 rows whose money has not arrived/.test(art), art.slice(0, 600));
    ok('W7 the blocked row', /1 row the tracker cannot state a money status for/.test(art), art.slice(0, 600));
    ok('W7 the row dated for another month', /1 row dated for another month/.test(art), art.slice(0, 600));
    ok('W7 and the rows living on another tab', /1 row that lives on another tab/.test(art), art.slice(0, 600));

    // W6: Generate is shut (a blocker is on screen) but still answers a click.
    const gen = t.el('wlGenerateBtn');
    ok('W6 Generate is not `disabled`', !!gen && gen.disabled === false, gen ? ('disabled=' + gen.disabled) : 'no button');
    ok('W6 Generate reads as unavailable', !!gen && gen.getAttribute('aria-disabled') === 'true');
    const ann = t.el('wlAnnounce'); if (ann) ann.textContent = '';
    if (gen) gen.click();
    ok('W6 clicking a shut Generate moves focus to the first blocker',
      t.doc.activeElement && t.doc.activeElement.id === 'wl-row-r-bad',
      t.doc.activeElement && t.doc.activeElement.id);
    const note = t.txt('wlGateNote') || '';
    ok('W6 and says what is missing', /Generate is off/.test(note) && /Completed/.test(note), note);
    ok('W6 the refusal is announced in a live region',
      /Generate is off/.test(t.txt('wlAnnounce') || ''), t.txt('wlAnnounce'));

    // W8 (live half): the month is the heading, and prev/next step it.
    ok('W8 the heading carries the month in words', /September 2026/.test(t.txt('wlMonthTtl') || ''), t.txt('wlMonthTtl'));
    ok('W8 next is disabled on the newest month', !!t.el('wlNextMonth') && t.el('wlNextMonth').disabled === true);
    ok('W8 previous is available', !!t.el('wlPrevMonth') && t.el('wlPrevMonth').disabled === false);
    if (t.el('wlPrevMonth')) t.el('wlPrevMonth').click();
    await settle(300);
    ok('W8 clicking previous moves the screen to the older month',
      /August 2026/.test(t.txt('wlMonthTtl') || ''), t.txt('wlMonthTtl'));
    ok('W8 and refetches that month', t.fetches.some((f) => /monthTab=08%2F2026/.test(f)),
      t.fetches.slice(-6).join(' | '));
    t.dom.window.close();
  }

  // -------------------------------------------------------------------------
  // W9 (live half): a row action reports into the aria-live region, and the
  // primary is the thing that changed, not a silent button relabel.
  // -------------------------------------------------------------------------
  {
    const t = boot(planOf([A('r1', HE.a)], [T(HE.a, 'Join', 250000)], []));
    await settle(400);
    const btn = t.doc.querySelector('#wl-row-r1 .wl-primary');
    ok('W9 the money button is there to click', !!btn, 'no .wl-primary on #wl-row-r1');
    if (btn) btn.click();
    await settle(120);
    const said = t.txt('wlAnnounce') || '';
    ok('W9 the result reaches the aria-live region', /Recorded the money/.test(said), said);
    ok('W9 and it names WHO', said.indexOf(HE.a) >= 0, said);
    // The region is never `hidden`: a live region that leaves and re-enters the
    // accessibility tree is one some screen readers stop watching. Its chrome
    // is hidden by :empty instead, which keeps the node itself present.
    ok('W9 the announce region is never hidden out of the tree',
      !!t.el('wlAnnounce') && t.el('wlAnnounce').hidden === false);
    ok('W9 and its chrome is collapsed by :empty rather than by hidden',
      /\.wl-announce:empty\{display:none\}/.test(html));
    ok('W9 the route called is the real one, keyed on the master rid',
      t.fetches.some((f) => /^opMarkMoneyReceived.*processId=r1/.test(f)), t.fetches.join(' | '));
    t.dom.window.close();
  }

  // -------------------------------------------------------------------------
  // W10: every group empty. The screen states each empty case rather than
  // rendering nothing and leaving the operator to guess whether it loaded.
  // -------------------------------------------------------------------------
  {
    const t = boot(planOf([], [], []));
    await settle(400);
    const titles = t.groupTitles().join(' | ');
    ok('W10 Blocked still renders when empty', titles.indexOf('Blocked') >= 0, titles);
    ok('W10 Needs you still renders when empty', titles.indexOf('Needs you') >= 0, titles);
    ok('W10 Goes on a letter still renders when empty', titles.indexOf('Goes on a letter') >= 0, titles);
    ok('W10 Done still renders when empty', titles.indexOf('Done') >= 0, titles);
    const blockedTxt = TX(t.groupOf('Blocked'));
    ok('W10 Blocked states the all-clear as a fact, not as an absence',
      /Nothing is blocking the letter/.test(blockedTxt), blockedTxt.slice(0, 200));
    const needsTxt = TX(t.groupOf('Needs you'));
    ok('W10 Needs you states its empty case', /Nothing is waiting on money/.test(needsTxt), needsTxt.slice(0, 200));
    ok('W10 the PARKED list stays absent when empty (it is an archive, not a job)',
      !!t.el('wlParked') && (t.el('wlParked').innerHTML || '').trim() === '',
      t.el('wlParked') ? t.el('wlParked').innerHTML.slice(0, 120) : 'no #wlParked');
    ok('W10 no blocker summary is drawn',
      !!t.el('wlBlockers') && (t.el('wlBlockers').innerHTML || '').trim() === '',
      t.el('wlBlockers') ? 'has content' : 'no #wlBlockers');
    ok('W10 Generate stays shut on an empty month',
      !!t.el('wlGenerateBtn') && t.el('wlGenerateBtn').getAttribute('aria-disabled') === 'true');
    // The gate beside Generate describes the CONTROL. It used to restate the
    // list's own headline ("Nothing to wire this month."), which is how the same
    // sentence came to appear twice in one viewport, which is what Noa actually
    // objected to on 2026-09-07.
    ok('W10 and says why the control is shut, without restating the list',
      /Generate stays off until a row is ready to wire/.test(t.txt('wlGateNote') || ''), t.txt('wlGateNote'));
    ok('W10 the old duplicated sentence is gone from the whole screen',
      !/Nothing to wire this month/.test(t.doc.body.textContent || ''), 'still present');
    ok('W10 the artifact reports a zero-row letter', /0 rows on a NIS letter/.test(t.txt('wlArtifact') || ''),
      t.txt('wlArtifact'));
    t.dom.window.close();
  }

  // -------------------------------------------------------------------------
  // W10b: ONE group empty. Money is all in, so Needs you is empty while the
  // letter group is full, and one parked row exists. The empty group must not
  // suppress the full ones or vice versa.
  // -------------------------------------------------------------------------
  {
    const parked = [{ masterRid: 'p1', name: HE.d, nameEn: 'Fixture p1', type: 'Increase',
      amount: 120000, currency: 'NIS', reason: 'signed in April, never funded' }];
    const t = boot(planOf([], [T(HE.a, 'Join', 250000), T(HE.b, 'Increase', 100000)], parked));
    await settle(400);
    ok('W10b Needs you is empty and says so',
      /Nothing is waiting on money/.test(TX(t.groupOf('Needs you'))));
    ok('W10b the letter group still lists both rows', t.cardsIn('Goes on a letter').length === 2,
      t.cardsIn('Goes on a letter').length);
    ok('W10b the parked list renders when it has a row', t.cardsIn('Parked').length === 1,
      t.cardsIn('Parked').length);
    const pcard = t.cardsIn('Parked')[0];
    ok('W10b the parked row carries its reason', !!pcard && /never funded/.test(pcard.textContent),
      pcard ? pcard.textContent.slice(0, 200) : 'no parked card');
    const un = pcard && pcard.querySelector('.wl-primary');
    ok('W10b un-park is the parked row\'s one primary', !!un && un.getAttribute('data-act') === 'unparkRow',
      un ? un.outerHTML.slice(0, 140) : 'no primary on the parked card');
    ok('W10b and it does not claim the money arrived',
      !!pcard && (/did not/.test(pcard.textContent) || /does not assert/.test(pcard.textContent)),
      pcard ? pcard.textContent.slice(0, 300) : 'no parked card');
    ok('W10b the artifact counts the parked row as left off',
      /1 parked row/.test(t.txt('wlArtifact') || ''), t.txt('wlArtifact'));
    t.dom.window.close();
  }

  // -------------------------------------------------------------------------
  // W4b: an OLDER deployed ju-service that has never heard of sourceTab /
  // recovered / datedFor. The row must render plainly, with no "undefined" and
  // no thrown read.
  // -------------------------------------------------------------------------
  {
    const bare = { masterRid: 'old1', name: HE.b, type: 'Join', amount: 400000,
      currency: 'NIS', execStatus: 'Pending' };
    const t = boot(planOf([bare], [], []));
    await settle(400);
    const card = t.doc.getElementById('wl-row-old1');
    ok('W4b a row with none of the new fields still renders', !!card);
    if (card) {
      ok('W4b and prints no "undefined"', TX(card).indexOf('undefined') < 0, TX(card).slice(0, 250));
      ok('W4b nor an empty tab claim', !/lives on/i.test(TX(card)), TX(card).slice(0, 250));
      ok('W4b nor a dated-for claim', !/dated for/i.test(TX(card)), TX(card).slice(0, 250));
      ok('W4b it still gets its one primary action', card.querySelectorAll('.wl-primary').length === 1);
      // No nameEn on the feed: the English line is omitted, not rendered blank.
      ok('W4b a missing English name renders no empty second line',
        !card.querySelector('.wl-row-nm-en'), card.innerHTML.slice(0, 300));
    }
    ok('W4b the artifact does not invent a datedFor count',
      !/dated for another month/.test(t.txt('wlArtifact') || ''), t.txt('wlArtifact'));
    t.dom.window.close();
  }

  // -------------------------------------------------------------------------
  // W1b (DOM half, 375px): at phone width the primary action is present in the
  // tree and is not sitting behind a horizontal scroll that does not exist.
  // jsdom does no layout, so this asserts REACHABILITY, and the CSS half above
  // asserts the geometry.
  // -------------------------------------------------------------------------
  {
    const t = boot(planOf([A('r1', HE.a), A('r2', HE.c, { recovered: true, sourceTab: '08/2026' })],
      [T(HE.a, 'Join', 250000)], []));
    await settle(400);
    ok('W1b the viewport under test is 375px', t.win.innerWidth === 375, t.win.innerWidth);
    const cards = t.cardsIn('Needs you');
    ok('W1b both rows are on the phone', cards.length === 2, cards.length);
    if (!cards.length) ok('W1b there are rows to check at all', false, 'no .wl-card under a "Needs you" group');
    cards.forEach((c, i) => {
      ok('W1b row ' + i + ' carries its amount', !!c.querySelector('.wl-row-amt'), c.innerHTML.slice(0, 200));
      ok('W1b row ' + i + ' carries its one primary action', c.querySelectorAll('.wl-primary').length === 1);
      ok('W1b row ' + i + ' carries the menu disclosure', !!c.querySelector('[data-wl-more]'));
    });
    // The card is a block, so nothing inside it depends on a column track.
    ok('W1b the card element itself is not given an inline grid',
      !!cards.length && !/style="[^"]*grid/.test(cards[0].outerHTML),
      cards.length ? cards[0].outerHTML.slice(0, 200) : 'no cards');
    t.dom.window.close();
  }

  // -------------------------------------------------------------------------
  // W5b: server-side blocking findings from Review join the same summary, and
  // shut the same gate. This is the half that used to render only BELOW the
  // list, in a box the operator's pointer had already passed.
  // -------------------------------------------------------------------------
  {
    const t = boot(planOf([A('r1', HE.a)], [T(HE.a, 'Join', 250000)], [], {
      opGenerateMonthlyWireLetter: { ok: true, go: false,
        blocking: [{ flag: 'hy_close_unsigned', detail: 'The June close is not signed off.' }],
        warnings: [] },
    }));
    await settle(400);
    ok('W5b nothing is blocking before the review',
      !!t.el('wlBlockers') && (t.el('wlBlockers').innerHTML || '').trim() === '',
      t.el('wlBlockers') ? 'has content' : 'no #wlBlockers');
    if (t.el('wlReviewBtn')) t.el('wlReviewBtn').click();
    await settle(300);
    const bl = TX(t.el('wlBlockers'));
    ok('W5b the server finding is lifted into the summary ABOVE the list',
      /June close is not signed off/.test(bl), bl.slice(0, 300));
    ok('W5b the gate is shut',
      !!t.el('wlGenerateBtn') && t.el('wlGenerateBtn').getAttribute('aria-disabled') === 'true');
    const ann5 = t.el('wlAnnounce'); if (ann5) ann5.textContent = '';
    if (t.el('wlGenerateBtn')) t.el('wlGenerateBtn').click();
    ok('W5b and a click on it repeats the reason rather than doing nothing',
      /June close is not signed off/.test(t.txt('wlAnnounce') || ''), t.txt('wlAnnounce'));
    t.dom.window.close();
  }

  // -------------------------------------------------------------------------
  // W2b: the money is in and reviewed. Generate arms, and the artifact stops
  // claiming anything is left off.
  // -------------------------------------------------------------------------
  {
    const t = boot(planOf([], [T(HE.a, 'Join', 250000)], [], {
      opGenerateMonthlyWireLetter: { ok: true, go: true, counts: { incoming: 1, outgoing: 0, total: 1 }, warnings: [] },
    }));
    await settle(400);
    if (t.el('wlReviewBtn')) t.el('wlReviewBtn').click();
    await settle(300);
    ok('W2b a clean review arms Generate',
      !!t.el('wlGenerateBtn') && t.el('wlGenerateBtn').getAttribute('aria-disabled') === 'false',
      t.el('wlGenerateBtn') && t.el('wlGenerateBtn').getAttribute('aria-disabled'));
    ok('W2b the artifact says nothing is left off',
      /Nothing on this tab is left off/.test(t.txt('wlArtifact') || ''), t.txt('wlArtifact'));
    ok('W2b and states the single row', /1 row on a NIS letter for September 2026/.test(t.txt('wlArtifact') || ''),
      t.txt('wlArtifact'));
    // Changing the month must shut it again (the pre-existing settle gate).
    if (t.el('wlMonth')) { t.el('wlMonth').value = '08/2026'; if (t.el('wlMonth').onchange) t.el('wlMonth').onchange(); }
    await settle(300);
    ok('W2b changing the month shuts the gate again',
      !!t.el('wlGenerateBtn') && t.el('wlGenerateBtn').getAttribute('aria-disabled') === 'true');
    t.dom.window.close();
  }

  // -------------------------------------------------------------------------
  // W11: WHY the letter group is empty, derived rather than guessed.
  //
  // On 2026-09-07 this screen told Noa "Every row on this tab has already been
  // paid or moved to trading" while its own Awaiting list showed two Pending
  // rows worth 380,000 in EUR and USD under a NIS selector. The first rebuild
  // softened that to "either the money is not in yet, or ...", which is a hedge
  // about a question the screen can answer from data it is already holding.
  // Each reason below is asserted from the evidence that produces it, and the
  // settled claim is asserted to be UNREACHABLE while any evidence contradicts it.
  // -------------------------------------------------------------------------
  {
    const SETTLED = /already been paid or moved to trading/;

    // Her exact live case.
    const t1 = boot(planOf(
      [A('r-lia', 'ליאה לדוגמה', { amount: 50000, currency: 'EUR', type: 'Increase' }),
       A('r-yan', 'ינאי לדוגמה', { amount: 330000, currency: 'USD' })],
      [], [],
    ));
    await settle(400);
    const letter1 = TX(t1.groupOf('Goes on a letter'));
    ok('W11 does not claim the tab is settled while money is awaited', !SETTLED.test(letter1), letter1.slice(0, 240));
    ok('W11 names the awaiting count', /2 rows are still awaiting money/.test(letter1), letter1.slice(0, 240));
    ok('W11 carries the real EUR figure', /50,000 EUR/.test(letter1), letter1.slice(0, 240));
    ok('W11 carries the real USD figure', /330,000 USD/.test(letter1), letter1.slice(0, 240));
    ok('W11 the reason is stated once in the letter group',
      (letter1.match(/still awaiting money/g) || []).length === 1,
      'count=' + (letter1.match(/still awaiting money/g) || []).length);
    ok('W11 the gate does not restate it beside Generate',
      !/still awaiting money/.test(t1.txt('wlGateNote') || ''), t1.txt('wlGateNote'));
    t1.dom.window.close();

    // Money IS ready, in a currency this letter cannot carry.
    const t2 = boot(planOf([], [], [], { peekExtra: { excluded: { total: 3, byCurrency: { USD: 1, EUR: 2 } } } }));
    await settle(400);
    const letter2 = TX(t2.groupOf('Goes on a letter'));
    ok('W11 does not claim settled while other-currency money is ready', !SETTLED.test(letter2), letter2.slice(0, 240));
    ok('W11 counts the other-currency rows', /3 rows are ready to wire in another currency/.test(letter2), letter2.slice(0, 240));
    ok('W11 names each currency', /1 row in USD/.test(letter2) && /2 rows in EUR/.test(letter2), letter2.slice(0, 240));
    t2.dom.window.close();

    // A currency cell nobody can read stops the whole month.
    const t3 = boot(planOf([], [], [], { peekExtra: { unresolvedCurrency: ['נועם לדוגמה: "פרנק"'] } }));
    await settle(400);
    const letter3 = TX(t3.groupOf('Goes on a letter'));
    ok('W11 reports the unreadable currency cell', /currency cell nobody can read/.test(letter3), letter3.slice(0, 240));
    ok('W11 says it blocks generation', /blocks generation/.test(letter3), letter3.slice(0, 240));
    ok('W11 does not also claim settled', !SETTLED.test(letter3), letter3.slice(0, 240));
    t3.dom.window.close();

    // Genuinely settled: the claim is allowed, because now it is true.
    const t4 = boot(planOf([], [], []));
    await settle(400);
    const letter4 = TX(t4.groupOf('Goes on a letter'));
    ok('W11 states the settled case when it is true', SETTLED.test(letter4), letter4.slice(0, 240));
    ok('W11 invents no awaiting rows', !/awaiting money/.test(letter4), letter4.slice(0, 240));
    t4.dom.window.close();
  }

  console.log('\n' + (fail ? 'WIRE-LETTER WORKLIST HARNESS FAILED: ' : 'WIRE-LETTER WORKLIST HARNESS PASSED: ')
    + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness crashed:', e); process.exit(2); });
