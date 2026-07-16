// Focused harness for the localStorage PII TTL purge (israel.html, 2026-07-16).
// Extracts the LIVE purgeStaleSnaps_ IIFE from israel.html (house pattern, same
// as client-honesty-harness.cjs) and runs it against a mock localStorage.
// Proves:
//   T1  a snapshot ts-stamped older than 30 days is REMOVED;
//   T2  a fresh snapshot (and one just inside the 30-day line) SURVIVES intact;
//   T3  an UNSTAMPED snapshot is stamped with a current ts, NOT deleted
//       (existing LPs mid-flow are never wiped), and its data is untouched;
//   T4  non-snapshot keys and unrelated lvp_* keys are never touched;
//   T5  an unparsable lvp_il_snap_* entry is removed (unrestorable, may hold PII);
//   T6  a throwing localStorage never propagates (page init must not break);
//   T7  the writer saveLocalSnap_ stamps ts on every save (the field the purge ages by).
// Run: node test/snap-ttl-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const israelHtml = fs.readFileSync(path.join(__dirname, '..', 'israel.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); }
}

// ---- extract the live purge IIFE from israel.html ---------------------------
const m = israelHtml.match(/\(function purgeStaleSnaps_\(\) \{[\s\S]*?\n    \}\)\(\);/);
if (!m) { console.log('FAIL could not extract purgeStaleSnaps_ from israel.html'); process.exit(1); }
const purgeSrc = m[0];
function runPurge(store) { new Function('localStorage', purgeSrc)(store); }

// ---- mock localStorage -------------------------------------------------------
function makeStore(init) {
  const map = new Map(Object.entries(init || {}));
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] === undefined ? null : [...map.keys()][i]; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    _dump() { return Object.fromEntries(map); }
  };
}

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const snap = (ts, data) => JSON.stringify(ts === undefined ? { page: 'bank', data: data || { name: 'x' } } : { ts, page: 'bank', data: data || { name: 'x' } });

// ---- T1/T2: old purged, fresh survives ---------------------------------------
(function () {
  const s = makeStore({
    'lvp_il_snap_OLD': snap(now - 31 * DAY),
    'lvp_il_snap_EDGE': snap(now - 29 * DAY),
    'lvp_il_snap_FRESH': snap(now - 1 * DAY, { name: 'keepme' })
  });
  runPurge(s);
  ok('T1 31-day-old snapshot purged', s.getItem('lvp_il_snap_OLD') === null, s.getItem('lvp_il_snap_OLD'));
  ok('T2 29-day-old snapshot survives', s.getItem('lvp_il_snap_EDGE') !== null);
  ok('T2 fresh snapshot survives', s.getItem('lvp_il_snap_FRESH') !== null);
  ok('T2 fresh snapshot data untouched', JSON.parse(s.getItem('lvp_il_snap_FRESH')).data.name === 'keepme');
  ok('T2 fresh snapshot ts untouched', JSON.parse(s.getItem('lvp_il_snap_FRESH')).ts === now - 1 * DAY);
})();

// ---- T3: unstamped gets stamped, not deleted ----------------------------------
(function () {
  const s = makeStore({ 'lvp_il_snap_NOTS': snap(undefined, { name: 'midflow' }) });
  ok('T3 precondition: entry has no ts', JSON.parse(s.getItem('lvp_il_snap_NOTS')).ts === undefined);
  runPurge(s);
  const after = JSON.parse(s.getItem('lvp_il_snap_NOTS') || 'null');
  ok('T3 unstamped snapshot NOT deleted', after !== null);
  ok('T3 unstamped snapshot got a current ts', after && typeof after.ts === 'number' && Math.abs(after.ts - Date.now()) < 60 * 1000, after && after.ts);
  ok('T3 unstamped snapshot data preserved', after && after.data && after.data.name === 'midflow');
  // and once stamped, a later run 31 days on would purge it: simulate by rewinding the stamp
  s.setItem('lvp_il_snap_NOTS', JSON.stringify(Object.assign(after, { ts: now - 31 * DAY })));
  runPurge(s);
  ok('T3 stamped entry ages out on a later pass', s.getItem('lvp_il_snap_NOTS') === null);
})();

// ---- T4: unrelated keys untouched ---------------------------------------------
(function () {
  const s = makeStore({
    'lvp_op_token_v1': 'tok',
    'lvp_console_lane': 'x',
    'someOtherApp': JSON.stringify({ ts: now - 400 * DAY }),
    'lvp_il_snap_OLD2': snap(now - 40 * DAY)
  });
  runPurge(s);
  ok('T4 non-snap lvp_* keys untouched', s.getItem('lvp_op_token_v1') === 'tok' && s.getItem('lvp_console_lane') === 'x');
  ok('T4 foreign old key untouched', s.getItem('someOtherApp') !== null);
  ok('T4 only the stale snap key removed', s.getItem('lvp_il_snap_OLD2') === null && s.length === 3);
})();

// ---- T5: unparsable snap entry removed ----------------------------------------
(function () {
  const s = makeStore({ 'lvp_il_snap_CORRUPT': '{not json', 'lvp_il_snap_NULL': 'null' });
  runPurge(s);
  ok('T5 corrupt snap entry removed', s.getItem('lvp_il_snap_CORRUPT') === null);
  ok('T5 literal-null snap entry removed', s.getItem('lvp_il_snap_NULL') === null);
})();

// ---- T6: storage failures never propagate --------------------------------------
(function () {
  let threw = false;
  try { runPurge({ get length() { throw new Error('SecurityError: denied'); } }); } catch (e) { threw = true; }
  ok('T6 throwing localStorage.length swallowed', threw === false);
  threw = false;
  const s = makeStore({ 'lvp_il_snap_X': snap(now - 40 * DAY) });
  s.removeItem = function () { throw new Error('QuotaError'); };
  try { runPurge(s); } catch (e) { threw = true; }
  ok('T6 throwing removeItem swallowed', threw === false);
})();

// ---- T7: the writer stamps ts (the field the purge relies on) ------------------
(function () {
  const w = israelHtml.match(/function saveLocalSnap_\(\) \{[\s\S]*?\n    \}/);
  ok('T7 saveLocalSnap_ extractable', !!w);
  ok('T7 writer stamps ts: Date.now()', !!w && /ts:\s*Date\.now\(\)/.test(w[0]));
})();

console.log(`\n${fail ? 'SNAP TTL FAILED: ' : 'SNAP TTL PASSED: '}${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
