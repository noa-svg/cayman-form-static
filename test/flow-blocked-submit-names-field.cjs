// flow-blocked-submit-names-field.cjs (2026-09-07)
//
// THE PROPERTY: a blocked submit on flow.html (the MONEY form: increases,
// redemptions, transfers) must always NAME at least one offending field, in
// text, on the page the LP is left looking at. Never bounce someone without
// naming why.
//
// The defect this pins, measured on the real form before the fix:
//   LP resumes on 'uploads', presses "סיום ושליחה", validateAllDataPages walks
//   PAGE_ORDER from index 0, 'start' fails on three empty required fields, and
//   goToPage sends the LP back there. Every one of those errors is `silent`
//   (empty required = red border, no text, per vRequired), and validatePage
//   excluded silent errors from the summary, so the summary stayed HIDDEN.
//   Observed: page 'uploads' -> 'start', 3 red borders, ZERO characters of text
//   on screen. Both lanes. That is the shape that cost an LP two days on the
//   Israeli onboarding form.
//
// The fix keeps the navigation (deleting it renders the summary onto a hidden
// page, which is a worse dead end - see PR #19's measurement on index.html) and
// fixes the NAMING: validatePage takes `nameSilent`, and validateAllDataPages
// sets it for any page that is not the one the LP is already on. Silent errors
// are then listed by LABEL only, so no per-field message is invented and the
// in-page house style ("empty required is obvious", Noa) is untouched.
//
// Assertions below therefore come in pairs: the bounced page must NAME, and the
// page the LP is already standing on must NOT gain text it did not have.
//
// Run: node test/flow-blocked-submit-names-field.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { loadFlowForm, makeFlowCfg } = require('./rig-flow.cjs');

