// israel-flow.cjs - scripted-user walkthrough of the REAL israel.html under the
// jsdom rig (rig-israel.cjs). Drives the individual-subscriber happy path end
// to end and the two core client gates:
//   F1  happy path: welcome -> personal -> qualification -> money ->
//       beneficiary -> tax residency -> additional investors -> uploads ->
//       sign (real pad events) -> review -> submit. Asserts the gateway POST
//       envelope (?source=lp, action:'submit', lane:'israeli', token present =
//       the server-side idempotency key, signaturePng riding along, the
//       collected submission carrying the typed data) and that the mocked
//       proof-of-progress success (ok:true, stage:'submitted',
//       detail:{signersPlanned}) paints the approved success card and clears
//       the local PII snapshot.
//   F2  nextUrl handoff: a mocked ok:true + stage:'signing' + nextUrl response
//       routes to window.top.location (jsdom reports the blocked navigation);
//       no failure copy is painted and the snapshot is cleared.
//   F3  checksum-invalid Israeli ID (123456789) is blocked client-side on the
//       personal page with the approved Hebrew inline error; a checksum-valid
//       ID (123456782) clears it.
//   F4  an empty required field blocks page-advance (welcome advances freely,
//       the personal page does not) and renders the error summary.
// Run: node test/israel-flow.cjs
'use strict';
const {
  loadIsraelForm, setField, checkRadio, checkBox,
  currentPage, currentPageEl, clickNext, drawSignature, sleep
} = require('./rig-israel.cjs');
const LVPRules = require('../validation-rules.js');
const bankRegistry = require('../bank-registry.json');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}

// Realistic synthetic identity (nothing leaves the mocked fetch).
const LP = {
  firstName: 'דניאל', lastName: 'רוזנברג',
  enFirst: 'Daniel', enLast: 'Rosenberg',
  id: '123456782',            // checksum-valid per LVPRules.validId
  badId: '123456789',         // checksum-INVALID
  birthDate: '15/03/1980',
  occupation: 'ניהול השקעות',
  email: 'daniel.rosenberg@example.com',
  phone: '0541234567',
  address: { search: 'הרצל 10, תל אביב', street: 'הרצל', city: 'תל אביב', house: '10', zip: '6688312', enStreet: 'Herzl', enCity: 'Tel Aviv' }
};
// Real bank + branch from the shipped registry (Bank Leumi, code 10).
const BANK = bankRegistry.banks.find((b) => b.c === 10);
const BRANCH = BANK.br[0];
// investmentDate must be EXACTLY the first business day (Sun-Thu) of next month.
function investmentDate() {
  const d = LVPRules.firstBusinessDayNextMonth();
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  return p2(d.getUTCDate()) + '/' + p2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
}
// Operator pre-seeded docs satisfy the required-upload gate (cfg.prefillUploads
// -> preAttached, the production path for docs the fund already holds).
const PREFILL_UPLOADS = {
  'investors.0.idPhoto': { fileName: 'teudat-zehut.pdf' },
  'investors.0.passport': { fileName: 'passport.pdf' },
  'investors.0.accountManagementApproval': { fileName: 'ishur-nihul-cheshbon.pdf' },
  'investors.0.qualification': { fileName: 'tofes-kshirut-chatum.pdf' }
};

function fillPersonalPage(document) {
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
  // ONE visible address field; the hidden component fields are the payload
  // contract (a Places pick fills them; the rig fills them directly, same as
  // the manual parse+geocode fallback would).
  setField(document, 'investorsArray[0].israelAddressSearch', LP.address.search);
  setField(document, 'investorsArray[0].israelAddress.street', LP.address.street);
  setField(document, 'investorsArray[0].israelAddress.city', LP.address.city);
  setField(document, 'investorsArray[0].israelAddress.houseNumber', LP.address.house);
  setField(document, 'investorsArray[0].israelAddress.postalCode', LP.address.zip);
  setField(document, 'investorsArray[0].englishDetails.englishAddress.street', LP.address.enStreet);
  setField(document, 'investorsArray[0].englishDetails.englishAddress.city', LP.address.enCity);
  setField(document, 'investorsArray[0].email', LP.email);
  setField(document, 'investorsArray[0].phoneNumber', LP.phone);
}

