// allowlist-two-engine-harness.cjs (2026-09-07).
//
// DEFECT: revoking console access did not revoke it on the engine that settles
// money. The Settings panel's allowlist box read and wrote GAS only, while
// ju-service keeps its OWN CONSOLE_ALLOWED_EMAILS (auth/consoleAuth.ts,
// consoleEmailAllowed) and, since 2026-09-03/05, serves park, un-park,
// mark-received, set-amount, set-bank-details, add-manual-row and the wire
// letter. Firm-domain addresses auto-allow on both engines, so the split bit
// NON-domain guests: removing one here left them able to hit ju-service's money
// routes.
//
// Drives the REAL loadSettings + the REAL allowlist-save handler out of
// console/index.html.
//
//   S1  load reads BOTH engines.
//   S2  one engine failing to answer is NOT a picture of who has access: the
//       save guard stays closed and the danger line shows.
//   S3  the box shows the money engine's list, and a divergence is detected.
//   S4  Save writes BOTH engines.
//   S5  ju-service is written FIRST, and if it refuses GAS is never written -
//       nothing is half-applied.
//   S6  a partial write (ju-service ok, GAS refused) NEVER says Saved.
//   S7  the bare word 'Error' is no longer the whole message when the server
//       actually said something.
//
// Run: node test/allowlist-two-engine-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }

function braceBlock(startIdx) {
  let i = html.indexOf('{', startIdx), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('unbalanced braces from ' + startIdx);
}
// Everything from the ALLOWLIST_LOADED guard through the end of loadSettings.
function extractLoad() {
  const start = html.indexOf('var ALLOWLIST_LOADED=false;');
  if (start < 0) throw new Error('ALLOWLIST_LOADED guard not found (boot contract changed)');
  const fnAt = html.indexOf('function loadSettings(', start);
  if (fnAt < 0) throw new Error('loadSettings not found');
  return html.slice(start, braceBlock(fnAt));
}
// The Save button's own handler.
function extractSave() {
  const start = html.indexOf("document.getElementById('allowlist-save').onclick=function(){");
  if (start < 0) throw new Error('allowlist-save handler not found (boot contract changed)');
  return html.slice(start, braceBlock(start)) + ';';
}
const loadSrc = extractLoad();
const saveSrc = extractSave();

const JU_API = 'https://ju-api.example';
const GW = 'https://gas.example/exec';

function build() {
  const dom = new JSDOM('<!doctype html><body>'
    + '<textarea id="allowlist-input"></textarea>'
    + '<span id="allowlist-status"></span>'
    + '<button id="allowlist-save">Save</button>'
    + '</body>');
  const document = dom.window.document;
  const calls = [];
  let impl = () => Promise.resolve({ ok: true, allowedEmails: [] });
  function apiFetch(url, isPost, base) { calls.push({ url, base }); return impl(url, base); }
  const scope = new dom.window.Function(
    // GAS_ONLY_ is injected so this harness still RUNS against the pre-fix
    // file (which reached for it) and fails on assertions rather than on a
    // ReferenceError. A red that is only a crash proves the harness moved, not
    // that the behaviour did.
    'document', 'apiFetch', 'JU_API', 'GW', 'GAS_ONLY_', 'loadSettingsHealth', 'loadSettingsFoCatalog',
    loadSrc + '\n' + saveSrc
    + '\n return { loadSettings: loadSettings, get loaded(){return ALLOWLIST_LOADED;},'
    + ' get diverged(){return typeof ALLOWLIST_DIVERGED===\'undefined\'?null:ALLOWLIST_DIVERGED;} };',
  )(document, apiFetch, JU_API, GW, GW, function () {}, function () {});
  return {
    dom, document, calls, scope,
    setImpl: (f) => { impl = f; },
    status: () => document.getElementById('allowlist-status').textContent,
    statusColor: () => document.getElementById('allowlist-status').style.color,
    box: () => document.getElementById('allowlist-input'),
    save: () => document.getElementById('allowlist-save').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
    gets: () => calls.filter((c) => c.url.indexOf('getConsoleSettings') >= 0),
    sets: () => calls.filter((c) => c.url.indexOf('setConsoleSettings') >= 0),
  };
}
const flush = () => new Promise((res) => { let n = 0; (function f() { if (++n > 12) return res(); Promise.resolve().then(f); })(); });

// A default reader that answers both engines with the same list.
function reader(juList, gasList) {
  return (url, base) => Promise.resolve({ ok: true, allowedEmails: base === JU_API ? juList : gasList });
}

