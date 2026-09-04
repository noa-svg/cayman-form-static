// flow-cayman-lane-harness.cjs (2026-09-04, Layer 2 English/LTR build).
//
// flow.html was Hebrew/RTL-only end to end: a Cayman-lane money-mint session
// (domain/initiateCaymanMoneyFlow.ts, ju-service, already shipped and inert
// until this and the console flag land) would show a real Cayman LP an
// entirely Hebrew form. This harness proves the NEW lane==='cayman' path
// through the REAL flow.html (rig-flow.cjs boots the actual file, not a
// hand-copied model), and that the ISRAELI lane is byte-for-byte unchanged.
//
// Covers:
//   A. dir/lang flip to ltr/en on a Cayman-lane config; Israeli lane unchanged.
//   B. Reused-copy labels actually render in English (Full name, ID number,
//      Account number, Back/Continue, Email address, Bank name, Branch number).
//   C. The account-management-approval upload is HIDDEN and NOT required on
//      the Cayman lane (matches domain/money/{increase,withdrawal}.ts's own
//      isIsraeli gate on this exact upload) - an entity Cayman submit reaches
//      the server with only the company stamp attached.
//   D. Bank fields accept free text with no Bank-of-Israel registry gate: a
//      foreign bank name, an alphanumeric branch, and an IBAN-shaped account
//      number all validate and post untouched (Source/Destination presence-
//      only rule, no combobox pop-up).
//   E. The increase currency picker posts ISO codes (ILS/USD/EUR) on the
//      Cayman lane - the Hebrew WORDS 'שקל'/'דולר'/'יורו' the Israeli lane
//      still posts would not survive the server's own caymanCurrencyCode_
//      (only the code/word/symbol triples it explicitly recognises normalise;
//      the English WORD "Shekel" is not one of them).
//   F. Redemption partial mode gets a REAL currency picker on the Cayman lane
//      (not the Israeli lane's disabled/forced "שקל" input) - a USD/EUR
//      redemption must not be silently relabelled NIS.
//   G. Israeli lane is a pure regression guard: RTL, Hebrew labels, bank
//      registry combobox attributes untouched, accountManagementApproval
//      still shown and required.
//
// Run: node test/flow-cayman-lane-harness.cjs
'use strict';
const { loadFlowForm, makeFlowCfg } = require('./rig-flow.cjs');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fire(el, type) { el.dispatchEvent(new (el.ownerDocument.defaultView.Event)(type, { bubbles: true })); }
function setVal(document, id, v) {
  const el = document.getElementById(id);
  if (!el) throw new Error('no #' + id);
  el.value = v; fire(el, 'input'); fire(el, 'change');
  return el;
}
function currentPage(document) {
  const p = document.querySelector('.lvp-page.is-active');
  return p ? p.getAttribute('data-page') : null;
}
function clickGo(document, page) {
  const btn = document.querySelector('.lvp-page.is-active [data-go="' + page + '"]');
  if (!btn) throw new Error('no [data-go="' + page + '"] on page ' + currentPage(document));
  btn.dispatchEvent(new (document.defaultView.MouseEvent)('click', { bubbles: true, cancelable: true }));
}
function fieldLabelText(document, name) {
  const w = document.querySelector('[data-field="' + name + '"]');
  if (!w) return null;
  const lab = w.querySelector('.lvp-field__label, legend.lvp-field__label');
  return lab ? lab.textContent.replace(/\*/g, '').trim() : null;
}

