// israel-sigpad-encode-harness.cjs (2026-08-23, CTO review finding #30).
//
// The Israeli signature pad used to re-encode the WHOLE canvas to a PNG data
// URL on every pointermove: a full image encode per touch sample, dozens of
// times a second, mid-stroke, on a 2x-DPR phone. The symptom is a pad that
// stutters and drops parts of the stroke on a mid-range Android, on the one
// screen where a bad experience is most expensive. signer.html has always
// captured at submit only; israel.html now matches it.
//
// Driven through the REAL israel.html under rig-israel.cjs, walking the actual
// page sequence a live LP walks, because the claim is about what happens
// between a fingertip and a submitted envelope:
//
//   S1  drawing produces ZERO canvas encodes. This is the fix, and the encode
//       count is the observable that made the pad stutter.
//   S2  the signature still reaches the server. A "fast" pad that posts an
//       empty signature is a worse bug than the one being fixed, so the same
//       run that proves S1 also reads signaturePng off the wire.
//   S3  a rotate mid-session (resize -> refit) still preserves the signature.
//       refit is the one non-submit place that legitimately needs the PNG, and
//       it is where a capture-on-demand rewrite can silently lose a stroke.
//
// Run: node test/israel-sigpad-encode-harness.cjs
'use strict';
const LVPRules = require('../validation-rules.js');
const bankRegistry = require('../bank-registry.json');
const {
  loadIsraelForm, setField, checkRadio, checkBox,
  currentPage, clickNext, drawSignature, sleep
} = require('./rig-israel.cjs');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}

// Obviously-synthetic identity. Nothing leaves the mocked transport.
const LP = {
  firstName: 'משקיע', lastName: 'בדיקה',
  enFirst: 'Test', enLast: 'Investor',
  id: '123456782',                    // checksum-valid synthetic
  birthDate: '15/03/1980',
  occupation: 'ניהול השקעות',
  email: 'noa+test@legacyvpartners.com',
  phone: '0541234567',
  address: { search: 'הרצל 10, תל אביב', street: 'הרצל', city: 'תל אביב', house: '10', zip: '6688312', enStreet: 'Herzl', enCity: 'Tel Aviv' }
};
const BANK = bankRegistry.banks.find((b) => b.c === 10);
const BRANCH = BANK.br[0];
function investmentDate() {
  const d = LVPRules.firstOfNextMonth();
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  return p2(d.getUTCDate()) + '/' + p2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
}
const PREFILL_UPLOADS = {
  'investors.0.idPhoto': { fileName: 'teudat-zehut.pdf' },
  // 2026-08-26: the ספח is now a required upload; seed it or the flow stalls on uploads.
  'investors.0.idAppendix': { fileName: 'sefach.pdf' },
  'investors.0.passport': { fileName: 'passport.pdf' },
  'investors.0.accountManagementApproval': { fileName: 'ishur-nihul-cheshbon.pdf' },
  'investors.0.qualification': { fileName: 'tofes-kshirut-chatum.pdf' }
};

// Walk the real page sequence up to (but not through) the signature step.
async function walkToSignPage(rig, tag) {
  const d = rig.document;
  ok(tag + ' boots on welcome', currentPage(d) === 'welcome', currentPage(d));
  await clickNext(d);
  setField(d, 'investorsArray[0].firstName', LP.firstName);
  setField(d, 'investorsArray[0].lastName', LP.lastName);
  setField(d, 'investorsArray[0].englishDetails.firstName', LP.enFirst);
  setField(d, 'investorsArray[0].englishDetails.lastName', LP.enLast);
  checkRadio(d, 'investorsArray[0].gender', 'זכר');
  setField(d, 'investorsArray[0].idNumber', LP.id);
  setField(d, 'investorsArray[0].birthDate', LP.birthDate);
  setField(d, 'investorsArray[0].birthCountry', 'ישראל');
  setField(d, 'investorsArray[0].citizenship', 'ישראל');
  setField(d, 'investorsArray[0].occupation', LP.occupation);
  setField(d, 'investorsArray[0].residencyCountry', 'ישראל');
  setField(d, 'investorsArray[0].israelAddressSearch', LP.address.search);
  setField(d, 'investorsArray[0].israelAddress.street', LP.address.street);
  setField(d, 'investorsArray[0].israelAddress.city', LP.address.city);
  setField(d, 'investorsArray[0].israelAddress.houseNumber', LP.address.house);
  setField(d, 'investorsArray[0].israelAddress.postalCode', LP.address.zip);
  setField(d, 'investorsArray[0].englishDetails.englishAddress.street', LP.address.enStreet);
  setField(d, 'investorsArray[0].englishDetails.englishAddress.city', LP.address.enCity);
  setField(d, 'investorsArray[0].email', LP.email);
  setField(d, 'investorsArray[0].phoneNumber', LP.phone);
  await clickNext(d);

  checkBox(d, 'investorsArray[0].qualification.isLiquidAssets');
  checkRadio(d, 'investorsArray[0].qualification.isSignedQualification', 'כן');
  await clickNext(d);

  setField(d, 'moneyInvestedInFund.investedAmountArray[0].investedCurrency', 'שקל');
  setField(d, 'moneyInvestedInFund.investedAmount', '500000');
  setField(d, 'moneyInvestedInFund.investmentDate', investmentDate());
  setField(d, 'moneyInvestedInFund.bankDetails.bankNameIsrael', BANK.n);
  setField(d, 'moneyInvestedInFund.bankDetails.branchNumberIsrael', String(BRANCH[0]));
  setField(d, 'moneyInvestedInFund.bankDetails.accountNumber', '740800/88');
  setField(d, 'moneyInvestedInFund.moneySource', 'הון עצמי');
  checkBox(d, 'taxDeclaration.isNonBusinessIncome');
  await clickNext(d);

  checkRadio(d, 'beneficiaryStatement.statement', 'self');
  await clickNext(d);
  checkRadio(d, 'investorsArray[0].taxResidency.taxCountry', 'ישראל בלבד');
  await clickNext(d);
  checkRadio(d, 'additionalInvestors', 'לא');
  await clickNext(d);
  const landed = await clickNext(d);
  ok(tag + ' reaches the signature page', landed === 'ind.sign', landed);
  await sleep(80);
  return d;
}

