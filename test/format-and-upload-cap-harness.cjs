// format-and-upload-cap-harness.cjs (2026-08-02, CTO review finding #13).
//
// Two previously-untested pieces of index.html's client-side format/size
// enforcement:
// 1. SWIFT/BIC validation (LVP_FIELD_VALIDATORS_'s lpBank.swift rule):
//    accepts 8-char and 11-char alphanumeric SWIFT/BIC codes and a 9-digit
//    U.S. ABA routing number; rejects everything else. Every other test
//    file that touches SWIFT only uses a single known-valid literal
//    ('LUMIILIT') as filler to get past validation - none of them exercise
//    the validator's actual accept/reject boundary.
// 2. The 10MB upload cap (form's change-event handler on [data-upload]
//    inputs): a file over the limit must be rejected (status message shown,
//    input cleared, pendingUploads never populated), a file at/under the
//    limit must be accepted. No existing test covers this at all.
//
// Part 1 extracts the REAL LVP_FIELD_VALIDATORS_ array + lvpValidateFormat_
// from the live file (brace-counting). Part 2 drives the REAL booted form
// (via test/rig.cjs) with a genuine 'change' event carrying a mock File
// object, so both parts exercise production code, not a hand-written copy.
//
// Run: node test/format-and-upload-cap-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const { loadForm } = require('./rig.cjs');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }

// ---- Part 1: SWIFT/BIC format validation -----------------------------------
function extractSwiftValidator() {
  const start = html.indexOf('var LVP_FIELD_VALIDATORS_ = [');
  if (start < 0) throw new Error('LVP_FIELD_VALIDATORS_ not found (boot contract changed)');
  let i = html.indexOf('[', start), depth = 0, end = -1;
  for (; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error('unbalanced brackets for LVP_FIELD_VALIDATORS_');
  const arraySrc = html.slice(start, end);
  const fnStart = html.indexOf('function lvpValidateFormat_(name, val) {');
  if (fnStart < 0) throw new Error('lvpValidateFormat_ not found (boot contract changed)');
  let j = html.indexOf('{', fnStart), depth2 = 0, fnEnd = -1;
  for (; j < html.length; j++) {
    if (html[j] === '{') depth2++;
    else if (html[j] === '}') { depth2--; if (depth2 === 0) { fnEnd = j + 1; break; } }
  }
  const fnSrc = html.slice(fnStart, fnEnd);
  return new Function(arraySrc + ';' + fnSrc + '; return lvpValidateFormat_;')();
}
const lvpValidateFormat_ = extractSwiftValidator();

// Accept: 8-char SWIFT, 11-char SWIFT, 9-digit ABA routing.
ok('8-char SWIFT accepted', lvpValidateFormat_('investment.lpBank.swift', 'LUMIILIT') === '');
ok('11-char SWIFT (with branch code) accepted', lvpValidateFormat_('investment.lpBank.swift', 'LUMIILITTLV') === '');
ok('9-digit U.S. ABA routing number accepted', lvpValidateFormat_('investment.lpBank.swift', '021000021') === '');
ok('lowercase SWIFT accepted (normalized to uppercase)', lvpValidateFormat_('investment.lpBank.swift', 'lumiilit') === '');
ok('SWIFT with internal whitespace accepted (stripped before checking)', lvpValidateFormat_('investment.lpBank.swift', 'LUMI ILIT') === '');

// Reject: too short, too long, wrong shape, non-alphanumeric.
ok('7-char SWIFT rejected (too short)', lvpValidateFormat_('investment.lpBank.swift', 'LUMIILI') !== '');
ok('10-char SWIFT rejected (not 8 or 11)', lvpValidateFormat_('investment.lpBank.swift', 'LUMIILITTL') !== '');
ok('8-digit number rejected (not a valid ABA length)', lvpValidateFormat_('investment.lpBank.swift', '02100002') !== '');
ok('SWIFT with a symbol rejected', lvpValidateFormat_('investment.lpBank.swift', 'LUMI-ILIT') !== '');
ok('empty string rejected', lvpValidateFormat_('investment.lpBank.swift', '') !== '');

// A field name that does NOT match the swift rule is untouched by it (falls
// through LVP_FIELD_VALIDATORS_ to the next matching rule or '' if none).
ok('a non-swift field name does not trigger the swift rule', lvpValidateFormat_('individual.firstName', 'not-a-swift-code') === '');

// ---- Part 2: 10MB upload cap ------------------------------------------------
function makeFakeFile(name, sizeBytes, type) {
  return { name, size: sizeBytes, type: type || 'application/pdf' };
}
function makeFakeFileList(files) {
  const list = files.slice();
  list.item = (i) => list[i] || null;
  return list;
}

(async () => {
  const { document, window } = await loadForm({ cfg: { applicantType: 'individual', prefill: { __testUploads: ['passportPrimary'], _pad: '1' } } });
  const input = document.querySelector('input[data-upload="passportPrimary"]');
  ok('upload input exists (fixture sanity)', !!input);

  function fireChange(files) {
    Object.defineProperty(input, 'files', { value: makeFakeFileList(files), configurable: true });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  }

  // Over the cap: rejected.
  fireChange([makeFakeFile('big.pdf', 10 * 1024 * 1024 + 1)]);
  await new Promise((r) => setTimeout(r, 20));
  const statusEl = document.getElementById('lvp-status') || document.querySelector('[data-status]');
  ok('a file just over 10MB is rejected (input cleared)', input.value === '' || input.files.length === 0);
  if (statusEl) ok('an oversize file shows a visible status message', !!statusEl.textContent && statusEl.textContent.length > 0, statusEl.textContent);

  // At the cap: accepted (boundary is size > 10MB, not >=).
  fireChange([makeFakeFile('exactly10mb.pdf', 10 * 1024 * 1024)]);
  await new Promise((r) => setTimeout(r, 20));
  const wrapAtCap = input.closest('.lvp-upload');
  ok('a file at exactly 10MB is accepted (boundary is strictly greater-than)', wrapAtCap && wrapAtCap.classList.contains('has-file'));

  // Comfortably under the cap: accepted.
  fireChange([makeFakeFile('small.pdf', 1024)]);
  await new Promise((r) => setTimeout(r, 20));
  const wrapSmall = input.closest('.lvp-upload');
  ok('a small file is accepted', wrapSmall && wrapSmall.classList.contains('has-file'));

  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e); process.exit(1); });
