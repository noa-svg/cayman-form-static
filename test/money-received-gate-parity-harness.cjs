// money-received-gate-parity-harness.cjs (2026-09-07).
//
// DEFECT: the SAME tracker write was confirm-gated in one place and one click
// in the other. ?api=opMarkMoneyReceived sets EXECUTION_STATUS to "Received in
// transit", un-parks the row and mirrors to Monday, and is reversible only by
// hand on the sheet. The drawer armed it behind ACT_CONFIRM.markMoneyReceived;
// the Transfer Form panel's Awaiting-money list fired it on the first click,
// and reported its failure only in a btn.title tooltip. "Not this month" (a
// live money row moved to another month tab) reported failure through a native
// alert(), and Un-park through a tooltip too.
//
// This harness drives the REAL wire-letter IIFE out of console/index.html in a
// real jsdom DOM, so it fails on the wiring rather than on a hand-written copy
// of it. It proves the gate BY THE REQUEST, not by the dialog: the assertion
// that matters is that no apiFetch is issued until the operator confirms.
//
//   G1  Clicking "Mark received" issues NO request.
//   G2  The armed strip's words come from ACT_CONFIRM.markMoneyReceived - one
//       table, two renderers, so the two surfaces cannot drift.
//   G3  Cancel disarms and still issues nothing.
//   G4  Confirm issues exactly one opMarkMoneyReceived, to ju-service, for the
//       row's own rid.
//   G5  A refusal is VISIBLE in the row, not parked in a tooltip.
//   G6  "Not this month" never calls alert(), and its failure is visible.
//   G7  Un-park's failure is visible.
//   G8  Source level: no alert( survives in this panel.
//
// Run: node test/money-received-gate-parity-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }

// ---- extraction ------------------------------------------------------------
function braceBlock(startIdx) {
  let i = html.indexOf('{', startIdx), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('unbalanced braces from ' + startIdx);
}
function extractVarObj(name) {
  const start = html.indexOf('var ' + name + '={');
  if (start < 0) throw new Error('var object not found: ' + name);
  return html.slice(start, braceBlock(start)) + ';';
}
// The wire-letter / Transfer Form panel IIFE, by its own opening declarations.
const WL_ANCHOR = "var monthEl=document.getElementById('wlMonth')";
function extractWlIife() {
  const decl = html.indexOf(WL_ANCHOR);
  if (decl < 0) throw new Error('wire-letter panel anchor not found (boot contract changed)');
  const start = html.lastIndexOf('(function(){', decl);
  if (start < 0) throw new Error('wire-letter IIFE opening not found');
  const end = braceBlock(start);
  const closeParen = html.indexOf('()', end);
  return html.slice(start, closeParen + 2);
}
const wlSrc = extractWlIife();
for (const needle of ['data-act="markMoneyReceived"', 'data-act="rowNextMonth"', 'data-act="unparkRow"', 'opMarkMoneyReceived']) {
  if (wlSrc.indexOf(needle) < 0) throw new Error('extracted panel missing ' + needle + ' (boot contract changed)');
}
const actConfirmSrc = extractVarObj('ACT_CONFIRM');
const ACT_CONFIRM = new Function(actConfirmSrc + ' return ACT_CONFIRM;')();
ok('ACT_CONFIRM carries the markMoneyReceived entry', !!(ACT_CONFIRM.markMoneyReceived && ACT_CONFIRM.markMoneyReceived.msg && ACT_CONFIRM.markMoneyReceived.cta));

