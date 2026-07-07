// Deterministic race-logic harness for israel.html loadSignPreview (2026-07-08).
// Extracts the live function from israel.html and drives it with fake timers +
// a scriptable gateway, proving the cold-render-loss fix (CTO 2026-07-08):
//   S1 a render that lands AFTER the 30s watchdog still shows (was discarded);
//   S2 one silent retry after an empty response; S3 dead gateway retries once
//   then fails open; S4 newer data supersedes a stale in-flight response;
//   S5 re-entry on shown data is a no-op; S6 warm path unchanged.
// Run: node test/sign-preview-race-harness.cjs
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'israel.html'), 'utf8');
const m = html.match(/(function loadSignPreview\(\) \{[\s\S]*?\n    \})\n    function initSigPad/);
if (!m) { console.error('could not extract loadSignPreview'); process.exit(2); }
const src = m[1];

let now = 0; let timers = [];
global.setTimeout = (fn, ms) => { const t = { fn, at: now + (ms || 0) }; timers.push(t); return t; };
global.clearTimeout = (t) => { timers = timers.filter(x => x !== t); };
global.requestAnimationFrame = (fn) => global.setTimeout(fn, 0);
function tick(ms) { const end = now + ms; while (true) { const due = timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at); if (!due.length) { now = end; break; } const t = due[0]; timers = timers.filter(x => x !== t); now = t.at; t.fn(); } }
const flush = () => new Promise(res => { let n = 0; (function f() { if (++n > 8) return res(); Promise.resolve().then(f); })(); });
async function step(ms) { tick(ms); await flush(); }

function mkEl() { return { hidden: true, innerHTML: '', textContent: '', scrollTop: 0, style: {} }; }
const els = { box: mkEl(), body: mkEl(), title: mkEl(), loading: mkEl() };
let collectData = { a: 1 };
const form = { querySelector: (sel) => ({ '[data-doc-preview]': els.box, '[data-doc-preview-body]': els.body, '[data-doc-preview-title]': els.title, '[data-doc-preview-loading]': els.loading }[sel]) };
function collectAll() { return collectData; }

let pending = [];
function gateway(action, payload, timeout) { let resolve, reject; const p = new Promise((rs, rj) => { resolve = rs; reject = rj; }); pending.push({ action, timeout, resolve, reject, p }); return p; }
function lastFetch() { return pending[pending.length - 1]; }

const loadSignPreview = (new Function('form', 'collectAll', 'gateway', 'requestAnimationFrame',
  'var signPreviewGen=0, signPreviewShownKey=null, signPreviewActiveKey=null;' + src + '; return loadSignPreview;'))(form, collectAll, gateway, global.requestAnimationFrame);

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra || ''); } }

(async () => {
  els.box.hidden = true; els.loading.hidden = false; pending = []; timers = []; now = 0;
  loadSignPreview(); await flush();
  ok('S1 spinner shown', els.loading.hidden === false);
  ok('S1 one fetch', pending.length === 1);
  ok('S1 budget 45s', lastFetch().timeout === 45000);
  await step(31000);
  ok('S1 watchdog hid spinner', els.loading.hidden === true);
  ok('S1 no card yet', els.box.hidden === true);
  ok('S1 no discard/retry (still 1 fetch)', pending.length === 1);
  lastFetch().resolve({ ok: true, docs: [{ title: 'מסמכי הצטרפות', html: '<p>DOC</p>' }] }); await flush();
  ok('S1 LATE SUCCESS SHOWS CARD (bug fixed)', els.box.hidden === false && els.body.innerHTML === '<p>DOC</p>');
  ok('S1 spinner hidden after show', els.loading.hidden === true);

  els.box.hidden = true; els.body.innerHTML = ''; els.loading.hidden = false; pending = []; timers = []; now = 0; collectData = { b: 2 };
  loadSignPreview(); await flush();
  lastFetch().resolve({ ok: true, docs: [] }); await flush();
  ok('S2 spinner back for retry', els.loading.hidden === false);
  ok('S2 no 2nd fetch before 5s', pending.length === 1);
  await step(5001);
  ok('S2 retry fired ~5s', pending.length === 2);
  lastFetch().resolve({ ok: true, docs: [{ title: 't', html: '<p>RETRY-OK</p>' }] }); await flush();
  ok('S2 retry success shows', els.box.hidden === false && els.body.innerHTML === '<p>RETRY-OK</p>');

  els.box.hidden = true; els.body.innerHTML = ''; els.loading.hidden = false; pending = []; timers = []; now = 0; collectData = { c: 3 };
  loadSignPreview(); await flush();
  lastFetch().reject(new Error('dead')); await flush();
  ok('S3 spinner back after 1st fail', els.loading.hidden === false);
  await step(5001);
  ok('S3 retry fired', pending.length === 2);
  lastFetch().reject(new Error('dead')); await flush();
  ok('S3 fail-open spinner hidden', els.loading.hidden === true);
  ok('S3 fail-open no card', els.box.hidden === true);
  ok('S3 no 3rd fetch', pending.length === 2);
  loadSignPreview(); await flush();
  ok('S3 re-entry re-attempts', pending.length === 3);

  els.box.hidden = true; els.body.innerHTML = ''; els.loading.hidden = false; pending = []; timers = []; now = 0; collectData = { d: 4 };
  loadSignPreview(); await flush();
  const stale = lastFetch();
  collectData = { d: 5 }; loadSignPreview(); await flush();
  ok('S4 new cycle new fetch', pending.length === 2);
  stale.resolve({ ok: true, docs: [{ title: 't', html: '<p>STALE</p>' }] }); await flush();
  ok('S4 stale discarded', els.body.innerHTML !== '<p>STALE</p>');
  lastFetch().resolve({ ok: true, docs: [{ title: 't', html: '<p>FRESH</p>' }] }); await flush();
  ok('S4 fresh shows', els.body.innerHTML === '<p>FRESH</p>');

  pending = []; loadSignPreview(); await flush();
  ok('S5 no refetch on same shown data', pending.length === 0);

  els.box.hidden = true; els.body.innerHTML = ''; els.loading.hidden = false; pending = []; timers = []; now = 0; collectData = { e: 6 };
  loadSignPreview(); await flush();
  await step(4600);
  lastFetch().resolve({ ok: true, docs: [{ title: 't', html: '<p>WARM</p>' }] }); await flush();
  ok('S6 warm shows, no stranded spinner', els.box.hidden === false && els.loading.hidden === true);

  console.log(fail ? ('FAILURES ' + fail + '/' + (pass + fail)) : ('ALL PASS ' + pass + ' asserts'));
  process.exit(fail ? 1 : 0);
})();
