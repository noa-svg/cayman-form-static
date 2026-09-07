// signer-blocked-submit-names-field.cjs (2026-09-07)
//
// THE DEFECT. signer.html's attester gates refused INVISIBLY. Clicking
// "חתימה ושליחה" with no stamp attached scrolled the page to the stamp control
// and wrote its only sentence into #err - which lives under the submit button,
// measured in real headless Chrome at 795-800px BELOW the fold on 1280x800,
// 375x812 and 320x568. The stamp field carried no error mark, no error summary
// was built, and #err had neither role="alert" nor aria-live, so nothing was
// announced either. The attester saw the page jump and nothing else.
//
// Three gates shared the flaw: they set errEl.textContent and returned, instead
// of markField + rebuildErrSummary like every other gate on the page. The main
// required-field path was always CORRECT (rebuildErrSummary lists every failing
// field with jump links); these three simply never used the machinery the file
// already had.
//
// WHAT THIS LOCKS. Not "the page scrolled" and not "some text exists
// somewhere" - both were already true while the defect was live. The assertion
// is that the OFFENDING FIELD IS NAMED AND MARKED:
//   - the .field container carries .field--error
//   - the control carries aria-invalid="true"
//   - the per-field message element (id="err-<name|id>") is VISIBLE and
//     non-empty - this is the one that sits beside the revealed control, and
//     is therefore the one the attester actually reads without scrolling
//   - the error summary is shown and NAMES the field by its label
// Viewport geometry is not assertable in jsdom (getBoundingClientRect is
// stubbed to a fixed box by rig-signer.cjs), so the "above the fold" half of
// this defect is proven by the CDP pixel rig, not here. What jsdom can prove -
// and what no DOM-blind pixel shot can - is WHICH field was named.
//
// The gate must not be weakened to achieve any of that: every blocked case
// asserts NO record_signature POST left the page, and the positive control
// asserts a complete attester leg still posts.
//
// Run: node test/signer-blocked-submit-names-field.cjs
'use strict';
const { loadSignerPage, makeSignerCtx } = require('./rig-signer.cjs');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}

const LAWYER_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'licenseNumber',
  'checkLiquid', 'checkIncome', 'checkOther', 'evidenceDate', 'otherEvidence'];

function lawyerCtx(over) {
  return makeSignerCtx(Object.assign({
    role: 'lawyer',
    docs: [{ title: 'Qualification', html: '<p>Body</p>' }],
    editableFields: { fields: LAWYER_FIELDS }
  }, over || {}));
}

// A controlling person: renders the ID-upload slots, no stamp gate.
function cpCtx(over) {
  return makeSignerCtx(Object.assign({
    role: 'cp1',
    docs: [{ title: 'Subscription agreement', html: '<p>Body</p>' }],
    editableFields: { fields: [] }
  }, over || {}));
}

// Fill every required editable field an attester leg has, so the ONLY thing
// standing between the click and a POST is the gate under test. Without this
// the required-field gate fires first and the test proves nothing about the
// gate it claims to cover.
async function fillLawyerLeg(rig) {
  rig.setField('firstName', 'בדיקה');
  rig.setField('lastName', 'בדיקה');
  rig.setField('email', 'noa@legacyvpartners.com');
  rig.setField('phone', '0501234567');
  rig.setField('licenseNumber', '987654');
  rig.setField('checkIncome', true);
  await rig.signTyped('עורך דין בדיקה');
}

// The four observables that together mean "named and marked".
function marks(rig, fieldSel, ctrlSel, msgId) {
  const doc = rig.document;
  const field = doc.querySelector(fieldSel);
  const ctrl = doc.querySelector(ctrlSel);
  const msg = doc.getElementById(msgId);
  const summary = doc.getElementById('err-summary');
  return {
    fieldMarked: !!(field && field.classList.contains('field--error')),
    ariaInvalid: ctrl ? ctrl.getAttribute('aria-invalid') : null,
    msgShown: !!(msg && !msg.hidden && (msg.textContent || '').trim()),
    msgText: msg ? (msg.textContent || '').trim() : null,
    summaryShown: !!(summary && !summary.hidden),
    summaryItems: [...doc.querySelectorAll('#err-summary-list li')].map((li) => (li.textContent || '').trim())
  };
}