// ---- G8: the native alert is gone from this panel ---------------------------
// Line comments stripped first: the fix's own comment names alert() to say why
// it went, and a check that cannot tell code from prose would fail on the
// explanation rather than on the behaviour.
const wlCode = wlSrc.replace(/^\s*\/\/.*$/gm, '');
ok('G8 no native alert() left in the Transfer Form panel', !/\balert\s*\(/.test(wlCode));

const JU_API = 'https://ju-api.example';
const GW = 'https://gas.example/exec';

const AWAIT_ROW =
  '<div class="wl-await-row" id="row1">'
  + '<div class="wl-row-nm">LP One</div><div></div><div></div><div></div>'
  + '<div class="wl-await-acts">'
  + '<button type="button" class="wl-await-btn" data-act="markMoneyReceived" data-rid="RID-1">Mark received</button>'
  + '<button type="button" class="wl-await-btn wl-await-btn--quiet" data-act="rowNextMonth" data-rid="RID-1">Not this month</button>'
  + '<button type="button" class="wl-await-btn wl-await-park" data-act="parkRow" data-rid="RID-1">Park</button>'
  + '</div></div>';
const PARKED_ROW =
  '<div class="wl-await-row" id="prow1"><div></div><div></div><div></div><div></div>'
  + '<div class="wl-await-acts">'
  + '<button type="button" class="wl-await-btn" data-act="unparkRow" data-rid="RID-1">Un-park</button>'
  + '</div></div>';

function build() {
  const dom = new JSDOM(
    '<!doctype html><body>'
    + '<input id="wlMonth" value="09/2026"><select id="wlCurrency"><option value="ILS" selected>ILS</option></select>'
    + '<input id="wlNavMonth"><span id="wlNavNote"></span><span id="wlGateNote"></span>'
    + '<button id="wlReviewBtn">Review</button><button id="wlGenerateBtn" disabled>Generate</button>'
    + '<input type="checkbox" id="wlCreateDraft"><div id="wlFindings"></div>'
    + '<div id="wlRows"></div><div id="wlResult"></div>'
    + '<div id="wlAwaiting">' + AWAIT_ROW + '</div>'
    + '<div id="wlParked">' + PARKED_ROW + '</div>'
    + '<div id="wlConfirm" hidden><div id="wlConfirmMsg"></div><button id="wlConfirmGo"></button><button id="wlConfirmCancel"></button></div>'
    + '</body>',
    { url: 'https://sign.example/console/' },
  );
  const document = dom.window.document;
  const calls = [];
  let impl = () => new Promise(() => {}); // default: never resolves, so panel boot fetches cannot resolve into assertions
  function apiFetch(url, isPost, base) { calls.push({ url, base }); return impl(url, base); }
  let alerts = 0;
  dom.window.alert = () => { alerts++; };
  function esc2(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const fn = new dom.window.Function(
    'document', 'apiFetch', 'esc2', 'JU_API', 'GW', 'ACT_CONFIRM', 'window', 'setTimeout', 'clearTimeout', 'alert',
    'consoleReadBase_', 'currentEngine', 'load', 'state',
    actConfirmSrc + '\n' + wlSrc,
  );
  fn(document, apiFetch, esc2, JU_API, GW, ACT_CONFIRM, dom.window, dom.window.setTimeout, dom.window.clearTimeout, dom.window.alert,
    function consoleReadBase_() { return JU_API; }, JU_API, function load() {}, { lane: 'israel' });
  // Boot-time peeks are noise for these assertions; drop them.
  calls.length = 0;
  return {
    dom, document, calls,
    alertCount: () => alerts,
    setImpl: (f) => { impl = f; },
    click: (sel) => {
      const b = document.querySelector(sel);
      if (!b) throw new Error('no element for ' + sel);
      b.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      return b;
    },
    strip: () => document.querySelector('#row1 + .wl-park-form') || document.querySelector('#prow1 + .wl-park-form'),
    money: () => calls.filter((c) => c.url.indexOf('opMarkMoneyReceived') >= 0),
  };
}
const flush = () => new Promise((res) => { let n = 0; (function f() { if (++n > 12) return res(); Promise.resolve().then(f); })(); });

(async () => {
  // ---- G1 + G2: arming, not firing -----------------------------------------
  {
    const t = build();
    t.click('[data-act="markMoneyReceived"]');
    await flush();
    ok('G1 THE GATE: clicking Mark received issues NO request', t.money().length === 0, t.calls.map((c) => c.url));
    const s = t.strip();
    ok('G2 a confirm strip is armed under the row', !!s);
    ok('G2 its sentence is ACT_CONFIRM.markMoneyReceived.msg verbatim',
      !!s && s.textContent.indexOf(ACT_CONFIRM.markMoneyReceived.msg) >= 0,
      s && s.textContent);
    const go = s && s.querySelector('[data-row-go]');
    ok('G2 its CTA is ACT_CONFIRM.markMoneyReceived.cta verbatim',
      !!go && go.textContent === ACT_CONFIRM.markMoneyReceived.cta, go && go.textContent);
  }

  // ---- G3: cancel ----------------------------------------------------------
  {
    const t = build();
    t.click('[data-act="markMoneyReceived"]');
    await flush();
    t.click('#row1 + .wl-park-form [data-row-cancel]');
    await flush();
    ok('G3 Cancel disarms the strip', !t.strip());
    ok('G3 Cancel issued nothing', t.money().length === 0, t.calls.map((c) => c.url));
  }

  // ---- G4: confirm fires exactly one request, on ju-service -----------------
  {
    const t = build();
    t.setImpl(() => Promise.resolve({ ok: true, tab: '09/2026' }));
    t.click('[data-act="markMoneyReceived"]');
    await flush();
    t.click('#row1 + .wl-park-form [data-row-go]');
    await flush();
    const m = t.money();
    ok('G4 confirming issues exactly one opMarkMoneyReceived', m.length === 1, m);
    ok('G4 it carries the row\'s own rid', m.length === 1 && m[0].url.indexOf('processId=RID-1') > 0, m);
    ok('G4 it goes to ju-service, the engine that settles money', m.length === 1 && m[0].base === JU_API, m);
    ok('G4 a successful confirm clears the strip', !t.strip());
  }

  // ---- G5: a refusal is visible on the row ---------------------------------
  {
    const t = build();
    t.setImpl(() => Promise.resolve({ ok: false, error: 'row is already settled' }));
    t.click('[data-act="markMoneyReceived"]');
    await flush();
    t.click('#row1 + .wl-park-form [data-row-go]');
    await flush();
    const s = t.strip();
    ok('G5 the refusal renders in the DOM, not in a tooltip',
      !!s && s.textContent.indexOf('row is already settled') >= 0, s && s.textContent);
    const btn = t.document.querySelector('[data-act="markMoneyReceived"]');
    ok('G5 the row button is re-armable after a refusal', btn.disabled === false && btn.textContent === 'Mark received');
    ok('G5 the row was NOT painted as Received', btn.className.indexOf('wl-await-done') < 0);
  }
  // Transport failure (apiFetch rejects with serverError attached).
  {
    const t = build();
    t.setImpl(() => Promise.reject(Object.assign(new Error('x'), { serverError: 'gateway timed out' })));
    t.click('[data-act="markMoneyReceived"]');
    await flush();
    t.click('#row1 + .wl-park-form [data-row-go]');
    await flush();
    const s = t.strip();
    ok('G5 a transport failure is visible too', !!s && s.textContent.indexOf('gateway timed out') >= 0, s && s.textContent);
  }

  // ---- G6: Not this month ---------------------------------------------------
  {
    const t = build();
    t.setImpl(() => Promise.reject(Object.assign(new Error('x'), { serverError: 'tab 10/2026 is closed' })));
    t.click('[data-act="rowNextMonth"]');
    await flush();
    ok('G6 no native alert()', t.alertCount() === 0);
    const s = t.strip();
    ok('G6 the failure is visible on the row', !!s && s.textContent.indexOf('tab 10/2026 is closed') >= 0, s && s.textContent);
    const nxt = t.document.querySelector('[data-act="rowNextMonth"]');
    ok('G6 the button is re-armable', nxt.disabled === false && nxt.textContent === 'Not this month');
  }

  // ---- one question per row: an armed Park form is replaced, never stacked --
  {
    const t = build();
    t.click('[data-act="parkRow"]');
    await flush();
    ok('the Park reason form arms as before', !!t.document.querySelector('#row1 + .wl-park-form .wl-park-in'));
    t.click('[data-act="markMoneyReceived"]');
    await flush();
    ok('exactly one strip under the row, never two',
      t.document.querySelectorAll('#wlAwaiting .wl-park-form').length === 1,
      t.document.querySelectorAll('#wlAwaiting .wl-park-form').length);
    const s = t.strip();
    ok('and it is the money confirm, with the Park reason input gone',
      !!s && !s.querySelector('.wl-park-in') && s.textContent.indexOf(ACT_CONFIRM.markMoneyReceived.msg) >= 0, s && s.textContent);
    ok('still nothing sent', t.money().length === 0, t.calls.map((c) => c.url));
  }

  // ---- G7: Un-park ----------------------------------------------------------
  {
    const t = build();
    t.setImpl(() => Promise.resolve({ ok: false, error: 'no Master RID on that row' }));
    t.click('[data-act="unparkRow"]');
    await flush();
    const s = t.document.querySelector('#prow1 + .wl-park-form');
    ok('G7 un-park failure is visible on the row', !!s && s.textContent.indexOf('no Master RID on that row') >= 0, s && s.textContent);
  }

  console.log((fail === 0 ? 'PASS' : 'FAIL') + ' money-received-gate-parity: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