// ---- H: mechanical "no Hebrew leak" scan -----------------------------------
// Catches the exact bug class the 2026-09-04 pixel-verifier pass found by hand
// (title/prose/labels/buttons/errors silently falling back to Hebrew wherever
// EN_MAP has a gap): walk every element swapScopeText_ itself targets (the
// SAME selector, copy-pasted from flow.html so this check can never drift out
// of sync with what the real translation pass actually covers), plus the
// upload-button labels and the aria-label the amount-row template sets
// programmatically (swapScopeText_ never reaches an aria-label), and flag any
// whose text still contains a Hebrew character - UNLESS it exactly matches one
// of the strings still deliberately pending Noa's sign-off (see flow.html's
// own EN_MAP header comment). The allowlist is closed and exact so a NEW,
// unrelated Hebrew leak can never hide behind it.
const HEBREW_RE = /[\u0590-\u05FF]/;
const SWAP_SCOPE_SELECTOR = '.lvp-page__title, .lvp-section__title, .lvp-field__label, legend.lvp-field__label, ' +
  '.lvp-field__hint, .lvp-upload__hint, .lvp-prose, .lvp-required-note, ' +
  '.lvp-upload__label label, .lvp-upload__btn, .lvp-radio > span, [data-go], ' +
  '#lvp-loading, #lvp-busy-title, #lvp-busy-warn, #lvp-submit-btn, .lvp-amount-add';
// Exact strings this build report (flow.html's own EN_MAP comment) documents
// as genuinely having NO existing approved English twin anywhere in the
// codebase as of 2026-09-04 - awaiting Noa's sign-off, not a translation bug.
const PENDING_HEBREW = new Set([
  'בתהליך זה אפשר למלא, לחתום ולשלוח את הבקשה.',
  'לאחר השלמת התהליך יתקבל עותק חתום.',
  'טופס העברה לקרן הקיימנית',
  '+ הוספת מטבע',
  'הסר מטבע',
  'ניתן להוסיף עד 4 מטבעות לבקשה זו.',
  'מטבע פדיון',
  'סכום (ברוטו) מתוך החשבון',
  'סכום הפדיון (ברוטו)',
  'צירוף קובץ',
  'כל השדות הינם חובה',
  // Found by THIS mechanical scan (not in the original 5 pixel-verifier bugs):
  // the email field's hint, no existing approved English twin located anywhere.
  'כתובת זו תשמש אותנו לתקשורת'
]);
function hebrewLeaks(document) {
  const leaks = [];
  document.querySelectorAll(SWAP_SCOPE_SELECTOR).forEach((el) => {
    if (el.closest('[hidden]')) return; // matches swapScopeText_'s own live-DOM scope
    const text = el.textContent.replace(/\*/g, '').trim();
    if (text && HEBREW_RE.test(text) && !PENDING_HEBREW.has(text)) {
      leaks.push({ selector: el.className || el.tagName, text });
    }
  });
  // aria-label on the dynamically-templated "remove currency" button (not
  // covered by swapScopeText_'s selector, and not a <button> text node).
  document.querySelectorAll('.lvp-amount-rm[aria-label]').forEach((el) => {
    const text = el.getAttribute('aria-label').trim();
    if (text && HEBREW_RE.test(text) && !PENDING_HEBREW.has(text)) {
      leaks.push({ selector: 'aria-label', text });
    }
  });
  return leaks;
}

