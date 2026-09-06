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
// E1  Next, on the SAME page as the Hebrew address, catches the blank English
//     mirror and blocks advancing (2026-09-04, second pass: this used to be
//     invisible to validatePage - hidden holders were skipped - so an LP could
//     click through every later page and only get bounced back at final
//     submit. Punish-late; caught by Noa reading the shipped behavior).
//   E2  the matching .lvp-field--en-addr-fallback holder for investorsArray[0]
//     is revealed (un-hidden, input flipped from hidden to text) and marked in
//     error, and the LP is left on (or returned to) the page that carries it.
//   E3  filling the revealed field and clicking Next again succeeds, and the
//     LP can walk on to submit, which carries the LP-typed English street/city.
//
// EXTENDED 2026-09-06 (ju/english-address-ux). The reveal above stays exactly as
// it is, as the SAFETY NET. What is new is that it is no longer how an LP first
// meets these fields, plus the root cause of the blank CITY on Yanai's live
// session:
//   C1-C3 ROOT CAUSE. placesFillEnglish_ used to fall back to the Geocoder only
//     when google.maps.places.Place returned NO address components. A Place that
//     returns HEBREW components is not "no components", so isHebrewText_
//     correctly refused them and the Geocoder - which for דן שומרון 13, רמת גן
//     genuinely answers locality "Ramat Gan" in English - was never consulted.
//     C1 locks the fallback firing on "no usable English" instead.
//   V1-V3 the English pair is visible, as ordinary non-error fields, from the
//     moment the Hebrew address resolves. No type="hidden", no late reveal.
//   R1 both fields carry the same required marker every field above them has
//     (the form's marker is pure CSS on .lvp-field:not([data-optional]), so it
//     needs no required/data-required attribute - see R1's comment).
//   T1 transliteration accuracy against a table of real Israeli street and city
//     names, failures named rather than hidden.
//   T2-T4 a transliterated value is a SUGGESTION: it blocks Continue until the
//     LP has actually interacted with the field, and a programmatic .focus()
//     (which doSubmitNow_'s error path performs) does not count as that.
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

  // E1/E2: Next itself must catch this now, on ind.personal, not just final
  // submit ten pages later.
  const enStreetEl = d.querySelector('[name="investorsArray[0].englishDetails.englishAddress.street"]');
  const enCityEl = d.querySelector('[name="investorsArray[0].englishDetails.englishAddress.city"]');
  ok(t + ' precondition: English street still blank pre-Next', enStreetEl && !enStreetEl.value.trim());
  ok(t + ' precondition: English city still blank pre-Next', enCityEl && !enCityEl.value.trim());
  ok(t + ' precondition: fallback holder starts hidden', enStreetEl.closest('.lvp-field').hidden === true);

  const afterFirstNext = await clickNext(d);
  ok(t + ' E1 Next is BLOCKED on ind.personal, not advanced to ind.qualification', afterFirstNext === 'ind.personal', afterFirstNext);

  const holder = enStreetEl.closest('.lvp-field');
  ok(t + ' E2 fallback holder revealed (un-hidden)', holder.hidden === false);
  ok(t + ' E2 fallback holder marked in error', holder.classList.contains('lvp-field--error'));
  ok(t + ' E2 English street input flipped from hidden to text', enStreetEl.type === 'text', enStreetEl.type);
  ok(t + ' E2 English city input flipped from hidden to text', enCityEl.type === 'text', enCityEl.type);
  const inlineMsg = holder.querySelector('.lvp-error-msg');
  ok(t + ' E2 inline error message present on the revealed field', !!inlineMsg && inlineMsg.textContent.trim().length > 0,
    inlineMsg && inlineMsg.textContent);
  ok(t + ' E2 aria-invalid set on the revealed input', enStreetEl.getAttribute('aria-invalid') === 'true');

  // E3: fill the revealed field right here and try again - Next now succeeds.
  setField(d, 'investorsArray[0].englishDetails.englishAddress.street', 'Dan Shomron 13');
  setField(d, 'investorsArray[0].englishDetails.englishAddress.city', 'Ramat Gan');
  ok(t + ' E3 Next succeeds once the revealed field is filled', (await clickNext(d)) === 'ind.qualification', currentPage(d));

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
  // walkToReview now fills the revealed field on ind.personal itself (the new
  // early gate) and carries on to review - see E1/E2/E3 assertions inside it.
  await walkToReview(rig, 'E');

  d.querySelector('[data-action="submit"]').click();
  await sleep(300);

  const submitCall = rig.gatewayCalls.find((c) => c.body && c.body.action === 'submit');
  ok('E3 submit succeeds carrying the field filled at the early gate', !!submitCall);
  if (submitCall) {
    const inv0 = submitCall.body.payload.submission.investorsArray[0];
    ok('E3 submission carries the LP-typed English street', inv0.englishDetails.englishAddress.street === 'Dan Shomron 13',
      inv0.englishDetails.englishAddress.street);
    ok('E3 submission carries the LP-typed English city', inv0.englishDetails.englishAddress.city === 'Ramat Gan',
      inv0.englishDetails.englishAddress.city);
  }
  const cardText = (d.querySelector('.lvp-result') || d.body).textContent;
  ok('E3 success card painted after the fix', cardText.indexOf('המסמכים נשלחו בהצלחה') !== -1);

  await scenarioRootCause();
  await scenarioTransliterationSuggestion();
  reportTransliterationAccuracy();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

