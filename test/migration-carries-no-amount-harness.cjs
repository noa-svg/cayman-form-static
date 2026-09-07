// migration-carries-no-amount-harness.cjs (2026-09-07).
//
// Noa's ruling, 2026-09-07 (2026-09-07-cayman-fund-to-fund-SPEC.md section 5):
// no amount is captured on an Israel-to-Cayman migration, from the LP or from
// the operator, because no correct figure exists at signing. The balance that
// moves is the one at the close of 2026.
//
// Before this change index.html refused any migrating LP whose session carried
// no figure. applyExistingAmountGate_ returned false and switched the page to
// the "Link unavailable" gate screen, from BOTH the review page and the submit
// handler. With the operator side no longer sending &amount=, that refusal
// would have fired on every single migrating LP: a dead link the moment the
// console change shipped.
//
// PART A is the exact journey that was broken. A migrating LP boots with
// isTransferIn:true and NO amount anywhere in the config, walks to review, and
// submits. They must never be sent to the gate screen and never be blocked, and
// the payload that reaches the wire must carry no investment branch at all.
//
// PART B is the negative. An ordinary new Cayman subscriber, with the money
// pages visible and an amount they typed themselves, must behave exactly as
// before: the money pages are in their sequence, they are required, and the
// amount they stated reaches the wire. A blanket removal of the amount would
// pass Part A and fail here.
//
// PART C pins the residue: a migration whose session still carries a stale
// cfg.prefill.investment (an old link minted before the console change) must
// still put no figure on the wire, and the read-only review panel must be gone
// from the markup rather than left painting a number with no sentence.
//
// Run: node test/migration-carries-no-amount-harness.cjs
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

// Walk to review, then sign and submit, capturing the submission that actually
// reaches the gateway. Returns the parsed body of the submit POST, or null.
async function walkAndSubmit(document, window) {
  const next = document.querySelector('[data-action="next"]');
  const submit = document.querySelector('[data-action="submit"]');
  for (let s = 0; s < 40 && cur(document) !== 'review'; s++) {
    for (let k = 0; k < 5; k++) { const e = visReq(document).filter(empty); if (!e.length) break; e.forEach(fill); await sleep(8); }
    next.click(); await sleep(10);
  }
  const seen = { body: null, called: false };
  const of = window.fetch;
  window.fetch = function (u, o) {
    if (String(u).indexOf('source=lp') !== -1) {
      let parsed = null;
      try { parsed = JSON.parse((o && o.body) || '{}'); } catch (e) { parsed = null; }
      // Foundation envelope: { action, token, lane, payload }. The submission the
      // server validates is payload.submission, not a top-level key.
      if (parsed && parsed.action === 'submit') { seen.called = true; seen.body = (parsed.payload || {}); }
    }
    return of(u, o);
  };
  const typeBtn = document.querySelector('[data-sig-mode="type"]');
  if (typeBtn) { typeBtn.click(); await sleep(8); }
  const ti = document.querySelector('[data-sig-typed-input]');
  if (ti) { setV(ti, 'Test Subscriber'); await sleep(8); }
  submit.click();
  await sleep(60);
  return seen;
}

