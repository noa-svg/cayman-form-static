// israel-cp-english-address-fatca-gate.cjs - locks the 2026-09-05 fix to the
// ינאי אורון English-address fallback (2026-09-04).
//
// THE BUG THE FIX INTRODUCED: the fallback's reveal/block scan
// (israel.html, both the per-page validatePage gate and the final-submit
// gate) matched every `*.englishDetails.englishAddress.street` input by
// name suffix alone, with no read of the entity's FATCA status. The server
// (apps/ju-service/src/domain/israeli/validate.ts:443-490, `cpNeedsEnglish`)
// only requires a controlling person's englishAddress when the entity
// self-certifies Passive NFFE - an Active NFFE/Other entity's controlling
// persons are never checked for it. So an Active-entity CP whose Hebrew
// address geocode-derive came back empty was wrongly force-revealed and
// blocked on a field the server would have accepted blank: the same
// phantom-required-field bug, in the opposite direction.
//
// This is a STATIC lock, not a full jsdom walk-through: it asserts the CP
// prefix (`controllingShareholdersContainer.controllingShareholdersArray[`)
// is excluded from both scans unless `entityW8.fatcaStatus` reads
// 'Passive NFFE' via the existing readRadio() helper - the same predicate
// validate.ts's cpNeedsEnglish uses. A regression that drops the guard, or
// inverts the condition, fails this test even without booting the form.
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
const GATE_RE = /prefix\.indexOf\('controllingShareholdersContainer\.controllingShareholdersArray\['\)\s*===\s*0\s*&&\s*(?:!cpEnglishRequired|readRadio\('entityW8\.fatcaStatus'\)\s*!==\s*'Passive NFFE')/g;

const gateMatches = html.match(GATE_RE) || [];
ok('CP prefix constant appears (sanity: the repeating template still uses this exact path)', html.indexOf(CP_PREFIX) >= 0);
ok('the englishAddress reveal/block scan gates CP holders on entityW8.fatcaStatus === Passive NFFE, at BOTH scan sites (final-submit + per-page Next)', gateMatches.length === 2,
  'found ' + gateMatches.length + ' gated CP check(s), expected 2 (validatePage + the final-submit scan)');

// The gate must read the CHECKED radio (readRadio), not the first DOM match
// for the name (_v would silently always return the first radio's value,
// which is never the LP's actual selection for a radio group).
ok('final-submit scan computes cpEnglishRequired via readRadio (not _v, which cannot read a checked radio)',
  /var cpEnglishRequired = readRadio\('entityW8\.fatcaStatus'\) === 'Passive NFFE'/.test(html));

console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
