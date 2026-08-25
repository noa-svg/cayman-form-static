// test-adversarial.cjs (2026-08-02, CTO review finding #12 - converted from
// an exploratory console.log probe to real pass/fail assertions).
//
// Two claims about index.html once an LP has already reached the review
// page and then goes back to tamper with an earlier answer:
// A. Clearing a required field (date of birth) and clicking Next again must
//    still be BLOCKED - a page that once validated does not become
//    permanently trusted; every forward navigation re-checks.
// B. The client DOES re-validate on the final Submit click, even for a
//    field tampered with directly via the DOM (bypassing the normal input
//    flow) rather than left empty through the UI: clearing the required
//    firstName field and clicking Submit navigates back to the page that
//    owns it with a validation error, and the gateway is never called.
//    (The original version of this probe assumed the OPPOSITE - that submit
//    skipped re-validation and only the server caught a tampered field.
//    Verified against the live doSubmit()/doSubmitNow_() flow in index.html:
//    that assumption was simply wrong, not a regression - the real,
//    current behavior is the safer one, matching what this test now
//    asserts.)
//
// Run: node test/test-adversarial.cjs
'use strict';
const { loadForm } = require('./rig.cjs');
// 'qualification.preSignedUpload' (added 2026-08-25): the qualification
// pre-signed radio became data-required, so the generic walker now answers it,
// picks the first option ('Yes, I will upload it') and reveals this upload
// holder. Without a stub for the slot the walk stalls on the qualification page.
const SLOTS = ['articlesOfIncorporation', 'bankAccountConfirmation', 'certificateOfIncorporation', 'corporateResolution', 'listOfAuthorizedSignatories', 'partnershipAgreement', 'proofOfRegisteredAddress', 'trustAgreement', 'passportPrimary', 'proofOfAddress', 'qualification.preSignedUpload'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }

function cur(d) { const p = d.querySelector('.lvp-page:not([hidden])'); return p ? p.getAttribute('data-page') : null; }
function fh(h) { let el = h; while (el && el.nodeType === 1) { if (el.hasAttribute && el.hasAttribute('hidden')) return true; if (el.style && el.style.display === 'none') return true; el = el.parentElement; } return false; }
function visReq(d) { const p = d.querySelector('.lvp-page:not([hidden])'); if (!p) return []; return Array.from(p.querySelectorAll('[data-required]')).filter((h) => !fh(h)); }
function empty(h) { if (h.classList.contains('lvp-dob')) { const iso = h.querySelector('[data-dob-iso]'); return !(iso && /^\d{4}-\d{2}-\d{2}$/.test(iso.value || '')); } const ins = Array.from(h.querySelectorAll('input,select,textarea')); let f = false; ins.forEach((i) => { if (i.type === 'radio' || i.type === 'checkbox') { if (i.checked) f = true; } else if (i.hasAttribute('data-upload')) { /* stubbed */ } else if (i.value && String(i.value).trim()) f = true; }); return !f; }
function fire(el, t) { el.dispatchEvent(new (el.ownerDocument.defaultView.Event)(t, { bubbles: true })); }
function setV(i, v) { i.value = v; fire(i, 'input'); fire(i, 'change'); }
function valueFor(i) {
  const n = String(i.name || '');
  if (/\.idNumber$|\.idOrCompanyNumber$|taxRefNumber$|registrationNumber$/.test(n)) return '123456782'; // checksum-valid Israeli ID
  if (/\.phone$/.test(n)) return '+972501234567';
  if (/\.usTin$/.test(n)) return '123456789';
  if (/\.giin\d*$|mergedGiin$/.test(n)) return 'ABCDEF.ABCDE.IL.123';
  if (/lpBank\.accountNumber$/.test(n)) return '12345678';
  if (/lpBank\.swift$/.test(n)) return 'LUMIILIT';
  if (/amount$/i.test(n)) return '150000';
  if (/\.postCode$/.test(n)) return '6100000';
  if (/taxRefTypeAndNumber$/.test(n)) return 'SSN 123-45-6789';
  return (i.getAttribute('inputmode') === 'numeric') ? '123456' : 'Test';
}
function fill(h) {
  if (h.classList.contains('lvp-dob')) { const d = h.querySelector('[data-dob-d]'), m = h.querySelector('[data-dob-m]'), y = h.querySelector('[data-dob-y]'), iso = h.querySelector('[data-dob-iso]'); if (d) setV(d, '01'); if (m) setV(m, '01'); if (y) setV(y, '1985'); if (iso && !/^\d{4}/.test(iso.value)) iso.value = '1985-01-01'; return; }
  const ins = Array.from(h.querySelectorAll('input,select,textarea'));
  const r = ins.filter((i) => i.type === 'radio'); if (r.length) { r[0].checked = true; fire(r[0], 'change'); fire(r[0], 'input'); return; }
  ins.forEach((i) => {
    if (i.type === 'checkbox') { i.checked = true; fire(i, 'change'); }
    else if (i.type === 'file') { /* stubbed */ }
    else if (i.tagName === 'SELECT') { const o = Array.from(i.options).find((x) => x.value); if (o) { i.value = o.value; fire(i, 'change'); fire(i, 'input'); } }
    else if (i.type === 'date') { setV(i, new Date().toISOString().slice(0, 10)); }
    else if (i.type === 'email') { setV(i, 't@example.com'); }
    else setV(i, valueFor(i));
  });
}
async function walkToReview(d, nextBtn) {
  for (let s = 0; s < 40; s++) {
    const p = cur(d);
    if (p === 'review') return true;
    for (let k = 0; k < 5; k++) { const e = visReq(d).filter(empty); if (!e.length) break; e.forEach(fill); await sleep(8); }
    nextBtn.click(); await sleep(10);
    if (cur(d) === p) return false;
  }
  return cur(d) === 'review';
}

