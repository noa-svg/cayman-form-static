// terminal-vocab-harness.cjs (2026-09-07)
//
// THE CLIENT HALF of the anti-divergence gate for the terminal-stage
// vocabulary. Its twin is legacy-tools-mono's
// apps/ju-service/tests/terminal-stage-vocabulary.test.mjs.
//
// WHAT WAS BROKEN. "Which stages are over" was hand-written in three places
// that disagreed - this file's isTerminalStage (7 stages), ju-service's
// CAYMAN_CONSOLE_TERMINAL (3, and that map WAS the whole ?api=list includeDone
// filter), ju-cayman's CAYMAN_CONSOLE_TERMINAL_ (4) - and three defects fell
// out of it:
//   1. an 'abandoned' row passed the server filter and was dropped here, so a
//      NON-EMPTY list rendered a COMPLETELY EMPTY board (2026-09-06, four real
//      rows);
//   2. the completed / canceled chip counts depended on which engine minted
//      the row;
//   3. renderDrawer re-derived terminality from its OWN literals
//      (complete / voided|void), so an 'expired', 'abandoned' or 'sealed' row
//      still offered VOID - an irreversible action on a row the board had
//      already retired - and the "No actions available" fallback could never
//      fire for it.
//
// Making the copies agree fixes today. THIS FILE is what stops a fourth copy,
// which is the only thing that stops it recurring. Checks:
//   V1  console/index.html declares the vocabulary exactly ONCE, inside the
//       marked block.
//   V2  no stage-terminality test exists anywhere else in the file - not a
//       literal chain, not a second map.
//   V3  the REAL renderDrawer gate reads the shared predicates, and evaluating
//       the REAL extracted source offers Void on exactly the in-flight stages.
//   V4  the block matches ju-service's CAYMAN_BOARD_TERMINAL member for member
//       and bucket for bucket. The mono repo being unreadable is a HARD FAIL,
//       never a silent skip (the console-action-contract A2 lesson: a vacuous
//       contract reads as "covered").
//
// Run: node test/terminal-vocab-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { monoSource } = require('./lib-mono-source.cjs');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); } }
function eqSet(label, a, b) {
  const A = JSON.stringify(a, Object.keys(a).sort());
  const B = JSON.stringify(b, Object.keys(b).sort());
  ok(label, A === B, '\n  got  ' + A + '\n  want ' + B);
}

// ---- V1: exactly one declaration, inside the markers ----------------------
const BEGIN = '// ---- BEGIN BOARD TERMINAL VOCABULARY';
const END = '// ---- END BOARD TERMINAL VOCABULARY';
const bStart = html.indexOf(BEGIN);
ok('V1 vocabulary block present', bStart >= 0);
ok('V1 vocabulary block declared once', bStart >= 0 && html.indexOf(BEGIN, bStart + 1) === -1);
const bEnd = html.indexOf(END, bStart);
ok('V1 vocabulary block closed', bEnd > bStart);
if (bStart < 0 || bEnd < 0) { console.log('\nterminal-vocab-harness: ' + pass + ' pass, ' + fail + ' fail'); process.exit(1); }
const block = html.slice(bStart, bEnd);

const declRe = /var\s+BOARD_TERMINAL_\s*=\s*\{[\s\S]*?\}\s*;/;
const decl = block.match(declRe);
ok('V1 BOARD_TERMINAL_ declared inside the block', !!decl);
ok('V1 BOARD_TERMINAL_ declared nowhere else', (html.match(/var\s+BOARD_TERMINAL_\s*=/g) || []).length === 1);

const sandbox = {};
vm.runInNewContext(decl[0], sandbox);
const CLIENT = sandbox.BOARD_TERMINAL_;
ok('V1 every bucket is completed|canceled', Object.values(CLIENT).every((v) => v === 'completed' || v === 'canceled'), JSON.stringify(CLIENT));

