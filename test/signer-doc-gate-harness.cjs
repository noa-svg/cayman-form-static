// signer-doc-gate-harness.cjs (2026-08-23, CTO review findings #12 and #50).
//
// Both claims are driven through the REAL signer.html under the jsdom boot rig
// (rig-signer.cjs). The observable in every case is the same one that matters
// to the fund: did a record_signature POST leave this page, and what was in it.
//
//   G (finding #12). The doc-ready gate exists so nobody signs a document they
//     could not see. It used to accept ANY .doc__note as proof a document had
//     rendered - and a doc the server returned with an ERROR renders exactly
//     that note. So the failure case was read as success and a controlling
//     person, joint holder or lawyer could sign a pack they had been shown an
//     error message instead of. Proof of a rendered doc is now a real
//     .doc__body or an acroFill note; the unavailable note carries its own
//     class and must never satisfy the gate.
//
//   L (finding #50). The EN/HE re-render rebuilt each checkbox's inline label
//     without re-emitting id="f-<name>", so after ONE language toggle the three
//     lawyer-evidence lookups returned null. That silently disabled the
//     at-least-one-evidence group check AND skipped building payload.lawyer
//     entirely, so the evidence selections and the licence number were dropped
//     server-side and the qualification doc sealed with empty evidence boxes -
//     while the signature itself posted happily. Latent only because the toggle
//     is display:none today. Belt and braces: the id is re-emitted, AND the
//     submit path looks fields up by [name] first, so either alone holds.
//
// Run: node test/signer-doc-gate-harness.cjs
'use strict';
const { loadSignerPage, makeSignerCtx } = require('./rig-signer.cjs');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}

// A joint holder: no CP identification gate, no lawyer stamp gate, so the doc
// gate and the signature gate are the only things between a click and a POST.
function jointCtx(docs) {
  return makeSignerCtx({ role: 'joint1', docs: docs });
}

const LAWYER_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'licenseNumber',
  'checkLiquid', 'checkIncome', 'checkOther', 'evidenceDate', 'otherEvidence'];
function lawyerCtx() {
  return makeSignerCtx({
    role: 'lawyer',
    docs: [{ title: 'Qualification', html: '<p>Body</p>' }],
    editableFields: { fields: LAWYER_FIELDS }
  });
}
async function toggleLanguage(rig) {
  rig.click('[data-lang-set="en"]');
  await rig.settle(60);
  rig.click('[data-lang-set="he"]');
  await rig.settle(60);
}