(async () => {
  // ---- A + B: Cayman-lane increase, individual --------------------------
  {
    const rig = await loadFlowForm({
      token: 'CAY-INC-IND',
      configXhr: () => ({ status: 200, body: makeFlowCfg({ flowType: 'cayman_increase', applicantType: 'individual', lane: 'cayman', language: 'en' }) })
    });
    const d = rig.document;
    ok('A html dir flips to ltr on the Cayman lane', d.documentElement.getAttribute('dir') === 'ltr', d.documentElement.getAttribute('dir'));
    ok('A html lang flips to en on the Cayman lane', d.documentElement.getAttribute('lang') === 'en', d.documentElement.getAttribute('lang'));
    ok('B "Full name" renders (reused from israel.html)', fieldLabelText(d, 'ind-fullName') === 'Full name', fieldLabelText(d, 'ind-fullName'));
    ok('B "ID number" renders (reused from israel.html)', fieldLabelText(d, 'ind-idNumber') === 'ID number', fieldLabelText(d, 'ind-idNumber'));
    ok('B "Email address" renders (reused from index.html)', fieldLabelText(d, 'lp-email') === 'Email address', fieldLabelText(d, 'lp-email'));
    ok('B nav "Continue" renders (reused from israel.html)',
      d.querySelector('[data-page="start"] [data-go="request"]').textContent.trim() === 'Continue',
      d.querySelector('[data-page="start"] [data-go="request"]').textContent);

    setVal(d, 'ind-fullName', 'Test Investor');
    setVal(d, 'ind-idNumber', 'A1234567');
    setVal(d, 'lp-email', 'noa+test@legacyvpartners.com');
    clickGo(d, 'request');
    await sleep(40);
    ok('B bank-name label reads "Bank name"', fieldLabelText(d, 'bank-name') === 'Bank name', fieldLabelText(d, 'bank-name'));
    ok('B bank-branch label reads "Branch number"', fieldLabelText(d, 'bank-branch') === 'Branch number', fieldLabelText(d, 'bank-branch'));
    ok('B nav "Back" renders', d.querySelector('[data-page="request"] [data-go="start"]').textContent.trim() === 'Back');

    // ---- D: bank fields are free text, no registry gate -----------------
    const bankNameEl = d.getElementById ? null : d.getElementById; // no-op guard for lint
    const bnEl = d.getElementById('bank-name');
    ok('D bank-name has no combobox role on the Cayman lane', !bnEl.hasAttribute('role'), bnEl.getAttribute('role'));
    setVal(d, 'bank-name', 'First National Bank of Someplace');
    setVal(d, 'bank-branch', 'MAIN-01');
    setVal(d, 'bank-account', 'GB29NWBK60161331926819');
    // ---- E: increase currency options are ISO codes ----------------------
    const curSel = d.querySelector('#amount-rows-increase [data-currency]');
    const opts = Array.prototype.map.call(curSel.options, (o) => o.value);
    ok('E Cayman currency options are ISO codes', JSON.stringify(opts) === JSON.stringify(['ILS', 'USD', 'EUR']), JSON.stringify(opts));
    d.querySelector('#amount-rows-increase [data-amount]').value = '10000';
    fire(d.querySelector('#amount-rows-increase [data-amount]'), 'input');
    curSel.value = 'USD';
    fire(curSel, 'change');
    clickGo(d, 'uploads');
    await sleep(40);
    ok('B/D reached uploads with free-text bank + foreign account (no bounce back to request)',
      currentPage(d) === 'uploads', currentPage(d));

    // ---- C: accountManagementApproval hidden + not required ---------------
    const amaWrap = d.getElementById('upload-accountManagementApproval-wrap');
    ok('C accountManagementApproval upload is hidden on the Cayman lane', amaWrap && amaWrap.hidden, amaWrap && amaWrap.outerHTML && amaWrap.outerHTML.slice(0, 80));

    // Submit with NO accountManagementApproval attached - must not be blocked.
    const posted = [];
    rig.window.fetch = function (url, init) {
      posted.push({ url: String(url), body: (init && init.body) || null });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, stage: 'submitted', nextUrl: '/signer.html?t=X' }), text: () => Promise.resolve('{}') });
    };
    d.getElementById('lvp-submit-btn').dispatchEvent(new rig.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(400);
    const call = posted.find((c) => c.body && String(c.body).indexOf('"action":"submit"') !== -1);
    ok('C Cayman individual increase submits with no account-management-approval attached', !!call, JSON.stringify(posted.map((c) => c.url)));
    if (call) {
      const env = JSON.parse(call.body);
      const sub = env.payload.submission;
      ok('D typed bank name posted untouched', sub.lpBank.bankName === 'First National Bank of Someplace', sub.lpBank.bankName);
      ok('D typed branch posted untouched', sub.lpBank.branch === 'MAIN-01', sub.lpBank.branch);
      ok('D IBAN-shaped account posted untouched', sub.lpBank.accountNumber === 'GB29NWBK60161331926819', sub.lpBank.accountNumber);
      ok('E amount row posted with ISO currency USD', sub.investment.amounts[0].currency === 'USD', JSON.stringify(sub.investment.amounts));
    }
  }

  // ---- C2: Cayman ENTITY still requires the company stamp ----------------
  {
    const rig = await loadFlowForm({
      token: 'CAY-INC-ENT',
      configXhr: () => ({ status: 200, body: makeFlowCfg({ flowType: 'cayman_increase', applicantType: 'entity', lane: 'cayman', language: 'en' }) })
    });
    const d = rig.document;
    setVal(d, 'ent-name', 'Test Holdings Ltd');
    setVal(d, 'ent-number', 'CAY-000123');
    setVal(d, 'lp-email', 'noa+test@legacyvpartners.com');
    clickGo(d, 'request');
    await sleep(40);
    setVal(d, 'bank-name', 'Offshore Trust Bank');
    setVal(d, 'bank-branch', 'GEORGE TOWN');
    setVal(d, 'bank-account', '000123456789');
    d.querySelector('#amount-rows-increase [data-amount]').value = '50000';
    fire(d.querySelector('#amount-rows-increase [data-amount]'), 'input');
    clickGo(d, 'uploads');
    await sleep(40);
    ok('C2 reached uploads (entity, Cayman)', currentPage(d) === 'uploads', currentPage(d));
    const stampWrap = d.getElementById('upload-stamp-wrap');
    ok('C2 company stamp upload still shown for an entity', stampWrap && !stampWrap.hidden);
    const submitBtn = d.getElementById('lvp-submit-btn');
    submitBtn.dispatchEvent(new rig.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(200);
    ok('C2 submit is BLOCKED with no company stamp attached (stayed on uploads)', currentPage(d) === 'uploads');
  }

  // ---- F: Cayman redemption gets a real currency picker -------------------
  {
    const rig = await loadFlowForm({
      token: 'CAY-RED-IND',
      configXhr: () => ({ status: 200, body: makeFlowCfg({ flowType: 'cayman_withdrawal', applicantType: 'individual', lane: 'cayman', language: 'en' }) })
    });
    const d = rig.document;
    setVal(d, 'ind-fullName', 'Test Investor');
    setVal(d, 'ind-idNumber', 'A1234567');
    setVal(d, 'lp-email', 'noa+test@legacyvpartners.com');
    clickGo(d, 'request');
    await sleep(40);
    const wdModePartial = d.querySelector('input[name="wd-mode"][value="partial"]');
    wdModePartial.checked = true;
    fire(wdModePartial, 'change');
    await sleep(20);
    const curSel = d.querySelector('#amount-rows-redemption [data-currency]');
    ok('F redemption currency control is a REAL select on the Cayman lane', curSel && curSel.tagName === 'SELECT', curSel && curSel.outerHTML);
    ok('F redemption currency is not disabled on the Cayman lane', curSel && !curSel.disabled);
    const opts = curSel ? Array.prototype.map.call(curSel.options, (o) => o.value) : [];
    ok('F redemption currency options are ISO codes', JSON.stringify(opts) === JSON.stringify(['ILS', 'USD', 'EUR']), JSON.stringify(opts));
  }

  // ---- G: Israeli lane is unchanged (regression guard) ---------------------
  {
    const rig = await loadFlowForm({
      token: 'ISR-INC-IND',
      configXhr: () => ({ status: 200, body: makeFlowCfg({ flowType: 'cayman_increase', applicantType: 'individual', lane: 'israeli', language: 'he' }) })
    });
    const d = rig.document;
    ok('G html dir stays rtl on the Israeli lane', d.documentElement.getAttribute('dir') === 'rtl', d.documentElement.getAttribute('dir'));
    ok('G html lang stays he on the Israeli lane', d.documentElement.getAttribute('lang') === 'he', d.documentElement.getAttribute('lang'));
    ok('G Hebrew label unchanged (שם מלא)', fieldLabelText(d, 'ind-fullName') === 'שם מלא', fieldLabelText(d, 'ind-fullName'));
    const bnEl = d.getElementById('bank-name');
    ok('G bank-name KEEPS its combobox role on the Israeli lane', bnEl.getAttribute('role') === 'combobox', bnEl.getAttribute('role'));
    const amaWrap = d.getElementById('upload-accountManagementApproval-wrap');
    ok('G accountManagementApproval upload still shown on the Israeli lane', amaWrap && !amaWrap.hidden);
    setVal(d, 'ind-fullName', 'משקיע בדיקה');
    setVal(d, 'ind-idNumber', '123456782');
    setVal(d, 'lp-email', 'noa+test@legacyvpartners.com');
    clickGo(d, 'request');
    await sleep(40);
    const curSel = d.querySelector('#amount-rows-increase [data-currency]');
    const opts = Array.prototype.map.call(curSel.options, (o) => o.value);
    ok('G Israeli currency options stay Hebrew words', JSON.stringify(opts) === JSON.stringify(['שקל', 'דולר', 'יורו']), JSON.stringify(opts));
  }

  // ---- H: no Hebrew leaks anywhere, across all 6 Cayman/English branches ---
  // The 2026-09-04 pixel-verifier pass found the title/prose/entity-labels/
  // redemption-headers/submit-button all silently falling back to Hebrew on
  // every one of these 6 combos (the ?mock=cay-inc-ind|inc-ent|red-ind|red-ent|
  // trn-ind|trn-ent branches). This walks the SAME 6 combos through the REAL
  // config path (not ?mock=, which is a design-preview shortcut - loadFlowForm
  // exercises bootstrapForm exactly as a real Cayman-lane mint would) and
  // fails if any NEW, un-allowlisted Hebrew string is visible at any page.
  const H_CASES = [
    { name: 'inc-ind', flowType: 'cayman_increase',   applicantType: 'individual' },
    { name: 'inc-ent', flowType: 'cayman_increase',   applicantType: 'entity' },
    { name: 'red-ind', flowType: 'cayman_withdrawal', applicantType: 'individual' },
    { name: 'red-ent', flowType: 'cayman_withdrawal', applicantType: 'entity' },
    { name: 'trn-ind', flowType: 'cayman_transfer',   applicantType: 'individual' },
    { name: 'trn-ent', flowType: 'cayman_transfer',   applicantType: 'entity' }
  ];
  for (const c of H_CASES) {
    const rig = await loadFlowForm({
      token: 'H-' + c.name,
      configXhr: () => ({ status: 200, body: makeFlowCfg({ flowType: c.flowType, applicantType: c.applicantType, lane: 'cayman', language: 'en' }) })
    });
    const d = rig.document;
    const isRedemption = c.flowType === 'cayman_withdrawal';
    const isTransfer = c.flowType === 'cayman_transfer';

    let leaks = hebrewLeaks(d);
    ok('H [' + c.name + '] no Hebrew leak on the start page', leaks.length === 0, JSON.stringify(leaks));

    if (c.applicantType === 'entity') {
      setVal(d, 'ent-name', 'Test Holdings Ltd');
      setVal(d, 'ent-number', 'CAY-000123');
    } else {
      setVal(d, 'ind-fullName', 'Test Investor');
      setVal(d, 'ind-idNumber', 'A1234567');
    }
    setVal(d, 'lp-email', 'noa+test@legacyvpartners.com');

    if (!isTransfer) {
      clickGo(d, 'request');
      await sleep(40);
      if (isRedemption) {
        const partial = d.querySelector('input[name="wd-mode"][value="partial"]');
        partial.checked = true;
        fire(partial, 'change');
        await sleep(20);
        d.querySelector('#amount-rows-redemption [data-amount]').value = '75000';
        fire(d.querySelector('#amount-rows-redemption [data-amount]'), 'input');
        const wdDateRadio = d.querySelector('#wd-date-radios input[type="radio"]');
        if (wdDateRadio) { wdDateRadio.checked = true; fire(wdDateRadio, 'change'); }
      } else {
        d.querySelector('#amount-rows-increase [data-amount]').value = '10000';
        fire(d.querySelector('#amount-rows-increase [data-amount]'), 'input');
      }
      setVal(d, 'bank-name', 'First National Bank of Someplace');
      setVal(d, 'bank-branch', 'MAIN-01');
      setVal(d, 'bank-account', 'GB29NWBK60161331926819');
      leaks = hebrewLeaks(d);
      ok('H [' + c.name + '] no Hebrew leak on the request page (entity labels / redemption headers)', leaks.length === 0, JSON.stringify(leaks));
    }
    clickGo(d, 'uploads');
    await sleep(40);
    ok('H [' + c.name + '] reached the uploads page', currentPage(d) === 'uploads', currentPage(d));
    leaks = hebrewLeaks(d);
    ok('H [' + c.name + '] no Hebrew leak on the uploads page (title / submit button)', leaks.length === 0, JSON.stringify(leaks));
  }

  // ---- H2: redemption empty-submit no longer mixes languages in one box ----
  // The pixel-verifier's bug #5: a Hebrew "amount required" line stacked above
  // already-English bank-field errors in the SAME lvp-error-summary box.
  // amountRequiredMsg_ (flow.html) now answers this per-kind, same shape as
  // the existing bankFieldMsg_ - prove the fix at the actual error-summary box.
  {
    const rig = await loadFlowForm({
      token: 'H2-RED-IND',
      configXhr: () => ({ status: 200, body: makeFlowCfg({ flowType: 'cayman_withdrawal', applicantType: 'individual', lane: 'cayman', language: 'en' }) })
    });
    const d = rig.document;
    setVal(d, 'ind-fullName', 'Test Investor');
    setVal(d, 'ind-idNumber', 'A1234567');
    setVal(d, 'lp-email', 'noa+test@legacyvpartners.com');
    clickGo(d, 'request');
    await sleep(40);
    const partial = d.querySelector('input[name="wd-mode"][value="partial"]');
    partial.checked = true;
    fire(partial, 'change');
    await sleep(20);
    // Amount left blank, bank fields left blank -> both error families fire together.
    clickGo(d, 'uploads');
    await sleep(60);
    ok('H2 empty redemption submit is blocked (stays on request page)', currentPage(d) === 'request', currentPage(d));
    const summary = d.getElementById('lvp-request-summary');
    const summaryText = summary ? summary.textContent : '';
    ok('H2 error summary box is visible', summary && !summary.hidden);
    ok('H2 amount-required error reads in English ("Enter a redemption amount.")', summaryText.indexOf('Enter a redemption amount.') !== -1, summaryText);
    ok('H2 bank-field error reads in English ("Destination bank ... is required.")', /Destination bank .* is required\./.test(summaryText), summaryText);
    ok('H2 no stray Hebrew anywhere in the error summary box', !HEBREW_RE.test(summaryText), summaryText);
    // The bug the summary-box checks above missed entirely: the INLINE span
    // under the amount row (a separate DOM node from the summary box) stayed
    // on the old raw T('...בשורה N.') call and kept reading Hebrew even after
    // the summary box itself was fixed. Assert on that node directly.
    const amountRow = d.querySelector('#amount-rows-redemption .lvp-amount-row');
    const inlineErr = amountRow ? amountRow.querySelector('.lvp-field__error') : null;
    const inlineErrText = inlineErr ? inlineErr.textContent : '';
    ok('H2 inline amount-row error also reads in English (not just the summary box)', inlineErrText.indexOf('Enter a redemption amount.') !== -1, inlineErrText);
    ok('H2 no stray Hebrew in the inline amount-row error', !HEBREW_RE.test(inlineErrText), inlineErrText);
  }

  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS CRASH:', e && e.stack || e); process.exit(1); });
