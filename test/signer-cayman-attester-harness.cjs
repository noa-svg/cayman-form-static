// signer-cayman-attester-harness.cjs (2026-09-08)
//
// The Cayman lawyer / CPA could not sign ANY pack. routes/signerform.ts's
// buildEditableFields returns, for role 'lawyer' on the Cayman lane, four
// fields the Israeli attester set never had: verifiedOn on every applicant,
// plus checkAuditedFinancials / auditedFinancialsDate / checkShareholders on
// an entity. signer.html had a client def for none of them, so each rendered
// as the field--unsupported notice and doSignSubmit_'s hard block refused the
// submit. The attester saw no way through, on the link, with no recourse.
//
// That block is correct and is NOT weakened here: a server-declared field with
// no renderer must never be silently dropped. The mismatch was the bug, and
// the client was the side that was behind - counsel's Schedule 2 consumes all
// four as real tokens (docpack/caymanSources.ts 'schedule-2-lawyer':
// schedule2.methods.verifiedOn / .checkAuditedFinancials /
// .auditedFinancialsDate / .checkShareholders), docpack/caymanScope.ts:648-660
// binds them, domain/recordSignature.ts:325-328 persists them, and
// domain/israeli/validate.ts:155-157 counts the two corporate boxes toward the
// at-least-one-evidence rule.
//
// So this harness proves the thing the bug denied: a Cayman attester, both
// applicant types, reaches "Sign and submit" and a record_signature POST
// actually leaves the page carrying what they attested. It drives the real
// signer.html in jsdom (rig-signer.cjs); no gate is stubbed.
//
// Run: node test/signer-cayman-attester-harness.cjs
'use strict';
const { loadSignerPage, makeSignerCtx } = require('./rig-signer.cjs');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }

// VERBATIM from routes/signerform.ts buildEditableFields (:266-280), the
// role==='lawyer' branch below its israeli lane-gate. If that server list
// changes and this one does not, the unsupported-field block fires and the
// first assertion below goes red - which is exactly the alarm that was missing.
const CAYMAN_LAWYER_FIELDS_INDIVIDUAL = [
  'firstName', 'lastName', 'licenseNumber', 'firmName', 'email', 'phone', 'attestationConfirmed',
  'verifiedOn', 'checkLiquid', 'evidenceDate', 'checkIncome', 'checkOther', 'otherEvidence',
];
const CAYMAN_LAWYER_FIELDS_ENTITY = [
  'firstName', 'lastName', 'licenseNumber', 'firmName', 'email', 'phone', 'attestationConfirmed',
  'verifiedOn', 'checkAuditedFinancials', 'auditedFinancialsDate', 'checkShareholders', 'checkOther', 'otherEvidence',
];

function caymanLawyerCtx(fields, lockedOver) {
  return makeSignerCtx({
    lane: 'cayman',
    role: 'lawyer',
    signerName: 'Attester Example',
    lockedContext: Object.assign({ primaryInvestor: { name: 'Subscriber Example' } }, lockedOver || {}),
    editableFields: { type: 'lawyer_attestation', fields: fields },
    // The lawyer's pack is confidentiality-scoped to schedule2_lawyer alone
    // (signerform.ts:476-489), so one doc is the real shape here.
    docs: [{ key: 'schedule2_lawyer', title: 'Schedule 2: Lawyer / CPA Verification', html: '<p>Verification text</p>' }],
  });
}

// Tolerant setter. A field the page failed to render is already reported by the
// unrenderable-field assertion; crashing here would abort the run and hide every
// later shape, so swallow the miss and carry on to the end.
function trySet(rig, name, value) {
  try { rig.setField(name, value); return true; } catch (e) { return false; }
}

