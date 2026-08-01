// joint-probe.cjs (2026-08-02, CTO review finding #12 - converted from an
// exploratory console.log probe to real pass/fail assertions).
//
// Claim: index.html's joint-holder conditional section (revealed by
// hasAdditionalInvestors=true) is hidden by default, reveals with its
// required additionalInvestors[0] fields on Yes, and hides again on No -
// the applyConditionals() show/hide engine round-trips cleanly rather than
// leaving stale visible-but-unreachable required fields behind (which would
// silently block submission on a page the LP can no longer see).
//
// Run: node test/joint-probe.cjs
'use strict';
const { loadForm } = require('./rig.cjs');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }
function ownHidden(el) { return el.hasAttribute('hidden') || (el.style && el.style.display === 'none'); }

(async () => {
  const { document } = await loadForm({ cfg: { applicantType: 'individual', prefill: { __testUploads: ['passportPrimary'], _pad: '1' } } });
  const jointWrap = document.querySelector('[data-show-when="hasAdditionalInvestors=true"]');
  const auth = document.querySelector('input[name="jointHolderAuth"]');

  ok('jointHolderAuth fieldset present (fixture sanity)', !!auth);
  ok('joint section wrapper found (fixture sanity)', !!jointWrap);
  ok('BEFORE: joint section is hidden by default', ownHidden(jointWrap));

  const yes = document.querySelector('input[name="hasAdditionalInvestors"][value="true"]');
  ok('hasAdditionalInvestors=true radio exists (fixture sanity)', !!yes);
  yes.checked = true;
  yes.dispatchEvent(new (document.defaultView.Event)('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 15));

  ok('AFTER Yes: joint section reveals', !ownHidden(jointWrap));
  const addInvReq = Array.from(document.querySelectorAll('[name^="additionalInvestors[0]"]')).map((i) => i.name);
  ok('AFTER Yes: additionalInvestors[0] fields are rendered', addInvReq.length > 0, addInvReq);
  const addReqHolders = Array.from(document.querySelectorAll('.lvp-page[data-page="individual.additional"] [data-required]')).filter((h) => !ownHidden(h)).length;
  ok('AFTER Yes: at least one visible required holder in the additional-investor page', addReqHolders > 0);

  const no = document.querySelector('input[name="hasAdditionalInvestors"][value="false"]');
  no.checked = true;
  no.dispatchEvent(new (document.defaultView.Event)('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 15));

  ok('AFTER No: joint section hides again (round-trips cleanly)', ownHidden(jointWrap));

  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e); process.exit(1); });
