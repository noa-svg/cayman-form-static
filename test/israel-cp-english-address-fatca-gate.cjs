// israel-cp-english-address-fatca-gate.cjs - the controlling-person half of the
// English-address contract.
//
// THE ORIGINAL DEFECT (2026-09-05). The English-address fallback's reveal/block
// scan matched every `*.englishDetails.englishAddress.street` input by name
// suffix alone, with no read of the entity's FATCA status. The server
// (apps/ju-service/src/domain/israeli/validate.ts, `cpNeedsEnglish`) only
// requires a controlling person's englishAddress when the entity self-certifies
// Passive NFFE. So an Active-NFFE CP whose geocode came back empty was
// force-revealed and blocked on a field the server would have accepted blank:
// a phantom required field, in the opposite direction. The fix at the time was
// to duplicate `cpNeedsEnglish` client-side, at both scan sites.
//
// WHAT THIS FILE LOCKS NOW (2026-09-06). The duplicated predicate is gone,
// because BOTH client-side scans are gone. The client no longer forms an
// opinion about which holders the server will require an English address from,
// which is a stronger fix than getting that opinion right: a predicate copied
// into a second codebase can drift from its original, and this one already did
// once. What blocks an LP is a refusal the server ACTUALLY issued, replayed
// onto the exact field the server named (focusServerValidation_), so an
// Active-NFFE CP is never stopped for the simple reason that the server never
// names them.
//
// STATIC by design, like its predecessor: it reads the shipped israel.html and
// fails if a client-side English-address opinion reappears anywhere. The jsdom
// walk-throughs live in israel-english-address-fallback-harness.cjs.
//
// Run: node test/israel-cp-english-address-fatca-gate.cjs
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'israel.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}

const CP_PREFIX = 'controllingShareholdersContainer.controllingShareholdersArray[';

ok('CP prefix constant appears (sanity: the repeating template still uses this exact path)',
  html.indexOf(CP_PREFIX) >= 0);

// 1. The CP row still HAS the English-address pair, and it is still wired to
//    the same data-en-addr-fallback holder key the reveal path resolves. The
//    class is only closed if the CP can be shown and named like anyone else.
const cpHolders = html.match(/data-en-addr-fallback="controllingShareholdersContainer\.controllingShareholdersArray\[\$\{i\}\]"/g) || [];
ok('the CP template still carries both English-address holders', cpHolders.length === 2, 'found ' + cpHolders.length);
const cpOptional = html.match(/<label class="lvp-field lvp-field--en-addr-fallback" hidden data-optional data-en-addr-fallback="controllingShareholdersContainer/g) || [];
ok('both CP English-address holders are data-optional (no client-side block on a CP either)',
  cpOptional.length === 2, 'found ' + cpOptional.length);

// 2. No client-side scan forms an opinion about whether a CP needs an English
//    address. The duplicated predicate and both scans it guarded are gone.
ok('the duplicated cpEnglishRequired predicate is gone', !/cpEnglishRequired/.test(html));
ok('no scan special-cases the CP prefix against entityW8.fatcaStatus for the English address',
  !/controllingShareholdersContainer\.controllingShareholdersArray\['\)\s*===\s*0\s*&&[^\n]*fatcaStatus/.test(html));
ok('the final-submit missingPrefix English-address scan is gone', !/missingPrefix/.test(html));

// 3. The server refusal path is the only thing that can reveal-and-block, and
//    it is holder-agnostic: it acts on the paths the SERVER sent, so a CP the
//    server did not name is never touched. Asserted by there being exactly one
//    call site, inside focusServerValidation_.
const callers = html.match(/^\s*(?:if \([^\n]*\))?\s*revealEnglishAddressFallback_\(/gm) || [];
ok('revealEnglishAddressFallback_ has exactly one call site', callers.length === 1, 'found ' + callers.length);
const fsvAt = html.indexOf('function focusServerValidation_(');
ok('focusServerValidation_ exists', fsvAt > 0);
const fsv = html.slice(fsvAt, fsvAt + 2600);
ok('that one call site is inside focusServerValidation_', fsv.indexOf('revealEnglishAddressFallback_(') !== -1);
// The prefix it reveals is derived from the SERVER's own problem path, never
// from a local scan of the form. That is what makes it holder-agnostic, and so
// automatically correct for an Active-NFFE CP the server chose not to name.
ok('the revealed prefix comes from the server-sent problems array',
  /for \(var e0 = 0; e0 < problems\.length/.test(fsv) && /englishAddress/.test(fsv));
ok('the reveal only fires for a holder that actually has a fallback holder in the DOM',
  /form\.querySelector\('\[data-en-addr-fallback="' \+ pre0 \+ '"\]'\)/.test(fsv));

// 4. The entity's own FATCA radio is untouched by any of this - the server
//    still reads it, and nothing here should have removed the field.
ok('entityW8.fatcaStatus is still collected by the form', /name="entityW8\.fatcaStatus"/.test(html));

console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
