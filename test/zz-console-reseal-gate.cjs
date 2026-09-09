// zz-console-reseal-gate.cjs - which stages offer "Reseal docs", and which do not.
//
// The old gate was `docsExist && !isTerminal` with docsExist as four stage
// literals. It put the button on 3 of 19 stages and HID it on needs_attention,
// which is exactly where a quarantined seal sits (ju-service spine.ts:278
// overwrites currentStage on the quarantine emit). It also rendered on
// 'dispatched', which the server refuses as terminal: a guaranteed silent
// no-op. This file pins the whole matrix so the next edit cannot quietly move
// the button off the stage that needs it.
'use strict';
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(l, c, x) { if (c) { pass++; console.log('ok   ' + l); } else { fail++; console.log('FAIL ' + l + (x === undefined ? '' : ' :: ' + x)); } }

const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');

// Evaluate the real gate expression out of the real file, rather than a copy.
const gateSrc = (html.match(/var resealable=\(([^;]+)\);/) || [])[1];
ok('G0 the gate expression is present in console/index.html', !!gateSrc, gateSrc);

const isAttnSrc = (html.match(/function isAttnStage\(st\)\{return ([^}]+);\}/) || [])[1];
ok('G1 isAttnStage is present', !!isAttnSrc, isAttnSrc);

// eslint-disable-next-line no-new-func
const isAttnStage = new Function('st', 'return ' + isAttnSrc + ';');
// eslint-disable-next-line no-new-func
const resealable = new Function('dstage', 'isAttnStage', 'return (' + gateSrc + ');');

// Every stage the spine can hold. 19 of them.
const ALL = [
  'link_sent', 'opened', 'in_progress', 'submitted', 'preview_rendered', 'signing',
  'all_signed', 'docs_assembled', 'dispatched', 'complete', 'sealed',
  'needs_attention', 'seal_quarantined', 'seal_stuck_retrying',
  'voided', 'void', 'expired', 'abandoned', 'token_revoked',
];
// Terminal per console/index.html's own list; the button is suppressed on these
// regardless, so the gate is only asked about the rest.
const TERMINAL = ['complete', 'sealed', 'voided', 'void', 'expired', 'abandoned', 'token_revoked'];

// The stages where the SERVER can actually act. all_signed and docs_assembled
// are the pre-seal stages; the attention stages are where a quarantine lands
// and where only a scoped call can reach.
const SHOULD_OFFER = ['all_signed', 'docs_assembled', 'needs_attention', 'seal_quarantined', 'seal_stuck_retrying'];

let offered = 0;
for (const st of ALL) {
  const isTerminal = TERMINAL.indexOf(st) >= 0;
  const shows = !isTerminal && resealable(st, isAttnStage);
  const want = SHOULD_OFFER.indexOf(st) >= 0;
  if (shows) offered++;
  ok('G ' + st.padEnd(20) + (want ? 'offers reseal' : 'does not offer reseal'), shows === want,
     'shows=' + shows + ' want=' + want);
}
ok('G2 the button is offered on exactly ' + SHOULD_OFFER.length + ' of ' + ALL.length + ' stages',
   offered === SHOULD_OFFER.length, 'offered=' + offered);

// The two defects that motivated this, asserted by name so a regression reads
// as the original bug rather than as an anonymous count change.
ok('G3 needs_attention offers reseal - a quarantined seal sits here and used to be unreachable',
   resealable('needs_attention', isAttnStage) === true);
ok('G4 dispatched does NOT offer reseal - the server refuses it as terminal, so the button was a silent no-op',
   (TERMINAL.indexOf('dispatched') >= 0 ? false : resealable('dispatched', isAttnStage)) === false);

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
