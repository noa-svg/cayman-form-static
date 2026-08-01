// id-checksum-harness.cjs (2026-08-02, CTO review finding #3).
//
// Proves signer.html's fieldError() now runs the real Israeli-ID checksum
// (validation-rules.js's validId, the verbatim client port of the server
// validator) on the idNumber field - but ONLY when idType === 'National ID'.
// idNumber is a shared field that also carries passport and company-
// registration numbers (letters allowed, no checksum applies); the gate
// exists specifically so a Cayman-lane signer entering a passport number
// never gets wrongly rejected by an Israeli-only rule.
//
// Extracts the REAL fieldError from the live signer.html source (brace-
// counting, same pattern as upload-race-harness.cjs) and the REAL validId
// from validation-rules.js, so this fails if a future edit breaks the gate
// or the checksum - not just if someone breaks a hand-written copy.
//
// Run: node test/id-checksum-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'signer.html'), 'utf8');
const rulesSrc = fs.readFileSync(path.join(__dirname, '..', 'validation-rules.js'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); } }

function extractFn(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}

// Real LVPRules, evaluated exactly like a <script src="validation-rules.js">
// tag would expose it: boot it in a real jsdom window (same pattern
// doc-sanitize-harness.cjs already uses for the sibling sanitizer module),
// so the UMD wrapper's browser branch (window.LVPRules = factory()) is the
// one that actually runs.
const rulesDom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
rulesDom.window.eval(rulesSrc);
const LVPRules = rulesDom.window.LVPRules;
if (!LVPRules || typeof LVPRules.validId !== 'function') throw new Error('could not extract real LVPRules.validId from validation-rules.js');

function makeFieldError() {
  const src = extractFn('fieldError');
  const wrapped = 'var LVPRules = REAL_RULES; var tHe = function(s){return s;}; ' + src + '; return fieldError;';
  return new Function('REAL_RULES', wrapped)(LVPRules);
}
const fieldError = makeFieldError();

// A minimal fake <input> + its owning fieldset, matching what fieldError
// actually touches: type/value/name/hasAttribute/form.elements[idType].
function makeInput(name, value, idTypeValue) {
  const form = { elements: { idType: { value: idTypeValue == null ? '' : idTypeValue } } };
  return {
    type: 'text', name: name, value: value, form: form,
    hasAttribute: function () { return false; }, // not required for these cases
  };
}

// A real, checksum-VALID Israeli ID (verified against LVPRules.validId directly).
// Brute-forced over a small range rather than hand-computed, so the test
// derives its fixture from the real checksum instead of a second, possibly-
// wrong reimplementation of it.
const VALID_IL_ID = (function () {
  for (let n = 1; n < 200000; n++) {
    const s = String(n);
    if (LVPRules.validId(s)) return s;
  }
  throw new Error('could not derive a valid test ID - validId() behavior changed');
})();
const INVALID_IL_ID = (function () {
  // Flip the last digit of a valid ID until the checksum breaks.
  for (let d = 0; d < 10; d++) {
    const candidate = VALID_IL_ID.slice(0, -1) + d;
    if (!LVPRules.validId(candidate)) return candidate;
  }
  throw new Error('could not derive an invalid test ID');
})();

// ---- 1. National ID + valid checksum -> no error -------------------------
ok('National ID, valid checksum: accepted',
  fieldError(makeInput('idNumber', VALID_IL_ID, 'National ID')) === '');

// ---- 2. National ID + invalid checksum -> rejected ------------------------
ok('National ID, invalid checksum: rejected',
  fieldError(makeInput('idNumber', INVALID_IL_ID, 'National ID')) === 'That ID number is not valid.');

// ---- 3. Passport (letters, no checksum applies) -> NEVER run through the
//         Israeli-only checksum, even though it would fail validId(). -------
ok('Passport idType: alphanumeric passport number is NOT checksum-checked',
  fieldError(makeInput('idNumber', 'AB1234567', 'Passport')) === '');

// ---- 4. Company Registration Number idType -> also skipped ----------------
ok('Company Registration Number idType: not checksum-checked',
  fieldError(makeInput('idNumber', INVALID_IL_ID, 'Company Registration Number')) === '');

// ---- 5. idType not yet selected (empty) -> fails open, no false rejection -
ok('idType unset (signer has not chosen yet): idNumber not checksum-checked',
  fieldError(makeInput('idNumber', INVALID_IL_ID, '')) === '');

// ---- 6. Empty idNumber is still handled by the pre-existing required check,
//         not this new branch (no false-positive checksum error on blank). --
ok('empty idNumber: no checksum error (required-check owns this case)',
  fieldError(makeInput('idNumber', '', 'National ID')) === '');

// ---- 7. A non-idNumber field is completely unaffected by this branch. -----
ok('a different field name never triggers the idNumber-only branch',
  fieldError(makeInput('taxId', INVALID_IL_ID, 'National ID')) === '');

console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