// Walk a booted rig from welcome through review, filling every page.
async function walkToReview(rig, t) {
  const d = rig.document;
  ok(t + ' boots on welcome', currentPage(d) === 'welcome', currentPage(d));
  ok(t + ' no gate mode (valid cfg)', !d.documentElement.classList.contains('lvp-gate-mode'));

  ok(t + ' welcome -> ind.personal', (await clickNext(d)) === 'ind.personal', currentPage(d));
  fillPersonalPage(d);
  ok(t + ' personal -> ind.qualification', (await clickNext(d)) === 'ind.qualification', currentPage(d));

  // Qualified by liquid assets, holds a pre-signed qualification form ->
  // the lawyer page must NOT enter the sequence.
  checkBox(d, 'investorsArray[0].qualification.isLiquidAssets');
  checkRadio(d, 'investorsArray[0].qualification.isSignedQualification', 'כן');
  const afterQual = await clickNext(d);
  ok(t + ' qualification -> money (lawyer page skipped)', afterQual === 'money', afterQual);

  setField(d, 'moneyInvestedInFund.investedAmountArray[0].investedCurrency', 'שקל');
  setField(d, 'moneyInvestedInFund.investedAmount', '500000');
  setField(d, 'moneyInvestedInFund.investmentDate', investmentDate());
  setField(d, 'moneyInvestedInFund.bankDetails.bankNameIsrael', BANK.n);
  setField(d, 'moneyInvestedInFund.bankDetails.branchNumberIsrael', String(BRANCH[0]));
  setField(d, 'moneyInvestedInFund.bankDetails.accountNumber', '740800');
  setField(d, 'moneyInvestedInFund.moneySource', 'הון עצמי');
  // publicOrPoliticalActivity / legalOrAdministrativeProceedings default to לא (checked).
  checkBox(d, 'taxDeclaration.isNonBusinessIncome');
  ok(t + ' money -> beneficiary', (await clickNext(d)) === 'beneficiary', currentPage(d));

  checkRadio(d, 'beneficiaryStatement.hasBeneficiaries', 'no');
  ok(t + ' beneficiary -> ind.taxres', (await clickNext(d)) === 'ind.taxres', currentPage(d));

  checkRadio(d, 'investorsArray[0].taxResidency.taxCountry', 'ישראל בלבד');
  ok(t + ' taxres -> ind.additional', (await clickNext(d)) === 'ind.additional', currentPage(d));

  checkRadio(d, 'additionalInvestors', 'לא');
  ok(t + ' additional -> uploads', (await clickNext(d)) === 'uploads', currentPage(d));

  // Required upload slots are pre-attached via cfg.prefillUploads.
  ok(t + ' uploads -> ind.sign', (await clickNext(d)) === 'ind.sign', currentPage(d));

  // Entering ind.sign fires the render_preview gateway call; let it settle and
  // verify the REAL preview pipeline painted the mocked doc.
  await sleep(80);
  const prevBox = d.querySelector('[data-doc-preview]');
  ok(t + ' sign-step doc preview painted from render_preview', prevBox && !prevBox.hidden &&
    (d.querySelector('[data-doc-preview-body]').innerHTML || '').indexOf('הסכם הצטרפות') !== -1);
  const previewCall = rig.gatewayCalls.find((c) => c.body && c.body.action === 'render_preview');
  ok(t + ' render_preview envelope (action/lane/token)', !!previewCall &&
    previewCall.body.lane === 'israeli' && previewCall.body.token === 'TESTTOKEN');

  await drawSignature(rig.window);
  ok(t + ' sign -> review', (await clickNext(d)) === 'review', currentPage(d));
  // Contact email seeded from the investor email (seedContactDefault).
  const contact = d.querySelector('input[name^="contactArray"]');
  ok(t + ' review seeds contact email', contact && contact.value === LP.email, contact && contact.value);
}

