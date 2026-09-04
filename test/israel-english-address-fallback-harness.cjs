// israel-english-address-fallback-harness.cjs - reproduces the ינאי אורון
// incident (2026-09-04) under the jsdom rig and proves the fix.
//
// THE DEFECT: englishDetails.englishAddress.street/city is required server-side
// (unconditionally, for the W-8) but rides as a bare <input type="hidden"> with
// NO visible field and NO client-side check. It is normally filled invisibly by
// an async geocode of the Hebrew address; this rig's own Geocoder mock always
// returns ZERO_RESULTS (rig-israel.cjs:191), so a submission that fills the
// Hebrew address but never explicitly sets the English mirror reproduces
// exactly what happened live: a real Hebrew address, a geocode miss, a blank
// required field the LP has no way to see or fix. Before the fix this sailed
// straight into the submit POST and the server bounced it with a message
// naming no field, forever, on retry.
//
// E1  the blank English mirror BLOCKS the submit client-side instead of
//     posting an incomplete pack: no gateway 'submit' call fires.
//   E2  the matching .lvp-field--en-addr-fallback holder for investorsArray[0]
//     is revealed (un-hidden, input flipped from hidden to text) and marked in
//     error, and the LP is left on (or returned to) the page that carries it.
//   E3  filling the revealed field and submitting again succeeds: the submit
//     POST fires and carries the LP-typed English street/city.
// Run: node test/israel-english-address-fallback-harness.cjs
'use strict';
const {
  loadIsraelForm, setField, checkRadio, checkBox,
  currentPage, clickNext, drawSignature, sleep
} = require('./rig-israel.cjs');
const LVPRules = require('../validation-rules.js');
const bankRegistry = require('../bank-registry.json');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}

const LP = {
  firstName: 'ינאי', lastName: 'אורון',
  enFirst: 'Yanai', enLast: 'Oron',
  id: '123456782', // checksum-valid
  birthDate: '03/08/1976',
  occupation: 'משקיע',
  email: 'yanai@example.com',
  phone: '0546547547',
  // Real Hebrew address, but deliberately NO enStreet/enCity here - this is the
  // exact class of street a geocode can miss on (Dan Shomron, Ramat Gan).
  address: { search: 'דן שומרון 13, רמת גן', street: 'דן שומרון', city: 'רמת גן', house: '13', zip: '5265233' }
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
  'investors.0.idAppendix': { fileName: 'sefach.pdf' },
  'investors.0.passport': { fileName: 'passport.pdf' },
  'investors.0.accountManagementApproval': { fileName: 'ishur-nihul-cheshbon.pdf' },
  'investors.0.qualification': { fileName: 'tofes-kshirut-chatum.pdf' }
};

function fillPersonalPageNoEnglishAddress(document) {
  setField(document, 'investorsArray[0].firstName', LP.firstName);
  setField(document, 'investorsArray[0].lastName', LP.lastName);
  setField(document, 'investorsArray[0].englishDetails.firstName', LP.enFirst);
  setField(document, 'investorsArray[0].englishDetails.lastName', LP.enLast);
  checkRadio(document, 'investorsArray[0].gender', 'זכר');
  setField(document, 'investorsArray[0].idNumber', LP.id);
  setField(document, 'investorsArray[0].birthDate', LP.birthDate);
  setField(document, 'investorsArray[0].birthCountry', 'ישראל');
  setField(document, 'investorsArray[0].citizenship', 'ישראל');
  setField(document, 'investorsArray[0].occupation', LP.occupation);
  setField(document, 'investorsArray[0].residencyCountry', 'ישראל');
  setField(document, 'investorsArray[0].israelAddressSearch', LP.address.search);
  setField(document, 'investorsArray[0].israelAddress.street', LP.address.street);
  setField(document, 'investorsArray[0].israelAddress.city', LP.address.city);
  setField(document, 'investorsArray[0].israelAddress.houseNumber', LP.address.house);
  setField(document, 'investorsArray[0].israelAddress.postalCode', LP.address.zip);
  // Deliberately NOT set: investorsArray[0].englishDetails.englishAddress.street/city.
  setField(document, 'investorsArray[0].email', LP.email);
  setField(document, 'investorsArray[0].phoneNumber', LP.phone);
}