(async () => {
  // ---- S1: the stamp gate names and marks the stamp field -----------------
  {
    const rig = await loadSignerPage({ ctx: lawyerCtx() });
    await fillLawyerLeg(rig);
    ok('S1 setup: stamp input rendered for the lawyer role',
      !!rig.q('[data-stamp-upload]'));
    rig.click('#done');
    await rig.settle(400);

    ok('S1 the gate still BLOCKS (no record_signature POST)',
      rig.posts().length === 0, 'posts=' + rig.posts().length);

    const m = marks(rig, '[data-stamp-slot="lawyer_stamp"]', '[data-stamp-upload]', 'err-stamp-lawyer_stamp');
    ok('S1 the stamp .field is marked .field--error', m.fieldMarked);
    ok('S1 the stamp control carries aria-invalid="true"', m.ariaInvalid === 'true', 'got ' + m.ariaInvalid);
    ok('S1 the per-field message beside the control is VISIBLE and non-empty',
      m.msgShown, JSON.stringify(m.msgText));
    ok('S1 the error summary is shown', m.summaryShown);
    ok('S1 the summary NAMES the stamp field by its label',
      m.summaryItems.some((t) => /חותמת/.test(t)), JSON.stringify(m.summaryItems));
  }

  // ---- S2: #err is announced to assistive tech ----------------------------
  {
    const rig = await loadSignerPage({ ctx: lawyerCtx() });
    const err = rig.document.getElementById('err');
    ok('S2 #err carries role="alert"', err && err.getAttribute('role') === 'alert',
      err && err.getAttribute('role'));
    ok('S2 #err carries an aria-live value', !!(err && err.getAttribute('aria-live')),
      err && err.getAttribute('aria-live'));
  }

  // ---- S3: attaching the stamp CLEARS the mark ----------------------------
  // A mark that outlives the problem is its own defect: the summary would keep
  // naming a field the attester has already dealt with.
  {
    const rig = await loadSignerPage({ ctx: lawyerCtx() });
    await fillLawyerLeg(rig);
    rig.click('#done');
    await rig.settle(400);
    ok('S3 precondition: the field is marked after the blocked submit',
      marks(rig, '[data-stamp-slot="lawyer_stamp"]', '[data-stamp-upload]', 'err-stamp-lawyer_stamp').fieldMarked);

    await rig.attachFile('[data-stamp-upload]', 'stamp.png');
    await rig.settle(250);
    const m = marks(rig, '[data-stamp-slot="lawyer_stamp"]', '[data-stamp-upload]', 'err-stamp-lawyer_stamp');
    ok('S3 attaching the stamp clears .field--error', !m.fieldMarked);
    ok('S3 attaching the stamp clears the per-field message', !m.msgShown, JSON.stringify(m.msgText));
    ok('S3 the summary no longer names the stamp field',
      !m.summaryItems.some((t) => /חותמת/.test(t)), JSON.stringify(m.summaryItems));
  }

  // ---- S4: POSITIVE CONTROL - the gate was not weakened -------------------
  // If this ever fails, the fix above has turned a real refusal into a pass,
  // which is far worse than the defect it replaced.
  {
    const rig = await loadSignerPage({ ctx: lawyerCtx() });
    await fillLawyerLeg(rig);
    await rig.attachFile('[data-stamp-upload]', 'stamp.png');
    await rig.settle(250);
    rig.click('#done');
    await rig.settle(500);
    ok('S4 a complete attester leg WITH a stamp still posts',
      rig.posts().length === 1, 'posts=' + rig.posts().length + ' errors=' + JSON.stringify(rig.errors.slice(0, 1)));
  }

  // ---- S5: the CP identification gate names and marks its field -----------
  // Same class, same file, same sibling gate: it too only set errEl.textContent.
  {
    const rig = await loadSignerPage({ ctx: cpCtx() });
    await rig.signTyped('משקיע בדיקה');
    ok('S5 setup: the CP ID slots rendered', !!rig.q('[data-id-upload]'));
    rig.click('#done');
    await rig.settle(400);

    ok('S5 the gate still BLOCKS (no record_signature POST)',
      rig.posts().length === 0, 'posts=' + rig.posts().length);

    const m = marks(rig, '[data-id-slot="passportPrimary"]', '#id-passportPrimary', 'err-id-passportPrimary');
    ok('S5 the identification .field is marked .field--error', m.fieldMarked);
    ok('S5 the identification control carries aria-invalid="true"', m.ariaInvalid === 'true', 'got ' + m.ariaInvalid);
    ok('S5 the per-field message beside the control is VISIBLE and non-empty',
      m.msgShown, JSON.stringify(m.msgText));
    ok('S5 the summary NAMES the identification field',
      m.summaryShown && m.summaryItems.length > 0, JSON.stringify(m.summaryItems));
  }

  // ---- S6: the unsupported-field gate names the field ---------------------
  // A server-declared field with no client renderer is a hard block that used
  // to say only "complete this with Legacy Value Partners", naming nothing -
  // and it renders no control at all, so the summary has to read the marked
  // CONTAINER's label to name it.
  {
    const rig = await loadSignerPage({
      ctx: lawyerCtx({ editableFields: { fields: LAWYER_FIELDS.concat(['someFieldTheClientCannotRender']) } })
    });
    await fillLawyerLeg(rig);
    rig.click('#done');
    await rig.settle(400);

    ok('S6 the gate still BLOCKS (no record_signature POST)',
      rig.posts().length === 0, 'posts=' + rig.posts().length);
    const doc = rig.document;
    const summary = doc.getElementById('err-summary');
    const items = [...doc.querySelectorAll('#err-summary-list li')].map((li) => (li.textContent || '').trim());
    ok('S6 the error summary is shown', !!(summary && !summary.hidden));
    ok('S6 the summary NAMES the unrenderable field',
      items.some((t) => /someFieldTheClientCannotRender/.test(t)), JSON.stringify(items));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