(async () => {
  // ---- S1: load reads BOTH engines -----------------------------------------
  {
    const t = build();
    t.setImpl(reader(['guest@outside.example'], ['guest@outside.example']));
    t.scope.loadSettings();
    await flush();
    const g = t.gets();
    ok('S1 load reads both engines', g.length === 2, g);
    ok('S1 one read is ju-service', g.some((c) => c.base === JU_API), g);
    ok('S1 the other is GAS', g.some((c) => c.base === GW), g);
    ok('S1 the save guard opens only after both answered', t.scope.loaded === true);
    ok('S1 the box carries the list', t.box().value === 'guest@outside.example', t.box().value);
  }

  // ---- S2: half a picture is not a picture ---------------------------------
  for (const dead of [JU_API, GW]) {
    const t = build();
    t.setImpl((url, base) => (base === dead
      ? Promise.resolve({ ok: false, error: 'unauthorized' })
      : Promise.resolve({ ok: true, allowedEmails: ['guest@outside.example'] })));
    t.scope.loadSettings();
    await flush();
    ok('S2 ' + (dead === JU_API ? 'ju-service' : 'GAS') + ' refusing keeps the save guard CLOSED', t.scope.loaded === false);
    ok('S2 and says so', t.status().indexOf('Could not load') === 0, t.status());
    ok('S2 in danger colour', t.statusColor().indexOf('danger') >= 0, t.statusColor());
  }
  // Transport failure on one engine is the same thing.
  {
    const t = build();
    t.setImpl((url, base) => (base === JU_API
      ? Promise.reject(new Error('offline'))
      : Promise.resolve({ ok: true, allowedEmails: [] })));
    t.scope.loadSettings();
    await flush();
    ok('S2 a rejected read also keeps the guard closed', t.scope.loaded === false);
  }

  // ---- S3: the money engine's list, and divergence is seen ------------------
  {
    const t = build();
    t.setImpl(reader(['guest@outside.example'], []));
    t.scope.loadSettings();
    await flush();
    ok('S3 the box shows the MONEY engine\'s list', t.box().value === 'guest@outside.example', t.box().value);
    ok('S3 the divergence is detected', t.scope.diverged === true);
  }
  {
    const t = build();
    t.setImpl(reader(['b@x.example', 'a@x.example'], ['a@x.example', 'b@x.example']));
    t.scope.loadSettings();
    await flush();
    ok('S3 order alone is not a divergence', t.scope.diverged === false);
  }

  // ---- S4: Save writes BOTH engines ----------------------------------------
  {
    const t = build();
    t.setImpl(reader(['guest@outside.example'], ['guest@outside.example']));
    t.scope.loadSettings();
    await flush();
    // The revocation: the guest is removed.
    t.box().value = '';
    t.setImpl(() => Promise.resolve({ ok: true, allowedEmails: [] }));
    t.save();
    await flush();
    const s = t.sets();
    ok('S4 Save writes BOTH engines', s.length === 2, s.map((c) => c.base));
    ok('S4 ju-service is written', s.some((c) => c.base === JU_API), s.map((c) => c.base));
    ok('S4 GAS is written', s.some((c) => c.base === GW), s.map((c) => c.base));
    ok('S4 both carry the same list', s.every((c) => c.url === s[0].url), s.map((c) => c.url));
    ok('S4 and only then does it say Saved', t.status() === 'Saved', t.status());
  }

  // ---- S5: ju-service first, and a refusal writes nothing anywhere ----------
  {
    const t = build();
    t.setImpl(reader(['guest@outside.example'], ['guest@outside.example']));
    t.scope.loadSettings();
    await flush();
    t.box().value = '';
    t.setImpl((url, base) => (base === JU_API
      ? Promise.resolve({ ok: false, error: 'firm_domain_required' })
      : Promise.resolve({ ok: true, allowedEmails: [] })));
    t.save();
    await flush();
    const s = t.sets();
    ok('S5 the money engine is written FIRST', s.length >= 1 && s[0].base === JU_API, s.map((c) => c.base));
    ok('S5 its refusal means GAS is never written', s.filter((c) => c.base === GW).length === 0, s.map((c) => c.base));
    ok('S5 nothing is reported as Saved', t.status() !== 'Saved', t.status());
    ok('S5 the server\'s own reason is shown', t.status() === 'firm_domain_required', t.status());
  }

  // ---- S6: a partial write never says Saved --------------------------------
  {
    const t = build();
    t.setImpl(reader(['guest@outside.example'], ['guest@outside.example']));
    t.scope.loadSettings();
    await flush();
    t.box().value = '';
    t.setImpl((url, base) => {
      if (url.indexOf('setConsoleSettings') >= 0) {
        return base === JU_API
          ? Promise.resolve({ ok: true, allowedEmails: [] })
          : Promise.resolve({ ok: false, error: 'script lock timed out' });
      }
      // the re-read that follows a partial write
      return Promise.resolve({ ok: true, allowedEmails: base === JU_API ? [] : ['guest@outside.example'] });
    });
    t.save();
    await flush();
    ok('S6 HALF-APPLIED ACCESS CONTROL NEVER READS AS SAVED', t.status() !== 'Saved', t.status());
    ok('S6 it names what the failing engine said', t.status() === 'script lock timed out', t.status());
    ok('S6 in danger colour', t.statusColor().indexOf('danger') >= 0, t.statusColor());
    ok('S6 and both engines are re-read so the box stops showing intent', t.gets().length === 4, t.gets().length);
    ok('S6 the re-read finds the split', t.scope.diverged === true);
    ok('S6 the danger line survives the re-read', t.status() === 'script lock timed out', t.status());
  }

  // ---- S7: 'Error' is the no-information fallback, not the whole message ----
  {
    const t = build();
    t.setImpl(reader([], []));
    t.scope.loadSettings();
    await flush();
    t.box().value = 'x@y.example';
    t.setImpl(() => Promise.reject(Object.assign(new Error('boom'), { serverError: 'invalid email(s): x' })));
    t.save();
    await flush();
    ok('S7 a transport failure surfaces what the server said', t.status() === 'invalid email(s): x', t.status());
  }
  {
    const t = build();
    t.setImpl(reader([], []));
    t.scope.loadSettings();
    await flush();
    t.box().value = 'x@y.example';
    t.setImpl(() => Promise.reject(new Error('boom')));
    t.save();
    await flush();
    ok('S7 with genuinely no information, Error remains the fallback', t.status() === 'Error', t.status());
  }

  // ---- the pre-existing wipe guard must still hold -------------------------
  {
    const t = build();
    t.setImpl(() => Promise.resolve({ ok: false, error: 'unauthorized' }));
    t.scope.loadSettings();
    await flush();
    t.box().value = '';
    t.save();
    await flush();
    ok('the allowlist-wipe guard still refuses a blind Save', t.sets().length === 0, t.sets());
  }

  console.log((fail === 0 ? 'PASS' : 'FAIL') + ' allowlist-two-engine: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
