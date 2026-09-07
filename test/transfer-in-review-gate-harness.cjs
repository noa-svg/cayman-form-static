// transfer-in-review-gate-harness.cjs (2026-09-07).
//
// Two LP-visible defects on index.html, both proved here against the REAL file.
//
// A. applyExistingAmountGate_ ended its SUCCESS path with `if (missing)
//    missing.hidden = true;` and `missing` was declared nowhere in the file.
//    Reading an undeclared identifier throws a ReferenceError, so the gate never
//    returned true. It is called from loadDocPreview (review page) and from the
//    submit handler, and it only runs when transferInFromConfig_() is true - so
//    every Israel-to-Cayman migrating LP hit a throw at Review and again at
//    Submit, exactly where they sign.
//
//    Part A1 drives the REAL extracted applyExistingAmountGate_ source down its
//    success path with a transfer-in config and asserts it RETURNS TRUE. A grep
//    for the identifier would also pass against a `typeof` band-aid; a call that
//    must return true would not.
//
//    Part A2 drives the whole real form in jsdom as a migrating LP, walks it to
//    review, and asserts the review page actually renders (no ReferenceError
//    escaped, the document pack and the signature section are on screen and the
//    read-only figure is painted).
//
// B. The wrong-form guard in handleCfgLoaded_ wrote its refusal into
//    document.getElementById('lvp-loading'), and no element carried that id. The
//    lookup was null, the write was skipped, and an LP whose link resolved to
//    the wrong form got SILENCE. Part B boots the real form with a money-flow
//    flowType and asserts the approved sentence is on screen.
//
// Run: node test/transfer-in-review-gate-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { loadForm } = require('./rig.cjs');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }

