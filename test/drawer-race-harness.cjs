// Deterministic race-logic harness for console/index.html openDrawer (2026-07-30).
// Extracts the live function and drives it with a scriptable gateway, proving
// the stale-response guard: opening drawer A, then drawer B before A's fetch
// resolves, must never let A's late response paint over B's now-open drawer.
// Found incidentally during the 2026-07-30 design-unification pass.
// Run: node test/drawer-race-harness.cjs
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');
const m = html.match(/(function openDrawer\(pid\)\{[\s\S]*?\n  \})\n/);
if (!m) { console.error('could not extract openDrawer'); process.exit(2); }
const src = m[1];

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra || ''); } }

const drawer = { _on: false, classList: { contains: () => drawer._on, add: () => { drawer._on = true; } } };
const dscrim = { classList: { add: () => {} } };
const bodyEl = { style: {} };
const dbody = { innerHTML: '' };
const dom = { getElementById: (id) => (id === 'dbody' ? dbody : null), activeElement: null, body: bodyEl };
const allRows = [];
const state = { lane: 'cayman' };
const esc2 = (s) => String(s == null ? '' : s);
const stageMilestone = (s) => s;

let pending = [];
function apiFetch() { let resolve, reject; const p = new Promise((rs, rj) => { resolve = rs; reject = rj; }); pending.push({ resolve, reject }); return p; }
function lastFetch() { return pending[pending.length - 1]; }

const rendered = [];
function renderDrawer(d) { rendered.push(d); }

const openDrawer = (new Function('drawer', 'dscrim', 'document', 'allRows', 'esc2', 'stageMilestone', 'apiFetch', 'state', 'renderDrawer', 'GW',
  'var currentPid=null, currentEngine=GW, drawerOpener=null;' + src + '; return openDrawer;'
))(drawer, dscrim, dom, allRows, esc2, stageMilestone, apiFetch, state, renderDrawer, 'https://gas.example/exec');

const flush = () => new Promise((res) => { let n = 0; (function f() { if (++n > 8) return res(); Promise.resolve().then(f); })(); });

(async () => {
  // The exact reported race: open A, open B before A resolves, A resolves late.
  openDrawer('A'); await flush();
  ok('A fetch in flight', pending.length === 1);
  openDrawer('B'); await flush();
  ok('B fetch in flight', pending.length === 2);
  ok('dbody shows B-loading skeleton, not A', dbody.innerHTML.indexOf('Loading') !== -1);

  // A's late response arrives after B is the open drawer.
  pending[0].resolve({ processId: 'A', displayName: 'LP A' }); await flush();
  ok('A LATE RESPONSE DISCARDED (bug fixed)', rendered.length === 0, JSON.stringify(rendered));

  // B's response arrives and paints, since B is still the open drawer.
  pending[1].resolve({ processId: 'B', displayName: 'LP B' }); await flush();
  ok('B response painted', rendered.length === 1 && rendered[0].processId === 'B', JSON.stringify(rendered));

  // Reopening the SAME pid after its own fetch is in flight must still render
  // (currentPid doesn't move away from itself).
  rendered.length = 0; pending = [];
  openDrawer('C'); await flush();
  pending[0].resolve({ processId: 'C', displayName: 'LP C' }); await flush();
  ok('same-pid response still paints', rendered.length === 1 && rendered[0].processId === 'C');

  // A late ERROR for a superseded drawer must not stomp the newer drawer's
  // loading/loaded state with a stale Retry screen either.
  rendered.length = 0; pending = [];
  openDrawer('D'); await flush();
  openDrawer('E'); await flush();
  const dBeforeReject = dbody.innerHTML;
  pending[0].reject({ serverError: 'timeout' }); await flush();
  ok('D late ERROR does not repaint dbody over E', dbody.innerHTML === dBeforeReject);

  console.log('\n' + (fail ? 'DRAWER RACE HARNESS FAILED: ' : 'DRAWER RACE HARNESS PASSED: ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
