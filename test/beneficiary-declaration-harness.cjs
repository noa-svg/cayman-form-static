// beneficiary-declaration-harness.cjs - verifies the beneficiary declaration
// page (../israel.html, data-page="beneficiary") matches the EasySend
// three-way field model (SPEC-individual-onboarding.md:163,187 /
// SPEC-entity-onboarding.md:143): ONE fieldset, THREE mutually-exclusive
// radio options (self / unknown+reasonUnknown / named), not the old
// two-step hasBeneficiaries gate this repo shipped before 2026-08-11.
//
// B1  the fieldset carries exactly one radio group (beneficiaryStatement.statement)
//     with exactly 3 options, native-radio mutual exclusion (shared name attr).
// B2  the approved Hebrew copy is locked verbatim (legend + 3 option labels +
//     reasonUnknown prompt + named-beneficiary intro), so a future edit can't
//     silently drift from the wording Noa approved.
// B3  the EN translation dictionary carries the exact approved English text
//     for the same 3 keys (still wired, not orphaned).
// B4  selecting "self": reasonUnknown field and named-beneficiary block stay
//     hidden; page advances immediately (no extra required field).
// B5  selecting "unknown": reasonUnknown field appears and is REQUIRED -
//     advancing without it is blocked; filling it clears the block.
// B6  selecting "named": the existing named-beneficiary array + connection
//     textarea appear (unchanged), advancing requires filling them.
// B7  switching from "unknown" back to "self" hides reasonUnknown again and
//     does not leave a stale required-block behind (mirrors the old
//     hasBeneficiaries-toggle regression this structure replaces).
// Run: node test/beneficiary-declaration-harness.cjs
'use strict';
const {
  loadIsraelForm, setField, checkRadio, checkBox,
  currentPage, clickNext, sleep
} = require('./rig-israel.cjs');
const LVPRules = require('../validation-rules.js');
const bankRegistry = require('../bank-registry.json');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}

const LP = {
  firstName: 'דניאל', lastName: 'רוזנברג',
  enFirst: 'Daniel', enLast: 'Rosenberg',
  id: '123456782',
  birthDate: '15/03/1980',
  occupation: 'ניהול השקעות',
  email: 'daniel.rosenberg@example.com',
  phone: '0541234567',
  address: { search: 'הרצל 10, תל אביב', street: 'הרצל', city: 'תל אביב', house: '10', zip: '6688312', enStreet: 'Herzl', enCity: 'Tel Aviv' }
};
const BANK = bankRegistry.banks.find((b) => b.c === 10);
const BRANCH = BANK.br[0];
function investmentDate() {
  const d = LVPRules.firstBusinessDayNextMonth();
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  return p2(d.getUTCDate()) + '/' + p2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
}

async function walkToBeneficiary(rig) {
  const d = rig.document;
  await clickNext(d); // welcome -> ind.personal
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
  await clickNext(d); // personal -> ind.qualification
  checkBox(d, 'investorsArray[0].qualification.isLiquidAssets');
  checkRadio(d, 'investorsArray[0].qualification.isSignedQualification', 'כן');
  await clickNext(d); // qualification -> money
  setField(d, 'moneyInvestedInFund.investedAmountArray[0].investedCurrency', 'שקל');
  setField(d, 'moneyInvestedInFund.investedAmount', '500000');
  setField(d, 'moneyInvestedInFund.investmentDate', investmentDate());
  setField(d, 'moneyInvestedInFund.bankDetails.bankNameIsrael', BANK.n);
  setField(d, 'moneyInvestedInFund.bankDetails.branchNumberIsrael', String(BRANCH[0]));
  setField(d, 'moneyInvestedInFund.bankDetails.accountNumber', '740800');
  setField(d, 'moneyInvestedInFund.moneySource', 'הון עצמי');
  checkBox(d, 'taxDeclaration.isNonBusinessIncome');
  const page = await clickNext(d); // money -> beneficiary
  ok('walk reaches beneficiary page', page === 'beneficiary', page);
  return d;
}

