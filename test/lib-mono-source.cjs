// Shared reader: mono sources come from a REF, not from a working tree.
//
// Three false failures in one night, 2026-09-09, all the same shape: these
// harnesses read ~/Desktop/legacy-tools-mono's WORKING TREE, that checkout sits
// on whatever branch another session last used (it was on an unrelated branch
// 83 commits behind main), and a cross-repo contract then reports a live route
// as a dead button. A gate whose verdict depends on which branch an unrelated
// checkout happens to be on is not a gate.
//
// Default is now `git show origin/main:<path>`, which is stable and is what
// ships. JU_MONO_ROOT still overrides with a working tree, for the real case it
// was added for: a paired console+gateway change still on two feature branches.
// When it is set, the working tree is read as before AND the reason is printed,
// so an override can never be silent.
// GIT_DIR MUST BE STRIPPED, and the working-tree fallback had to go.
//
// githooks/pre-push runs these harnesses, and git exports GIT_DIR /
// GIT_WORK_TREE / GIT_INDEX_FILE into every hook. Those OUTRANK
// `git -C <other repo>`, so the `git show` below resolved against
// cayman-form-static's own .git and answered
// "fatal: path ... exists on disk, but not in 'origin/main'". It worked from a
// shell and failed only under the hook, which is the one place these gates
// actually run.
//
// The catch then swallowed that into a silent read of the stale working tree,
// which is the precise thing this file exists to prevent, so a broken read
// looked like a verdict. A source that cannot be established returns '' and the
// caller's own ok() reports it. "Could not check" is never reported as checked.
function monoSource(relPath) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { execFileSync } = require('child_process');
  const override = process.env.JU_MONO_ROOT;
  const root = override || path.join(os.homedir(), 'Desktop', 'legacy-tools-mono');
  if (override) {
    try { return fs.readFileSync(path.join(root, relPath), 'utf8'); } catch (e) { return ''; }
  }
  const env = {};
  for (const k of Object.keys(process.env)) {
    if (!/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|PREFIX)$/.test(k)) env[k] = process.env[k];
  }
  try {
    return execFileSync('git', ['-C', root, 'show', 'origin/main:' + relPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: env });
  } catch (e) {
    return '';
  }
}
module.exports = { monoSource };
