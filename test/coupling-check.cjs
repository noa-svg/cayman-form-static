// Deployment-coupling self-test (2026-07-16).
// The GAS /exec deployment id is hardcoded in several files; a partial deploy
// (or a re-deploy that mints a new id) would silently split the client fleet
// across two gateways. This check proves, statically:
//   C1  every script.google.com/macros/s/<id>/exec occurrence across the six
//       served files resolves to ONE distinct deployment id (and each live
//       gateway consumer actually carries it -- sign.html is a redirect stub
//       and is allowed zero occurrences);
//   C1p ju-api-ONLY pages, israel.html + index.html (2026-08-05/19 flip;
//       LEGACY FALLBACK REMOVED 2026-09-06). Both lanes' ONBOARDING invites
//       mint on ju-service exclusively, and ju-cayman (GAS) is permanently
//       retired and Drive-trashed - a stale pre-flip token has no live
//       session to recover on either engine, so probing GAS for one only
//       risked routing a real LP onto a dead backend (the actual bug this
//       removal fixes: a pre-2026-08-05 link falling back to GAS and then
//       silently stranding, since every GAS-side recovery trigger is also
//       permanently suspended - see DECISIONS-PARKED.md 2026-09-06). Both
//       pages leave C1's ">=1 /exec" presence assertion and instead assert
//       ju-api primary exactly once and ZERO /exec occurrences.
//       flow.html and signer.html are NOT included in this removal, but the
//       REASON changed on 2026-09-07 and is corrected here rather than left
//       stating the opposite of the console. This used to read "Cayman
//       (non-Israel) money still mints on GAS today by design
//       (moneyMintBaseForLane_ is isIsrael-gated), so their GAS gateway is a
//       live primary". It is not: CAYMAN_MONEY_MINT_ON_JU_API moved every
//       Cayman money mint to ju-service, so on both pages the GAS gateway is
//       now a legacy FALLBACK, exactly as it is on index/israel.
//       It stays anyway, and that is the load-bearing part: unlike the two
//       onboarding pages, these two still carry live GAS-minted sessions from
//       before the flip, and flow.html's fallback is sticky per session and
//       engaged only on an unknown token, never on a bare 5xx. Removing it
//       would strand those. Retire it when no GAS-minted money session can
//       still be resumed, not on the mint flip. C1f/C1s below are unchanged.
//   C1j CONSOLE SEAM EXCEPTION (2026-08-07, Israeli-onboarding mint reroute):
//       console/index.html carries the ju-api base (GW_JU) exactly once, ON
//       TOP OF its unchanged C1 obligations (it still carries the one GAS
//       /exec id for everything that is not an Israel-lane onboarding mint).
//       This is a deliberate carve-out, not a weakening: the GAS id must
//       still be consistent fleet-wide INCLUDING the console, AND the ju-api
//       base must be the exact expected constant - a second copy of either
//       URL, a typo'd ju-api host, or the seam vanishing all fail here.
//   C1f MONEY-FLOW WIRING (2026-08-08, agent/money-flow-juapi): flow.html
//       gets the SAME dual-gateway shape as C1p (ju-api primary + legacy
//       /exec fallback), proving the wiring exists - not that it is live
//       (console/index.html's MONEY_MINT_ON_JU_API stays false).
//   C1m MONEY-FLOW MINT SEAM (2026-08-08): console/index.html's money mint
//       gets its own flag (MONEY_MINT_ON_JU_API, default false) and its own
//       dispatcher (moneyMintBaseForLane_), independently reversible from
//       the onboarding seam (C1c); sendIsraeliInvite always threads the same
//       base the mint used. EXTENDED 2026-09-07: the Cayman money lane gets
//       its OWN second flag (CAYMAN_MONEY_MINT_ON_JU_API) inside that same
//       dispatcher, so the two money lanes are independently reversible from
//       each other too. The lane -> base MAP itself is pinned separately, by
//       test/money-mint-lane-routing.cjs: C1m proves the parts are present
//       and wired, that harness proves they resolve to the right engine.
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
// correct; israel.html, index.html and signer.html are ju-api-only pages,
// asserted separately in C1p/C1s below, see the header notes; flow.html
// keeps exactly one /exec occurrence for its ?mock= dev-tool constant only).
const GATEWAY_REQUIRED = ['flow.html', 'console/index.html'];
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
  // FLIPPED 2026-08-08: the console's own comment above the flag names the
  // exact proof (pid proof-38e8a6c9-10e0-4f93-8f14-f71f4eb97de6, live-verified
  // lane/flowType/serverBuild on ju-service, and the same token resolving
  // empty on GAS). Matched on the pid, not the route's api name - the
  // comment deliberately never spells "?api=<name>" as literal text, since
  // that pattern gets scanned by console-action-contract.cjs as a real
  // client-vs-GAS-dispatcher button reference, and this route is
  // ju-service-only by design (a false "dead button" positive otherwise).
  // This assertion requires the flag AND its proof citation together - so a
  // bare flip with no proof comment still fails the gate, and reverting the
  // flip without also removing the (now-stale) proof comment fails it too.
  ok('C1c Israel-lane mint flag is true AND carries its live-proof citation (a bare flip with no cited proof fails; a stale proof comment after reverting also fails)',
    /var ISRAEL_MINT_ON_JU_API\s*=\s*true\s*;/.test(c)
      && /FLIPPED TRUE 2026-08-08 after the gate above cleared:[\s\S]{0,40}proof-38e8a6c9-10e0-4f93-8f14-f71f4eb97de6[\s\S]{0,40}minted end to end on[\s\S]{0,20}ju-service/.test(c));
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
// ---- C1p: ju-api-only pages, israel.html + index.html (legacy fallback removed 2026-09-06) ----
// Positive replacement for their former C1 presence check: the ju-api primary
// constant appears exactly once, and NO /exec URL rides along any more - GAS
// is permanently retired, so there is no live session for a fallback to ever
// recover.
for (const f of ['israel.html', 'index.html']) {
  const primaryCount = html[f].split(PILOT_PRIMARY_URL).length - 1;
  ok('C1p ' + f + ' carries the ju-api primary URL exactly once', primaryCount === 1,
    'found ' + primaryCount + ' occurrences of ' + PILOT_PRIMARY_URL);
  ok('C1p ' + f + ' carries ZERO /exec URLs (no legacy fallback)',
    idsByFile[f].length === 0, 'found ' + idsByFile[f].length + ' occurrences');
  ok('C1p ' + f + ' carries no leftover legacy-gateway plumbing',
    !/LEGACY_GATEWAY|useLegacyGateway|activeGatewayUrl_|probeLegacyGateway_|cfgTokenUnknown_|stickToLegacyGateway_/.test(html[f]));
}
// ---- C1j: console per-lane gateway seam (2026-08-07/08 Israeli mint reroute) --
// The console's Israeli-onboarding mint CAN be born on ju-service, flag-gated
// (ISRAEL_MINT_ON_JU_API in console/index.html, default false until the live
// smoke proves a ju-service-minted process end to end); every other console
// action still rides the GAS /exec gateway, whose C1 assertions above remain
// fully in force for this file. Assert the ju-api base is the EXACT expected
// constant and appears exactly once (the single JU_API definition), and that
// the flag + its dispatcher (mintBaseForLane_) are present - drift protection
// for the seam itself, not for one particular implementation shape of it.
{
  const juCount = html['console/index.html'].split(PILOT_PRIMARY_URL).length - 1;
  ok('C1j console/index.html carries the ju-api base constant exactly once', juCount === 1,
    'found ' + juCount + ' occurrences of ' + PILOT_PRIMARY_URL);
  ok('C1j console seam is the flag-gated mintBaseForLane_ dispatcher (explicit lane split, greppable)',
    html['console/index.html'].indexOf('function mintBaseForLane_(') !== -1
      && html['console/index.html'].indexOf('ISRAEL_MINT_ON_JU_API') !== -1
      && html['console/index.html'].indexOf("var JU_API = '" + PILOT_PRIMARY_URL + "'") !== -1);
  ok('C1j console still carries the GAS /exec gateway for everything else (C1 not weakened)',
    idsByFile['console/index.html'].length >= 1);
}
// ---- C1f: flow.html, ju-api ONLY for real traffic (legacy fallback removed
// 2026-09-12, ju-cayman retirement gate 3 item 6, Noa's explicit go) --------
// Was the MONEY-FLOW dual-gateway seam (2026-08-08). Removed without a live
// TTL confirmation that zero pre-flip money-flow tokens remain (parked, see
// DECISIONS-PARKED.md). ONE /exec occurrence deliberately remains: the
// render-verify (?mock=) local dev/design tool, which never hits the network
// for config and stays pinned to GAS on purpose (unchanged by this removal).
{
  const juCount = html['flow.html'].split(PILOT_PRIMARY_URL).length - 1;
  ok('C1f flow.html carries the ju-api primary URL exactly once', juCount === 1,
    'found ' + juCount + ' occurrences of ' + PILOT_PRIMARY_URL);
  ok('C1f flow.html carries exactly ONE legacy /exec URL (the ?mock= dev-tool constant, not a production fallback)',
    idsByFile['flow.html'].length === 1, 'found ' + idsByFile['flow.html'].length + ' occurrences');
  ok('C1f flow.html legacy id matches the id the other pages carry',
    idsByFile['flow.html'].length === 1 && idsByFile['console/index.html'].length >= 1
      && idsByFile['flow.html'][0] === idsByFile['console/index.html'][0]);
  ok('C1f flow.html carries no leftover PRODUCTION fallback plumbing',
    !/useLegacyGateway|activeGatewayUrl_|probeLegacyGateway_|cfgTokenUnknown_|stickToLegacyGateway_|flStickKey/.test(html['flow.html']));
  ok('C1f render-verify (?mock=) stays pinned to GAS; every other load is the bare ju-api primary',
    html['flow.html'].indexOf("GW = qs.get('mock') ? LEGACY_GATEWAY : JU_API;") !== -1);
}
// ---- C1s: signer.html, ju-api ONLY (legacy fallback removed 2026-09-12) ---
// Was the SIGNER dual-gateway seam (2026-08-17), added after a real LP was
// blocked by a GAS/ju-service token mismatch. Removed as ju-cayman
// retirement gate 3 item 6 (Noa's explicit go, accepted without a live TTL
// confirmation that zero pre-flip tokens remain - see DECISIONS-PARKED.md).
// Positive replacement for the former presence check, same shape as C1p.
{
  const juCount = html['signer.html'].split(PILOT_PRIMARY_URL).length - 1;
  ok('C1s signer.html carries the ju-api primary URL exactly once', juCount === 1,
    'found ' + juCount + ' occurrences of ' + PILOT_PRIMARY_URL);
  ok('C1s signer.html carries ZERO /exec URLs (no legacy fallback)',
    idsByFile['signer.html'].length === 0, 'found ' + idsByFile['signer.html'].length + ' occurrences');
  ok('C1s signer.html carries no leftover legacy-gateway plumbing',
    !/LEGACY_GATEWAY|useLegacyGateway|probeLegacySigner_|signerStickKey/.test(html['signer.html']));
  ok('C1s signer.html\'s GW is the bare ju-api primary, unconditionally',
    html['signer.html'].indexOf('var GW = JU_API;') !== -1);
}
// ---- C1m: console's MONEY-FLOW mint seam (2026-08-08, agent/money-flow-juapi) ----
// The sibling of C1c, for increase/withdrawal. Deliberately checked as its OWN
// flag+dispatcher, never sharing ISRAEL_MINT_ON_JU_API / mintBaseForLane_: the
// two lanes must stay independently reversible. No new ju-api URL is expected
// here (moneyMintBaseForLane_ reuses the console's single JU_API constant,
// already asserted exactly-once by C1j above).
{
  const c = html['console/index.html'];
  // FLIPPED 2026-08-09: same requirement as C1c above (flag AND its proof
  // citation together, so a bare flip or a stale comment after a revert both
  // fail). Proof pid proof-e2683ad8-e517-4451-a273-fa7c06bd1c79 (flow=increase)
  // walked mint through seal to a terminal `complete` stage on ju-service.
  ok('C1m MONEY_MINT_ON_JU_API is true AND carries its live-proof citation (a bare flip with no cited proof fails; a stale proof comment after reverting also fails)',
    /var MONEY_MINT_ON_JU_API\s*=\s*true\s*;/.test(c)
      && /FLIPPED TRUE 2026-08-09 after the gate above cleared:[\s\S]{0,600}proof-e2683ad8-e517-4451-a273-fa7c06bd1c79[\s\S]{0,120}terminal `complete` stage on ju-service/.test(c));
  ok('C1m console carries its own moneyMintBaseForLane_ dispatcher (not a reuse of mintBaseForLane_)',
    c.indexOf('function moneyMintBaseForLane_(') !== -1);
  // 2026-09-07. Same shape as the Israel-lane assertion above: the flag AND
  // the citation of what closed its gate, so a bare flip fails and a stale
  // justification left behind after a revert fails too. The two layers named
  // are initiateCaymanMoneyFlow.ts's own stated blockers.
  ok('C1m CAYMAN_MONEY_MINT_ON_JU_API is true AND cites the two layers that closed (a bare flip with no cited proof fails; a stale citation after reverting also fails)',
    /var CAYMAN_MONEY_MINT_ON_JU_API\s*=\s*true\s*;/.test(c)
      && /LAYER 2[\s\S]{0,400}flow-cayman-lane-harness\.cjs[\s\S]{0,400}LAYER 3[\s\S]{0,400}Approved by Noa 2026-09-04/.test(c));
  ok('C1m the Cayman money flag is a SEPARATE flag, not a reuse of the Israel one (the two money lanes stay independently reversible)',
    /var MONEY_MINT_ON_JU_API\s*=\s*true\s*;/.test(c)
      && /var CAYMAN_MONEY_MINT_ON_JU_API\s*=\s*true\s*;/.test(c)
      && /if \(isIsrael\) return MONEY_MINT_ON_JU_API \? JU_API : GW;\s*\n\s*return CAYMAN_MONEY_MINT_ON_JU_API \? JU_API : GW;/.test(c));
  // A Cayman money invite composed by a ju-service older than 6713d010 quotes
  // the ISRAELI receiving account (867519) to a Cayman LP. The console cannot
  // enforce the other repo's deploy order, so the constraint is at least kept
  // legible at the flag rather than living only in a merged commit message.
  ok('C1m the Cayman money flag states its ju-service deploy-order constraint (6713d010)',
    c.indexOf('6713d010') !== -1);
  ok('C1m the money mint call site routes through moneyMintBaseForLane_, exactly once',
    (c.match(/moneyMintBaseForLane_\(state\.lane\)/g) || []).length === 1);
  ok('C1m auto-send invite after a money mint threads moneyBase_ (never a bare GW default)',
    c.indexOf("apiFetch('?admin=sendIsraeliInvite&process='+encodeURIComponent(processId), false, moneyBase_)") !== -1);
  ok('C1m manual resend threads the pid-bound data-base (never re-derived from current state.lane)',
    c.indexOf("apiFetch('?admin=sendIsraeliInvite&process='+encodeURIComponent(pid), false, base)") !== -1
      && c.indexOf("var base=b.getAttribute('data-base')||GW;") !== -1);
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