// Same brace-counting extraction resume-jump-harness.cjs uses: the logic under
// test is the shipped source, not a hand copy that can drift.
function extractFn(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found in index.html: ' + name);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}

// ---- A1: the real gate, driven down its success path -----------------------
(function () {
  const src = extractFn('applyExistingAmountGate_');
  function makeGate(transferIn, pos) {
    const panel = { hidden: true };
    const valueEl = { textContent: '' };
    const form = {
      querySelector(sel) {
        if (sel === '[data-existing-amount]') return panel;
        if (sel === '[data-existing-amount-value]') return valueEl;
        return null;
      }
    };
    const documentStub = { documentElement: { classList: { add() {} } } };
    const factory = new Function(
      'form', 'document', 'window', 'transferInFromConfig_', 'currentInvestmentAmount_',
      src + '; return applyExistingAmountGate_;'
    );
    const gate = factory(form, documentStub, { console: null }, () => transferIn, () => pos);
    return { gate, panel, valueEl };
  }

  // The defect's exact lane: transfer-in session WITH the operator's figure.
  const t = makeGate(true, { amount: 1500000, currency: 'ILS' });
  let threw = null, ret;
  try { ret = t.gate(); } catch (e) { threw = e; }
  ok('A1 transfer-in success path does not throw', threw === null, threw && String(threw && threw.message || threw));
  ok('A1 transfer-in success path RETURNS TRUE (a throw or a falsy return blocks review and submit)', ret === true, { ret: ret, threw: threw && String(threw.message || threw) });
  ok('A1 the read-only figure is painted, grouped, with its currency', t.valueEl.textContent === '1,500,000 ILS', t.valueEl.textContent);
  ok('A1 the panel is revealed', t.panel.hidden === false);

  // A fractional figure keeps two decimals (money formatting, not number formatting).
  const f = makeGate(true, { amount: 500000.5, currency: 'USD' });
  let fThrew = null, fRet;
  try { fRet = f.gate(); } catch (e) { fThrew = e; }
  ok('A1 fractional transfer-in figure also completes without throwing', fThrew === null && fRet === true, fThrew && String(fThrew.message || fThrew));
  ok('A1 fractional figure renders with two decimals', f.valueEl.textContent === '500,000.50 USD', f.valueEl.textContent);

  // Non-transfer-in (new LP) short-circuits before the defect line ever ran, so
  // this branch was never broken. Asserted so a future edit cannot break it.
  const n = makeGate(false, null);
  ok('A1 a new LP still passes the gate with the panel hidden', n.gate() === true && n.panel.hidden === true);

  // Fail-closed: a transfer-in session with no figure must still refuse.
  const m = makeGate(true, null);
  ok('A1 a transfer-in session with no figure still refuses (fail closed)', m.gate() === false);
})();

// ---- A2: the real form, walked to review as a migrating LP ------------------
const SLOTS = ['articlesOfIncorporation', 'bankAccountConfirmation', 'certificateOfIncorporation', 'corporateResolution', 'listOfAuthorizedSignatories', 'partnershipAgreement', 'proofOfRegisteredAddress', 'trustAgreement', 'passportPrimary', 'proofOfAddress', 'qualification.preSignedUpload'];
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

(async () => {
  // ---- A2 ----
  const { document, errors } = await loadForm({
    cfg: {
      applicantType: 'individual',
      isExistingLp: true,
      isTransferIn: true,
      prefill: { __testUploads: SLOTS, _pad: '1', investment: { amount: 1500000, currency: 'ILS' } }
    }
  });
  for (let s = 0; s < 40 && cur(document) !== 'review'; s++) {
    for (let k = 0; k < 5; k++) { const e = visReq(document).filter(empty); if (!e.length) break; e.forEach(fill); await sleep(8); }
    const next = document.querySelector('[data-action="next"]');
    next.click(); await sleep(10);
  }
  ok('A2 a migrating LP reaches the review page', cur(document) === 'review', 'landed on ' + cur(document));

  const refErrors = errors.filter((e) => /ReferenceError/.test(e));
  ok('A2 no ReferenceError escapes while the migrating LP is on review', refErrors.length === 0, refErrors.slice(0, 3));

  // The gate returning false (or throwing) leaves the pack, the signature and
  // the submit button hidden. This is what the LP would actually see.
  const wrap = document.querySelector('[data-doc-preview]');
  const sigSection = document.querySelector('[data-sig-section]');
  const submitBtn = document.querySelector('[data-action="submit"]');
  ok('A2 the document pack is on screen for a migrating LP', !!wrap && wrap.hidden === false);
  ok('A2 the signature section is on screen for a migrating LP', !!sigSection && sigSection.hidden === false, sigSection && sigSection.hidden);
  ok('A2 the submit button is on screen for a migrating LP', !!submitBtn && submitBtn.hidden === false, submitBtn && submitBtn.hidden);

  const valueEl = document.querySelector('[data-existing-amount-value]');
  const panel = document.querySelector('[data-existing-amount]');
  ok('A2 the read-only transferring figure is painted on review', !!valueEl && valueEl.textContent === '1,500,000 ILS', valueEl && valueEl.textContent);
  ok('A2 the transferring-position panel is revealed', !!panel && panel.hidden === false);

  // ---- B: the wrong-form refusal must reach the LP's eyes ----
  const APPROVED = 'This link belongs to a different form. Please use the link sent to you, or contact us.';
  ok('B the approved sentence still exists verbatim in index.html (copy is frozen)', html.indexOf("'" + APPROVED + "'") !== -1);

  const b = await loadForm({ cfg: { applicantType: 'individual', flowType: 'cayman_increase', prefill: { _pad: '1' } } });
  const host = b.document.getElementById('lvp-loading');
  ok('B the refusal has a real host element in the markup', !!host);
  ok('B the refusal text is actually written into it', !!host && host.textContent === APPROVED, host && host.textContent);
  ok('B the refusal is not left hidden', !!host && host.hidden === false, host && host.hidden);
  ok('B the host sits inside the gate screen the LP is shown', !!host && !!host.closest('#lvp-gate'));
  ok('B the gate screen is switched on, so the form is replaced rather than left rendered',
    b.document.documentElement.classList.contains('lvp-gate-mode'));

  // An onboarding link must be untouched by the wrong-form guard.
  const c = await loadForm({ cfg: { applicantType: 'individual', flowType: 'cayman_subscription', prefill: { _pad: '1' } } });
  const cHost = c.document.getElementById('lvp-loading');
  ok('B a genuine onboarding link is NOT refused', !c.document.documentElement.classList.contains('lvp-gate-mode') && !!cHost && cHost.hidden === true);

  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e); process.exit(1); });