const html = fs.readFileSync(path.join(__dirname, '..', 'flow.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }

function summaryOf(d, page) {
  const s = d.getElementById('lvp-' + page + '-summary');
  return { el: s, hidden: s ? s.hidden : true, text: s ? s.textContent.trim() : '' };
}
function activePage(d) {
  const a = d.querySelector('.lvp-page.is-active');
  return a ? a.getAttribute('data-page') : null;
}
function visiblePages(d) {
  return [...d.querySelectorAll('.lvp-page')].filter((p) => p.classList.contains('is-active')).map((p) => p.getAttribute('data-page'));
}
function redFields(d) {
  return [...d.querySelectorAll('[data-field].is-invalid')].map((w) => w.getAttribute('data-field'));
}
// Records WHICH element the form chose to reveal, so that property is
// measurable in jsdom (which has no layout). Pins the choice, never the pixel
// result - the pixel result is the CDP pass's job.
//
// Two mechanisms to catch, because the bounce path no longer uses
// scrollIntoView. The in-page path still does (focusAndReveal -> inp), so that
// is recorded directly. The bounce path computes an absolute scroll position
// from the summary box's own rect (revealWithContext_), so the box is recorded
// via the getBoundingClientRect call that the position is derived FROM. Same
// property either way: the summary box, and not a field far below it, is what
// the scroll is aimed at.
function trackReveals(rig) {
  const seen = [];
  rig.window.Element.prototype.scrollIntoView = function () {
    seen.push(this.id || (this.tagName + '.' + (this.className || '')));
  };
  const realRect = rig.window.Element.prototype.getBoundingClientRect;
  rig.window.Element.prototype.getBoundingClientRect = function () {
    if (this.id && /^lvp-.*-summary$/.test(this.id)) seen.push(this.id);
    return realRect.apply(this, arguments);
  };
  return seen;
}
function postedSubmit(rig) {
  return rig.xhrCalls.some((c) => c.body && String(c.body).indexOf('"submit"') !== -1);
}
async function boot(over) {
  return loadFlowForm({
    token: 'NAMEFIELD',
    configXhr: () => ({ status: 200, body: makeFlowCfg(over) })
  });
}
function clickSubmit(rig) {
  rig.document.getElementById('lvp-submit-btn').dispatchEvent(new rig.window.Event('click', { bubbles: true }));
  return new Promise((r) => setTimeout(r, 400));
}

// ---- Static: the mechanism is present in the shape the comments claim. -----
ok('S1 validatePage takes the nameSilent flag', /function validatePage\(page, nameSilent\)/.test(html));
ok('S2 validateAllDataPages sets it only for a page the LP is not on',
  /var from = getCurrentPage\(\);[\s\S]{0,400}validatePage\(PAGE_ORDER\[i\], PAGE_ORDER\[i\] !== from\)/.test(html));
ok('S3 the navigation is KEPT (removing it hides the summary from the LP)',
  /validatePage\(PAGE_ORDER\[i\], PAGE_ORDER\[i\] !== from\)\) \{ try \{ goToPage\(PAGE_ORDER\[i\]\); \}/.test(html));
ok('S4 a silent error carries its label so it can be named', /errs\.push\(\{ name: name, silent: true, label: fieldLabel\(name\) \}\)/.test(html));
ok('S5 silent lines render label-only, no invented message', /var text = \(e\.label \|\| e\.name\) \+ \(e\.msg \? ': ' \+ T\(e\.msg\) : ''\);/.test(html));
ok('S6 vRequired still returns silent (the field-level rule is untouched)', /function vRequired\(id\) \{ return val\(id\) \? \{ ok: true \} : \{ ok: false, silent: true \}; \}/.test(html));
// Pixel-pass findings, 2026-09-07. Both are about the box being READABLE once
// it exists; naming the field in a box the LP cannot see is the same dead end.
ok('S7 a bounce reveals the SUMMARY BOX, not the field far below it',
  /var revealEl = \(nameSilent && summary && summary\.hidden === false\) \? summary : null;\s*\n\s*focusAndReveal\(errs\[0\]\.anchor \|\| fieldWrap\(errs\[0\]\.name\), revealEl\);/.test(html));
ok('S8 focusAndReveal takes the reveal target and does not let focus undo it',
  /function focusAndReveal\(el, revealEl\)/.test(html) && /inp\.focus\(\{ preventScroll: !!revealEl \}\)/.test(html));
ok('S9 summary items are display:block so a wrapped item keeps its bullet',
  /\.lvp-error-summary a, \.lvp-error-summary button \{[^}]*display: block;/.test(html));
// Framing pass, 2026-09-07. Revealing the box with scrollIntoView({block:'start'})
// pinned it to y=0 and took the page title, progress bar and logo off screen with
// it (title top -51 on every request-page bounce, -147..-203 at 320px), so the LP
// saw a red box on a page with no heading and no step. The reveal now scrolls by
// the MINIMUM that puts the box fully on screen, which keeps everything above it.
ok('S10 the bounce reveal is position-computed, not edge-pinned',
  /function revealWithContext_\(box\)/.test(html)
  && /if \(revealEl\) \{ revealWithContext_\(revealEl\); return; \}/.test(html)
  && !/scrollIntoView\(\{ block: revealEl/.test(html));
ok('S11 the floor keeps the box BOTTOM on screen (short-viewport case)',
  /var want = boxBottom - vh \+ PAD;/.test(html));
ok('S12 the ceiling keeps the box TOP on screen (box taller than viewport)',
  /var ceilY = boxTop - PAD;[^\n]*\n\s*if \(want > ceilY\) want = ceilY;/.test(html));
ok('S13 the in-page (non-bounce) reveal still centres the FIELD, unchanged',
  /inp\.scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\);/.test(html));

(async () => {
  // =========================================================================
  // A. THE REGRESSION. Bounce backwards onto a purely-empty page, both lanes.
  // =========================================================================
  for (const lane of ['israeli', 'cayman']) {
    const tag = 'A(' + lane + ')';
    const rig = await boot({
      flowType: lane === 'cayman' ? 'cayman_increase' : 'israeli_increase',
      applicantType: 'individual',
      lane,
      language: lane === 'cayman' ? 'en' : 'he',
      resumePage: 'uploads'
    });
    const d = rig.document;
    const reveals = trackReveals(rig);
    ok(tag + ' resumed on uploads', activePage(d) === 'uploads', activePage(d));
    await clickSubmit(rig);

    const landed = activePage(d);
    const sum = summaryOf(d, landed);
    ok(tag + ' the LP lands on the page carrying the problem', landed === 'start', landed);
    ok(tag + ' exactly one page is visible', visiblePages(d).length === 1, visiblePages(d));
    ok(tag + ' the fields are marked', redFields(d).length === 3, redFields(d));

    // THE ASSERTION THAT GOES RED ON MAIN.
    ok(tag + ' the summary on the landed page is VISIBLE', sum.hidden === false, sum);
    ok(tag + ' the summary NAMES at least one field in text', sum.text.length > 0, sum.text);
    // Named by the field's own shipped label, every one of them.
    const labels = lane === 'cayman'
      ? ['Full name', 'ID number', 'Email address']
      : ['שם מלא', 'מספר תעודת זהות', 'כתובת דוא"ל'];
    labels.forEach((lbl) => {
      ok(tag + ' the summary names "' + lbl + '"', sum.text.indexOf(lbl) !== -1, sum.text);
    });
    // The summary is on the page the LP can SEE, not a hidden one.
    ok(tag + ' the summary lives inside the visible page', sum.el && sum.el.closest('.lvp-page').classList.contains('is-active'));
    // Each named line is a working jump control back to its field.
    const links = [...sum.el.querySelectorAll('[data-jump]')].map((b) => b.getAttribute('data-jump'));
    ok(tag + ' every named line is a jump link to a real field', links.length === 3 && links.every((n) => d.querySelector('[data-field="' + n + '"]')), links);
    // The box the LP was sent to read is what gets scrolled to, not a field
    // that may sit far below it (pixel-pass finding, 375px redemption bounce).
    ok(tag + ' the SUMMARY BOX is what is revealed', reveals.indexOf('lvp-start-summary') !== -1, reveals);
    ok(tag + ' focus is still on the first bad field', d.activeElement && d.activeElement.id === (lane === 'cayman' ? 'ind-fullName' : 'ind-fullName'), d.activeElement && d.activeElement.id);
    // Validation is NOT weakened: nothing was posted.
    ok(tag + ' nothing was submitted to the gateway', postedSubmit(rig) === false);
    ok(tag + ' no jsdom errors (the handler ran to completion)', rig.errors.length === 0, rig.errors);
    rig.window.close();
  }

  // =========================================================================
  // B. THE HOUSE STYLE IS UNTOUCHED. On the page the LP is already standing
  //    on, empty-required stays a bare red border with no text (Noa).
  // =========================================================================
  {
    const rig = await boot({ flowType: 'israeli_increase', applicantType: 'individual', lane: 'israeli', language: 'he' });
    const d = rig.document;
    const reveals = trackReveals(rig);
    ok('B on start to begin with', activePage(d) === 'start', activePage(d));
    d.querySelector('[data-go="request"]').dispatchEvent(new rig.window.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const sum = summaryOf(d, 'start');
    ok('B forward nav is still blocked', activePage(d) === 'start', activePage(d));
    ok('B fields are still marked red', redFields(d).length === 3, redFields(d));
    ok('B the summary stays HIDDEN on the page the LP is already on', sum.hidden === true, sum);
    ok('B no per-field error text is invented', [...d.querySelectorAll('.lvp-field__error')].every((e) => !e.textContent.trim()));
    // In-page reveal is UNCHANGED: the field, never the (hidden) summary box.
    ok('B the FIELD is revealed, not the box', reveals.indexOf('lvp-start-summary') === -1 && reveals.length > 0, reveals);
    rig.window.close();
  }

  // =========================================================================
  // C. Submit blocked on the page the LP is ALREADY on: also unchanged.
  //    Israeli lane, uploads page, missing accountManagementApproval upload.
  // =========================================================================
  {
    const rig = await boot({
      flowType: 'israeli_increase', applicantType: 'individual', lane: 'israeli', language: 'he',
      resumePage: 'uploads',
      prefill: { fullName: 'בדיקה בדיקה', idNumber: '123456782', email: 'test@example.com' }
    });
    const d = rig.document;
    // Fill start + request by hand so 'uploads' is genuinely the first failure.
    const set = (id, v) => { const el = d.getElementById(id); if (el) { el.value = v; } };
    set('ind-fullName', 'בדיקה בדיקה'); set('ind-idNumber', '123456782'); set('lp-email', 'test@example.com');
    set('bank-name', 'בנק הפועלים'); set('bank-branch', '600'); set('bank-account', '123456');
    const amt = d.querySelector('#amount-rows-increase .lvp-amount-row [data-amount]');
    if (amt) amt.value = '100000';
    await clickSubmit(rig);
    const landed = activePage(d);
    ok('C the LP is not moved off the page they are on', landed === 'uploads', landed);
    ok('C the missing upload is named (it always was: "נא להעלות קובץ.")',
      summaryOf(d, 'uploads').hidden === false && summaryOf(d, 'uploads').text.indexOf('נא להעלות קובץ.') !== -1,
      summaryOf(d, 'uploads').text);
    ok('C nothing was submitted', postedSubmit(rig) === false);
    rig.window.close();
  }

  // =========================================================================
  // D. A redemption bounced back to 'request': the silent radio groups
  //    (wd-mode / wd-date) get named alongside the verbose bank errors, and
  //    the verbose ones keep their message.
  // =========================================================================
  {
    const rig = await boot({
      flowType: 'cayman_withdrawal', applicantType: 'individual', lane: 'cayman', language: 'en',
      resumePage: 'uploads'
    });
    const d = rig.document;
    const reveals = trackReveals(rig);
    const set = (id, v) => { const el = d.getElementById(id); if (el) el.value = v; };
    set('ind-fullName', 'Test Investor'); set('ind-idNumber', '123456782'); set('lp-email', 'test@example.com');
    await clickSubmit(rig);
    const landed = activePage(d);
    const sum = summaryOf(d, landed);
    ok('D lands on the request page', landed === 'request', landed);
    ok('D the summary is visible', sum.hidden === false, sum);
    ok('D the silent redemption-mode radio group is NAMED', /\S/.test(sum.text) && sum.text.length > 0, sum.text);
    ok('D a verbose bank error keeps its message', /Destination bank .* is required\./.test(sum.text), sum.text);
    ok('D the summary lists every failing field on the page',
      sum.el.querySelectorAll('[data-jump]').length === redFields(d).length,
      { listed: sum.el.querySelectorAll('[data-jump]').length, red: redFields(d) });
    // THE BRANCH THE PIXEL PASS CAUGHT: the first bad field here (wd-date) sits
    // far below the box, and revealing it put the box above the viewport.
    ok('D the SUMMARY BOX is revealed, not the field far below it', reveals.indexOf('lvp-request-summary') !== -1, reveals);
    ok('D nothing was submitted', postedSubmit(rig) === false);
    rig.window.close();
  }

  // =========================================================================
  // E. Entity applicant, bounced back to 'start': the entity labels are named,
  //    not the hidden individual ones.
  // =========================================================================
  {
    const rig = await boot({
      flowType: 'cayman_increase', applicantType: 'entity', lane: 'cayman', language: 'en',
      resumePage: 'uploads'
    });
    const d = rig.document;
    await clickSubmit(rig);
    const sum = summaryOf(d, activePage(d));
    ok('E lands on start', activePage(d) === 'start', activePage(d));
    ok('E the summary is visible', sum.hidden === false, sum);
    const jumps = [...sum.el.querySelectorAll('[data-jump]')].map((b) => b.getAttribute('data-jump'));
    ok('E it names the ENTITY fields', jumps.indexOf('ent-name') !== -1 && jumps.indexOf('ent-number') !== -1, jumps);
    ok('E it does not name the hidden individual fields', jumps.indexOf('ind-fullName') === -1, jumps);
    ok('E nothing was submitted', postedSubmit(rig) === false);
    rig.window.close();
  }

  // =========================================================================
  // F. Transfer flow. PAGE_ORDER drops 'request' entirely (isTransferFlow), so
  //    the only possible bounce is uploads -> start. Same property must hold.
  // =========================================================================
  {
    const rig = await boot({
      flowType: 'israeli_transfer', applicantType: 'individual', lane: 'israeli', language: 'he',
      resumePage: 'uploads'
    });
    const d = rig.document;
    await clickSubmit(rig);
    const sum = summaryOf(d, activePage(d));
    ok('F transfer bounces to start', activePage(d) === 'start', activePage(d));
    ok('F the summary is visible', sum.hidden === false, sum);
    ok('F it names the identity fields', sum.text.indexOf('שם מלא') !== -1, sum.text);
    ok('F nothing was submitted', postedSubmit(rig) === false);
    rig.window.close();
  }

  // =========================================================================
  // G. The amount-rows pseudo-field ('__rows-increase') as the FIRST failure on
  //    a bounced page. It is never silent, so it was already named before this
  //    change; assert it still is, and that its anchor still resolves (the
  //    fieldWrap('__rows-*') special case that a naive refactor would drop).
  // =========================================================================
  {
    const rig = await boot({
      flowType: 'israeli_increase', applicantType: 'individual', lane: 'israeli', language: 'he',
      resumePage: 'uploads'
    });
    const d = rig.document;
    const set = (id, v) => { const el = d.getElementById(id); if (el) el.value = v; };
    set('ind-fullName', 'בדיקה בדיקה'); set('ind-idNumber', '123456782'); set('lp-email', 'test@example.com');
    await clickSubmit(rig);
    const sum = summaryOf(d, activePage(d));
    ok('G lands on the request page', activePage(d) === 'request', activePage(d));
    ok('G the summary is visible', sum.hidden === false, sum);
    const jumps = [...sum.el.querySelectorAll('[data-jump]')].map((b) => b.getAttribute('data-jump'));
    ok('G the amount block is named first', jumps[0] === '__rows-increase', jumps);
    ok('G its amount message survives (it was never silent)', sum.text.indexOf('נא להזין סכום') !== -1, sum.text);
    ok('G the silent bank fields are named alongside it',
      jumps.indexOf('bank-name') !== -1 && jumps.indexOf('bank-branch') !== -1 && jumps.indexOf('bank-account') !== -1, jumps);
    ok('G nothing was submitted', postedSubmit(rig) === false);
    rig.window.close();
  }

  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS CRASH:', e && e.stack || e); process.exit(1); });
