// zz-cayman-lp-primary-entity.cjs (2026-09-09)
//
// THE CLASS THIS LOCKS: an LP shape nothing has ever walked.
//
// index.html is the primary subscriber's own form, and every harness that
// walks it end to end - test-positive-submit.cjs:58, test-adversarial.cjs:82,
// migration-carries-no-amount-harness.cjs:112/:157/:189 - boots it with
// `applicantType: 'individual'`. The ENTITY primary applicant, which is the
// shape the Cayman migration lane exists for (an Israeli corporate LP moving
// into the Cayman vehicle), had NO end-to-end walk at all: nothing proved an
// entity LP could reach the review page, sign, and reach the gateway.
//
// This is the entity counterpart of test-positive-submit.cjs. Same walker,
// same fill rules, same gateway assertion - the ONLY difference is
// applicantType, which is exactly the variable that was never covered. It also
// asserts the entity-only pages actually appear, so a future conditional that
// hides the entity branch fails here rather than on a real corporate LP.
//
// No fixture names a real LP; nothing leaves the jsdom rig.
//
// Run: node test/zz-cayman-lp-primary-entity.cjs
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
  const { document, window } = await loadForm({ cfg: { applicantType: 'entity', prefill: { __testUploads: SLOTS, _pad: '1' } } });
  const next = document.querySelector('[data-action="next"]'), submit = document.querySelector('[data-action="submit"]');

  for (let s = 0; s < 40 && cur(document) !== 'review'; s++) {
    for (let k = 0; k < 5; k++) { const e = visReq(document).filter(empty); if (!e.length) break; e.forEach(fill); await sleep(8); }
    next.click(); await sleep(10);
  }
  ok('an ENTITY applicant reaches review', cur(document) === 'review', 'landed on ' + cur(document) + ' instead');
  // The entity branch really rendered: these two blocks exist only for an
  // entity applicant, so a conditional that quietly hid them would otherwise
  // let the walk "pass" on an individual-shaped form wearing an entity flag.
  ok('the entity legal-name field was on the walked form',
     !!document.querySelector('[name="entity.legalName"]'));
  ok('the controlling-person block was on the walked form',
     !!document.querySelector('[data-repeating-typed-path="controllingPersons"]'));

  window.__submit = false;
  const of = window.fetch;
  window.fetch = function (u, o) { if (String(u).indexOf('source=lp') !== -1) window.__submit = true; return of(u, o); };

  const typeBtn = document.querySelector('[data-sig-mode="type"]');
  ok('signature type-mode toggle exists on review (fixture sanity)', !!typeBtn);
  if (typeBtn) { typeBtn.click(); await sleep(8); }
  const ti = document.querySelector('[data-sig-typed-input]');
  ok('typed-signature input exists once type mode is active (fixture sanity)', !!ti);
  if (ti) { setV(ti, 'Rivka Tannenbaum'); await sleep(8); }

  submit.click();
  await sleep(40);
  ok('a complete ENTITY form + signature reaches the gateway', window.__submit === true);

  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e); process.exit(1); });
