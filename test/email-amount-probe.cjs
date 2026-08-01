// email-amount-probe.cjs (2026-08-02, CTO review finding #12 - converted
// from an exploratory console.log probe to real pass/fail assertions).
//
// Two independent claims about index.html:
// 1. A malformed email on the page holding email/phone (individual.personal) blocks Next (format validation
//    actually runs, not just a required-empty check).
// 2. The investment-amount field auto-formats with thousand separators on
//    blur (1000000 -> "1,000,000") - a UX/readability feature for a field
//    where a misread digit count is a real-money mistake.
//
// Run: node test/email-amount-probe.cjs
'use strict';
const { loadForm } = require('./rig.cjs');
const SLOTS = ['passportPrimary', 'proofOfAddress', 'bankAccountConfirmation'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }

function cur(d) { const p = d.querySelector('.lvp-page:not([hidden])'); return p ? p.getAttribute('data-page') : null; }
function fh(h) { let el = h; while (el && el.nodeType === 1) { if (el.hasAttribute && el.hasAttribute('hidden')) return true; if (el.style && el.style.display === 'none') return true; el = el.parentElement; } return false; }
function visReq(d) { const p = d.querySelector('.lvp-page:not([hidden])'); if (!p) return []; return Array.from(p.querySelectorAll('[data-required]')).filter((h) => !fh(h)); }
function empty(h) { if (h.classList.contains('lvp-dob')) { const iso = h.querySelector('[data-dob-iso]'); return !(iso && /^\d{4}-\d{2}-\d{2}$/.test(iso.value || '')); } const ins = Array.from(h.querySelectorAll('input,select,textarea')); let f = false; ins.forEach((i) => { if (i.type === 'radio' || i.type === 'checkbox') { if (i.checked) f = true; } else if (i.hasAttribute('data-upload')) { /* stubbed */ } else if (i.value && String(i.value).trim()) f = true; }); return !f; }
function fire(el, t) { el.dispatchEvent(new (el.ownerDocument.defaultView.Event)(t, { bubbles: true })); }
function setV(i, v) { i.value = v; fire(i, 'input'); fire(i, 'change'); }
// Validator-aware values (ported from test-adversarial.cjs, same gap fixed
// in drive-branch.cjs 2026-08-02): the generic 'Test'/'123456' fallback gets
// stuck on format-gated fields (e.g. the Israeli-ID checksum) before ever
// reaching the contact/investment pages this probe actually tests.
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
  const r = ins.filter((i) => i.type === 'radio'); if (r.length) { r[0].checked = true; fire(r[0], 'change'); return; }
  ins.forEach((i) => {
    if (i.type === 'checkbox') { i.checked = true; fire(i, 'change'); }
    else if (i.type === 'file') { /* stubbed */ }
    else if (i.tagName === 'SELECT') { const o = Array.from(i.options).find((x) => x.value); if (o) { i.value = o.value; fire(i, 'change'); fire(i, 'input'); } }
    else if (i.type === 'date') { setV(i, new Date().toISOString().slice(0, 10)); }
    else if (i.type === 'email') { setV(i, 't@example.com'); }
    else setV(i, valueFor(i));
  });
}
async function walkTo(d, next, target) {
  for (let s = 0; s < 40; s++) {
    if (cur(d) === target) return true;
    for (let k = 0; k < 5; k++) { const e = visReq(d).filter(empty); if (!e.length) break; e.forEach(fill); await sleep(8); }
    next.click(); await sleep(10);
  }
  return cur(d) === target;
}

(async () => {
  const { document } = await loadForm({ cfg: { applicantType: 'individual', prefill: { __testUploads: SLOTS, _pad: '1' } } });
  const next = document.querySelector('[data-action="next"]');

  // ---- EMAIL: malformed email must block Next -------------------------------
  // individual.email/phone actually live on individual.personal - there is
  // no standalone "individual.contact" page (the original probe's target
  // name was stale, confirmed absent from index.html's current data-page
  // set).
  const reachedContact = await walkTo(document, next, 'individual.personal');
  ok('walk reaches the page holding email/phone (individual.personal)', reachedContact, 'landed on ' + cur(document) + ' instead');

  visReq(document).forEach((h) => { const ph = h.querySelector('[name="individual.phone"]'); if (ph) setV(ph, '0501234567'); });
  const em = document.querySelector('[name="individual.email"]');
  ok('email input exists on individual.personal (fixture sanity)', !!em);
  setV(em, 'not-an-email');
  const before = cur(document);
  next.click();
  await sleep(12);
  const after = cur(document);
  ok('a malformed email blocks Next (format validation actually runs)', before === after, 'moved from ' + before + ' to ' + after);

  // ---- AMOUNT: thousand-separator formatting on blur -------------------------
  setV(em, 'good@example.com');
  const reachedInvestment = await walkTo(document, next, 'investment');
  ok('after fixing the email, the walk reaches the investment page', reachedInvestment, 'landed on ' + cur(document) + ' instead');

  const amt = document.querySelector('[data-amount]');
  ok('amount input exists on the investment page (fixture sanity)', !!amt);
  setV(amt, '1000000');
  fire(amt, 'blur');
  await sleep(12);
  ok('amount 1000000 formats with thousand separators on blur', amt.value === '1,000,000', 'got ' + JSON.stringify(amt.value));

  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e); process.exit(1); });
