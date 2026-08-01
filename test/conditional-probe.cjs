// conditional-probe.cjs (2026-08-02, CTO review finding #12 - converted
// from an exploratory console.log probe to real pass/fail assertions).
//
// The original probe looped entity.type over ['Corporation','Partnership',
// 'Trust','LLC'] via prefill, checking which document uploads revealed per
// type. That no longer reflects production: index.html:704 hardcodes
// entity.type to a fixed <input type="hidden" value="Corporation">
// ("the fund accepts Israeli corporations... trusts, partnerships, LLCs and
// 'other' are off-scope and not offered"), so a prefill attempt to set a
// different type has no effect - the probe's own loop was silently testing
// nothing for 3 of its 4 branches. Rewritten to assert CURRENT reality:
// entity.type cannot be overridden, the two conditionally-gated uploads
// (Articles/Corporate resolution, gated on entity.type=Corporation;LLC)
// correctly show for the only type the form actually offers, and the
// individual lane never renders any entity-only upload UI.
//
// Run: node test/conditional-probe.cjs
'use strict';
const { loadForm } = require('./rig.cjs');
const SLOTS = ['articlesOfIncorporation', 'bankAccountConfirmation', 'certificateOfIncorporation', 'corporateResolution', 'listOfAuthorizedSignatories', 'partnershipAgreement', 'proofOfRegisteredAddress', 'trustAgreement'];

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }
function formHidden(h) { let el = h; while (el && el.nodeType === 1) { if (el.hasAttribute && el.hasAttribute('hidden')) return true; if (el.style && el.style.display === 'none') return true; el = el.parentElement; } return false; }
function slotEl(d, slot) { return d.querySelector('input[data-upload="' + slot + '"]'); }
function visible(d, slot) { const i = slotEl(d, slot); return !!i && !formHidden(i); }

(async () => {
  // A prefill attempt to override entity.type is a no-op: the field is
  // hardcoded, not conditional, so this loop asserts the SAME expected
  // state regardless of what the (ignored) prefill requests.
  for (const attemptedType of ['Corporation', 'Partnership', 'Trust', 'LLC']) {
    const { document } = await loadForm({ cfg: { applicantType: 'entity', prefill: { __testUploads: SLOTS, entity: { type: attemptedType }, _pad: '1' } } });
    const nextBtn = document.querySelector('[data-action="next"]');
    nextBtn.click();
    await new Promise((r) => setTimeout(r, 15));
    const cur = (document.querySelector('.lvp-page:not([hidden])') || {}).getAttribute('data-page');
    ok('prefill entity.type="' + attemptedType + '": still lands on documents page', cur === 'documents');

    const hiddenType = document.querySelector('input[type="hidden"][name="entity.type"]');
    ok('prefill entity.type="' + attemptedType + '": entity.type stays hardcoded to Corporation (prefill ignored)', hiddenType && hiddenType.value === 'Corporation');

    // Always-visible (no conditional gate) entity uploads.
    ok('prefill entity.type="' + attemptedType + '": certificateOfIncorporation visible (ungated)', visible(document, 'certificateOfIncorporation'));
    ok('prefill entity.type="' + attemptedType + '": listOfAuthorizedSignatories visible (ungated)', visible(document, 'listOfAuthorizedSignatories'));

    // Gated on entity.type=Corporation;LLC - since entity.type is always
    // Corporation, these must always be visible too.
    ok('prefill entity.type="' + attemptedType + '": articlesOfIncorporation visible (Corporation matches its gate)', visible(document, 'articlesOfIncorporation'));
    ok('prefill entity.type="' + attemptedType + '": corporateResolution visible (Corporation matches its gate)', visible(document, 'corporateResolution'));

    // Not offered at all - no upload input exists for these, regardless of
    // what the caller tried to prefill.
    ok('prefill entity.type="' + attemptedType + '": partnershipAgreement upload does not exist (off-scope, not offered)', !slotEl(document, 'partnershipAgreement'));
    ok('prefill entity.type="' + attemptedType + '": trustAgreement upload does not exist (off-scope, not offered)', !slotEl(document, 'trustAgreement'));
  }

  // Individual lane: none of the entity-only upload slots should exist at all.
  const { document: di } = await loadForm({ cfg: { applicantType: 'individual', prefill: { __testUploads: SLOTS, _pad: '1' } } });
  const nb = di.querySelector('[data-action="next"]');
  nb.click();
  await new Promise((r) => setTimeout(r, 15));
  // certificateOfIncorporation/articlesOfIncorporation markup exists (inside
  // the data-applicant="entity" wrapper) but must be hidden, not visible, on
  // the individual lane. partnershipAgreement/trustAgreement have no markup
  // anywhere in the file at all (confirmed absent, not just hidden).
  ['certificateOfIncorporation', 'articlesOfIncorporation'].forEach((s) => {
    ok('individual lane: ' + s + ' upload exists but is hidden', !!slotEl(di, s) && !visible(di, s));
  });
  ['partnershipAgreement', 'trustAgreement'].forEach((s) => {
    ok('individual lane: ' + s + ' upload does not exist', !slotEl(di, s));
  });

  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e); process.exit(1); });