// ---- V2: no second terminality test anywhere in the file ------------------
// Only the three shared predicates may name a terminal stage. Anything else -
// `st==='sealed'`, `dstage==='voided'||dstage==='void'`, a second map - is the
// fourth copy this file exists to catch.
const outside = html.slice(0, bStart) + html.slice(bEnd);
const STAGES = ['complete', 'completed', 'sealed', 'voided', 'void', 'expired', 'abandoned', 'token_revoked'];

// Strip // comments so the file's own prose (which names every stage, on
// purpose) is not mistaken for a predicate.
const code = outside.replace(/^[ \t]*\/\/[^\n]*$/gm, '');

// (a) equality chains: two or more stage comparisons within one expression.
const chainRe = new RegExp("===\\s*'(?:" + STAGES.join('|') + ")'\\s*\\|\\|\\s*[A-Za-z_$][\\w$]*\\s*===\\s*'(?:" + STAGES.join('|') + ")'", 'g');
const chains = code.match(chainRe) || [];
ok('V2 no hand-written terminal-stage chain outside the block', chains.length === 0, JSON.stringify(chains));

// (b) a second MEMBERSHIP map keyed by 3+ stage names. A membership map's
// values are the flags a set uses (1 / true / a bucket word); a map of stage ->
// human label or stage -> colour answers a different question and is fine, as
// long as it does not decide WHICH stages are terminal.
const mapRe = /\{[^{}]{0,400}\}/g;
const maps = (code.match(mapRe) || []).filter((m) => STAGES.filter((s) => new RegExp("(?:^|[\\s{,])['\"]?" + s + "['\"]?\\s*:").test(m)).length >= 3);
const membershipRe = /:\s*(?:1|true|'completed'|'canceled')\s*[,}]/;
const unexpectedMaps = maps.filter((m) => membershipRe.test(m));
ok('V2 no second stage-keyed membership map', unexpectedMaps.length === 0, JSON.stringify(unexpectedMaps).slice(0, 400));

// (c) every retired-row LABEL must name a stage the vocabulary actually
// retires - a label for a stage nobody retires is the 'token_revoked' shape
// coming back through the display layer.
const lblM = html.match(/var\s+RETIRED_LABEL\s*=\s*\{[\s\S]*?\}\s*;/);
ok('V2 RETIRED_LABEL present', !!lblM);
if (lblM) {
  const lctx = {};
  vm.runInNewContext(lblM[0], lctx);
  const orphan = Object.keys(lctx.RETIRED_LABEL).filter((k) => !(k in CLIENT));
  ok('V2 every retired-row label names a board-terminal stage', orphan.length === 0, JSON.stringify(orphan));
}

// (d) the specific regression: renderDrawer must not re-derive terminality.
ok('V2 renderDrawer does not re-derive isTerminal from literals',
  !/var\s+isTerminal\s*=\s*isComplete\s*\|\|\s*isVoided/.test(html));

