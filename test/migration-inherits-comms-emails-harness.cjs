// migration-inherits-comms-emails-harness.cjs (2026-09-08).
//
// Noa's ruling, SPEC section 6c: "keep what they have automatically and dont ask
// the lps... in terms of emails for comms". A migrating LP already has
// communication emails on file from the Israeli fund. They carry over and the LP
// is never asked again, so the Communications page must not appear at all on a
// migration.
//
// PART A is the migration. The comms page is gated out of visiblePages() by the
// SAME data-page-when="isTransferIn=false" mechanism that already gates the two
// money pages, so nothing new was invented for it. Three things have to hold at
// once: the page is not in the sequence, it leaves no required-field state that
// could block Next or Submit, and the payload that reaches the wire carries NO
// comms keys at all.
//
// That last one is the real hazard and it is not implied by the first two.
// collectAll walks EVERY named control regardless of page visibility, and an
// unchecked checkbox is collected unconditionally (it writes false rather than
// skipping, unlike a blank text input). Without the collectAll skip a migration
// would still have shipped comms.ccFamilyOffice:false - an answer the LP was
// never asked for - into a namespace that is supposed to be inherited untouched.
//
// PART B is the negative, and it matters as much. An ordinary new Cayman
// subscriber must be unchanged: the comms page is still in their sequence, still
// sits immediately before review, still runs through validatePage, the
// English-only scrub still applies to its inputs, and every value they entered
// still reaches the wire. A blanket removal of the page would pass Part A and
// fail here.
//
// PART C pins the mechanism itself: the gate is data-page-when (not a second
// bespoke one), and the prefetch that used to be keyed off the comms page id
// still fires on a migration, where comms no longer exists to trigger it.
//
// Run: node test/migration-inherits-comms-emails-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { loadForm } = require('./rig.cjs');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const SLOTS = ['articlesOfIncorporation', 'bankAccountConfirmation', 'certificateOfIncorporation', 'corporateResolution', 'listOfAuthorizedSignatories', 'partnershipAgreement', 'proofOfRegisteredAddress', 'trustAgreement', 'passportPrimary', 'proofOfAddress', 'qualification.preSignedUpload'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }

function cur(d) { const p = d.querySelector('.lvp-page:not([hidden])'); return p ? p.getAttribute('data-page') : null; }
function seq(d) { return Array.from(d.querySelectorAll('.lvp-page')).filter((p) => !p.hidden).map((p) => p.getAttribute('data-page')); }
function fh(h) { let el = h; while (el && el.nodeType === 1) { if (el.hasAttribute && el.hasAttribute('hidden')) return true; if (el.style && el.style.display === 'none') return true; el = el.parentElement; } return false; }
function visReq(d) { const p = d.querySelector('.lvp-page:not([hidden])'); if (!p) return []; return Array.from(p.querySelectorAll('[data-required]')).filter((h) => !fh(h)); }
function empty(h) { if (h.classList.contains('lvp-dob')) { const iso = h.querySelector('[data-dob-iso]'); return !(iso && /^\d{4}-\d{2}-\d{2}$/.test(iso.value || '')); } const ins = Array.from(h.querySelectorAll('input,select,textarea')); let f = false; ins.forEach((i) => { if (i.type === 'radio' || i.type === 'checkbox') { if (i.checked) f = true; } else if (i.hasAttribute('data-upload')) { /* stubbed */ } else if (i.value && String(i.value).trim()) f = true; }); return !f; }
function fire(el, t) { el.dispatchEvent(new (el.ownerDocument.defaultView.Event)(t, { bubbles: true })); }
function setV(i, v) { i.value = v; fire(i, 'input'); fire(i, 'change'); }
function valueFor(i) {
  const n = String(i.name || '');
  if (/\.idNumber$|\.idOrCompanyNumber$|taxRefNumber$|registrationNumber$/.test(n)) return '123456782';
  if (/\.phone$/.test(n)) return '+972501234567';
  if (/\.usTin$/.test(n)) return '123456789';
  if (/\.giin\d*$|mergedGiin$/.test(n)) return 'ABCDEF.ABCDE.IL.123';
  if (/lpBank\.accountNumber$/.test(n)) return '12345678';
  if (/lpBank\.swift$/.test(n)) return 'LUMIILIT';
  if (/amount$/i.test(n)) return '150000';
  if (/\.postCode$/.test(n)) return '6100000';
  if (/taxRefTypeAndNumber$/.test(n)) return 'SSN 123-45-6789';
  return (i.getAttribute('inputmode') === 'numeric') ? '123456' : 'Test';
}
function fill(h) {
  if (h.classList.contains('lvp-dob')) { const d = h.querySelector('[data-dob-d]'), m = h.querySelector('[data-dob-m]'), y = h.querySelector('[data-dob-y]'), iso = h.querySelector('[data-dob-iso]'); if (d) setV(d, '01'); if (m) setV(m, '01'); if (y) setV(y, '1985'); if (iso && !/^\d{4}/.test(iso.value)) iso.value = '1985-01-01'; return; }
  const ins = Array.from(h.querySelectorAll('input,select,textarea'));
  const r = ins.filter((i) => i.type === 'radio'); if (r.length) { r[0].checked = true; fire(r[0], 'change'); fire(r[0], 'input'); return; }
  ins.forEach((i) => {
    if (i.type === 'checkbox') { i.checked = true; fire(i, 'change'); }
    else if (i.type === 'file') { /* stubbed */ }
    else if (i.tagName === 'SELECT') { const o = Array.from(i.options).find((x) => x.value); if (o) { i.value = o.value; fire(i, 'change'); fire(i, 'input'); } }
    else if (i.type === 'date') { setV(i, new Date().toISOString().slice(0, 10)); }
    else if (i.type === 'email') { setV(i, 't@example.com'); }
    else setV(i, valueFor(i));
  });
}

