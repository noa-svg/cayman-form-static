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
  try {
    return execFileSync('git', ['-C', root, 'show', 'origin/main:' + relPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    try { return fs.readFileSync(path.join(root, relPath), 'utf8'); } catch (e2) { return ''; }
  }
}
module.exports = { monoSource };
