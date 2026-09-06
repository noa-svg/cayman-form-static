// israel-english-address-fallback-harness.cjs - the CONTRACT for the W-8's
// English address pair (englishDetails.englishAddress.street/city) on
// israel.html, driven against the REAL form in jsdom.
//
// BACKGROUND. The pair is required server-side, unconditionally, for every
// Israeli individual: it is line 3 of the IRS W-8BEN each holder files at seal
// (packages/ju-israeli-domain/src/validate.ts:390-393, code
// english_address_required). The LP is not asked to type it. It is filled from
// the Hebrew address, and there are now THREE fillers, in order:
//   1. the client geocode on this page (Places, then Geocoder), and
//   2. the client geocode of the typed Hebrew string, and
//   3. israeliDeriveEnglishAddress_ on ju-service, which runs immediately
//      before validation on every submit (apps/ju-service/src/domain/submit.ts,
//      just above israeliSanitizeSubmission) with a Google Geocoding tier and a
//      Cloud Translation tier behind it.
//
// THE ORIGINAL DEFECT (2026-09-04): the pair rode as bare <input type="hidden">
// with no visible field, so when 1 and 2 missed, the server refused with a
// message naming no field, on a value with no input to correct. A dead end,
// identical on every retry.
//
// THE OVER-CORRECTION (2026-09-06, reverted here): the client was given two
// gates that REFUSED to advance or submit while the pair was blank, plus a
// local Hebrew-to-Latin transliteration engine to fill it. Both are gone.
// The gates blocked a real LP on a perfectly good address, because Google's
// CLIENT-side route for a street like דן שומרון comes back in Hebrew while the
// SERVER derives "Dan Shomron 13" for the same street - measured live against
// production on 2026-09-06 via ?api=diagGeocode (armed:true, translitArmed:true,
// derived:true). The client's idea of "the server will refuse this" was simply
// wrong. The transliteration engine went with them: nothing should guess a
// value onto a tax form client-side when the server derives a better one.
//
// THE CONTRACT THIS FILE LOCKS.
//   C1-C3  ROOT CAUSE of the blank English CITY, and it stays fixed.
//          placesFillEnglish_ used to fall back to the Geocoder only when
//          google.maps.places.Place returned NO address components. A Place
//          returning HEBREW components is not "no components", so isHebrewText_
//          correctly refused them and the Geocoder - which for דן שומרון 13,
//          רמת גן genuinely answers locality "Ramat Gan" in English - was never
//          consulted. The condition is "did we get usable English", not "did we
//          get bytes back".
//   V1-V3  the pair is VISIBLE, as ordinary non-error fields, from the moment
//          the Hebrew address resolves. Not hidden, not a late reveal.
//   O1     the pair is data-optional: the client never blocks on it, because
//          the LP is not its source of truth and the server is.
//   N1-N2  Continue and Submit both proceed with the English street blank.
//          This is the un-blocking half of the fix, stated as a test.
//   S1-S3  the server refusal is the ONE gate, and it lands NAMED, VISIBLE and
//          FILLABLE on the exact field, on whatever page carries it - never the
//          generic retry line, never a blank dead end. This is what makes N1-N2
//          safe rather than punish-late.
//   H1-H4  nothing automatic ever writes a BLANK-over-good or a HEBREW value
//          into the pair, and isHebrewText_ is not weakened. Includes the
//          re-type path, which must clear a stale English pair.
//   X1-X3  static: no client-side transliteration engine, and no client-side
//          blocking scan, exists in israel.html at all.
//
// Run: node test/israel-english-address-fallback-harness.cjs
'use strict';
const {
  loadIsraelForm, setField, checkRadio, checkBox, pickPlace, comp, fire,
  currentPage, clickNext, drawSignature, sleep
} = require('./rig-israel.cjs');
const fs = require('fs');
const path = require('path');
const LVPRules = require('../validation-rules.js');
const bankRegistry = require('../bank-registry.json');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}

