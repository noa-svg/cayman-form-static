// Deployment-coupling self-test (2026-07-16).
// The GAS /exec deployment id is hardcoded in several files; a partial deploy
// (or a re-deploy that mints a new id) would silently split the client fleet
// across two gateways. This check proves, statically:
//   C1  every script.google.com/macros/s/<id>/exec occurrence across the six
//       served files resolves to ONE distinct deployment id (and each live
//       gateway consumer actually carries it -- sign.html is a redirect stub
//       and is allowed zero occurrences);
//   C2  index/israel/signer/flow each bake window.__BUILD_TAG exactly once,
//       the tag prefix matches the file name, and every tag is unique;
//   C3  console/index.html carries a build tag too (console- prefix,
//       observability only, no stale-tab guard by design).
// Run: node test/coupling-check.cjs
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = ['index.html', 'israel.html', 'signer.html', 'flow.html', 'console/index.html', 'sign.html'];
// Files that MUST carry the gateway URL (sign.html is a redirect stub: zero is correct).
const GATEWAY_REQUIRED = ['index.html', 'israel.html', 'signer.html', 'flow.html', 'console/index.html'];
// Files that MUST bake a filename-prefixed build tag.
const TAGGED = { 'index.html': 'index-', 'israel.html': 'israel-', 'signer.html': 'signer-', 'flow.html': 'flow-', 'console/index.html': 'console-' };

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}

const html = {};
for (const f of FILES) html[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---- C1: single deployment id across the fleet -----------------------------
const EXEC_RE = /script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec/g;
const idsByFile = {};
const allIds = new Set();
for (const f of FILES) {
  idsByFile[f] = [];
  let m;
  EXEC_RE.lastIndex = 0;
  while ((m = EXEC_RE.exec(html[f])) !== null) { idsByFile[f].push(m[1]); allIds.add(m[1]); }
}
for (const f of GATEWAY_REQUIRED) {
  ok('C1 ' + f + ' carries the gateway /exec URL', idsByFile[f].length >= 1, 'found ' + idsByFile[f].length + ' occurrences');
}
ok('C1 at least one /exec occurrence in the fleet', allIds.size >= 1);
ok('C1 exactly ONE distinct deployment id across all files', allIds.size === 1,
  'distinct ids: ' + JSON.stringify([...allIds].map(id => id.slice(0, 12) + '...')) + ' per-file counts: ' +
  JSON.stringify(Object.fromEntries(FILES.map(f => [f, idsByFile[f].length]))));

// ---- C2 + C3: build tags ----------------------------------------------------
// Plain-string form only; the stale-guard's own extraction regex literal inside
// the files spells it with a backslash (window\.__BUILD_TAG) so it cannot match here.
const TAG_RE = /window\.__BUILD_TAG = '([^']+)'/g;
const tags = {};
for (const f of Object.keys(TAGGED)) {
  const found = [];
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html[f])) !== null) found.push(m[1]);
  const label = (f === 'console/index.html' ? 'C3 ' : 'C2 ') + f;
  ok(label + ' bakes window.__BUILD_TAG exactly once', found.length === 1, 'found ' + JSON.stringify(found));
  if (found.length !== 1) continue;
  tags[f] = found[0];
  ok(label + ' tag prefix matches file name (' + TAGGED[f] + ')', found[0].indexOf(TAGGED[f]) === 0, 'tag: ' + found[0]);
}
const tagVals = Object.values(tags);
ok('C2 every build tag is unique to its file', new Set(tagVals).size === tagVals.length, JSON.stringify(tags));

// ---- C4: shared modules stay deployment-id-free and are wired ----------------
// lvp-gateway.js (Batch D) carries the gateway TRANSPORT only; the /exec URL is
// passed in from each form so the single-deployment-id assertion above keeps
// operating on the forms alone. If an id ever creeps into a shared module, a
// partial deploy could silently split the fleet again.
for (const mfile of ['lvp-gateway.js', 'validation-rules.js']) {
  const src = fs.readFileSync(path.join(ROOT, mfile), 'utf8');
  EXEC_RE.lastIndex = 0;
  ok('C4 ' + mfile + ' carries NO /exec deployment id', !EXEC_RE.test(src));
}
// Every gateway consumer form loads the shared transport BEFORE its app script
// (the tag stamp is inside the first app script, so tag position is the bound).
for (const f of ['index.html', 'israel.html', 'flow.html']) {
  const at = html[f].indexOf('<script src="lvp-gateway.js"></script>');
  const tagAt = html[f].indexOf('window.__BUILD_TAG =');
  ok('C4 ' + f + ' loads lvp-gateway.js before the app script', at !== -1 && tagAt !== -1 && at < tagAt,
    'scriptTag@' + at + ' buildTag@' + tagAt);
}

// ---- summary ----------------------------------------------------------------
console.log('\n' + (fail ? 'COUPLING CHECK FAILED: ' : 'COUPLING CHECK PASSED: ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
