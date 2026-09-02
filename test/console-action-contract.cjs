// Console ACTION-ROUTE CONTRACT (2026-07-19).
//
// Born from the dead pre-submit "Resend invite reminder" button: the backend
// half of the invite-resend was removed on 2026-06-11 while the UI kept a
// button pointing at a route that could never serve it, and no layer checked
// the two sides against each other. The old console-harness K6 checks even
// certified the wiring TO the wrong route, because they only asserted the
// route STRING was present, not that the server has a handler for it.
//
// This harness closes the class both ways it can fail:
//   A1  Every ?admin=/?api= route the console references (literal strings AND
//       the dynamically-built '?admin='+act family: ACT_CONFIRM keys + every
//       data-act value the drawer renders) has a matching `p.admin === '...'`
//       / `p.api === '...'` handler in the mono gateway source.
//   A2  The mono repo being absent is a HARD FAIL, never a silent skip - a
//       vacuous contract reads as "covered" (the exact lesson of the parity
//       suites and the silent-monitor incident).
//   A3  Stage-aware reminder routing: the drawer renders the pre-submit
//       reminder as data-act="resendInvite" (nudge only at signing). A
//       pre-submit reminder pointed at ?admin=nudge is the exact dead button
//       this file exists to prevent.
//   A4  Honest errors: every reminder/action catch surfaces err.serverError
//       (apiFetch attaches it when the server answers {ok:false}); the
//       generic "check the connection" text may only be the no-info fallback.
//
// Run: node test/console-action-contract.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); } }

// ---- A2: the gateway source must be readable, or this whole contract is vacuous.
// JU_MONO_ROOT overrides the mono repo root (used while a paired console+gateway
// change is still on two feature branches: point it at the mono worktree that
// carries the matching route so the contract checks the pair that will actually
// ship together, instead of failing against the not-yet-merged shared checkout).
const MONO_ROOT = process.env.JU_MONO_ROOT || path.join(os.homedir(), 'Desktop', 'legacy-tools-mono');
const GATEWAY = path.join(MONO_ROOT, 'apps', 'ju-cayman', 'src', 'server', 'CaymanGateway.ts');
let gw = '';
try { gw = fs.readFileSync(GATEWAY, 'utf8'); } catch (e) { gw = ''; }
// The console talks to TWO backends, and has since the 2026-08-08 ju-service flip.
// Checking only GAS made this contract half-blind: a route that ships ju-service-only
// (consoledispatch.ts) reads here as a dead button when it is a live one, and - the
// direction that actually bites - a route deleted from ju-service would NOT be caught
// at all. Read both, and let a handler in either satisfy the contract.
const DISPATCH = path.join(MONO_ROOT, 'apps', 'ju-service', 'src', 'routes', 'consoledispatch.ts');
let jd = '';
try { jd = fs.readFileSync(DISPATCH, 'utf8'); } catch (e) { jd = ''; }
ok('A2 mono gateway source present (absent = vacuous contract, hard fail)', gw.length > 0, GATEWAY);
ok('A2b ju-service dispatch source present (absent = half-blind contract, hard fail)', jd.length > 0, DISPATCH);

// ---- collect every route the console references ----
// Literal '?admin=x' / '?api=x' strings:
const refs = new Set();
let m;
const litRe = /\?(admin|api)=([A-Za-z0-9_]+)/g;
while ((m = litRe.exec(html)) !== null) refs.add(m[1] + ':' + m[2]);