// SYNTHETIC fixture identity. The incident this file locks was a real LP's, and
// the incident is named in the comments above; the fixture deliberately is not
// theirs (house rule: no real LP names in test fixtures). ישראל ישראלי is the
// Hebrew placeholder name, and the ID is the same checksum-valid synthetic one
// the rest of this suite uses. The ADDRESS is real, because the address is the
// thing under test: Google has no English street name on file for it.
const LP = {
  firstName: 'ישראל', lastName: 'ישראלי',
  enFirst: 'Israel', enLast: 'Israeli',
  id: '123456782', // checksum-valid
  birthDate: '03/08/1976',
  occupation: 'משקיע',
  email: 'israel.israeli@example.com',
  phone: '0546547547',
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

// The address in the exact component shape Google returns for it. Measured live
// 2026-09-06: geocode(language:'en') gives a HEBREW route (the street has no
// English name on file) and an ENGLISH locality. That asymmetry is the bug.
const HE_COMPS = [
  comp('13', ['street_number']), comp('דן שומרון', ['route']),
  comp('רמת גן', ['locality', 'political']), comp('5265233', ['postal_code'])
];
const EN_COMPS = [
  comp('13', ['street_number']), comp('דן שומרון', ['route']),
  comp('Ramat Gan', ['locality', 'political']), comp('5265233', ['postal_code'])
];
// Everything Hebrew: Google has no English for the street OR the city.
const ALL_HE_COMPS = HE_COMPS;
const SEARCH = 'investorsArray[0].israelAddressSearch';
const EN_STREET = 'investorsArray[0].englishDetails.englishAddress.street';
const EN_CITY = 'investorsArray[0].englishDetails.englishAddress.city';

function esc(name) { return name.replace(/(["\\\]\[])/g, '\\$1'); }
function el(d, name) { return d.querySelector('[name="' + esc(name) + '"]'); }
function val(d, name) { const e = el(d, name); return e ? String(e.value || '').trim() : '(no element)'; }
function isHe(s) { return /[א-ת]/.test(String(s || '')); }

// Install the Place class the LIVE page uses (the rig has no Maps SDK of its
// own). `components` is what fetchFields resolves with.
function installPlaceClass(w, components) {
  w.google.maps.places.Place = function (o) {
    this.id = o.id;
    this.addressComponents = null;
    const self = this;
    this.fetchFields = function () {
      self.addressComponents = components.map((c) => ({ longText: c.long_name, shortText: c.short_name, types: c.types }));
      return Promise.resolve({});
    };
  };
}

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
  // Deliberately NOT set: englishDetails.englishAddress.street/city.
  setField(document, 'investorsArray[0].email', LP.email);
  setField(document, 'investorsArray[0].phoneNumber', LP.phone);
}

// Walk from the boot screen to review, filling nothing English. Every Next must
// succeed: that IS assertion N1.
async function walkToReview(rig, t) {
  const d = rig.document;
  ok(t + ' boots on welcome', currentPage(d) === 'welcome', currentPage(d));
  ok(t + ' welcome -> ind.personal', (await clickNext(d)) === 'ind.personal', currentPage(d));
  fillPersonalPageNoEnglishAddress(d);

  const enStreetEl = el(d, EN_STREET), enCityEl = el(d, EN_CITY);
  ok(t + ' precondition: English street blank pre-Next', enStreetEl && !enStreetEl.value.trim());
  ok(t + ' precondition: English city blank pre-Next', enCityEl && !enCityEl.value.trim());

  const after = await clickNext(d);
  ok(t + ' N1 Next is NOT blocked by the blank English pair (the server supplies it)',
    after === 'ind.qualification', after);

  await advanceFromQualificationToReview(rig, t);
}

async function advanceFromQualificationToReview(rig, t) {
  const d = rig.document;
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

// Click Next until `review` is reached again (used after the server bounce puts
// the LP back on ind.personal). Bounded so a real regression fails loudly.
async function walkBackToReview(d) {
  for (let i = 0; i < 12 && currentPage(d) !== 'review'; i++) {
    const before = currentPage(d);
    await clickNext(d);
    if (currentPage(d) === before) return before;   // stuck: report where
  }
  return currentPage(d);
}

// ---------------------------------------------------------------------------
// N1/N2 + S1-S3. The full LP journey with an English pair the client never
// fills, and a SERVER that refuses it. This is the scenario that justifies
// removing the client gates: the LP must reach the server, and the server's
// refusal must arrive named, visible and fillable.
async function scenarioServerIsTheGate() {
  let submits = 0;
  const rig = await loadIsraelForm({
    cfg: { prefillUploads: PREFILL_UPLOADS },
    gatewayResponses: {
      submit: (body) => {
        submits++;
        const inv = body.payload.submission.investorsArray[0];
        const ea = (inv.englishDetails || {}).englishAddress || {};
        // The REAL server shape: validate.ts pushes {path, code} problems and
        // handleIsraeliOnboardingSubmit returns them under detail.validation.
        if (!String(ea.street || '').trim() || !String(ea.city || '').trim()) {
          return {
            ok: false,
            error: 'אירעה תקלה. נא לנסות שוב.',
            detail: {
              validation: [
                { path: 'investorsArray[0].englishDetails.englishAddress.street', code: 'english_address_required' }
              ]
            }
          };
        }
        return { ok: true, stage: 'submitted', detail: { signersPlanned: 1 } };
      }
    }
  });
  const d = rig.document;
  await walkToReview(rig, 'S');

  // N2: the client SUBMITS. It does not pre-empt the server on a blank pair.
  d.querySelector('[data-action="submit"]').click();
  await sleep(400);
  ok('N2 the client submitted rather than refusing on the blank English pair', submits === 1, 'submits=' + submits);
  const firstCall = rig.gatewayCalls.find((c) => c.body && c.body.action === 'submit');
  ok('N2 the POST carried the blank English street (the server is the filler)',
    !!firstCall && !String(((firstCall.body.payload.submission.investorsArray[0].englishDetails || {}).englishAddress || {}).street || '').trim());

  // S1-S3: the server refused. That refusal must be named ON the field.
  const holder = el(d, EN_STREET).closest('.lvp-field');
  ok('S1 the LP is returned to the page carrying the English address', currentPage(d) === 'ind.personal', currentPage(d));
  ok('S1 the English street holder is un-hidden by the server refusal', holder.hidden === false);
  ok('S1 the English street input is a real text field, not type="hidden"', el(d, EN_STREET).type === 'text', el(d, EN_STREET).type);
  ok('S2 the holder is marked in error', holder.classList.contains('lvp-field--error'));
  const msg = holder.querySelector('.lvp-error-msg');
  ok('S2 a NAMED inline message is on the field, not the generic retry line',
    !!msg && msg.textContent.indexOf('רחוב באנגלית') !== -1, msg && msg.textContent);
  ok('S2 aria-invalid is set for screen readers', el(d, EN_STREET).getAttribute('aria-invalid') === 'true');
  // Assert on the CARD, never on d.body: jsdom's textContent includes <script>
  // text, and the success copy is a JS string literal in this file, so a
  // body-wide search matches even when nothing was painted.
  ok('S3 the success card was NOT painted on the refusal',
    !d.querySelector('.lvp-result') ||
    d.querySelector('.lvp-result').textContent.indexOf('המסמכים נשלחו בהצלחה') === -1);

  // S3: and the LP can actually finish, on the very next try.
  setField(d, EN_STREET, 'Dan Shomron 13');
  setField(d, EN_CITY, 'Ramat Gan');
  const back = await walkBackToReview(d);
  ok('S3 the LP walks back to review after filling the named field', back === 'review', back);
  d.querySelector('[data-action="submit"]').click();
  await sleep(400);
  ok('S3 the second submit was sent', submits === 2, 'submits=' + submits);
  const second = rig.gatewayCalls.filter((c) => c.body && c.body.action === 'submit').pop();
  // Defensive: a regression that never sends the second submit must FAIL these
  // two assertions, not crash the run before the static locks below get to run.
  const ea2 = (((second && second.body.payload.submission.investorsArray[0].englishDetails) || {}).englishAddress) || {};
  ok('S3 the submission carries the LP-typed English street', ea2.street === 'Dan Shomron 13', ea2.street);
  ok('S3 the submission carries the LP-typed English city', ea2.city === 'Ramat Gan', ea2.city);
  const card = d.querySelector('.lvp-result');
  ok('S3 the success card is painted once the server accepts',
    !!card && card.textContent.indexOf('המסמכים נשלחו בהצלחה') !== -1, card && card.textContent.slice(0, 80));
}

// ---------------------------------------------------------------------------
// C1-C3 + V1-V3 + O1. The Places pick path, with the Place class returning
// HEBREW components and a Geocoder that has the English city.
async function scenarioRootCause() {
  const rig = await loadIsraelForm({
    geocode: () => ({ status: 'OK', results: [{ address_components: EN_COMPS }] })
  });
  const d = rig.document, w = rig.window;
  installPlaceClass(w, HE_COMPS);
  await clickNext(d);
  ok('C0 precondition: English pair hidden before any address exists',
    el(d, EN_STREET).closest('.lvp-field').hidden === true);

  pickPlace(d, SEARCH, { address_components: HE_COMPS, place_id: 'PLACE_TEST', formatted_address: 'דן שומרון 13, רמת גן, ישראל' });
  const holder = el(d, EN_STREET).closest('.lvp-field');
  const cityHolder = el(d, EN_CITY).closest('.lvp-field');

  ok('V1 English street holder visible the moment the address resolves', holder.hidden === false);
  ok('V1 English city holder visible the moment the address resolves', cityHolder.hidden === false);
  ok('V2 English street input is a real text field', el(d, EN_STREET).type === 'text', el(d, EN_STREET).type);
  ok('V2 English city input is a real text field', el(d, EN_CITY).type === 'text', el(d, EN_CITY).type);
  ok('V3 neither field is in an error state on first sight',
    !holder.classList.contains('lvp-field--error') && !cityHolder.classList.contains('lvp-field--error'));

  // O1: deliberately data-optional. The form's required marker is pure CSS on
  // `.lvp-field:not([data-optional])`, so data-optional is simultaneously the
  // "no marker" and the "validatePage skips it" signal - one attribute, both
  // meanings, which is why they cannot drift apart.
  ok('O1 English street holder is data-optional (the client never blocks on it)', holder.hasAttribute('data-optional'));
  ok('O1 English city holder is data-optional', cityHolder.hasAttribute('data-optional'));
  ok('O1 neither holder matches the required-marker selector',
    !holder.matches('.lvp-field:not([data-optional]):not(.lvp-field--error)') &&
    !cityHolder.matches('.lvp-field:not([data-optional]):not(.lvp-field--error)'));

  await sleep(250);
  // C1: THE ROOT CAUSE. Google had "Ramat Gan" and the old code never asked.
  ok('C1 English CITY auto-filled from Google despite the Place class returning Hebrew',
    val(d, EN_CITY) === 'Ramat Gan', val(d, EN_CITY));
  ok('C2 the Geocoder WAS consulted after the Place class produced no usable English',
    rig.geocodeCalls.some((q) => q.placeId === 'PLACE_TEST' && q.language === 'en'), JSON.stringify(rig.geocodeCalls));
  // C3: the street genuinely has no English name at Google. It must stay BLANK
  // rather than take the Hebrew string or a local guess. The server fills it.
  ok('C3 English STREET is not the Hebrew string', !isHe(val(d, EN_STREET)), val(d, EN_STREET));
  ok('C3 English STREET is left blank for the server to derive', val(d, EN_STREET) === '', val(d, EN_STREET));

  // N1 again, on the PICK path rather than the typed path: a blank street here
  // must not stop Continue either.
  fillPersonalPageNoEnglishAddress(d);
  setField(d, EN_CITY, 'Ramat Gan');   // keep what Google gave; street stays blank
  ok('N1 Continue proceeds with the English street blank after a real Places pick',
    (await clickNext(d)) === 'ind.qualification', currentPage(d));
}

// ---------------------------------------------------------------------------
// RS1-RS4. THE RESUME PATH. A returning LP whose Hebrew address is restored
// from CFG.prefill must meet the same visible, pre-filled English pair a
// first-time LP does. Found by mutation-testing this file on 2026-09-06: the
// resume branch inside bindPlacesInputs runs at Places-ready time, which is
// BEFORE hydrateFromPrefill on a real resume, and it stamps data-places-bound so
// the later re-bind is a no-op. Measured before the fix: pair hidden, both
// fields blank, ZERO geocodes fired.
async function scenarioResume() {
  const rig = await loadIsraelForm({
    cfg: {
      prefill: {
        investorsArray: [{
          firstName: LP.firstName, lastName: LP.lastName,
          israelAddress: { street: LP.address.street, city: LP.address.city, houseNumber: LP.address.house, postalCode: LP.address.zip },
          englishDetails: { englishAddress: { street: '', city: '' } }
        }]
      }
    },
    geocode: () => ({ status: 'OK', results: [{ address_components: EN_COMPS }] })
  });
  const d = rig.document;
  await clickNext(d);
  await sleep(400);
  ok('RS1 the resumed Hebrew address was restored', val(d, 'investorsArray[0].israelAddress.street') === LP.address.street,
    val(d, 'investorsArray[0].israelAddress.street'));
  ok('RS2 the English pair is visible on resume, not hidden and blank',
    el(d, EN_STREET).closest('.lvp-field').hidden === false && el(d, EN_CITY).closest('.lvp-field').hidden === false);
  ok('RS2 both inputs are real text fields on resume',
    el(d, EN_STREET).type === 'text' && el(d, EN_CITY).type === 'text');
  ok('RS3 the derive actually fired on resume', rig.geocodeCalls.length > 0, JSON.stringify(rig.geocodeCalls));
  ok('RS3 the English city was derived on resume', val(d, EN_CITY) === 'Ramat Gan', val(d, EN_CITY));
  ok('RS4 the English street is left blank for the server, never Hebrew',
    val(d, EN_STREET) === '' && !isHe(val(d, EN_STREET)), val(d, EN_STREET));
}

// ---------------------------------------------------------------------------
// H1-H4. Nothing automatic writes a blank-over-good or a Hebrew value.
async function scenarioNeverHebrewNeverStale() {
  const rig = await loadIsraelForm({
    // Google answers HEBREW for everything, on both the Place path and the
    // Geocoder path. Neither field may be written.
    geocode: () => ({ status: 'OK', results: [{ address_components: ALL_HE_COMPS }] })
  });
  const d = rig.document, w = rig.window;
  installPlaceClass(w, ALL_HE_COMPS);
  await clickNext(d);
  pickPlace(d, SEARCH, { address_components: ALL_HE_COMPS, place_id: 'PLACE_TEST', formatted_address: 'דן שומרון 13, רמת גן, ישראל' });
  await sleep(250);
  ok('H1 an all-Hebrew geocode writes NOTHING into the English street', val(d, EN_STREET) === '', val(d, EN_STREET));
  ok('H1 an all-Hebrew geocode writes NOTHING into the English city', val(d, EN_CITY) === '', val(d, EN_CITY));
  ok('H1 the pair is still shown, so the LP can supply it themselves',
    el(d, EN_STREET).closest('.lvp-field').hidden === false);

  // H2: data-script="en" hands these to the form's existing wrong-script
  // handler, so Hebrew typed by the LP is stripped as they type. Same guard and
  // same already-approved warning every other English field on this form has.
  ok('H2 English street input carries data-script="en"', el(d, EN_STREET).getAttribute('data-script') === 'en');
  ok('H2 English city input carries data-script="en"', el(d, EN_CITY).getAttribute('data-script') === 'en');
  const sEl = el(d, EN_STREET);
  sEl.value = 'Dan שומרון 13';
  fire(sEl, 'input');
  ok('H2 Hebrew typed into the English street is stripped live', !isHe(sEl.value), sEl.value);

  // H3: the LP re-types the search box. The resolved pair no longer describes
  // anything, so it must be cleared and put away, not left stale on screen.
  const searchEl = el(d, SEARCH);
  setField(d, EN_CITY, 'Ramat Gan');
  searchEl.value = 'הרצל 1, תל';
  fire(searchEl, 'input');
  ok('H3 re-typing the address clears the stale English city', val(d, EN_CITY) === '', val(d, EN_CITY));
  ok('H3 re-typing the address clears the stale English street', val(d, EN_STREET) === '', val(d, EN_STREET));
  ok('H3 re-typing the address hides the pair again', el(d, EN_CITY).closest('.lvp-field').hidden === true);
  ok('H3 the hidden pair is back to type="hidden"', el(d, EN_CITY).type === 'hidden', el(d, EN_CITY).type);
}

// ---------------------------------------------------------------------------
// H4 + X1-X3. Static locks on the shipped file itself.
function staticLocks() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'israel.html'), 'utf8');

  // H4: isHebrewText_ is the guard both English-mirror offers ride on. It is
  // not to be weakened to buy a fill - that is the Sharon Dagan seal failure
  // (2026-08-31) and it is what makes C3 and H1 hold.
  ok('H4 isHebrewText_ is unchanged and still tests the full Hebrew block',
    /function isHebrewText_\(s\) \{ return \/\[א-ת\]\/\.test\(String\(s \|\| ''\)\); \}/.test(src));
  const offers = src.match(/if \((?:enRoute|enCity|dRoute|dCity) && !isHebrewText_\((?:enRoute|enCity|dRoute|dCity)\)\)/g) || [];
  ok('H4 all four English-mirror offers (Places street/city, Geocoder street/city) are gated on isHebrewText_',
    offers.length === 4, 'found ' + offers.length);

  // X1: the client transliteration engine written on 2026-09-06 is gone. It is
  // named here so a future session does not reintroduce it silently: the server
  // transliterates via Cloud Translation, better, after the Geocoding tier.
  ok('X1 no client-side transliteration engine remains',
    !/TRANSLIT_CONS|translitWord_|translitHe_|suggestTranslit_|data-translit-unconfirmed/.test(src));

  // X2: no client-side scan blocks on a blank englishAddress. Both gates that
  // did (validatePage's per-page reveal and doSubmitNow_'s missingPrefix) are
  // gone, and the CP FATCA special-case they needed went with them.
  ok('X2 doSubmitNow_ carries no missingPrefix English-address block', !/missingPrefix/.test(src));
  ok('X2 no scan reveals the English pair from a client-side blank check',
    !/if \(!enStreetEl\.value\.trim\(\)[^\n]*revealEnglishAddressFallback_/.test(src));

  // X3: revealEnglishAddressFallback_ still exists and has exactly ONE caller,
  // focusServerValidation_. That single call site is the whole safety argument:
  // the LP is only ever stopped by a refusal that actually happened.
  const callers = src.match(/^\s*(?:if \([^\n]*\))?\s*revealEnglishAddressFallback_\(/gm) || [];
  ok('X3 revealEnglishAddressFallback_ is still defined', /function revealEnglishAddressFallback_\(prefix\)/.test(src));
  ok('X3 revealEnglishAddressFallback_ has exactly one call site', callers.length === 1, 'found ' + callers.length);
  const fsv = src.slice(src.indexOf('function focusServerValidation_('), src.indexOf('function focusServerValidation_(') + 2600);
  ok('X3 that call site is inside focusServerValidation_ (a real server refusal)',
    fsv.indexOf('revealEnglishAddressFallback_(') !== -1);
}

(async () => {
  await scenarioServerIsTheGate();
  await scenarioRootCause();
  await scenarioResume();
  await scenarioNeverHebrewNeverStale();
  staticLocks();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