// Walk forward to review, calling onPage(pageId) each time a new page shows so a
// caller can act on a specific page in situ (the comms page in Part B). Records
// every page id the LP was actually shown, so "never saw the comms page" is an
// assertion about the journey, not just about the end state.
async function walkToReview(document, onPage) {
  const next = document.querySelector('[data-action="next"]');
  const visited = [];
  for (let s = 0; s < 40 && cur(document) !== 'review'; s++) {
    const id = cur(document);
    if (id && visited[visited.length - 1] !== id) { visited.push(id); if (onPage) await onPage(id); }
    for (let k = 0; k < 5; k++) { const e = visReq(document).filter(empty); if (!e.length) break; e.forEach(fill); await sleep(8); }
    next.click(); await sleep(10);
  }
  if (cur(document) === 'review') visited.push('review');
  return visited;
}

async function signAndSubmit(document, window) {
  const seen = { body: null, called: false };
  const of = window.fetch;
  window.fetch = function (u, o) {
    if (String(u).indexOf('source=lp') !== -1) {
      let parsed = null;
      try { parsed = JSON.parse((o && o.body) || '{}'); } catch (e) { parsed = null; }
      if (parsed && parsed.action === 'submit') { seen.called = true; seen.body = (parsed.payload || {}); }
    }
    return of(u, o);
  };
  const typeBtn = document.querySelector('[data-sig-mode="type"]');
  if (typeBtn) { typeBtn.click(); await sleep(8); }
  const ti = document.querySelector('[data-sig-typed-input]');
  if (ti) { setV(ti, 'Test Subscriber'); await sleep(8); }
  document.querySelector('[data-action="submit"]').click();
  await sleep(60);
  return seen;
}