(async () => {
  // ---- G1: a doc the server could not produce blocks the signature ---------
  {
    const rig = await loadSignerPage({
      ctx: jointCtx([{ title: 'Subscription agreement', error: 'Document preview not available.' }])
    });
    ok('G1 no boot errors', rig.errors.length === 0, rig.errors[0]);
    ok('G1 the page did render the unavailable note (the case under test)',
      !!rig.q('#doc-list .doc__note--unavailable'), rig.q('#doc-list').innerHTML.slice(0, 200));
    await rig.signTyped('Test Signer');
    rig.click('#done');
    await rig.settle(400);
    ok('G1 NO signature POST leaves the page for an errored document',
      rig.posts().length === 0, JSON.stringify(rig.posts().map((p) => p.url)));
  }

  // ---- G2: a real rendered document still signs ----------------------------
  {
    const rig = await loadSignerPage({ ctx: jointCtx([{ title: 'Subscription agreement', html: '<p>Body text</p>' }]) });
    ok('G2 the doc body rendered', !!rig.q('#doc-list .doc__body'));
    await rig.signTyped('Test Signer');
    rig.click('#done');
    await rig.settle(400);
    ok('G2 a rendered document signs normally (the gate is not a blanket block)',
      rig.posts().length === 1, JSON.stringify(rig.posts().length));
  }

  // ---- G3: an acroFill doc (no preview by design) still signs ---------------
  // The W-8 branch has no HTML body on purpose: the form is completed from the
  // signer's answers. Its note is proof the doc IS there, unlike an error note.
  {
    const rig = await loadSignerPage({ ctx: jointCtx([{ title: 'W-8BEN', acroFill: true }]) });
    ok('G3 the acroFill note rendered with its own marker class',
      !!rig.q('#doc-list .doc__note--acrofill'));
    await rig.signTyped('Test Signer');
    rig.click('#done');
    await rig.settle(400);
    ok('G3 an acroFill doc still signs', rig.posts().length === 1);
  }

  // ---- G4: an empty doc list still blocks (unchanged behaviour) -------------
  {
    const rig = await loadSignerPage({ ctx: jointCtx([]) });
    await rig.signTyped('Test Signer');
    rig.click('#done');
    await rig.settle(400);
    ok('G4 an empty doc list still blocks the signature', rig.posts().length === 0);
  }

  // ---- G5: the language toggle cannot re-open the hole ---------------------
  // The re-render path re-stamps the note text; if it left the class behind, an
  // errored doc would start passing the gate after one toggle.
  {
    const rig = await loadSignerPage({
      ctx: jointCtx([{ title: 'Subscription agreement', error: 'Document preview not available.' }])
    });
    await toggleLanguage(rig);
    ok('G5 after an EN/HE toggle the note still carries the unavailable marker',
      !!rig.q('#doc-list .doc__note--unavailable') && !rig.q('#doc-list .doc__note--acrofill'),
      rig.q('#doc-list').innerHTML.slice(0, 200));
    await rig.signTyped('Test Signer');
    rig.click('#done');
    await rig.settle(400);
    ok('G5 still no signature POST after a language toggle', rig.posts().length === 0);
  }

  // ---- L1: the lawyer leg survives a language toggle ------------------------
  {
    const rig = await loadSignerPage({ ctx: lawyerCtx() });
    ok('L1 no boot errors', rig.errors.length === 0, rig.errors[0]);
    ok('L1 the evidence checkbox carries its id on first render',
      rig.q('#signer-form [name="checkLiquid"]').id === 'f-checkLiquid');
    await toggleLanguage(rig);
    ok('L1 the evidence checkbox STILL carries its id after an EN/HE toggle',
      rig.q('#signer-form [name="checkLiquid"]').id === 'f-checkLiquid',
      JSON.stringify(rig.q('#signer-form [name="checkLiquid"]').id));

    rig.setField('firstName', 'Test');
    rig.setField('lastName', 'Lawyer');
    rig.setField('email', 'noa+test@legacyvpartners.com');
    rig.setField('phone', '0501234567');
    rig.setField('licenseNumber', '987654');
    rig.setField('checkLiquid', true);
    rig.setField('evidenceDate', '2026-08-01');
    await rig.attachFile('[data-stamp-upload]');
    await rig.signTyped('Test Lawyer');
    rig.click('#done');
    await rig.settle(500);

    ok('L1 the signature posted', rig.posts().length === 1, JSON.stringify(rig.posts().length));
    const env = rig.posts().length ? JSON.parse(rig.posts()[0].body) : null;
    const lawyer = env && env.payload && env.payload.lawyer;
    ok('L1 the payload carries the lawyer leg at all (it used to vanish)', !!lawyer,
      env ? JSON.stringify(Object.keys(env.payload)) : 'no post');
    ok('L1 the evidence selection survives as a real boolean',
      !!lawyer && lawyer.checkLiquid === true && lawyer.checkIncome === false && lawyer.checkOther === false,
      JSON.stringify(lawyer));
    ok('L1 the licence number survives', !!lawyer && lawyer.licenseNumber === '987654',
      JSON.stringify(lawyer && lawyer.licenseNumber));
    ok('L1 the evidence date survives', !!lawyer && lawyer.evidenceDate === '2026-08-01',
      JSON.stringify(lawyer && lawyer.evidenceDate));
  }

  // ---- L2: the at-least-one-evidence group check survives a toggle ----------
  // The server's lawyer validator requires one evidence box, so the boxes carry
  // no individual `required`. If the lookup returns null the whole group check
  // is skipped and a lawyer signs an attestation with every box empty.
  {
    const rig = await loadSignerPage({ ctx: lawyerCtx() });
    await toggleLanguage(rig);
    rig.setField('firstName', 'Test');
    rig.setField('lastName', 'Lawyer');
    rig.setField('email', 'noa+test@legacyvpartners.com');
    rig.setField('phone', '0501234567');
    rig.setField('licenseNumber', '987654');
    // deliberately NO evidence box checked
    await rig.attachFile('[data-stamp-upload]');
    await rig.signTyped('Test Lawyer');
    rig.click('#done');
    await rig.settle(500);
    ok('L2 a lawyer with no evidence box checked cannot submit, even after a toggle',
      rig.posts().length === 0, JSON.stringify(rig.posts().length));
  }

  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS CRASH:', e); process.exit(1); });