// Count every canvas-to-PNG encode from this point on.
function countEncodes(rig) {
  const proto = rig.window.HTMLCanvasElement.prototype;
  const real = proto.toDataURL;
  const state = { n: 0 };
  proto.toDataURL = function () { state.n++; return real.apply(this, arguments); };
  return state;
}

(async () => {
  // ---- S1 + S2: draw, then submit ------------------------------------------
  {
    const rig = await loadIsraelForm({ cfg: { prefillUploads: PREFILL_UPLOADS } });
    const d = await walkToSignPage(rig, 'S1');

    const enc = countEncodes(rig);
    await drawSignature(rig.window);   // mousedown + 12 mousemoves + mouseup
    ok('S1 drawing a signature triggers ZERO canvas encodes', enc.n === 0,
      enc.n + ' encodes during a 12-sample stroke');

    ok('S1 sign -> review', (await clickNext(d)) === 'review', currentPage(d));
    d.querySelector('[data-action="submit"]').click();
    await sleep(300);

    const submitCall = rig.gatewayCalls.find((c) => c.body && c.body.action === 'submit');
    ok('S2 the submit POST fired', !!submitCall);
    const png = submitCall && submitCall.body.payload && submitCall.body.payload.signaturePng;
    ok('S2 the drawn signature still rides the envelope',
      typeof png === 'string' && png.indexOf('data:image/png') === 0, JSON.stringify(png));
    ok('S2 the encode happened at submit, not during the stroke', enc.n >= 1, enc.n);
  }

  // ---- S3: a rotate mid-session must not lose the signature ----------------
  {
    const rig = await loadIsraelForm({ cfg: { prefillUploads: PREFILL_UPLOADS } });
    const d = await walkToSignPage(rig, 'S3');
    await drawSignature(rig.window);
    // refit() bails out when the pad measures 0 wide, which is what jsdom
    // reports for EVERY element. Without a real box on the canvas the resize
    // handler returns immediately and this whole block would assert nothing -
    // so give the pad a box first, and only the pad, so no other page logic
    // starts seeing hidden elements as laid out.
    const pad = d.querySelector('#sig-pad');
    pad.getBoundingClientRect = function () {
      return { width: 320, height: 160, top: 0, left: 0, right: 320, bottom: 160, x: 0, y: 0 };
    };
    // The pad debounces resize/orientationchange by 200ms and then re-fits.
    rig.window.dispatchEvent(new rig.window.Event('resize'));
    await sleep(320);
    rig.window.dispatchEvent(new rig.window.Event('orientationchange'));
    await sleep(320);

    ok('S3 sign -> review after a rotate', (await clickNext(d)) === 'review', currentPage(d));
    d.querySelector('[data-action="submit"]').click();
    await sleep(300);
    const submitCall = rig.gatewayCalls.find((c) => c.body && c.body.action === 'submit');
    const png = submitCall && submitCall.body.payload && submitCall.body.payload.signaturePng;
    ok('S3 the signature survives a rotate and still posts',
      typeof png === 'string' && png.indexOf('data:image/png') === 0, JSON.stringify(png));
  }

  // ---- S4: an unsigned pad still blocks the submit --------------------------
  // The capture-on-demand rewrite must not turn "no signature" into a truthy
  // value: the gate reads the pad at submit now, so this is the case that would
  // regress into posting a blank signature.
  {
    const rig = await loadIsraelForm({ cfg: { prefillUploads: PREFILL_UPLOADS } });
    const d = await walkToSignPage(rig, 'S4');
    ok('S4 sign -> review without drawing', (await clickNext(d)) === 'review', currentPage(d));
    d.querySelector('[data-action="submit"]').click();
    await sleep(300);
    const submitCall = rig.gatewayCalls.find((c) => c.body && c.body.action === 'submit');
    ok('S4 an unsigned pad posts nothing', !submitCall,
      submitCall && JSON.stringify(submitCall.body.payload.signaturePng));
    ok('S4 the LP is sent back to the signature page', currentPage(d) === 'ind.sign', currentPage(d));
  }

  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS CRASH:', e); process.exit(1); });
