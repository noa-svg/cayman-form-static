// Deployment-coupling self-test (2026-07-16).
// The GAS /exec deployment id is hardcoded in several files; a partial deploy
// (or a re-deploy that mints a new id) would silently split the client fleet
// across two gateways. This check proves, statically:
//   C1  every script.google.com/macros/s/<id>/exec occurrence across the six
//       served files resolves to ONE distinct deployment id (and each live
//       gateway consumer actually carries it -- sign.html is a redirect stub
//       and is allowed zero occurrences);
//   C1p PILOT EXCEPTION (2026-08-05, Phase 4 pilot flip): israel.html's
//       PRIMARY gateway is ju-api.legacyvpartners.com (ju-service), so it
//       leaves C1's ">=1 /exec" presence assertion and instead gets POSITIVE
//       assertions of its own: exactly one ju-api primary URL, plus exactly
//       one legacy /exec URL (the in-flight-session fallback for sessions
//       minted before the flip) carrying the SAME deployment id the other
//       four pages carry. Drift protection preserved, not weakened: a stray
//       second copy of either URL, a missing fallback, or a diverged id all
//       fail here.
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
// Files that MUST carry the gateway URL (sign.html is a redirect stub: zero is
// correct; israel.html is the Phase 4 pilot page and is asserted separately in
// C1p below, see the header note).
const GATEWAY_REQUIRED = ['index.html', 'signer.html', 'flow.html', 'console/index.html'];
// israel.html's pilot PRIMARY gateway (ju-service behind ju-api).
const PILOT_PRIMARY_URL = 'https://ju-api.legacyvpartners.com';
// Files that MUST bake a filename-prefixed build tag.
const TAGGED = { 'index.html': 'index-', 'israel.html': 'israel-', 'signer.html': 'signer-', 'flow.html': 'flow-', 'console/index.html': 'console-' };

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}

const html = {};
for (const f of FILES) html[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---- C1c: the console's Israel-lane mint seam (2026-08-07) -----------------
// The console gained a SECOND gateway constant (JU_API) so the Israel-lane mint
// can be pointed at ju-service. It is behind a flag defaulting to false, because
// flipping it moves the BIRTH of new Israeli money processes onto a path that
// has not yet carried one end to end.
// These assertions exist so the seam cannot drift silently:
//   - exactly one ju-api URL in the console (a stray second copy is drift)
//   - the flag is still present and still defaults to FALSE, so nobody flips
//     the money front door as a side effect of an unrelated edit. When the gate
//     in the console's own comment is genuinely met, this assertion is the
//     thing you deliberately update, which is the point.
{
  const c = html['console/index.html'];
  const juApiHits = (c.match(/https:\/\/ju-api\.legacyvpartners\.com/g) || []).length;
  ok('C1c console carries exactly one ju-api base', juApiHits === 1, 'found ' + juApiHits);
  ok('C1c console still carries exactly one /exec gateway',
    (c.match(/script\.google\.com\/macros\/s\/[^/]+\/exec/g) || []).length === 1);
  ok('C1c Israel-lane mint flag exists and defaults to FALSE (flipping it is a deliberate money-path cutover)',
    /var ISRAEL_MINT_ON_JU_API\s*=\s*false\s*;/.test(c));
  // ONBOARDING mint only, exactly one call site. The MONEY mint must NOT move:
  // flow.html is hardcoded GAS with no fallback, and the money mint's follow-up
  // ?admin=sendIsraeliInvite carries no base override, so a ju-service-minted
  // money event would be stranded on both counts. If this ever reads 2, someone
  // has wired the money lane in without fixing those.
  ok('C1c exactly ONE mint call site routes through mintBaseForLane_ (onboarding; money stays on GAS)',
    (c.match(/mintBaseForLane_\(state\.lane\)/g) || []).length === 1);
  ok('C1c apiFetch retry carries the base (a retry must not fall back to the other gateway)',
    /apiFetch\(qs, true, base\)/.test(c));
}

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
// ---- C1p: pilot exception, israel.html (2026-08-05 flip) -------------------
// Positive replacement for israel.html's former C1 presence check: the ju-api
// primary constant appears exactly once, and exactly one legacy /exec URL (the
// pre-flip in-flight-session fallback) rides along, same id as the rest of the
// fleet (the id-match leg also feeds the global single-id assertion below,
// since israel.html's occurrence is in allIds).
{
  const primaryCount = html['israel.html'].split(PILOT_PRIMARY_URL).length - 1;
  ok('C1p israel.html carries the ju-api primary URL exactly once', primaryCount === 1,
    'found ' + primaryCount + ' occurrences of ' + PILOT_PRIMARY_URL);
  ok('C1p israel.html carries exactly ONE legacy /exec URL (pre-flip fallback)',
    idsByFile['israel.html'].length === 1, 'found ' + idsByFile['israel.html'].length + ' occurrences');
  ok('C1p israel.html legacy fallback id matches the id the other pages carry',
    idsByFile['israel.html'].length === 1 && idsByFile['index.html'].length >= 1
      && idsByFile['israel.html'][0] === idsByFile['index.html'][0],
    'israel: ' + JSON.stringify(idsByFile['israel.html'].map(id => id.slice(0, 12) + '...'))
      + ' index: ' + JSON.stringify(idsByFile['index.html'].map(id => id.slice(0, 12) + '...')));
}
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
