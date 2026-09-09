/**
 * harness-gate-membership.cjs (2026-09-07)
 *
 * THE CLASS THIS PREVENTS: a harness nothing runs.
 *
 * test/api-fetch-nonjson-harness.cjs was dead from 2026-08-23 to 2026-09-07,
 * all 12 assertions failing on `ReferenceError: JU_API is not defined`. Nobody
 * noticed for a structural reason: it was never in githooks/pre-push's
 * HARNESSES list, and with no CI the gate is the only place a harness is seen.
 * Five more tracked harnesses were in the same position, one of them also red.
 *
 * PREVENT: every tracked, runnable test/*.cjs must appear in HARNESSES, so
 * forgetting to wire one in fails the gate at the push that adds it.
 * DETECT: this file.
 *
 * The only exemptions are the rig LIBRARIES, listed by name below with their
 * reason so an exemption is a written act rather than an omission. Each is
 * re-checked: a "library" that stops exporting must join the gate.
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
  'lib-mono-source': 'reads a mono source from git show origin/main:<path>; exports monoSource',
};

// TRACKED files only: an untracked harness is invisible on a fresh clone, and
// coupling-check already guards the .gitignore allowlist side of that.
//
// Read the INDEX, not HEAD. They agree at gate time, but ls-files also sees a
// harness staged in the commit that adds it. With ls-tree HEAD, wiring one in
// correctly (file + .gitignore + HARNESSES in one commit) would fail until a
// SECOND commit, teaching the next author that the check is noise.
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

// A listed name that does not exist makes the gate refuse every push.
const missingFile = listed.filter((n) => !tracked.includes(n));
ok('every name in the gate is a tracked harness that exists', missingFile.length === 0, missingFile.join(', '));

// THE MAIN ASSERTION: nothing tracked and runnable is left out.
const orphans = tracked.filter((n) => !listed.includes(n) && !Object.prototype.hasOwnProperty.call(LIBRARIES, n));
ok('every tracked, runnable harness is in the deploy gate', orphans.length === 0,
  'not in HARNESSES: ' + orphans.join(', '));

// An exemption has to keep being true: a rig that stops exporting is a harness
// in hiding, and would slip through the check above forever.
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
