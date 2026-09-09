// zz-cayman-verified-on-copy.cjs - the attester's verification date on the
// CLIENT: the two messages Noa approved 2026-09-08, and the 90-day window
// measured back from today (her ruling: from the signing moment, not from the
// 2027-01-01 subscription date).
//
// The server is the authority (ju-service domain/cayman/verificationWindow.ts
// and the verified_on_required / verified_on_out_of_window codes). This file
// only proves the browser states the same rule early, so the attester is told
// on their own pane instead of bounced by a round-trip.
'use strict';
const { loadSignerPage, makeSignerCtx } = require('./rig-signer.cjs');
let pass = 0, fail = 0;
function ok(l, c, x) { if (c) { pass++; console.log('ok   ' + l); } else { fail++; console.log('FAIL ' + l + (x === undefined ? '' : ' :: ' + x)); } }

const CAY_IND = ['firstName','lastName','licenseNumber','firmName','email','phone','attestationConfirmed','verifiedOn','checkLiquid','evidenceDate','checkIncome','checkOther','otherEvidence'];

// Computed, never a literal: the rule runs back from TODAY, so a hardcoded date
// would pass now and turn red on a calendar day nobody chose.
function iso(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

async function boot() {
  return loadSignerPage({ ctx: makeSignerCtx({
    lane: 'cayman', role: 'lawyer',
    docs: [{ key: 'schedule2_lawyer', title: 'Schedule 2 - Qualification', html: '<p>Qualification body</p>' }],
    lockedContext: {},
    editableFields: { type: 'lawyer_attestation', fields: CAY_IND }
  })});
}

// Fill everything EXCEPT verifiedOn, which each test sets itself.
async function fillRest(rig) {
  ['firstName','lastName','licenseNumber','firmName','email','phone','evidenceDate','otherEvidence']
    .forEach(n => {
      const el = rig.document.querySelector('#signer-form [name="' + n + '"]');
      if (el) { el.value = (n === 'email') ? 'a@example.invalid' : (n === 'evidenceDate') ? iso(7) : 'X'; el.dispatchEvent(new rig.window.Event('input', { bubbles: true })); }
    });
  ['attestationConfirmed','checkLiquid'].forEach(n => {
    const el = rig.document.querySelector('#signer-form [name="' + n + '"]');
    if (el) { el.checked = true; el.dispatchEvent(new rig.window.Event('change', { bubbles: true })); }
  });
}

async function setVerifiedOn(rig, v) {
  const el = rig.document.querySelector('#signer-form [name="verifiedOn"]');
  el.value = v;
  el.dispatchEvent(new rig.window.Event('input', { bubbles: true }));
}
function msg(rig) {
  const el = rig.document.getElementById('err-verifiedOn');
  return el ? String(el.textContent || '').trim() : '(no message element)';
}
async function attachStamp(rig) {
  const inp = rig.q('#stamp-lawyer_stamp');
  const f = new rig.window.File([new Uint8Array([1, 2, 3, 4])], 'stamp.png', { type: 'image/png' });
  Object.defineProperty(inp, 'files', { value: [f], configurable: true });
  inp.dispatchEvent(new rig.window.Event('change', { bubbles: true }));
  await rig.settle(220);
}
async function submit(rig) {
  await rig.signTyped('Ada Attester');
  await attachStamp(rig);
  rig.click('#done');
  await rig.settle(800);
}

const BLANK_COPY = "Enter the date you checked the investor's documents.";
const WINDOW_COPY = "That date is outside the 90 days the form allows. Enter the date you checked the documents, within the last 90 days.";

(async () => {
  // 1. Marked required in the label, not only enforced on submit.
  {
    const rig = await boot();
    const lbl = rig.document.querySelector('#signer-form label[for="f-verifiedOn"]');
    ok('V1 the date is visibly required', !!lbl && /\*/.test(lbl.textContent), lbl && lbl.textContent);
    const inp = rig.document.querySelector('#signer-form [name="verifiedOn"]');
    ok('V2 and required to the browser and to a screen reader', !!inp && inp.hasAttribute('required') && inp.getAttribute('aria-required') === 'true');
    ok('V3 it is a date control, not a free-text box', inp && inp.getAttribute('type') === 'date', inp && inp.getAttribute('type'));
    // The label must not quote a rule the page does not enforce. It used to read
    // "not older than 90 days from the date of subscription" - counsel's own
    // reference - while the form measures from the SIGNING moment (Noa,
    // 2026-09-08). Counsel's sentence stays untouched in the SEALED document;
    // this is only the field the attester fills in.
    ok('V3b the label does not quote the subscription reference the form does not use',
       !!lbl && !/date of subscription/i.test(lbl.textContent), lbl && lbl.textContent);
  }

  // 2. Blank: the approved wording, and no request sent.
  {
    const rig = await boot(); await fillRest(rig); await setVerifiedOn(rig, '');
    await submit(rig);
    ok('V4 a blank date blocks the submit', rig.posts().length === 0, 'posts=' + rig.posts().length);
    ok('V5 blank shows the approved wording, not "This field is required."', msg(rig) === BLANK_COPY, msg(rig));
  }

  // 3. Older than 90 days: the approved wording, and no request sent.
  {
    const rig = await boot(); await fillRest(rig); await setVerifiedOn(rig, iso(120));
    await submit(rig);
    ok('V6 a date 120 days old blocks the submit', rig.posts().length === 0, 'posts=' + rig.posts().length);
    ok('V7 out-of-window shows the approved wording', msg(rig) === WINDOW_COPY, msg(rig));
  }

  // 4. The future is not a verification date either.
  {
    const rig = await boot(); await fillRest(rig); await setVerifiedOn(rig, iso(-5));
    await submit(rig);
    ok('V8 a future date blocks the submit', rig.posts().length === 0, 'posts=' + rig.posts().length);
    ok('V9 and says so with the same approved wording', msg(rig) === WINDOW_COPY, msg(rig));
  }

  // 5. Inside the window: through, and the value actually reaches the server.
  {
    const rig = await boot(); await fillRest(rig); await setVerifiedOn(rig, iso(30));
    await submit(rig);
    ok('V10 a date 30 days old goes through', rig.posts().length === 1, 'err=' + rig.q('#err').textContent);
    if (rig.posts().length === 1) {
      const pl = JSON.parse(rig.posts()[0].body).payload;
      ok('V11 and the date reaches the server on payload.lawyer', !!(pl.lawyer && pl.lawyer.verifiedOn === iso(30)), JSON.stringify(pl.lawyer && pl.lawyer.verifiedOn));
    } else { fail++; console.log('FAIL V11 no post to inspect'); }
  }

  // 6. The exact boundary counsel wrote. "Not older than 90 days" includes the
  //    90th day; it would have to read "less than 90" to exclude it. Same
  //    reading as the server predicate and as Israel's own 3-month rule.
  {
    const rig = await boot(); await fillRest(rig); await setVerifiedOn(rig, iso(90));
    await submit(rig);
    ok('V12 exactly 90 days old is INSIDE the window', rig.posts().length === 1, msg(rig));
  }
  {
    const rig = await boot(); await fillRest(rig); await setVerifiedOn(rig, iso(91));
    await submit(rig);
    ok('V13 and 91 days old is not', rig.posts().length === 0 && msg(rig) === WINDOW_COPY, msg(rig));
  }

  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