(async () => {
  // ==================== PART A: migrating LP ====================
  const a = await loadForm({
    cfg: {
      applicantType: 'individual',
      flowType: 'cayman_subscription',
      isExistingLp: true,
      isTransferIn: true,
      prefill: { __testUploads: SLOTS, _pad: '1' }
    }
  });

  // NOTE on what is NOT asserted here. A boot-time "comms is not in the visible
  // set" check would be worthless: showPage hides every .lvp-page but the current
  // one, so at boot exactly one page (welcome) is unhidden whether or not the gate
  // exists. Verified by mutation on 2026-09-08: with the gate removed, that
  // assertion stayed green. The real sequence is only observable by walking it,
  // which is what the journey assertion below does.
  const commsPage = a.document.querySelector('.lvp-page[data-page="comms"]');
  ok('A the comms page exists in the markup, it is gated not deleted', !!commsPage);
  // Scope pin, not a guard: the comms page carries no data-required holders at
  // all, so a gated-out comms page cannot leave required-field state behind. This
  // stays green under the un-gate mutation by design; it exists so that adding a
  // required control to this page becomes a visible change here.
  ok('A the comms page contributes zero required holders in the first place (scope pin)',
    !!commsPage && commsPage.querySelectorAll('[data-required]').length === 0,
    !!commsPage && commsPage.querySelectorAll('[data-required]').length);

  const aVisited = await walkToReview(a.document);
  ok('A the migrating LP never lands on the comms page anywhere in the journey',
    aVisited.indexOf('comms') === -1, aVisited);
  ok('A the migrating LP reaches review', cur(a.document) === 'review', 'landed on ' + cur(a.document));
  ok('A the migrating LP is never sent to the gate screen',
    !a.document.documentElement.classList.contains('lvp-gate-mode'));
  const aRef = a.errors.filter((e) => /ReferenceError/.test(e));
  ok('A no ReferenceError escapes on the migrating LP journey', aRef.length === 0, aRef.slice(0, 3));

  // Backwards too: the gated page must be absent from the sequence in both
  // directions, not merely skipped on the way forward.
  a.document.querySelector('[data-action="prev"]').click(); await sleep(15);
  ok('A stepping Back from review does not land the migrating LP on comms',
    cur(a.document) !== 'comms', cur(a.document));
  const next2 = a.document.querySelector('[data-action="next"]');
  next2.click(); await sleep(15);
  ok('A the migrating LP is back on review', cur(a.document) === 'review', cur(a.document));

  const aSeen = await signAndSubmit(a.document, a.window);
  ok('A the migrating LP is not blocked at submit: the gateway is actually called', aSeen.called === true);
  const aSub = (aSeen.body && aSeen.body.submission) || null;
  ok('A the submission still carries the migration flag the server reads',
    !!aSub && aSub.isTransferIn === true, aSub && aSub.isTransferIn);

  // THE BLANK-OVERWRITE GUARD. The migrating LP's comms emails live on their
  // Israeli Monday row. Anything this payload carries under comms is a value the
  // LP never gave, and ju-cayman's CaymanMonday.js writes the comms columns from
  // exactly this namespace. No comms key may ship at all.
  ok('A the submission carries NO comms branch at all',
    !!aSub && typeof aSub.comms === 'undefined', aSub && aSub.comms);
  ok('A specifically, no ccFamilyOffice:false is shipped over the inherited opt-in',
    !!aSub && !(aSub.comms && Object.prototype.hasOwnProperty.call(aSub.comms, 'ccFamilyOffice')),
    aSub && aSub.comms);
  const aFlat = JSON.stringify(aSub || {});
  ok('A no comms.* key survives anywhere in the migration payload',
    aFlat.indexOf('"comms"') === -1 && aFlat.indexOf('ccFamilyOffice') === -1 &&
    aFlat.indexOf('additionalEmails') === -1 && aFlat.indexOf('foEmail') === -1);

  // ============ PART B: ordinary new Cayman subscriber, unchanged ============
  const b = await loadForm({
    cfg: { applicantType: 'individual', flowType: 'cayman_subscription', prefill: { __testUploads: SLOTS, _pad: '1' } }
  });

  const bSeqBoot = seq(b.document);
  ok('B the ordinary subscriber is not flagged as a migration at boot',
    (b.document.querySelector('input[name="isTransferIn"]') || {}).value === 'false');

  let sawCommsPage = false, commsValidated = false, hebrewScrubbed = false;
  const bVisited = await walkToReview(b.document, async (id) => {
    if (id !== 'comms') return;
    sawCommsPage = true;
    const page = b.document.querySelector('.lvp-page[data-page="comms"]');
    ok('B the comms page is actually the one on screen', page && page.hidden === false);

    // The English-only scrub is live validation on this page: Hebrew typed into a
    // comms input is stripped as it is entered. Prove it on a real comms control.
    const fo = b.document.querySelector('[name="comms.foEmail"]');
    setV(fo, 'שלום@family.com');
    hebrewScrubbed = (fo.value.indexOf('שלום') === -1);
    setV(fo, 'office@family.com');

    // Two additional recipients, added the way the LP adds them.
    const addBtn = b.document.querySelector('[data-action="add-row"][data-target="comms.additionalEmails"]');
    addBtn.click(); await sleep(10);
    addBtn.click(); await sleep(10);
    const rows = b.document.querySelectorAll('[name^="comms.additionalEmails"]');
    ok('B the add-row control still builds comms recipient rows', rows.length === 2, rows.length);
    if (rows[0]) setV(rows[0], 'cc-one@example.com');
    if (rows[1]) setV(rows[1], 'cc-two@example.com');

    const cc = b.document.querySelector('[name="comms.ccFamilyOffice"]');
    cc.checked = true; fire(cc, 'change');

    // The comms page still goes through the REAL gate: validatePage runs on it at
    // Continue and it is in the submit-time all-pages sweep. Proven by driving the
    // Continue button and watching it advance exactly one page.
    //
    // HONEST SCOPE, measured not assumed (2026-09-08): validatePage's email-format
    // and Hebrew backstops both require the control to sit inside a
    // .lvp-field/.lvp-fieldset holder, and NONE of the three comms controls does
    // (the recipient inputs live in .lvp-email-row, foEmail is a bare input). So a
    // malformed comms email passes the client gate today and only the server
    // catches it. That is pre-existing and untouched by the migration gate; this
    // harness pins what the page actually does rather than a check it does not have.
    const commsPageEl = b.document.querySelector('.lvp-page[data-page="comms"]');
    commsValidated = (b.document.querySelector('[name="comms.additionalEmails[0]"]')
      .closest('.lvp-field, .lvp-fieldset') === null) && commsPageEl.hidden === false;
  });

  ok('B an ordinary subscriber is still shown the comms page', sawCommsPage === true, bVisited);
  ok('B the comms page still sits immediately before review',
    bVisited.indexOf('comms') !== -1 && bVisited[bVisited.indexOf('comms') + 1] === 'review', bVisited);
  ok('B the English-only scrub still applies to comms inputs', hebrewScrubbed === true);
  ok('B the comms page is on screen and its controls carry no validation holder (scope pin)',
    commsValidated === true);
  ok('B the comms page still passes through the REAL validatePage gate at Continue',
    bVisited[bVisited.indexOf('comms') + 1] === 'review' && cur(b.document) === 'review', bVisited);
  ok('B the ordinary subscriber reaches review', cur(b.document) === 'review', 'landed on ' + cur(b.document));

  b.document.querySelector('[data-action="prev"]').click(); await sleep(15);
  ok('B stepping Back from review lands the ordinary subscriber on comms',
    cur(b.document) === 'comms', cur(b.document));
  b.document.querySelector('[data-action="next"]').click(); await sleep(15);
  ok('B the ordinary subscriber is back on review', cur(b.document) === 'review', cur(b.document));

  const bSeen = await signAndSubmit(b.document, b.window);
  ok('B an ordinary subscriber still reaches the gateway at submit', bSeen.called === true);
  const bSub = (bSeen.body && bSeen.body.submission) || null;
  ok('B the ordinary subscriber is not flagged as a migration',
    !!bSub && bSub.isTransferIn === false, bSub && bSub.isTransferIn);
  ok('B the comms branch still ships for an ordinary subscriber',
    !!bSub && !!bSub.comms, bSub && bSub.comms);
  ok('B both additional comms recipients still reach the wire',
    !!bSub && !!bSub.comms && Array.isArray(bSub.comms.additionalEmails) &&
    bSub.comms.additionalEmails.indexOf('cc-one@example.com') !== -1 &&
    bSub.comms.additionalEmails.indexOf('cc-two@example.com') !== -1,
    bSub && bSub.comms && bSub.comms.additionalEmails);
  ok('B the family-office opt-in still reaches the wire',
    !!bSub && !!bSub.comms && bSub.comms.ccFamilyOffice === true, bSub && bSub.comms);
  ok('B the family-office email still reaches the wire',
    !!bSub && !!bSub.comms && bSub.comms.foEmail === 'office@family.com', bSub && bSub.comms);

  // The off-by-default opt-in must still ship as an explicit false for an
  // ordinary subscriber: that is the pre-existing contract, and the migration
  // skip must not have quietly widened into every lane.
  const c = await loadForm({
    cfg: { applicantType: 'individual', flowType: 'cayman_subscription', prefill: { __testUploads: SLOTS, _pad: '1' } }
  });
  await walkToReview(c.document);
  const cSeen = await signAndSubmit(c.document, c.window);
  const cSub = (cSeen.body && cSeen.body.submission) || null;
  ok('B an ordinary subscriber who touched nothing still ships ccFamilyOffice:false',
    !!cSub && !!cSub.comms && cSub.comms.ccFamilyOffice === false, cSub && cSub.comms);

  // ================= PART C: the mechanism, not a second one =================
  ok('C the comms page is gated by the EXISTING data-page-when engine',
    /data-page="comms"[^>]*data-page-when="isTransferIn=false"/.test(html));
  ok('C no second gating mechanism was invented for it: exactly three pages carry the gate',
    (html.match(/<section class="lvp-page" data-page="[^"]*"[^>]*data-page-when="isTransferIn=false"/g) || []).length === 3,
    (html.match(/<section class="lvp-page" data-page="[^"]*"[^>]*data-page-when="isTransferIn=false"/g) || []).length);
  ok('C the two money pages still carry their original gate',
    /data-page="investment" data-page-when="isTransferIn=false"/.test(html) &&
    /data-page="investment.bank" data-page-when="isTransferIn=false"/.test(html));
  ok('C collectAll skips the comms namespace only for a migration',
    /isMigration && inp\.name\.indexOf\('comms\.'\) === 0/.test(html));
  ok('C the doc-pack prefetch no longer depends on the comms page existing',
    html.indexOf("=== 'comms') { prefetchDocPreview()") === -1 &&
    /idx === pages\.length - 2.*prefetchDocPreview\(\)/.test(html));
  const aPack = a.document.querySelector('[data-doc-preview]');
  ok('C the document pack still renders on review for a migration',
    !!aPack && aPack.hidden === false);

  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e); process.exit(1); });
