/**
 * harness-gate-membership.cjs (2026-09-07)
 *
 * THE CLASS THIS PREVENTS: a harness nothing runs.
 *
 * test/api-fetch-nonjson-harness.cjs sat DEAD on main from 2026-08-23 to
 * 2026-09-07 - all 12 of its assertions failing with
 * `ReferenceError: JU_API is not defined`, because it
 * extracted apiFetch into a synthetic scope that never learned about apiFetch's
 * required `base` argument. Nobody noticed, and the reason nobody noticed is
 * structural rather than accidental: the harness was never in githooks/pre-push's
 * HARNESSES list, so the deploy gate did not run it, and a repo with no CI (the
 * gate is the only automated check - most of test/ is deliberately gitignored,
 * see CLAUDE.md) has no other place for it to be seen. It protected the operator
 * console's non-JSON handling - the retry, the auth-page path that ends a dead
 * session, the {ok:false} envelope that must throw rather than paint a false
 * all-clear - and for that whole period nothing verified any of it.
 *
 * Four more tracked harnesses were in the same position when this was written
 * (mint-pick-binding, money-flow-fallback, sign-preview-race, sign-stub). One of
 * them, mint-pick-binding, was ALSO red and had been for a while.
 *
 * PREVENT: every tracked, runnable test/*.cjs must appear in HARNESSES. Adding a
 * harness and forgetting to wire it into the gate now fails the gate itself, at
 * the push that adds it. DETECT: this file.
 *
 * The only exemptions are the shared rig LIBRARIES, which export helpers and
 * assert nothing when run directly. They are listed BY NAME below, with the
 * reason, so an exemption is a deliberate written act rather than an omission -
 * and the exemption is itself checked: a "library" that stops exporting is no
 * longer a library and must join the gate.
 *
 * Run: node test/harness-gate-membership.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('FAIL', label, extra === undefined ? '' : String(extra).slice(0, 400)); }
}

// Shared rigs: required by other harnesses, not runnable on their own.
const LIBRARIES = {
  'rig': 'boots index.html; exports loadForm/makeCfg/isVisible/visiblePages',
  'rig-flow': 'boots flow.html; exports loadFlowForm/makeFlowCfg/tokenUnknownCfg',
  'rig-israel': 'boots israel.html; exports the Israeli-lane loaders',
  'rig-signer': 'boots signer.html; exports loadSignerPage/makeSignerCtx',
};

// TRACKED files only. An untracked harness is invisible on a fresh clone
// (test/* is gitignored with a by-name allowlist), so the gate could not run it
// there even if it were listed - which is a different bug, and coupling-check
// already guards the .gitignore allowlist side of it.
//
// Read from the INDEX (ls-files), not from HEAD: pre-push runs after the commit
// so the two agree at gate time, but ls-files also sees a harness staged in the
// very commit that adds it. With ls-tree HEAD, wiring a new harness into the
// gate correctly - file, .gitignore line and HARNESSES entry in one commit -
// would fail this check until a SECOND commit, which teaches the next author
// that the check is noise.
const tracked = execFileSync('git', ['ls-files', 'test/'], { cwd: repo, encoding: 'utf8' })
  .split('\n').filter((l) => l.endsWith('.cjs'))
  .map((l) => path.basename(l, '.cjs')).sort();
ok('the tracked harness list is non-empty (git read worked)', tracked.length > 10, tracked.length);

const prePush = fs.readFileSync(path.join(repo, 'githooks', 'pre-push'), 'utf8');
const block = prePush.match(/\nHARNESSES=\(\n([\s\S]*?)\n\)\n/);
ok('githooks/pre-push still declares a HARNESSES=( ... ) list', !!block);
if (!block) { console.log(`${pass} pass, ${fail} fail`); process.exit(1); }
const listed = block[1].split('\n').map((l) => l.trim()).filter(Boolean);

ok('no harness is listed in the gate twice', new Set(listed).size === listed.length,
  listed.filter((n, i) => listed.indexOf(n) !== i).join(', '));

// Every listed name must actually exist, or the gate refuses to push at all
// (node exits non-zero on a missing file and the runner marks it failed).
const missingFile = listed.filter((n) => !tracked.includes(n));
ok('every name in the gate is a tracked harness that exists', missingFile.length === 0, missingFile.join(', '));

// THE MAIN ASSERTION: nothing tracked and runnable is left out.
const orphans = tracked.filter((n) => !listed.includes(n) && !Object.prototype.hasOwnProperty.call(LIBRARIES, n));
ok('every tracked, runnable harness is in the deploy gate', orphans.length === 0,
  'not in HARNESSES: ' + orphans.join(', '));

// An exemption has to keep being true. A rig that no longer exports helpers is
// a harness in hiding, and would slip through the check above forever.
Object.keys(LIBRARIES).forEach((lib) => {
  const p = path.join(repo, 'test', lib + '.cjs');
  const exists = fs.existsSync(p);
  ok('exempt library ' + lib + ' still exists', exists);
  if (exists) {
    ok('exempt library ' + lib + ' is still a library (exports helpers, asserts nothing)',
      /module\.exports\s*=/.test(fs.readFileSync(p, 'utf8')), LIBRARIES[lib]);
  }
});

// And the exemption list may not quietly grow to cover a real harness.
const staleExemptions = Object.keys(LIBRARIES).filter((n) => listed.includes(n));
ok('no exempt library is ALSO listed in the gate (one story per harness)',
  staleExemptions.length === 0, staleExemptions.join(', '));

console.log(`${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