(async () => {
  // ================= PART A: migrating LP, NO amount anywhere =================
  // Deliberately no `investment` in prefill and no `existingPosition` on the
  // config: this is the world the console change creates.
  const a = await loadForm({
    cfg: {
      applicantType: 'individual',
      // A migration mints as a cayman_subscription with the transfer-in flag set
      // (SPEC section 6a: the subscription is the spine). flowType must be present
      // or handleCfgLoaded_ reads the config as a dead token and gates the link.
      flowType: 'cayman_subscription',
      isExistingLp: true,
      isTransferIn: true,
      prefill: { __testUploads: SLOTS, _pad: '1' }
    }
  });

  ok('A the migrating LP is not sent to the gate screen at boot',
    !a.document.documentElement.classList.contains('lvp-gate-mode'));

  const moneyPages = Array.from(a.document.querySelectorAll('.lvp-page'))
    .filter((p) => !p.hidden).map((p) => p.getAttribute('data-page'));
  ok('A the money pages are still gated out for a migrating LP',
    moneyPages.indexOf('investment') === -1 && moneyPages.indexOf('investment.bank') === -1, moneyPages);

  const aSeen = await walkAndSubmit(a.document, a.window);

  ok('A a migrating LP with no amount reaches the review page',
    cur(a.document) === 'review', 'landed on ' + cur(a.document));
  ok('A the migrating LP is NEVER sent to the gate screen',
    !a.document.documentElement.classList.contains('lvp-gate-mode'));
  const aRef = a.errors.filter((e) => /ReferenceError/.test(e));
  ok('A no ReferenceError escapes on the migrating LP journey', aRef.length === 0, aRef.slice(0, 3));

  const aWrap = a.document.querySelector('[data-doc-preview]');
  const aSig = a.document.querySelector('[data-sig-section]');
  const aBtn = a.document.querySelector('[data-action="submit"]');
  ok('A the document pack is on screen', !!aWrap && aWrap.hidden === false);
  ok('A the signature section is on screen', !!aSig && aSig.hidden === false, aSig && aSig.hidden);
  ok('A the submit button is on screen', !!aBtn && aBtn.hidden === false, aBtn && aBtn.hidden);

  ok('A the migrating LP is NOT blocked at submit: the gateway is actually called',
    aSeen.called === true);
  const aSub = (aSeen.body && aSeen.body.submission) || null;
  ok('A the submission carries the migration flag the server reads', aSub && aSub.isTransferIn === true,
    aSub && aSub.isTransferIn);
  ok('A the submission carries NO investment branch at all',
    !!aSub && typeof aSub.investment === 'undefined', aSub && aSub.investment);

  // ============ PART B: ordinary new Cayman subscriber, unchanged ============
  const b = await loadForm({
    cfg: { applicantType: 'individual', flowType: 'cayman_subscription', prefill: { __testUploads: SLOTS, _pad: '1' } }
  });
  const bPages = Array.from(b.document.querySelectorAll('.lvp-page'))
    .map((p) => p.getAttribute('data-page'));
  ok('B the money pages exist in the markup for an ordinary subscriber',
    bPages.indexOf('investment') !== -1 && bPages.indexOf('investment.bank') !== -1);

  const bAmt = b.document.querySelector('[name="investment.amount"]');
  const bCur = b.document.querySelector('[name="investment.currency"]');
  ok('B the amount control is present and required for an ordinary subscriber',
    !!bAmt && !!bAmt.closest('[data-required]'));
  ok('B the currency control is present for an ordinary subscriber', !!bCur);

  const bSeen = await walkAndSubmit(b.document, b.window);
  ok('B an ordinary subscriber reaches review', cur(b.document) === 'review',
    'landed on ' + cur(b.document));
  ok('B an ordinary subscriber still reaches the gateway at submit', bSeen.called === true);
  const bSub = (bSeen.body && bSeen.body.submission) || null;
  ok('B the ordinary subscriber is not flagged as a migration',
    !!bSub && bSub.isTransferIn === false, bSub && bSub.isTransferIn);
  ok('B the amount the ordinary subscriber typed still reaches the wire',
    !!bSub && !!bSub.investment && Number(bSub.investment.amount) === 150000,
    bSub && bSub.investment);
  ok('B the currency the ordinary subscriber chose still reaches the wire',
    !!bSub && !!bSub.investment && !!bSub.investment.currency, bSub && bSub.investment);
  ok('B the ordinary subscriber still submits their remitting bank account',
    !!bSub && !!bSub.investment && !!bSub.investment.lpBank && !!bSub.investment.lpBank.accountNumber,
    bSub && bSub.investment && bSub.investment.lpBank);

  // ===== PART C: a stale minted figure on an old link must not resurface =====
  const c = await loadForm({
    cfg: {
      applicantType: 'individual',
      flowType: 'cayman_subscription',
      isExistingLp: true,
      isTransferIn: true,
      existingPosition: { amount: 1500000, currency: 'ILS' },
      prefill: { __testUploads: SLOTS, _pad: '1', investment: { amount: 1500000, currency: 'ILS' } }
    }
  });
  const cAmt = c.document.querySelector('[name="investment.amount"]');
  ok('C a stale prefill figure is blanked out of the hidden amount control',
    !!cAmt && String(cAmt.value || '') === '', cAmt && cAmt.value);
  const cSeen = await walkAndSubmit(c.document, c.window);
  ok('C a migration on a stale link still reaches submit', cSeen.called === true);
  const cSub = (cSeen.body && cSeen.body.submission) || null;
  ok('C a stale minted figure never reaches the wire',
    !!cSub && typeof cSub.investment === 'undefined', cSub && cSub.investment);

  // The read-only review panel and its styling are gone, not merely hidden: an
  // empty bordered box above the pack, with a label and note no code ever wrote,
  // is worse than nothing. A migrating LP now sees the document pack directly.
  ok('C the read-only amount panel is gone from the markup',
    html.indexOf('data-existing-amount') === -1);
  ok('C the panel styling is gone with it', html.indexOf('lvp-existing-amount') === -1);
  ok('C the gate function is gone, not merely unreferenced',
    html.indexOf('applyExistingAmountGate_') === -1);
  ok('C the operator-figure seeding path is gone',
    html.indexOf('seedExistingLpAmount_') === -1 && html.indexOf('existingPositionFromConfig_') === -1);
  // The lane flag itself must NOT have been removed with the amount: it still
  // gates both money pages and it is what the server's caymanIsTransferIn_ reads.
  ok('C the isTransferIn lane flag survives, because it still gates the money pages',
    html.indexOf('data-page-when="isTransferIn=false"') !== -1 &&
    html.indexOf('function transferInFromConfig_(') !== -1);

  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e); process.exit(1); });