(async () => {
  // ---- F1: happy path through submit -> success card -------------------------
  {
    const rig = await loadIsraelForm({ cfg: { prefillUploads: PREFILL_UPLOADS } });
    const d = rig.document;
    await walkToReview(rig, 'F1');

    rig.document.querySelector('[data-action="submit"]').click();
    await sleep(300);   // full-walk revalidation + mocked gateway round-trip

    const submitCall = rig.gatewayCalls.find((c) => c.body && c.body.action === 'submit');
    ok('F1 submit POST fired to ?source=lp', !!submitCall && submitCall.url.indexOf('source=lp') !== -1);
    if (submitCall) {
      const b = submitCall.body;
      ok('F1 envelope action', b.action === 'submit');
      ok('F1 envelope lane israeli', b.lane === 'israeli', b.lane);
      ok('F1 envelope token present (server-side idempotency key)', b.token === 'TESTTOKEN');
      ok('F1 envelope omits flowType (static-form contract)', !('flowType' in b));
      const sub = b.payload && b.payload.submission;
      ok('F1 submission collected the typed ID', sub && sub.investorsArray && sub.investorsArray[0] &&
        sub.investorsArray[0].idNumber === LP.id);
      ok('F1 submission carries Hebrew name', sub && sub.investorsArray[0].firstName === LP.firstName &&
        sub.investorsArray[0].lastName === LP.lastName);
      ok('F1 submission carries the bank details', sub && sub.moneyInvestedInFund &&
        sub.moneyInvestedInFund.bankDetails &&
        sub.moneyInvestedInFund.bankDetails.bankNameIsrael === BANK.n &&
        sub.moneyInvestedInFund.bankDetails.branchNumberIsrael === String(BRANCH[0]));
      ok('F1 submission applicantType individual', sub && sub.applicantType === 'individual');
      ok('F1 drawn signature rides the envelope', typeof b.payload.signaturePng === 'string' &&
        b.payload.signaturePng.indexOf('data:image/png') === 0);
    }
    // Proof-of-progress success (stage submitted + signersPlanned) paints the
    // approved success card, no failure copy, and clears the local PII snapshot.
    const cardText = (d.querySelector('.lvp-result') || d.body).textContent;
    ok('F1 success card painted', cardText.indexOf('המסמכים נשלחו בהצלחה') !== -1);
    const statusEl = d.querySelector('[data-status]');
    ok('F1 no failure copy', !statusEl || statusEl.textContent.indexOf('לא ניתן היה לשלוח') === -1, statusEl && statusEl.textContent);
    ok('F1 local snapshot cleared after success', rig.window.localStorage.getItem('lvp_il_snap_TESTTOKEN') === null);
  }

  // ---- F2: nextUrl handoff ----------------------------------------------------
  {
    const rig = await loadIsraelForm({
      cfg: { prefillUploads: PREFILL_UPLOADS },
      gatewayResponses: {
        submit: { ok: true, stage: 'signing', nextUrl: 'https://sign.legacyvpartners.com/signer.html?t=NEXTTOKEN', detail: {} }
      }
    });
    await walkToReview(rig, 'F2');
    rig.document.querySelector('[data-action="submit"]').click();
    await sleep(300);
    const submitCall = rig.gatewayCalls.find((c) => c.body && c.body.action === 'submit');
    ok('F2 submit POST fired', !!submitCall);
    // jsdom blocks real navigation and reports it on the virtual console; that
    // report is the observable proof the client routed to res.nextUrl.
    ok('F2 nextUrl handoff attempted (window.top.location)', rig.errors.some((e) => /navigation/i.test(e)), rig.errors.join(' | '));
    const statusEl = rig.document.querySelector('[data-status]');
    ok('F2 no failure copy on handoff', !statusEl || statusEl.textContent.indexOf('לא ניתן היה לשלוח') === -1);
    ok('F2 local snapshot cleared before handoff', rig.window.localStorage.getItem('lvp_il_snap_TESTTOKEN') === null);
  }

  // ---- F3: checksum-invalid ID blocked client-side -----------------------------
  {
    ok('F3 precondition: 123456789 fails the checksum', LVPRules.validId(LP.badId) === false);
    ok('F3 precondition: 123456782 passes the checksum', LVPRules.validId(LP.id) === true);
    const rig = await loadIsraelForm({ cfg: { prefillUploads: PREFILL_UPLOADS } });
    const d = rig.document;
    await clickNext(d);   // welcome -> ind.personal
    fillPersonalPage(d);
    const idInput = setField(d, 'investorsArray[0].idNumber', LP.badId);
    const after = await clickNext(d);
    ok('F3 bad-checksum ID blocks advance', after === 'ind.personal', after);
    const holder = idInput.closest('.lvp-field');
    ok('F3 ID field marked in error', holder.classList.contains('lvp-field--error'));
    const msg = holder.querySelector('.lvp-error-msg');
    ok('F3 approved Hebrew inline error', !!msg && msg.textContent === 'מספר תעודת הזהות אינו תקין.', msg && msg.textContent);
    ok('F3 error summary rendered', !!currentPageEl(d).querySelector('[data-error-summary]'));
    // Fixing the ID clears the gate.
    setField(d, 'investorsArray[0].idNumber', LP.id);
    ok('F3 valid ID advances', (await clickNext(d)) === 'ind.qualification', currentPage(d));
  }

  // ---- F4: empty required field blocks page-advance ----------------------------
  {
    const rig = await loadIsraelForm({ cfg: { prefillUploads: PREFILL_UPLOADS } });
    const d = rig.document;
    ok('F4 welcome advances with no fields', (await clickNext(d)) === 'ind.personal');
    const after = await clickNext(d);   // nothing filled
    ok('F4 empty personal page blocks advance', after === 'ind.personal', after);
    ok('F4 required holders marked', currentPageEl(d).querySelectorAll('.lvp-field--error, .lvp-fieldset--error').length > 0);
    const summary = currentPageEl(d).querySelector('[data-error-summary]');
    ok('F4 error summary rendered with approved heading', !!summary &&
      summary.textContent.indexOf('נא להשלים את השדות הבאים:') !== -1);
    // One field filled, the rest still empty: still blocked.
    setField(d, 'investorsArray[0].firstName', LP.firstName);
    ok('F4 partially filled page still blocks', (await clickNext(d)) === 'ind.personal');
  }

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e); process.exit(1); });
