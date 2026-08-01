// drive-branch.cjs (2026-08-02, CTO review finding #12 - converted from an
// exploratory console.log probe to real pass/fail assertions).
//
// Full page-by-page walk of index.html for both applicant lanes. At every
// page: (1) if required fields are empty, clicking Next must NOT advance
// (the enforcement gate must hold - a page that lets an LP skip past
// unfilled required fields is a real, silent data-completeness bug); (2)
// after filling every visible required field, clicking Next MUST advance
// (not get stuck on a field the fill logic thinks it satisfied but the
// page's own validator disagrees with); (3) the walk eventually reaches
// 'review' rather than looping or dead-ending.
//
// The original probe took applicantType/entity-type as CLI args for a human
// to run by hand and eyeball the JSON dump. Converted to run both lanes
// automatically (entity.type is hardcoded to Corporation, see
// conditional-probe.cjs, so there is only one entity branch to walk).
//
// Run: node test/drive-branch.cjs
'use strict';
const { loadForm } = require('./rig.cjs');
const SLOTS = ['articlesOfIncorporation', 'bankAccountConfirmation', 'certificateOfIncorporation', 'clnUpload', 'corporateResolution', 'corporateSeal', 'listOfAuthorizedSignatories', 'nationalIdAppendix', 'nationalIdBack', 'nationalIdFront', 'partnershipAgreement', 'passportPrimary', 'proofOfAddress', 'proofOfRegisteredAddress', 'qualification.preSignedUpload', 'tax.exemptionCertificate', 'trustAgreement'];

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }

function curPageEl(d) { return d.querySelector('.lvp-page:not([hidden])'); }
function formHidden(h) { let el = h; while (el && el.nodeType === 1) { if (el.hasAttribute && el.hasAttribute('hidden')) return true; if (el.style && el.style.display === 'none') return true; el = el.parentElement; } return false; }
function visReq(d) { const p = curPageEl(d); if (!p) return []; return Array.from(p.querySelectorAll('[data-required]')).filter((h) => !formHidden(h)); }
function holderEmpty(h) {
  if (h.classList.contains('lvp-dob')) { const iso = h.querySelector('[data-dob-iso]'); return !(iso && /^\d{4}-\d{2}-\d{2}$/.test(iso.value || '')); }
  const inputs = Array.from(h.querySelectorAll('input,select,textarea')); let filled = false;
  inputs.forEach((i) => { if (i.type === 'radio' || i.type === 'checkbox') { if (i.checked) filled = true; } else if (i.getAttribute && i.hasAttribute('data-upload')) { /* upload via pendingUploads, treat as filled when stubbed */ } else if (i.value && String(i.value).trim()) filled = true; });
  return !filled;
}
function label(h) { const l = (h.querySelector('.lvp-field__label,.lvp-fieldset__legend,.lvp-upload__doc-title') || {}).textContent || h.getAttribute('data-upload') || '?'; return String(l).trim().slice(0, 34); }
function fire(el, t) { el.dispatchEvent(new (el.ownerDocument.defaultView.Event)(t, { bubbles: true })); }
function setVal(i, v) { i.value = v; fire(i, 'input'); fire(i, 'change'); }
// Validator-aware values (ported from test-adversarial.cjs/test-positive-
// submit.cjs, 2026-07-16): the inline format gate (LVP_FIELD_VALIDATORS_ in
// index.html) rejects generic 'Test'/'123456' fills on format-gated fields.
// drive-branch.cjs's original fillHolder() never got this upgrade, which is
// exactly why its walk silently stranded before review - a probe-fill-value
// gap, not a real production bug (confirmed by comparing against the two
// sibling probes that already had this fix).
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
function fillHolder(h) {
  if (h.classList.contains('lvp-dob')) { const d = h.querySelector('[data-dob-d]'), m = h.querySelector('[data-dob-m]'), y = h.querySelector('[data-dob-y]'), iso = h.querySelector('[data-dob-iso]'); if (d) setVal(d, '01'); if (m) setVal(m, '01'); if (y) setVal(y, '1985'); if (iso && !/^\d{4}/.test(iso.value)) { iso.value = '1985-01-01'; } return; }
  const inputs = Array.from(h.querySelectorAll('input,select,textarea'));
  const radios = inputs.filter((i) => i.type === 'radio'); if (radios.length) { radios[0].checked = true; fire(radios[0], 'change'); fire(radios[0], 'input'); return; }
  inputs.forEach((i) => {
    if (i.type === 'checkbox') { i.checked = true; fire(i, 'change'); }
    else if (i.type === 'file') { /* stubbed */ }
    else if (i.tagName === 'SELECT') { const o = Array.from(i.options).find((x) => x.value); if (o) { i.value = o.value; fire(i, 'change'); fire(i, 'input'); } }
    else if (i.type === 'date') { setVal(i, new Date().toISOString().slice(0, 10)); }
    else if (i.type === 'email') { setVal(i, 'test@example.com'); }
    else { setVal(i, valueFor(i)); }
  });
}

async function walk(lane, cfg) {
  const { document } = await loadForm({ cfg });
  const nextBtn = document.querySelector('[data-action="next"]');
  let reachedReview = false;
  for (let step = 0; step < 40; step++) {
    const pageEl = curPageEl(document);
    const page = pageEl ? pageEl.getAttribute('data-page') : null;
    ok(lane + ' step ' + step + ': a page is visible', !!page, 'walk stalled with no visible .lvp-page');
    if (!page) break;

    const empties = visReq(document).filter(holderEmpty);
    if (empties.length) {
      nextBtn.click();
      await new Promise((r) => setTimeout(r, 10));
      const afterEl = curPageEl(document);
      const movedWithEmpty = afterEl && afterEl.getAttribute('data-page') !== page;
      ok(
        lane + ' page "' + page + '": Next is blocked while required fields are empty',
        !movedWithEmpty,
        movedWithEmpty ? 'advanced past empty [' + empties.map(label).join(', ') + ']' : undefined
      );
      if (movedWithEmpty) continue; // keep walking from wherever it landed, don't get stuck asserting the same page forever
    }

    for (let k = 0; k < 5; k++) {
      const e = visReq(document).filter(holderEmpty);
      if (!e.length) break;
      e.forEach(fillHolder);
      await new Promise((r) => setTimeout(r, 8));
    }
    nextBtn.click();
    await new Promise((r) => setTimeout(r, 10));
    const afterFillEl = curPageEl(document);
    const after = afterFillEl ? afterFillEl.getAttribute('data-page') : null;
    ok(lane + ' page "' + page + '": Next advances once every required field is filled', after !== page, 'stuck on ' + page + ' after filling all visible required fields');
    if (after === page) break;
    if (after === 'review') { reachedReview = true; break; }
  }
  ok(lane + ': walk reaches the review page', reachedReview);
}

(async () => {
  await walk('individual', { applicantType: 'individual', prefill: { __testUploads: SLOTS, _pad: '1' } });
  await walk('entity', { applicantType: 'entity', prefill: { __testUploads: SLOTS, entity: { type: 'Corporation' }, _pad: '1' } });
  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e); process.exit(1); });