async function main() {
  // B1/B2/B3: structure + copy lock, no need to walk the whole form.
  {
    const rig = await loadIsraelForm();
    const d = rig.document;
    const section = d.querySelector('.lvp-page[data-page="beneficiary"]');
    ok('B0 beneficiary section exists', !!section);

    const radios = section.querySelectorAll('input[type="radio"]');
    ok('B1 exactly 3 radios on the page', radios.length === 3, radios.length);
    const names = new Set(Array.prototype.map.call(radios, (r) => r.name));
    ok('B1 all 3 share one field name (native mutual exclusion)', names.size === 1 && names.has('beneficiaryStatement.statement'), [...names].join(','));
    const values = Array.prototype.map.call(radios, (r) => r.value).sort();
    ok('B1 values are exactly self/unknown/named', values.join(',') === 'named,self,unknown', values.join(','));
    // Only ONE fieldset gates the three options (no nested second-step fieldset).
    const fieldsets = section.querySelectorAll('fieldset.lvp-fieldset');
    ok('B1 exactly one fieldset (no two-step gate)', fieldsets.length === 1, fieldsets.length);

    // B2: approved Hebrew copy, verbatim.
    const legend = fieldsets[0].querySelector('legend').textContent.trim();
    ok('B2 legend copy exact', legend === 'המשקיע/ה מצהיר/ה בזאת:', legend);
    const labels = Array.prototype.map.call(section.querySelectorAll('fieldset.lvp-fieldset label.lvp-radio'), (l) => l.textContent.trim());
    ok('B2 self-option copy exact', labels.indexOf('אני פועל/ת עבור עצמי בלבד') !== -1, labels.join(' | '));
    ok('B2 unknown-option copy exact', labels.indexOf('יש נהנה/ים בזכויות כאמור, אולם פרטי הזיהוי שלו/שלהם טרם ידועים') !== -1, labels.join(' | '));
    ok('B2 named-option copy exact', labels.indexOf('הנהנים בפעולה הם:') !== -1, labels.join(' | '));
    const title = section.querySelector('h2.lvp-page__title').textContent.trim();
    ok('B2 section title unchanged', title === 'הצהרה על נהנים ובעלי שליטה', title);

    // B3: EN translation dictionary carries the exact same 3 strings, still wired
    // (not orphaned - these keys now have a live caller in the markup above).
    const html = fs.readFileSync(path.join(__dirname, '..', 'israel.html'), 'utf8');
    ok('B3 self EN copy wired', html.indexOf('"אני פועל/ת עבור עצמי בלבד":"I am acting on my own behalf only"') !== -1);
    ok('B3 unknown EN copy wired', html.indexOf('"יש נהנה/ים בזכויות כאמור, אולם פרטי הזיהוי שלו/שלהם טרם ידועים":"There is a beneficiary or beneficiaries in the said rights, but their identifying details are not yet known"') !== -1);
    ok('B3 named EN copy wired', html.indexOf('"הנהנים בפעולה הם:":"The beneficiaries of the transaction are:"') !== -1);
  }

  // B4: "self" - no extra fields required, advances immediately.
  {
    const rig = await loadIsraelForm();
    const d = await walkToBeneficiary(rig);
    checkRadio(d, 'beneficiaryStatement.statement', 'self');
    const reasonHolder = d.querySelector('[data-show-when="beneficiaryStatement.statement=unknown"]');
    const namedHolder = d.querySelector('[data-show-when="beneficiaryStatement.statement=named"]');
    ok('B4 reasonUnknown hidden under self', reasonHolder.hidden || getComputedHidden(reasonHolder));
    ok('B4 named block hidden under self', namedHolder.hidden || getComputedHidden(namedHolder));
    const next = await clickNext(d);
    ok('B4 self advances past beneficiary with no extra fields', next !== 'beneficiary', next);
  }

  // B5: "unknown" without reasonUnknown blocks advance; filling it clears the block.
  {
    const rig = await loadIsraelForm();
    const d = await walkToBeneficiary(rig);
    checkRadio(d, 'beneficiaryStatement.statement', 'unknown');
    await sleep(20);
    const reasonHolder = d.querySelector('[data-show-when="beneficiaryStatement.statement=unknown"]');
    ok('B5 reasonUnknown visible under unknown', !reasonHolder.hidden && !getComputedHidden(reasonHolder));
    const blocked = await clickNext(d);
    ok('B5 advance blocked without reasonUnknown', blocked === 'beneficiary', blocked);
    ok('B5 reasonUnknown holder flagged invalid', reasonHolder.classList.contains('lvp-field--error'));
    setField(d, 'beneficiaryStatement.reasonUnknown', 'טרם אותרו פרטי הנהנה');
    const advanced = await clickNext(d);
    ok('B5 advance succeeds once reasonUnknown is filled', advanced !== 'beneficiary', advanced);
  }

  // B6: "named" surfaces the existing named-beneficiary array + connection field.
  {
    const rig = await loadIsraelForm();
    const d = await walkToBeneficiary(rig);
    checkRadio(d, 'beneficiaryStatement.statement', 'named');
    await sleep(20);
    const namedHolder = d.querySelector('[data-show-when="beneficiaryStatement.statement=named"]');
    ok('B6 named block visible', !namedHolder.hidden && !getComputedHidden(namedHolder));
    const blocked = await clickNext(d);
    ok('B6 advance blocked with an empty beneficiary row', blocked === 'beneficiary', blocked);
    setField(d, 'beneficiaryStatement.beneficiariesDetails.beneficiariesArray[0].fullName', 'ישראל ישראלי');
    setField(d, 'beneficiaryStatement.beneficiariesDetails.beneficiariesArray[0].idOrCompanyNumber', '123456782');
    setField(d, 'beneficiaryStatement.beneficiariesDetails.beneficiariesArray[0].birthOrIncorporationDate', '01/01/1990');
    setField(d, 'beneficiaryStatement.beneficiariesDetails.beneficiariesArray[0].gender', 'זכר');
    setField(d, 'beneficiaryStatement.beneficiariesDetails.beneficiariesArray[0].country', 'ישראל');
    setField(d, 'beneficiaryStatement.beneficiariesDetails.connectionBetweenBeneficiaries', 'קרוב משפחה');
    const advanced = await clickNext(d);
    ok('B6 advance succeeds once the named beneficiary row is filled', advanced !== 'beneficiary', advanced);
  }

  // B7: switching unknown -> self clears the stale required reasonUnknown block.
  {
    const rig = await loadIsraelForm();
    const d = await walkToBeneficiary(rig);
    checkRadio(d, 'beneficiaryStatement.statement', 'unknown');
    await sleep(20);
    checkRadio(d, 'beneficiaryStatement.statement', 'self');
    await sleep(20);
    const reasonHolder = d.querySelector('[data-show-when="beneficiaryStatement.statement=unknown"]');
    ok('B7 reasonUnknown re-hidden after switching back to self', reasonHolder.hidden || getComputedHidden(reasonHolder));
    const next = await clickNext(d);
    ok('B7 advances cleanly after the switch', next !== 'beneficiary', next);
  }

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

// jsdom's data-show-when engine may toggle either the `hidden` attribute or
// inline display:none depending on the holder element; check both so this
// harness doesn't depend on which one the engine currently uses.
function getComputedHidden(el) {
  if (!el) return true;
  if (el.hidden) return true;
  const style = el.getAttribute('style') || '';
  return /display:\s*none/.test(style);
}

main().catch((e) => { console.error(e); process.exit(1); });