(async () => {
  const { document, window } = await loadForm({ cfg: { applicantType: 'individual', prefill: { __testUploads: SLOTS, _pad: '1' } } });
  const next = document.querySelector('[data-action="next"]'), prev = document.querySelector('[data-action="prev"]'), submit = document.querySelector('[data-action="submit"]');

  const reached = await walkToReview(document, next);
  ok('walk reaches review on a first, honest pass', reached, 'landed on ' + cur(document) + ' instead');

  // ---- TEST A: clearing DOB after already reaching review must re-block ----
  for (let i = 0; i < 20 && cur(document) !== 'individual.personal'; i++) { prev.click(); await sleep(8); }
  ok('walking back reaches individual.personal (fixture sanity)', cur(document) === 'individual.personal');

  const dob = document.querySelector('.lvp-page[data-page="individual.personal"] .lvp-dob');
  ok('date-of-birth field exists on individual.personal (fixture sanity)', !!dob);
  if (dob) { ['[data-dob-d]', '[data-dob-m]', '[data-dob-y]', '[data-dob-iso]'].forEach((s) => { const x = dob.querySelector(s); if (x) x.value = ''; }); }
  const before = cur(document);
  next.click();
  await sleep(10);
  const after = cur(document);
  ok('A: clearing a required DOB after already reaching review still blocks Next', before === after, 'advanced from ' + before + ' to ' + after);

  // ---- TEST B: submit does not re-validate every earlier page client-side --
  if (dob) { const d = dob.querySelector('[data-dob-d]'), m = dob.querySelector('[data-dob-m]'), y = dob.querySelector('[data-dob-y]'); setV(d, '01'); setV(m, '01'); setV(y, '1985'); const iso = dob.querySelector('[data-dob-iso]'); if (iso && !/^\d{4}/.test(iso.value)) iso.value = '1985-01-01'; }
  const backOnReview = await walkToReview(document, next);
  ok('B: after re-filling DOB, the walk reaches review again', backOnReview, 'landed on ' + cur(document) + ' instead');

  window.__submit = false;
  const of = window.fetch;
  window.fetch = function (u, o) { if (String(u).indexOf('source=lp') !== -1) window.__submit = true; return of(u, o); };

  const typeBtn = document.querySelector('[data-sig-mode="type"]'); if (typeBtn) { typeBtn.click(); await sleep(8); }
  const ti = document.querySelector('[data-sig-typed-input]'); if (ti) { setV(ti, 'Test Subscriber'); await sleep(8); }

  // Tamper directly via the DOM (bypassing the normal input flow) with a
  // required field (firstName) and a non-required one (occupation).
  const fn = document.querySelector('[name="individual.firstName"]'); if (fn) fn.value = '';
  const occ = document.querySelector('[name="individual.occupation"]'); if (occ) occ.value = '';
  submit.click();
  await sleep(30);
  ok(
    'B: submit re-validates and blocks a tampered required field - the gateway is never called',
    window.__submit === false
  );
  ok(
    'B: a blocked submit navigates back to the page that owns the invalid field',
    cur(document) === 'individual.subscriber'
  );

  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e); process.exit(1); });