async function walkToReview(rig, t) {
  const d = rig.document;
  ok(t + ' boots on welcome', currentPage(d) === 'welcome', currentPage(d));
  ok(t + ' welcome -> ind.personal', (await clickNext(d)) === 'ind.personal', currentPage(d));
  fillPersonalPageNoEnglishAddress(d);
  ok(t + ' personal -> ind.qualification', (await clickNext(d)) === 'ind.qualification', currentPage(d));

  checkBox(d, 'investorsArray[0].qualification.isLiquidAssets');
  checkRadio(d, 'investorsArray[0].qualification.isSignedQualification', 'כן');
  ok(t + ' qualification -> money', (await clickNext(d)) === 'money', currentPage(d));

  setField(d, 'moneyInvestedInFund.investedAmountArray[0].investedCurrency', 'שקל');
  setField(d, 'moneyInvestedInFund.investedAmount', '500000');
  setField(d, 'moneyInvestedInFund.investmentDate', investmentDate());
  setField(d, 'moneyInvestedInFund.bankDetails.bankNameIsrael', BANK.n);
  setField(d, 'moneyInvestedInFund.bankDetails.branchNumberIsrael', String(BRANCH[0]));
  setField(d, 'moneyInvestedInFund.bankDetails.accountNumber', '740800');
  setField(d, 'moneyInvestedInFund.moneySource', 'הון עצמי');
  checkBox(d, 'taxDeclaration.isNonBusinessIncome');
  ok(t + ' money -> beneficiary', (await clickNext(d)) === 'beneficiary', currentPage(d));

  checkRadio(d, 'beneficiaryStatement.statement', 'self');
  ok(t + ' beneficiary -> ind.taxres', (await clickNext(d)) === 'ind.taxres', currentPage(d));

  checkRadio(d, 'investorsArray[0].taxResidency.taxCountry', 'ישראל בלבד');
  ok(t + ' taxres -> ind.additional', (await clickNext(d)) === 'ind.additional', currentPage(d));

  checkRadio(d, 'additionalInvestors', 'לא');
  ok(t + ' additional -> uploads', (await clickNext(d)) === 'uploads', currentPage(d));

  ok(t + ' uploads -> ind.sign', (await clickNext(d)) === 'ind.sign', currentPage(d));
  await sleep(80);
  await drawSignature(rig.window);
  ok(t + ' sign -> review', (await clickNext(d)) === 'review', currentPage(d));
}

(async () => {
  const rig = await loadIsraelForm({ cfg: { prefillUploads: PREFILL_UPLOADS } });
  const d = rig.document;
  await walkToReview(rig, 'E');

  // Precondition: reproduces the live incident exactly - Hebrew address filled,
  // English mirror genuinely blank (the rig's Geocoder mock always misses).
  const enStreetEl = d.querySelector('[name="investorsArray[0].englishDetails.englishAddress.street"]');
  const enCityEl = d.querySelector('[name="investorsArray[0].englishDetails.englishAddress.city"]');
  ok('E precondition: English street still blank pre-submit', enStreetEl && !enStreetEl.value.trim());
  ok('E precondition: English city still blank pre-submit', enCityEl && !enCityEl.value.trim());
  ok('E precondition: fallback holder starts hidden', enStreetEl.closest('.lvp-field').hidden === true);

  d.querySelector('[data-action="submit"]').click();
  await sleep(300);

  const blockedSubmitCall = rig.gatewayCalls.find((c) => c.body && c.body.action === 'submit');
  ok('E1 blank English mirror blocks the submit POST (no incomplete pack sent)', !blockedSubmitCall,
    blockedSubmitCall && JSON.stringify(blockedSubmitCall.body));

  const holder = enStreetEl.closest('.lvp-field');
  ok('E2 fallback holder revealed (un-hidden)', holder.hidden === false);
  ok('E2 fallback holder marked in error', holder.classList.contains('lvp-field--error'));
  ok('E2 English street input flipped from hidden to text', enStreetEl.type === 'text', enStreetEl.type);
  ok('E2 English city input flipped from hidden to text', enCityEl.type === 'text', enCityEl.type);
  ok('E2 LP left on the page carrying the field (ind.personal)', currentPage(d) === 'ind.personal', currentPage(d));
  const statusEl = d.querySelector('[data-status]');
  ok('E2 approved required-fields status line shown', !!statusEl && statusEl.textContent.indexOf('נא להשלים את שדות החובה') !== -1,
    statusEl && statusEl.textContent);

  // E3: the LP can now actually fix it - fill the revealed field and resubmit.
  setField(d, 'investorsArray[0].englishDetails.englishAddress.street', 'Dan Shomron 13');
  setField(d, 'investorsArray[0].englishDetails.englishAddress.city', 'Ramat Gan');
  // The rig's clickNext-based flow already walked every later page once; jump
  // straight back to review the way the LP's own in-form navigation would, then submit.
  while (currentPage(d) !== 'review') { await clickNext(d); }
  d.querySelector('[data-action="submit"]').click();
  await sleep(300);

  const submitCall = rig.gatewayCalls.find((c) => c.body && c.body.action === 'submit');
  ok('E3 resubmit after filling the revealed field succeeds', !!submitCall);
  if (submitCall) {
    const inv0 = submitCall.body.payload.submission.investorsArray[0];
    ok('E3 submission carries the LP-typed English street', inv0.englishDetails.englishAddress.street === 'Dan Shomron 13',
      inv0.englishDetails.englishAddress.street);
    ok('E3 submission carries the LP-typed English city', inv0.englishDetails.englishAddress.city === 'Ramat Gan',
      inv0.englishDetails.englishAddress.city);
  }
  const cardText = (d.querySelector('.lvp-result') || d.body).textContent;
  ok('E3 success card painted after the fix', cardText.indexOf('המסמכים נשלחו בהצלחה') !== -1);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
