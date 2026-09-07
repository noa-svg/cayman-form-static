// money-mint-lane-routing.cjs (2026-09-07).
//
// PINS THE LANE -> BASE MAP for the console's money mint. The dispatcher was
// isIsrael-gated, so "Transfer to Cayman" - and every other Cayman money
// event - dispatched to GW, i.e. to ju-cayman (GAS), which is permanently
// retired and Drive-trashed and refuses the mint. The flow it could not start
// had a complete engine on ju-service since 2026-08-30.
//
// WHY A PIN AND NOT JUST A FLAG CHECK. coupling-check.cjs's C1m already
// asserts the flags are present and that exactly one call site routes through
// this dispatcher. Neither of those catches the actual defect class here,
// which is the dispatcher AGREEING with its flags and still sending a lane to
// the wrong engine. This runs the real function, extracted from the real file,
// over every lane value the console can hand it.
//
// The function is scoped inside console/index.html's app IIFE and is not on
// window, so it is extracted by source and evaluated with the same two base
// constants the file defines. That is deliberate: it keeps the test honest
// about the SHIPPED text rather than a hand-copied model of it, and the
// extraction failing is itself a failure (see the guards below).
//
// Run: node test/money-mint-lane-routing.cjs
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}

const file = path.join(__dirname, '..', 'console', 'index.html');
const src = fs.readFileSync(file, 'utf8');

// ---- Extract the two base constants and the dispatcher from the real file --
const JU_API_M = src.match(/var JU_API\s*=\s*'([^']+)'/);
const GW_M = src.match(/var GW\s*=\s*'([^']+)'/);
ok('console defines JU_API', !!JU_API_M);
ok('console defines GW', !!GW_M);

const FN_M = src.match(/function moneyMintBaseForLane_\(lane\)\s*\{[\s\S]*?\n  \}/);
ok('the money dispatcher is present and extractable', !!FN_M);

const FLAG_IL = src.match(/var MONEY_MINT_ON_JU_API\s*=\s*(true|false)\s*;/);
const FLAG_KY = src.match(/var CAYMAN_MONEY_MINT_ON_JU_API\s*=\s*(true|false)\s*;/);
ok('the Israel-lane money flag is present', !!FLAG_IL);
ok('the Cayman-lane money flag is present and SEPARATE (never a reuse of the Israel one)',
  !!FLAG_KY && FLAG_KY.index !== (FLAG_IL && FLAG_IL.index));

if (!JU_API_M || !GW_M || !FN_M || !FLAG_IL || !FLAG_KY) {
  console.log('\nMONEY MINT LANE ROUTING FAILED: could not extract the dispatcher or its inputs.');
  process.exit(1);
}

const JU_API = JU_API_M[1];
const GW = GW_M[1];
const moneyMintBaseForLane_ = new Function(
  'JU_API', 'GW', 'MONEY_MINT_ON_JU_API', 'CAYMAN_MONEY_MINT_ON_JU_API',
  FN_M[0] + '\n return moneyMintBaseForLane_;'
)(JU_API, GW, FLAG_IL[1] === 'true', FLAG_KY[1] === 'true');

// ---- THE MAP ---------------------------------------------------------------
// The three cases named in the brief, plus the exact strings the console can
// actually produce. state.lane is written by the fund switch ('israel' /
// 'cayman', persisted in localStorage) and read back from it, so a stale or
// absent localStorage value is a real source of '' here.
ok('israeli lane mints on ju-service', moneyMintBaseForLane_('israel') === JU_API,
  moneyMintBaseForLane_('israel'));
ok("the engine-canonical spelling 'israeli' routes identically to the UI's 'israel'",
  moneyMintBaseForLane_('israeli') === JU_API, moneyMintBaseForLane_('israeli'));
ok('cayman lane mints on ju-service (THE FIX: this returned the retired GAS engine)',
  moneyMintBaseForLane_('cayman') === JU_API, moneyMintBaseForLane_('cayman'));
ok('an unknown lane mints on ju-service, never on the retired GAS engine',
  moneyMintBaseForLane_('atlantis') === JU_API, moneyMintBaseForLane_('atlantis'));

// Empty / absent lane is the unknown case the console can genuinely reach.
ok('an empty lane routes like unknown, not to GAS', moneyMintBaseForLane_('') === JU_API,
  moneyMintBaseForLane_(''));
ok('an undefined lane routes like unknown, not to GAS',
  moneyMintBaseForLane_(undefined) === JU_API, moneyMintBaseForLane_(undefined));
ok('a null lane routes like unknown, not to GAS', moneyMintBaseForLane_(null) === JU_API,
  moneyMintBaseForLane_(null));

// Case-insensitivity is what the isIsrael test provides; pin it so a future
// rewrite cannot quietly drop the toLowerCase and send 'Israel' to the Cayman
// branch (harmless today, a real split the moment either flag differs).
ok("'Israel' (capitalised) is still the Israel lane",
  moneyMintBaseForLane_('Israel') === JU_API, moneyMintBaseForLane_('Israel'));

// ---- THE INVARIANT ---------------------------------------------------------
// The mint and its invite must land on the SAME engine. The create path
// resolves the base ONCE and threads that value into both calls; re-deriving
// it per call is exactly how a mid-session flag flip would split them across
// engines. C1m asserts the call-site strings; this asserts the shape that
// makes them safe - a single resolution point, and a resend bound to the
// process's own recorded engine rather than to the current state.lane.
ok('the money base is resolved exactly once per create',
  (src.match(/var moneyBase_=moneyMintBaseForLane_\(state\.lane\)/g) || []).length === 1);
ok('the mint call takes that resolved base',
  /admin=mintLink[\s\S]{0,400}?, false, moneyBase_\)/.test(src));
ok('the auto-send invite takes the SAME resolved base, never a bare GW',
  src.indexOf("apiFetch('?admin=sendIsraeliInvite&process='+encodeURIComponent(processId), false, moneyBase_)") !== -1);
ok('a later manual resend uses the engine recorded on the process, not the live lane',
  src.indexOf("_sb.setAttribute('data-base',moneyBase_)") !== -1
    && src.indexOf("var base=b.getAttribute('data-base')||GW;") !== -1);

// ---- THE DEPLOY-ORDER NOTE -------------------------------------------------
// A Cayman money invite composed by a ju-service older than 6713d010 quotes
// the ISRAELI receiving account. The comment carrying that constraint is the
// only thing standing between the next reader and re-learning it from an LP,
// so it is asserted rather than trusted to survive edits.
ok('the Cayman money flag carries its ju-service deploy-order constraint',
  /must not go live before ju-service serves\s*\n\s*\/\/ 6713d010 or later/.test(src),
  'the 6713d010 ordering note is missing from console/index.html');

console.log('');
if (fail) {
  console.log('MONEY MINT LANE ROUTING FAILED: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}
console.log('MONEY MINT LANE ROUTING PASSED: ' + pass + ' passed, 0 failed');