// ---- V3: the REAL drawer gate, evaluated -----------------------------------
function lineWith(re, label) {
  const m = html.match(re);
  ok('V3 ' + label + ' found in console/index.html', !!m, String(re));
  return m ? m[0] : '';
}
const fnIsTerminal = lineWith(/function isTerminalStage\(st\)\{[^\n]*\}/, 'isTerminalStage');
const fnIsCompleted = lineWith(/function isCompletedStage\(st\)\{[^\n]*\}/, 'isCompletedStage');
const fnIsCanceled = lineWith(/function isCanceledStage\(st\)\{[^\n]*\}/, 'isCanceledStage');
// The whole gate region, verbatim: from the drawer's stage read down to (but
// not including) docsExist. Taking the REGION rather than two named lines
// means a reintroduced helper (the old `var isVoided=...`) is carried into the
// evaluation instead of crashing it, so this harness reports the symptom
// rather than exploding on it.
const gateM = html.match(/var dstage=String\(d\.stage[^\n]*\n[\s\S]*?(?=\n\s*\/\/ Docs exist once)/);
ok('V3 renderDrawer gate region found', !!gateM);
const drawerGate = gateM ? gateM[0] : '';
ok('V3 the gate region defines isTerminal', /var\s+isTerminal\s*=/.test(drawerGate));

// The Void button is emitted under `if(!isTerminal){`; that is the gate under
// test. Assert the real source still shapes it that way before trusting the
// evaluation below.
ok('V3 Void button is gated on !isTerminal',
  /if\(!isTerminal\)\{\s*dactBtns\+='<button class="dvoid" data-act="void">Void<\/button>';/.test(html));
ok('V3 the no-actions fallback is reached when no button renders',
  /dactBtns\s*\?[\s\S]{0,200}No actions available/.test(html));

const ctx = {};
try {
  vm.runInNewContext(decl[0] + '\n' + fnIsTerminal + '\n' + fnIsCompleted + '\n' + fnIsCanceled + '\n' +
    'function drawerOffersVoid(d){var dstage=String(d.stage||"");' + drawerGate.replace(/var dstage=[^\n]*/, '') +
    '\nreturn !isTerminal;}', ctx);
} catch (e) {
  ok('V3 the extracted drawer gate evaluates', false, String(e && e.message));
  ctx.drawerOffersVoid = function () { return true; };
}

// Every stage either engine can emit (domain/spine.ts CAYMAN_CANONICAL_STAGES /
// ju-cayman server/Spine.ts CAYMAN_CANONICAL_STAGES_ - both hard-throw outside
// this list), plus the two legacy spellings an old registry row can carry.
const ALL_STAGES = ['link_sent', 'opened', 'in_progress', 'submitted', 'signing', 'all_signed',
  'docs_assembled', 'dispatched', 'complete', 'needs_attention', 'abandoned', 'voided', 'expired',
  'sealed', 'void'];

const offeredVoidOnRetired = ALL_STAGES.filter((s) => ctx.isTerminalStage(s) && ctx.drawerOffersVoid({ stage: s }));
ok('V3 SYMPTOM 3: Void is never offered on a stage the board has retired', offeredVoidOnRetired.length === 0,
  JSON.stringify(offeredVoidOnRetired));

const refusedVoidOnLive = ALL_STAGES.filter((s) => !ctx.isTerminalStage(s) && !ctx.drawerOffersVoid({ stage: s }));
ok('V3 Void is still offered on every in-flight stage', refusedVoidOnLive.length === 0, JSON.stringify(refusedVoidOnLive));

// token_revoked was in this file's vocabulary for months and no writer on
// either engine could ever produce it: revocation is an attribute of the
// revoked set and its audit trail is a NON-STAGE state-log row (ju-service
// routes/consoledispatch.ts admin==='revoke', ju-cayman
// server/CaymanAuthHardening.ts). ju-cayman's own CaymanStallWatchdog.ts
// dropped its matching entry on 2026-08-05 for exactly this reason.
ok('V3 token_revoked is not in the board vocabulary', !('token_revoked' in CLIENT));

// ---- V4: cross-repo equality with ju-service -------------------------------
const MONO_ROOT = process.env.JU_MONO_ROOT || path.join(os.homedir(), 'Desktop', 'legacy-tools-mono');
const SHARED = 'apps/ju-service/src/domain/consoleShared.ts';
let ts = '';
ts = monoSource(SHARED);
ok('V4 ju-service domain/consoleShared.ts is readable (a vacuous contract is a FAIL, not a skip)', !!ts,
  SHARED + ' - set JU_MONO_ROOT to the mono worktree carrying the paired change');

if (ts) {
  const vocab = ts.match(/CAYMAN_STAGE_VOCABULARY[^=]*=\s*\{([\s\S]*?)\n\};/);
  ok('V4 CAYMAN_STAGE_VOCABULARY found', !!vocab);
  if (vocab) {
    const server = {};
    for (const m of vocab[1].matchAll(/([A-Za-z_][\w]*)\s*:\s*\{[^}]*board:\s*'(completed|canceled)'/g)) server[m[1]] = m[2];
    eqSet('V4 client BOARD_TERMINAL_ === ju-service CAYMAN_BOARD_TERMINAL', CLIENT, server);
  }
}

console.log('terminal-vocab-harness: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
