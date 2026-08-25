// test-positive-submit.cjs (2026-08-02, CTO review finding #12 - converted
// from an exploratory console.log probe to real pass/fail assertions).
//
// The positive-path complement to test-adversarial.cjs's TEST B (which
// proves a tampered/invalid required field correctly BLOCKS submit and the
// gateway is never called): a genuinely complete form with a signature must
// successfully reach the gateway. Together the two prove the re-validation
// on Submit is exactly as strict as it needs to be - neither over-blocking
// a valid submission nor under-blocking an invalid one.
//
// Run: node test/test-positive-submit.cjs
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

(async () => {
  const { document, window } = await loadForm({ cfg: { applicantType: 'individual', prefill: { __testUploads: SLOTS, _pad: '1' } } });
  const next = document.querySelector('[data-action="next"]'), submit = document.querySelector('[data-action="submit"]');

  for (let s = 0; s < 40 && cur(document) !== 'review'; s++) {
    for (let k = 0; k < 5; k++) { const e = visReq(document).filter(empty); if (!e.length) break; e.forEach(fill); await sleep(8); }
    next.click(); await sleep(10);
  }
  ok('a fully-filled form reaches review', cur(document) === 'review', 'landed on ' + cur(document) + ' instead');

  window.__submit = false;
  const of = window.fetch;
  window.fetch = function (u, o) { if (String(u).indexOf('source=lp') !== -1) window.__submit = true; return of(u, o); };

  const typeBtn = document.querySelector('[data-sig-mode="type"]');
  ok('signature type-mode toggle exists on review (fixture sanity)', !!typeBtn);
  if (typeBtn) { typeBtn.click(); await sleep(8); }
  const ti = document.querySelector('[data-sig-typed-input]');
  ok('typed-signature input exists once type mode is active (fixture sanity)', !!ti);
  if (ti) { setV(ti, 'Test Subscriber'); await sleep(8); }

  submit.click();
  await sleep(40);
  ok('a complete form + signature reaches the gateway (re-validation must not over-block a valid submission)', window.__submit === true);

  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e); process.exit(1); });