// The submit path requires a stamp for role 'lawyer' regardless of lane
// (doSignSubmit_'s stamp gate is lane-blind). Attaching one here is what a real
// attester does today; whether the CAYMAN lane should ask for it at all is a
// separate open question, since only the Israeli seal places it.
async function completeAndSubmit(rig, values) {
  Object.keys(values).forEach((k) => trySet(rig, k, values[k]));
  await rig.attachFile('[data-stamp-upload="lawyer_stamp"]', 'stamp.png');
  await rig.signTyped('Attester Example');
  rig.click('#done');
  await rig.settle(400);
}

function postedLawyer(rig) {
  const posts = rig.posts();
  if (!posts.length) return null;
  const body = JSON.parse(posts[posts.length - 1].body);
  return (body.payload && body.payload.lawyer) || null;
}

(async () => {
  // ---- 1. Cayman INDIVIDUAL applicant -------------------------------------
  {
    const rig = await loadSignerPage({ ctx: caymanLawyerCtx(CAYMAN_LAWYER_FIELDS_INDIVIDUAL) });
    const { document } = rig;

    ok('individual: page booted clean', rig.errors.length === 0, rig.errors.slice(0, 2));
    // The lockout itself: every declared field has a renderer.
    const unsupported = Array.from(document.querySelectorAll('#signer-form .field--unsupported'))
      .map((el) => String((el.querySelector('label') || {}).textContent || '').trim());
    ok('individual: no server field is left unrenderable', unsupported.length === 0, unsupported);
    ok('individual: verifiedOn renders as a date input',
      !!document.querySelector('#signer-form input[name="verifiedOn"][type="date"]'));
    // Cayman is an English pack. The Israeli Hebrew clause text used to render
    // here for these two, because the label override keyed off companyName
    // rather than the lane.
    const liquidLabel = String((document.querySelector('#signer-form [data-field="checkLiquid"]') || {}).textContent || '');
    ok('individual: the evidence clause renders in English on the Cayman lane',
      /Liquid Assets/.test(liquidLabel) && !/[֐-׿]/.test(liquidLabel), liquidLabel.slice(0, 80));

    await completeAndSubmit(rig, {
      firstName: 'Attester', lastName: 'Example', licenseNumber: '12345', firmName: 'Example & Co',
      email: 'attester@example.com', phone: '+972500000000', attestationConfirmed: true,
      verifiedOn: '2026-09-01', checkLiquid: true, evidenceDate: '2026-08-20',
    });

    const posts = rig.posts();
    ok('individual: an attester CAN complete the submit (record_signature posted)', posts.length === 1,
      { posts: posts.length, err: String((document.getElementById('err') || {}).textContent || '') });
    const law = postedLawyer(rig);
    ok('individual: payload.lawyer was built', !!law);
    if (law) {
      ok('individual: verifiedOn travels', law.verifiedOn === '2026-09-01', law.verifiedOn);
      ok('individual: checkLiquid is a real boolean, not the string "true"', law.checkLiquid === true, law.checkLiquid);
      ok('individual: evidenceDate travels', law.evidenceDate === '2026-08-20', law.evidenceDate);
      ok('individual: licence number travels', law.licenseNumber === '12345', law.licenseNumber);
      ok('individual: the corporate measures are present and false', law.checkAuditedFinancials === false && law.checkShareholders === false,
        { a: law.checkAuditedFinancials, s: law.checkShareholders });
    }
  }

  // ---- 2. Cayman ENTITY applicant ------------------------------------------
  {
    const rig = await loadSignerPage({
      ctx: caymanLawyerCtx(CAYMAN_LAWYER_FIELDS_ENTITY, { companyName: 'Example Holdings Ltd', registrationNumber: '515000000' }),
    });
    const { document } = rig;

    ok('entity: page booted clean', rig.errors.length === 0, rig.errors.slice(0, 2));
    const unsupported = Array.from(document.querySelectorAll('#signer-form .field--unsupported'))
      .map((el) => String((el.querySelector('label') || {}).textContent || '').trim());
    ok('entity: no server field is left unrenderable', unsupported.length === 0, unsupported);
    ok('entity: checkAuditedFinancials renders as a checkbox',
      !!document.querySelector('#signer-form input[name="checkAuditedFinancials"][type="checkbox"]'));
    ok('entity: checkShareholders renders as a checkbox',
      !!document.querySelector('#signer-form input[name="checkShareholders"][type="checkbox"]'));
    ok('entity: auditedFinancialsDate renders as a date input',
      !!document.querySelector('#signer-form input[name="auditedFinancialsDate"][type="date"]'));

    // The evidence-group check used to require all three ISRAELI boxes to be
    // present before it ran. On this shape checkLiquid and checkIncome do not
    // exist at all, so it did not run and an entity attester could submit having
    // ticked nothing. Prove the group rule now covers the corporate boxes.
    const errEl = document.getElementById('err');
    trySet(rig, 'firstName', 'Attester'); trySet(rig, 'lastName', 'Example');
    trySet(rig, 'licenseNumber', '12345'); trySet(rig, 'firmName', 'Example & Co');
    trySet(rig, 'email', 'attester@example.com'); trySet(rig, 'phone', '+972500000000');
    trySet(rig, 'attestationConfirmed', true); trySet(rig, 'verifiedOn', '2026-09-01');
    await rig.attachFile('[data-stamp-upload="lawyer_stamp"]', 'stamp.png');
    await rig.signTyped('Attester Example');
    rig.click('#done');
    await rig.settle(300);
    ok('entity: no evidence box ticked is refused, not posted', rig.posts().length === 0,
      { posts: rig.posts().length });
    ok('entity: the refusal is visible', String(errEl.textContent || '').trim() !== '', errEl.textContent);

    // Ticking the corporate box without its date is refused too (counsel's own
    // "latest available report date" companion).
    trySet(rig, 'checkAuditedFinancials', true);
    rig.click('#done');
    await rig.settle(300);
    ok('entity: audited financials ticked with no report date is refused', rig.posts().length === 0);

    trySet(rig, 'auditedFinancialsDate', '2025-12-31');
    trySet(rig, 'checkShareholders', true);
    rig.click('#done');
    await rig.settle(400);
    ok('entity: an entity attester CAN complete the submit', rig.posts().length === 1,
      { posts: rig.posts().length, err: String(errEl.textContent || '') });
    const law = postedLawyer(rig);
    ok('entity: payload.lawyer was built for an entity attester', !!law);
    if (law) {
      ok('entity: checkAuditedFinancials travels as true', law.checkAuditedFinancials === true, law.checkAuditedFinancials);
      ok('entity: checkShareholders travels as true', law.checkShareholders === true, law.checkShareholders);
      ok('entity: auditedFinancialsDate travels', law.auditedFinancialsDate === '2025-12-31', law.auditedFinancialsDate);
      ok('entity: verifiedOn travels', law.verifiedOn === '2026-09-01', law.verifiedOn);
      ok('entity: licence number travels', law.licenseNumber === '12345', law.licenseNumber);
      ok('entity: the individual measures are present and false', law.checkLiquid === false && law.checkIncome === false,
        { l: law.checkLiquid, i: law.checkIncome });
    }
  }

  // ---- 3. The unsupported-field block is still armed -----------------------
  // The fix must not have blunted the guard it satisfied. A field the server
  // invents with no client def must still stop the submit dead.
  {
    const rig = await loadSignerPage({
      ctx: caymanLawyerCtx(CAYMAN_LAWYER_FIELDS_INDIVIDUAL.concat(['someFieldNobodyRenders'])),
    });
    ok('guard: an unrenderable field still renders the notice',
      rig.document.querySelectorAll('#signer-form .field--unsupported').length === 1);
    await rig.attachFile('[data-stamp-upload="lawyer_stamp"]', 'stamp.png');
    await rig.signTyped('Attester Example');
    rig.click('#done');
    await rig.settle(300);
    ok('guard: an unrenderable field still hard-blocks the submit', rig.posts().length === 0);
  }

  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e); process.exit(1); });
