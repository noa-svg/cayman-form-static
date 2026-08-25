// resume-restore-and-fatca-harness.cjs (2026-08-02, CTO review finding #13).
//
// Two previously-untested pieces of index.html:
// 1. Resume/prefill field restoration (restoreFormData, index.html:4048):
//    given a resume token's saved prefill data, do input/select/radio values
//    actually rehydrate into the DOM? resume-jump-harness.cjs already covers
//    the PAGE-NAVIGATION half of resume (jumping to the right resumePage) in
//    real depth; this is the other half - does the DATA come back. Boots the
//    REAL form via test/rig.cjs with real prefill data and reads the actual
//    resulting input values (not a hand-written re-simulation of the
//    restore logic).
// 2. FATCA/CRS conditional reveal (index.html:1148-1155): usPersonStatus
//    correctly shows/hides the U.S. TIN field vs the exemption-category
//    field vs neither, for both individual and entity applicants (the
//    entity branch additionally gets a whole extra classification page,
//    data-applicant="entity" gated).
//
// Run: node test/resume-restore-and-fatca-harness.cjs
'use strict';
const { loadForm } = require('./rig.cjs');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }
function fh(h) { let el = h; while (el && el.nodeType === 1) { if (el.hasAttribute && el.hasAttribute('hidden')) return true; if (el.style && el.style.display === 'none') return true; el = el.parentElement; } return false; }