// ---------------------------------------------------------------------------
// Yanai's REAL address, in the exact component shape Google returns for it.
// Measured live 2026-09-06: geocode(language:'en') gives a HEBREW route (the
// street has no English name on file) and an ENGLISH locality.
const HE_COMPS = [
  comp('13', ['street_number']), comp('דן שומרון', ['route']),
  comp('רמת גן', ['locality', 'political']), comp('5265233', ['postal_code'])
];
const EN_COMPS = [
  comp('13', ['street_number']), comp('דן שומרון', ['route']),
  comp('Ramat Gan', ['locality', 'political']), comp('5265233', ['postal_code'])
];
const SEARCH = 'investorsArray[0].israelAddressSearch';
const EN_STREET = 'investorsArray[0].englishDetails.englishAddress.street';
const EN_CITY = 'investorsArray[0].englishDetails.englishAddress.city';
const NOTE_HE = 'לא הצלחנו לתרגם את הכתובת אוטומטית. נא לאשר או להשלים באנגלית.';

function val(d, name) {
  const e = d.querySelector('[name="' + name.replace(/(["\\\]\[])/g, '\\$1') + '"]');
  return e ? String(e.value || '').trim() : '(no element)';
}
function el(d, name) { return d.querySelector('[name="' + name.replace(/(["\\\]\[])/g, '\\$1') + '"]'); }

// C1-C3 + V1-V3 + R1. Boots the form with the Place class the LIVE page uses
// (the rig never had one) returning HEBREW components, and a Geocoder that has
// the English city. Before the fix this left BOTH English fields blank and
// never called the Geocoder at all.
async function scenarioRootCause() {
  const rig = await loadIsraelForm({
    geocode: (q) => ({ status: 'OK', results: [{ address_components: q.placeId ? EN_COMPS : EN_COMPS }] })
  });
  const d = rig.document, w = rig.window;
  w.google.maps.places.Place = function (o) {
    this.id = o.id;
    this.addressComponents = null;
    const self = this;
    this.fetchFields = function () {
      // Components come back, but in Hebrew: requestedLanguage:'en' is a request,
      // not a guarantee. This is NOT "no components", which is the whole point.
      self.addressComponents = HE_COMPS.map((c) => ({ longText: c.long_name, shortText: c.short_name, types: c.types }));
      return Promise.resolve({});
    };
  };
  await clickNext(d);
  const holderBefore = el(d, EN_STREET).closest('.lvp-field');
  ok('C0 precondition: English pair hidden before any address exists', holderBefore.hidden === true);

  pickPlace(d, SEARCH, { address_components: HE_COMPS, place_id: 'PLACE_YANAI', formatted_address: 'דן שומרון 13, רמת גן, ישראל' });
  const holder = el(d, EN_STREET).closest('.lvp-field');
  const cityHolder = el(d, EN_CITY).closest('.lvp-field');

  // V1/V2: visible IMMEDIATELY on the pick - not one geocode round-trip later,
  // and not at a failed Continue.
  ok('V1 English street holder visible the moment the address resolves', holder.hidden === false);
  ok('V1 English city holder visible the moment the address resolves', cityHolder.hidden === false);
  ok('V2 English street input is a real text field, not type="hidden"', el(d, EN_STREET).type === 'text', el(d, EN_STREET).type);
  ok('V2 English city input is a real text field, not type="hidden"', el(d, EN_CITY).type === 'text', el(d, EN_CITY).type);
  ok('V3 neither field is in an error state on first sight', !holder.classList.contains('lvp-field--error') && !cityHolder.classList.contains('lvp-field--error'));

  // R1: the form's required marker is a pure-CSS rule keyed off
  // `.lvp-field:not([data-optional]):not(.lvp-field--error) > .lvp-field__label`
  // (israel.html, "Required markers, 2026-08-24"). No required/data-required
  // attribute exists anywhere on this form; asserting the SELECTOR matches is
  // asserting the marker renders. jsdom does not evaluate ::after content.
  const REQ_SEL = '.lvp-field:not([data-optional]):not(.lvp-field--error) > .lvp-field__label';
  ok('R1 English street label matches the required-marker selector', !!holder.querySelector(':scope > .lvp-field__label') && holder.matches('.lvp-field:not([data-optional])') && d.querySelectorAll(REQ_SEL).length > 0);
  ok('R1 English street holder carries no data-optional opt-out', !holder.hasAttribute('data-optional'));
  ok('R1 English city holder carries no data-optional opt-out', !cityHolder.hasAttribute('data-optional'));

  await sleep(250);
  // C1: THE ROOT CAUSE. Google had "Ramat Gan" and the old code never asked for it.
  ok('C1 English CITY auto-filled from Google despite the Place class returning Hebrew',
    val(d, EN_CITY) === 'Ramat Gan', val(d, EN_CITY));
  ok('C2 the Geocoder WAS consulted after the Place class produced no usable English',
    rig.geocodeCalls.some((q) => q.placeId === 'PLACE_YANAI' && q.language === 'en'), JSON.stringify(rig.geocodeCalls));
  // C3: the street genuinely has no English name at Google, so it must NOT be
  // silently filled with the Hebrew - isHebrewText_ still refuses it, and what
  // lands instead is a flagged transliteration (see T2).
  ok('C3 English STREET is not the Hebrew string', !/[א-ת]/.test(val(d, EN_STREET)), val(d, EN_STREET));
  ok('C3 English street holds the transliteration suggestion', val(d, EN_STREET) === 'Dan Shomron 13', val(d, EN_STREET));
}

// T2-T4. A transliteration is a suggestion the LP must confirm.
async function scenarioTransliterationSuggestion() {
  const rig = await loadIsraelForm({
    // Google answers nothing usable at all: both fields fall to transliteration.
    geocode: () => null
  });
  const d = rig.document;
  await clickNext(d);
  fillPersonalPageNoEnglishAddress(d);
  pickPlace(d, SEARCH, { address_components: HE_COMPS, place_id: 'PLACE_YANAI', formatted_address: 'דן שומרון 13, רמת גן, ישראל' });
  await sleep(250);

  ok('T2 street pre-filled with the transliteration', val(d, EN_STREET) === 'Dan Shomron 13', val(d, EN_STREET));
  ok('T2 city pre-filled with the transliteration', val(d, EN_CITY) === 'Ramat Gan', val(d, EN_CITY));
  ok('T2 street flagged as an unconfirmed suggestion', el(d, EN_STREET).dataset.translitUnconfirmed === '1');
  ok('T2 city flagged as an unconfirmed suggestion', el(d, EN_CITY).dataset.translitUnconfirmed === '1');
  const note = d.querySelector('.lvp-en-addr-note');
  ok('T2 the approved note is rendered verbatim', !!note && note.textContent.trim() === NOTE_HE, note && note.textContent);

  // T3: an unconfirmed suggestion cannot ride into a submit.
  ok('T3 Continue is REFUSED while the suggestion is unconfirmed', (await clickNext(d)) === 'ind.personal', currentPage(d));

  // T4: a PROGRAMMATIC focus does not count as the LP having looked at it.
  try { el(d, EN_STREET).focus(); el(d, EN_CITY).focus(); } catch (e) {}
  ok('T4 a programmatic .focus() does NOT confirm the suggestion',
    el(d, EN_STREET).dataset.translitUnconfirmed === '1' && el(d, EN_CITY).dataset.translitUnconfirmed === '1');
  ok('T4 Continue still refused after a programmatic focus', (await clickNext(d)) === 'ind.personal', currentPage(d));

  // A real interaction (click into the field) confirms it.
  fire(el(d, EN_STREET), 'mousedown');
  fire(el(d, EN_CITY), 'mousedown');
  ok('T3 a real interaction clears the unconfirmed flag',
    !el(d, EN_STREET).dataset.translitUnconfirmed && !el(d, EN_CITY).dataset.translitUnconfirmed);
  ok('T3 Continue succeeds once the LP has been in the fields', (await clickNext(d)) === 'ind.qualification', currentPage(d));
  ok('T3 the confirmed suggestion is preserved', val(d, EN_STREET) === 'Dan Shomron 13' && val(d, EN_CITY) === 'Ramat Gan');
}

// T1. Accuracy of the transliteration engine, measured not asserted-away.
// Extracted from the REAL israel.html by brace counting, the pattern this
// repo's other harnesses use (see CLAUDE.md, "extractFn").
function loadTranslit() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'israel.html'), 'utf8');
  const grab = (start) => {
    const i = src.indexOf(start);
    if (i < 0) throw new Error('harness: not found in israel.html: ' + start);
    let depth = 0;
    for (let k = src.indexOf('{', i); k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
    }
    throw new Error('harness: unbalanced braces after ' + start);
  };
  const code = [
    grab('var TRANSLIT_CONS = {') + ';', grab('var TRANSLIT_INITIAL = {') + ';',
    grab('var TRANSLIT_FINAL = {') + ';', grab('var TRANSLIT_GERESH = {') + ';',
    "var EPENTHETIC = 'a';",
    grab('function translitWord_('), grab('function translitHe_('),
    'return translitHe_;'
  ].join('\n');
  return new Function(code)();
}

// Real Israeli street and city names, paired with the spelling the road signs
// and the municipalities actually use. Deliberately includes the ones an
// unpointed-Hebrew engine cannot get right, because pretending otherwise would
// be the dishonest version of this test.
const TRANSLIT_TABLE = [
  ['דן שומרון', 'Dan Shomron'], ['רמת גן', 'Ramat Gan'], ['תל אביב', 'Tel Aviv'],
  ['בן גוריון', 'Ben Gurion'], ['הרצל', 'Herzl'], ["ז'בוטינסקי", 'Zhabotinsky'],
  ['ביאליק', 'Bialik'], ['רוטשילד', 'Rotshild'], ['אלנבי', 'Allenby'],
  ['דיזנגוף', 'Dizengof'], ['ירושלים', 'Yerushalayim'], ['נתניה', 'Netanya'],
  ['חיפה', 'Haifa'], ['באר שבע', 'Beer Sheva'], ['אשדוד', 'Ashdod'],
  ['כפר סבא', 'Kfar Saba'], ['פתח תקווה', 'Petah Tikva'], ['ראשון לציון', 'Rishon LeTziyon'],
  ['הרצליה', 'Herzliya'], ['רעננה', 'Raanana'], ['שבזי', 'Shabazi'],
  ['ויצמן', 'Weizmann'], ['סוקולוב', 'Sokolov'], ['אבן גבירול', 'Even Gvirol'],
  ['בגין', 'Begin'], ["ז'ראר בכר", 'Zherar Bakhar'], ['שדרות ירושלים', 'Sderot Yerushalayim'],
  ['מודיעין', 'Modiin'], ['קריית אונו', 'Kiryat Ono'], ['גבעתיים', 'Givatayim']
];
// Locked floors, not targets. They exist so a refactor that quietly makes the
// engine WORSE fails the deploy gate; raise them when the engine improves.
const EXACT_FLOOR = 7;
const SKELETON_FLOOR = 19;

function reportTransliterationAccuracy() {
  const translit = loadTranslit();
  const skel = (x) => x.toLowerCase().replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
  let exact = 0, skeleton = 0;
  const misses = [];
  TRANSLIT_TABLE.forEach(([he, sign]) => {
    const got = translit(he);
    const isExact = got.toLowerCase() === sign.toLowerCase();
    const isSkel = skel(got) === skel(sign);
    if (isExact) exact++;
    if (isSkel) skeleton++;
    if (!isExact) misses.push(he + ' -> ' + got + ' (sign: ' + sign + ')');
  });
  console.log('\n--- T1 transliteration accuracy (' + TRANSLIT_TABLE.length + ' real Israeli names) ---');
  console.log('  exact matches:      ' + exact + '/' + TRANSLIT_TABLE.length);
  console.log('  consonant skeleton: ' + skeleton + '/' + TRANSLIT_TABLE.length);
  misses.forEach((m) => console.log('  miss: ' + m));
  ok('T1 the case Noa named transliterates correctly: דן שומרון -> Dan Shomron', translit('דן שומרון') === 'Dan Shomron', translit('דן שומרון'));
  ok('T1 final forms are folded (ך ם ן ף ץ): גן -> Gan', translit('גן') === 'Gan', translit('גן'));
  ok('T1 ו as mater lectionis reads as a vowel, not v: שומרון -> Shomron', translit('שומרון') === 'Shomron', translit('שומרון'));
  ok('T1 י as mater lectionis reads as a vowel: רוטשילד -> Rotshild', translit('רוטשילד') === 'Rotshild', translit('רוטשילד'));
  ok('T1 the tz digraph: רמת -> Ramat and ראשון carries tz in לציון', translit('לציון').indexOf('tz') !== -1, translit('לציון'));
  ok('T1 the kh digraph for non-initial כ: בכר -> Bakhar', translit('בכר') === 'Bakhar', translit('בכר'));
  ok('T1 the sh digraph: שדרות starts Sh', /^Sh/.test(translit('שדרות')), translit('שדרות'));
  ok('T1 the ch/zh geresh digraphs: ז\'בוטינסקי starts Zh', /^Zh/.test(translit("ז'בוטינסקי")), translit("ז'בוטינסקי"));
  ok('T1 digits and Latin text ride through untouched', translit('דן שומרון 13') === 'Dan Shomron 13', translit('דן שומרון 13'));
  ok('T1 output is never Hebrew', !/[א-ת]/.test(TRANSLIT_TABLE.map((r) => translit(r[0])).join('')));
  ok('T1 exact-match floor held (>= ' + EXACT_FLOOR + ')', exact >= EXACT_FLOOR, exact);
  ok('T1 consonant-skeleton floor held (>= ' + SKELETON_FLOOR + ')', skeleton >= SKELETON_FLOOR, skeleton);
}