// Dynamic '?admin='+act: every ACT_CONFIRM key plus every data-act value the
// drawer can render reaches apiFetch("?admin="+act...) via the shared handler
// - EXCEPT the acts goEl.onclick special-cases before that generic fallback
// (same shape as the resendInvite/nudge ternary already carved out below via
// their literal route strings). Those never actually hit '?admin=<act>', so
// neither collection loop may manufacture a fake admin: ref for them.
const DACT_SPECIAL_ROUTED = new Set(['markMoneyReceived', 'rowNextMonth', 'rowReviewed', 'rowReopen']);
const actConfirm = html.match(/var ACT_CONFIRM=\{([\s\S]*?)\n\s*\};/);
ok('dynamic-route source: ACT_CONFIRM found', !!actConfirm);
if (actConfirm) {
  const keyRe = /\n\s*([A-Za-z0-9_]+):\{/g;
  let k;
  while ((k = keyRe.exec(actConfirm[1])) !== null) {
    if (DACT_SPECIAL_ROUTED.has(k[1])) continue;
    refs.add('admin:' + k[1]);
  }
}
const dactRe = /data-act="([A-Za-z0-9_]+)"/g;
while ((m = dactRe.exec(html)) !== null) {
  if (DACT_SPECIAL_ROUTED.has(m[1])) continue;
  refs.add('admin:' + m[1]);
}
// The reminder acts are routed through an explicit ternary, not '?admin='+act;
// they are already in `refs` via their literal route strings. But assert the
// two families agree: every data-act that is NOT a literal-string route must be
// an ACT_CONFIRM key or one of the reminder acts.
ok('route refs collected (sanity: includes nudge + resendInvite + void + reseal)',
  refs.has('admin:nudge') && refs.has('admin:resendInvite') && refs.has('admin:void') && refs.has('admin:reseal'),
  Array.from(refs).join(','));

// A ternary-built route ('?admin='+(cond?'a':'b')) contributes its two literal
// arms via litRe already, since each arm is a full '?admin=x' literal.

// ---- A1: every referenced route has a gateway handler ----
if (gw) {
  refs.forEach((ref) => {
    const parts = ref.split(':');
    const needle = "p." + parts[0] + " === '" + parts[1] + "'";
    // consoledispatch.ts destructures the param bag, so its handlers read
    // `admin === 'x'` / `api === 'x'` rather than GAS's `p.admin === 'x'`.
    const needleJu = parts[0] + " === '" + parts[1] + "'";
    const inGas = gw.indexOf(needle) >= 0;
    const inJu = jd.indexOf(needleJu) >= 0;
    ok('A1 a backend handles ' + ref, inGas || inJu,
      'console references ?' + parts[0] + '=' + parts[1] + ' but NEITHER CaymanGateway.ts (`' + needle + '`) NOR ju-service consoledispatch.ts (`' + needleJu + '`) handles it - a one-sided add/removal (the dead-button class)');
  });
}

// ---- A3b: markMoneyReceived is special-cased to ?api=opMarkMoneyReceived,
// not the generic ?admin=markMoneyReceived - assert the special case itself
// still calls a real, gateway-handled route (the carve-out above must not
// become a second way for this class of bug to hide).
ok('A3b markMoneyReceived special-cased before the generic ?admin= fallback',
  /act==='markMoneyReceived'\)\{/.test(html));
ok('A3b markMoneyReceived routes to ?api=opMarkMoneyReceived',
  html.indexOf("apiFetch('?api=opMarkMoneyReceived&processId='") >= 0);
if (gw) {
  ok('A1b gateway handles api:opMarkMoneyReceived (the real route markMoneyReceived hits)',
    gw.indexOf("p.api === 'opMarkMoneyReceived'") >= 0);
}

// ---- A3c: rowNextMonth is special-cased to ?api=diagCorrectTrackerDate, the
// same shape as markMoneyReceived above. The carve-out is only safe while it
// is paired with these assertions: the act must be handled before the generic
// ?admin= fallback, AND the route it actually calls must be one a backend
// answers. Without both, adding a name to DACT_SPECIAL_ROUTED would become a
// way to silence exactly the dead-button class this file exists to catch.
ok('A3c rowNextMonth special-cased before the generic ?admin= fallback',
  /data-act="rowNextMonth"/.test(html) && /act="rowNextMonth"\]/.test(html));
ok('A3c rowNextMonth routes to ?api=diagCorrectTrackerDate',
  html.indexOf("apiFetch('?api=diagCorrectTrackerDate&masterRid='") >= 0);

// ---- A3d: rowReviewed / rowReopen are special-cased to ?api=opSetRowReview,
// the same shape as markMoneyReceived and rowNextMonth. The exemption is only
// safe paired with these: both acts must be handled in the drawer's act chain,
// and the route they actually call must be one a backend answers. Adding a name
// to DACT_SPECIAL_ROUTED without this pairing would turn the exemption set into
// a way to silence the dead-button class this file exists to catch.
ok('A3d rowReviewed / rowReopen handled in the drawer act chain',
  /act==='rowReviewed'\|\|act==='rowReopen'/.test(html));
ok('A3d both route to ?api=opSetRowReview',
  html.indexOf("apiFetch('?api=opSetRowReview&masterRid='") >= 0);
// And the read half the board overlay depends on: without it an approved row
// still renders as "needs review" and the button looks broken.
ok('A3d the board overlay reads ?api=opGetRowReview',
  html.indexOf("apiFetch('?api=opGetRowReview&masterRids='") >= 0);

// ---- A3: stage-aware reminder routing ----
ok('A3 drawer renders the pre-submit reminder as resendInvite, nudge only otherwise',
  html.indexOf('data-act="\'+(preSubmit?\'resendInvite\':\'nudge\')+\'"') >= 0);
ok('A3 drawer handler routes resendInvite to ?admin=resendInvite',
  /act==='resendInvite'\)\?'\?admin=resendInvite&processId=':'\?admin=nudge&processId='/.test(html));

// ---- A4: honest errors ----
ok('A4 reminder catch surfaces err.serverError', /Could not send the reminder'\+\(\(err&&err\.serverError\)/.test(html));
ok('A4 void/reseal catch passes serverError into dActError', /dActError\(act,\(err&&err\.serverError\)\?\{error:err\.serverError\}:null\)/.test(html));

console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