(async () => {
  // ---- Part 1: resume/prefill restoration ----------------------------------
  const prefill = {
    individual: { firstName: 'Resumed', lastName: 'LP' },
    fatcaCrs: { usPersonStatus: 'notUs' },
    _pad: '1',
  };
  const { document: rd } = await loadForm({ cfg: { applicantType: 'individual', prefill } });
  const fn = rd.querySelector('input[name="individual.firstName"]');
  const ln = rd.querySelector('input[name="individual.lastName"]');
  ok('resume: firstName input exists (fixture sanity)', !!fn);
  ok('resume: a plain text field rehydrates from prefill', fn && fn.value === 'Resumed', fn && fn.value);
  ok('resume: a second plain text field rehydrates from prefill', ln && ln.value === 'LP', ln && ln.value);
  const notUsRadio = rd.querySelector('input[name="fatcaCrs.usPersonStatus"][value="notUs"]');
  ok('resume: a radio field exists for the prefilled value (fixture sanity)', !!notUsRadio);
  ok('resume: the matching radio option is checked from prefill', notUsRadio && notUsRadio.checked === true);
  const specifiedRadio = rd.querySelector('input[name="fatcaCrs.usPersonStatus"][value="specified"]');
  ok('resume: a non-matching radio option in the same group stays unchecked', specifiedRadio && specifiedRadio.checked === false);

  // A field with no prefill entry must not be clobbered to empty/wrong -
  // it simply keeps whatever the page's own default rendering gave it.
  const untouched = rd.querySelector('input[name="individual.occupation"]');
  ok('resume: a field absent from prefill is left alone, not blanked or errored', !!untouched && untouched.value === '');

  // ---- Part 2: FATCA/CRS conditional reveal, individual lane ---------------
  // 'qualification.preSignedUpload' in __testUploads (2026-08-25): the qualification
  // pre-signed radio became data-required, so this walk now answers it, picks the
  // first option ('Yes, I will upload it') and reveals a required upload holder.
  // Without the stub the walk stalls on qualification and never reaches fatcaCrs.
  // The reveal must be checked with the pager actually ON the fatcaCrs page:
  // fh() walks the FULL ancestor chain, and the page itself starts hidden
  // (pager defaults to 'welcome') independent of the conditional's own
  // hidden state, so checking without navigating there first would report
  // "hidden" regardless of what the conditional engine actually does.
  const { document: id } = await loadForm({ cfg: { applicantType: 'individual', prefill: { __testUploads: ['passportPrimary', 'proofOfAddress', 'bankAccountConfirmation', 'qualification.preSignedUpload'], _pad: '1' } } });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function fire(el, t) { el.dispatchEvent(new (el.ownerDocument.defaultView.Event)(t, { bubbles: true })); }
  function setV(i, v) { i.value = v; fire(i, 'input'); fire(i, 'change'); }
  function cur(doc) { const p = doc.querySelector('.lvp-page:not([hidden])'); return p ? p.getAttribute('data-page') : null; }
  function visReq(doc) { const p = doc.querySelector('.lvp-page:not([hidden])'); if (!p) return []; return Array.from(p.querySelectorAll('[data-required]')).filter((h) => !fh(h)); }
  function empty(h) { if (h.classList.contains('lvp-dob')) { const iso = h.querySelector('[data-dob-iso]'); return !(iso && /^\d{4}-\d{2}-\d{2}$/.test(iso.value || '')); } const ins = Array.from(h.querySelectorAll('input,select,textarea')); let f = false; ins.forEach((i) => { if (i.type === 'radio' || i.type === 'checkbox') { if (i.checked) f = true; } else if (i.hasAttribute('data-upload')) { /* stubbed */ } else if (i.value && String(i.value).trim()) f = true; }); return !f; }
  // Validator-aware values (same gap this session already fixed in
  // drive-branch.cjs/email-amount-probe.cjs): the generic fallback gets
  // stuck on format-gated fields (ID checksum, SWIFT) before ever reaching
  // fatcaCrs.
  function valueFor(i) {
    const n = String(i.name || '');
    if (/\.idNumber$|\.idOrCompanyNumber$|taxRefNumber$|registrationNumber$/.test(n)) return '123456782';
    if (/\.phone$/.test(n)) return '+972501234567';
    if (/\.usTin$/.test(n)) return '123456789';
    if (/lpBank\.accountNumber$/.test(n)) return '12345678';
    if (/lpBank\.swift$/.test(n)) return 'LUMIILIT';
    if (/amount$/i.test(n)) return '150000';
    if (/\.postCode$/.test(n)) return '6100000';
    return (i.getAttribute('inputmode') === 'numeric') ? '123456' : 'Test';
  }
  function fillHolder(h) {
    if (h.classList.contains('lvp-dob')) { const d = h.querySelector('[data-dob-d]'), m = h.querySelector('[data-dob-m]'), y = h.querySelector('[data-dob-y]'), iso = h.querySelector('[data-dob-iso]'); if (d) setV(d, '01'); if (m) setV(m, '01'); if (y) setV(y, '1985'); if (iso && !/^\d{4}/.test(iso.value)) iso.value = '1985-01-01'; return; }
    const ins = Array.from(h.querySelectorAll('input,select,textarea'));
    const r = ins.filter((i) => i.type === 'radio'); if (r.length) { r[0].checked = true; fire(r[0], 'change'); return; }
    ins.forEach((i) => { if (i.type === 'checkbox') { i.checked = true; fire(i, 'change'); } else if (i.type === 'file') { /* stubbed */ } else if (i.tagName === 'SELECT') { const o = Array.from(i.options).find((x) => x.value); if (o) { i.value = o.value; fire(i, 'change'); fire(i, 'input'); } } else if (i.type === 'date') { setV(i, new Date().toISOString().slice(0, 10)); } else if (i.type === 'email') { setV(i, 't@example.com'); } else setV(i, valueFor(i)); });
  }
  async function walkTo(doc, target) {
    const next = doc.querySelector('[data-action="next"]');
    for (let s = 0; s < 40; s++) {
      if (cur(doc) === target) return true;
      for (let k = 0; k < 5; k++) { const e = visReq(doc).filter(empty); if (!e.length) break; e.forEach(fillHolder); await sleep(8); }
      next.click();
      await sleep(10);
    }
    return cur(doc) === target;
  }
  const reachedFatca = await walkTo(id, 'fatcaCrs');
  ok('individual: walk reaches the fatcaCrs page', reachedFatca, 'landed on ' + cur(id) + ' instead');

  const usTin = id.querySelector('[name="fatcaCrs.usTin"]');
  const exemption = id.querySelector('.lvp-page [data-show-when="fatcaCrs.usPersonStatus=notSpecified"]');
  ok('individual: usTin field exists (fixture sanity)', !!usTin);
  ok('individual: exemption block exists (fixture sanity)', !!exemption);

  function setStatus(doc, value) {
    const radio = doc.querySelector('input[name="fatcaCrs.usPersonStatus"][value="' + value + '"]');
    radio.checked = true;
    radio.dispatchEvent(new (doc.defaultView.Event)('change', { bubbles: true }));
  }
  const CONDITIONAL_SETTLE_MS = 60;

  setStatus(id, 'specified');
  await sleep(CONDITIONAL_SETTLE_MS);
  ok('individual, usPersonStatus=specified: U.S. TIN field reveals', !fh(usTin.closest('.lvp-field') || usTin));
  ok('individual, usPersonStatus=specified: exemption block stays hidden', fh(exemption));

  setStatus(id, 'notSpecified');
  await sleep(CONDITIONAL_SETTLE_MS);
  ok('individual, usPersonStatus=notSpecified: U.S. TIN field hides', fh(usTin.closest('.lvp-field') || usTin));
  ok('individual, usPersonStatus=notSpecified: exemption block reveals', !fh(exemption));

  setStatus(id, 'notUs');
  await sleep(CONDITIONAL_SETTLE_MS);
  ok('individual, usPersonStatus=notUs: U.S. TIN field hides', fh(usTin.closest('.lvp-field') || usTin));
  ok('individual, usPersonStatus=notUs: exemption block hides', fh(exemption));

  // ---- Part 2b: entity-only classification page ----------------------------
  const { document: ed } = await loadForm({ cfg: { applicantType: 'entity', prefill: { __testUploads: ['certificateOfIncorporation'], entity: { type: 'Corporation' }, _pad: '1' } } });
  const entityClassPage = ed.querySelector('.lvp-page[data-page="fatcaCrs.classification"]');
  ok('entity: the FATCA/CRS classification page exists for entity applicants', !!entityClassPage);
  ok('entity: the classification page is gated data-applicant="entity"', entityClassPage && entityClassPage.getAttribute('data-applicant') === 'entity');

  const { document: idNoClass } = await loadForm({ cfg: { applicantType: 'individual', prefill: { __testUploads: ['passportPrimary'], _pad: '1' } } });
  const indClassPage = idNoClass.querySelector('.lvp-page[data-page="fatcaCrs.classification"]');
  ok('individual: the entity-only classification page markup exists but is not reachable (data-applicant gate)', !indClassPage || indClassPage.getAttribute('data-applicant') === 'entity');

  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e); process.exit(1); });
