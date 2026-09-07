// console-transfer-one-mint.cjs (2026-09-07).
//
// ONE MINT, NO AMOUNT. Two rulings from Noa on 2026-09-07, both about the
// step-1 button labelled "Transfer to Cayman", pinned here against the REAL
// console/index.html driven in jsdom.
//
//   T1  Pressing "Transfer to Cayman" mints an ONBOARDING subscription on the
//       Cayman lane carrying &transferIn=1, so the server composes all eight
//       migration documents from a single operator act. It used to mint
//       process=transfer, which produces the transfer instruction ALONE and no
//       subscription pack (sealQueue composes exactly one document per money
//       flowType), leaving whichever half the operator did not also mint by
//       hand simply missing, with nothing on screen saying so.
//
//   T2  That mint carries NO amount and NO currency. No correct figure exists
//       at signing: the balance that moves is the one at the close of 2026.
//       Any number captured now would be an estimate printed as a fact inside
//       a document an LP signs.
//
//   T3  THE NEGATIVE HALF, which matters as much as the positive one. This
//       change moves a SHARED predicate (isExistingLpFlow_), so increase and
//       withdrawal are driven end to end here too and their mint URLs are
//       asserted whole, not by substring: they must still go down the money
//       path, on the Israeli lane, byte for byte as before.
//
//   T4  The operator-facing amount field is gone from the markup entirely, not
//       merely hidden. A hidden required field is how a green Send button and
//       a blank document coexist.
//
//   T5  Pressing Onboarding AFTER Transfer is a real change of choice, not a
//       swallowed no-op. The preset derives process="subscription", so a
//       handler comparing the pressed button against state.process would see
//       "no change" and leave the panel in migration mode under the Onboarding
//       heading.
//
//   T6  Leaving the Cayman lane leaves the preset behind. The preset is three
//       pieces of state (lane, LP status, the lit button); syncFund already
//       reset the first two, and a lit "Transfer to Cayman" over an Israeli
//       onboarding panel is the console telling the operator it is doing
//       something it is not.
//
// This drives the real file in jsdom (runScripts:'dangerously') with a
// scriptable window.fetch, the same rig shape as console-honest-status-harness.
// The board is Google-SSO gated in production, so a syntactically valid,
// unexpired id_token is seeded in localStorage; the console only reads its
// exp/email claims client-side and lets the server be the real boundary.
//
// Run: node test/console-transfer-one-mint.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const HTML_PATH = path.join(__dirname, '..', 'console', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('FAIL', label, extra === undefined ? '' : String(extra).slice(0, 500)); }
}

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function fakeIdToken() {
  return b64u({ alg: 'RS256', typ: 'JWT' }) + '.'
    + b64u({ email: 'noa@legacyvpartners.com', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig';
}

// Every mint the console attempts is recorded verbatim, so the assertions can
// read the SENT string rather than a reconstruction of it.
function boot() {
  const mints = [];
  const all = [];
  const dom = new JSDOM(html, {
    url: 'http://localhost:8000/console/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem('lvp_op_token_v1', fakeIdToken());
      w.fetch = function (url, o) {
        let q = '';
        try { q = JSON.parse(o.body).q || ''; } catch (e) { q = ''; }
        all.push(q);
        if (q.indexOf('?admin=mintLink') === 0) mints.push(q);
        const route = (q.match(/^\?(?:api|admin)=([A-Za-z0-9_]+)/) || [])[1] || '';
        let answer = { ok: true };
        if (route === 'list') answer = { processes: [], generatedAt: '' };
        else if (route === 'opNotes') answer = { notes: {} };
        else if (route === 'opBoardDetail') answer = { ok: true, rows: {} };
        else if (route === 'opGetRowReview') answer = { ok: true, reviews: {} };
        else if (route === 'w8renewals') answer = { counts: {}, due: [] };
        else if (route === 'mintLink') answer = { ok: true, processId: 'p-test', url: 'https://sign.legacyvpartners.com/flow.html?t=x' };
        return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(answer)) });
      };
    },
  });
  return { dom, doc: dom.window.document, win: dom.window, mints, all };
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 260 : ms));

function press(doc, selector) {
  const el = doc.querySelector(selector);
  if (!el) throw new Error('missing control: ' + selector);
  el.click();
  return el;
}
function typeInto(doc, id, value) {
  const el = doc.getElementById(id);
  if (!el) throw new Error('missing field: ' + id);
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true }));
}

(async () => {
  // ---- T4: the amount controls are GONE from the shipped markup ------------
  ok('T4 no operator amount input ships in the console at all',
    html.indexOf('id="transferAmt"') < 0);
  ok('T4 no operator currency select ships either',
    html.indexOf('id="transferCcy"') < 0);
  ok('T4 the row that held them is gone, not hidden',
    html.indexOf('transferAmtRow') < 0);
  // Scoped to the mint builder, not the whole file: the wire-letter and
  // manual-record routes further down legitimately send their own &currency=
  // and &amount= and have nothing to do with a subscription mint.
  ok('T4 the transfer-in query fragment is the bare marker and nothing else',
    /function transferInQs_\(\)\{\s*\n\s*return \(state\.lpKind==="existing"\)\?'&transferIn=1':'';\s*\n\s*\}/.test(html),
    (html.match(/function transferInQs_[\s\S]{0,200}/) || ['(not found)'])[0]);
  ok('T4 the onboarding mint appends that fragment and no figure',
    /\+_tinQs\+\(force\?'&force=1':''\)/.test(html)
    && html.indexOf('_amtQs') < 0 && html.indexOf('_amtParts') < 0);
  ok('T4 the transfer preset is NOT an existing-LP money flow any more',
    /function isExistingLpFlow_\(p\)\{ return p==="increase"\|\|p==="withdrawal"; \}/.test(html),
    (html.match(/function isExistingLpFlow_[^\n]*/) || ['(not found)'])[0]);

  // ---- T1 + T2: press the button, send, read the mint ---------------------
  {
    const t = boot();
    await settle(400);
    press(t.doc, '#newProcBtn');
    press(t.doc, '#procGrid button[data-proc="transfer"]');
    await settle(300); // the preset switches the lane through the fund switcher

    ok('T1 the console is now on the Cayman lane',
      t.doc.body.getAttribute('data-lane') === 'cayman', t.doc.body.getAttribute('data-lane'));
    ok('T1 the pressed button is the one highlighted (not Onboarding)',
      t.doc.querySelector('#procGrid button[data-proc="transfer"]').getAttribute('aria-checked') === 'true'
      && t.doc.querySelector('#procGrid button[data-proc="subscription"]').getAttribute('aria-checked') === 'false');
    ok('T1 the operator gets the ONBOARDING door, not the money picker',
      t.doc.getElementById('lpPickerWrap').style.display === 'none'
      && t.doc.getElementById('manualLpFields').style.display !== 'none');
    ok('T1 the existing-LP picker is shown, because a migrating LP is an existing one',
      t.doc.getElementById('existingLpPickWrap').style.display !== 'none');
    ok('T2 there is no amount row on screen to fill in',
      !t.doc.getElementById('transferAmtRow') && !t.doc.getElementById('transferAmt'));

    typeInto(t.doc, 'name', 'Test Migrant');
    typeInto(t.doc, 'email', 'migrant@example.com');
    // The existing-LP search and the onboarding picker share one binding
    // (window.__onbPick), which is what onbPickedItemId_ reads at mint time.
    t.win.__onbPick({ itemId: '900000001', nameEn: 'Test Migrant', nameHe: '', nickname: '', email: 'migrant@example.com' });
    await settle(60);

    const cta = t.doc.getElementById('createBtn');
    ok('T2 Send is enabled with NO figure entered anywhere', cta.disabled === false,
      'disabled=' + cta.disabled + ' / ' + (t.doc.getElementById('ctaExplain') || {}).textContent);

    cta.click();
    await settle(60);
    ok('T1 the confirm card opened', !!t.doc.getElementById('crevGo'));
    press(t.doc, '#crevGo');
    await settle(300);

    ok('T1 exactly one mint was attempted', t.mints.length === 1, JSON.stringify(t.mints));
    const q = t.mints[0] || '';
    ok('T1 the mint is a SUBSCRIPTION, never process=transfer',
      /[?&]process=subscription(&|$)/.test(q) && q.indexOf('process=transfer') < 0, q);
    ok('T1 on the Cayman lane', /[?&]lane=cayman(&|$)/.test(q), q);
    ok('T1 declaring the LP as existing', /[?&]lpKind=existing(&|$)/.test(q), q);
    ok('T1 carrying the migration marker &transferIn=1', /[?&]transferIn=1(&|$)/.test(q), q);
    ok('T1 bound to the picked Monday record', /[?&]mondayItemId=900000001(&|$)/.test(q), q);
    ok('T2 the mint carries NO amount', q.indexOf('amount=') < 0, q);
    ok('T2 the mint carries NO currency', q.indexOf('currency=') < 0, q);

    // ---- T5: Onboarding after Transfer is a real change of choice ----------
    press(t.doc, '#newProcBtn');
    press(t.doc, '#procGrid button[data-proc="transfer"]');
    await settle(120);
    press(t.doc, '#procGrid button[data-proc="subscription"]');
    await settle(120);
    ok('T5 pressing Onboarding after Transfer moves the highlight',
      t.doc.querySelector('#procGrid button[data-proc="subscription"]').getAttribute('aria-checked') === 'true'
      && t.doc.querySelector('#procGrid button[data-proc="transfer"]').getAttribute('aria-checked') === 'false');
    ok('T5 and drops the migration LP status the preset had set',
      t.doc.getElementById('existingLpPickWrap').style.display === 'none'
      && t.doc.getElementById('onbPickerWrap').style.display !== 'none');

    // ---- T6: the preset does not survive the lane -------------------------
    // Driven through the ONE observable the console offers for a choice it
    // holds privately: pressing a step-1 button that is already the current
    // choice returns early as a no-op. So if the transfer preset survived a
    // switch away from Cayman, pressing "Transfer to Cayman" again would do
    // NOTHING and the operator would sit on Israel with the migration door
    // apparently pressed. With the preset dropped, the same press is a real
    // change and puts the console back on Cayman.
    press(t.doc, '#procGrid button[data-proc="transfer"]');
    await settle(300);
    ok('T6 the preset put the console on Cayman',
      t.doc.body.getAttribute('data-lane') === 'cayman', t.doc.body.getAttribute('data-lane'));
    t.win.__consoleSetLane('israel');
    await settle(250);
    ok('T6 the lane switch took', t.doc.body.getAttribute('data-lane') === 'israel');
    press(t.doc, '#procGrid button[data-proc="transfer"]');
    await settle(300);
    ok('T6 pressing Transfer after leaving Cayman is a real press, not a swallowed no-op',
      t.doc.body.getAttribute('data-lane') === 'cayman', t.doc.body.getAttribute('data-lane'));
    ok('T6 and it re-arms the migration door',
      t.doc.getElementById('existingLpPickWrap').style.display !== 'none');
    t.dom.window.close();
  }

  // ---- T3: increase and withdrawal still mint through the money path ------
  for (const proc of ['increase', 'withdrawal']) {
    const t = boot();
    await settle(400);
    ok('T3 ' + proc + ' starts on the Israeli lane (the console default)',
      t.doc.body.getAttribute('data-lane') === 'israel', t.doc.body.getAttribute('data-lane'));
    press(t.doc, '#newProcBtn');
    press(t.doc, '#procGrid button[data-proc="' + proc + '"]');
    await settle(120);
    ok('T3 ' + proc + ' still shows the money LP picker, not the onboarding fields',
      t.doc.getElementById('lpPickerWrap').style.display === 'block'
      && t.doc.getElementById('manualLpFields').style.display === 'none');
    t.win.__lpSetPick({ itemId: '800000002', nameEn: 'Existing Lp', nameHe: '', email: 'lp@example.com' });
    // The CTA gate is re-evaluated by the panel's delegated click listener, the
    // same event a real operator's click on the search result produces.
    t.doc.getElementById('panel').dispatchEvent(new t.win.Event('click', { bubbles: true }));
    await settle(80);
    const cta = t.doc.getElementById('createBtn');
    ok('T3 ' + proc + ' Send is enabled on the pick alone', cta.disabled === false);
    cta.click();
    await settle(60);
    press(t.doc, '#crevGo');
    await settle(300);
    ok('T3 ' + proc + ' minted exactly once', t.mints.length === 1, JSON.stringify(t.mints));
    const q = t.mints[0] || '';
    // Asserted WHOLE. A substring check would pass on a URL that had quietly
    // grown a transferIn marker or lost its peopleId.
    const expected = '?admin=mintLink&process=' + proc + '&lane=israel&type=individual'
      + '&mondayId=800000002&peopleId=800000002';
    ok('T3 ' + proc + ' mints the money URL byte for byte, unchanged', q === expected,
      'got ' + q + '\n want ' + expected);
    ok('T3 ' + proc + ' carries no transfer-in marker', q.indexOf('transferIn') < 0, q);
    ok('T3 ' + proc + ' auto-sends its invite on the same engine as before',
      t.all.indexOf('?admin=sendIsraeliInvite&process=p-test') >= 0, JSON.stringify(t.all.slice(-4)));
    t.dom.window.close();
  }

  console.log('\n' + (fail ? 'CONSOLE TRANSFER ONE-MINT FAILED: ' : 'CONSOLE TRANSFER ONE-MINT PASSED: ')
    + pass + ' passed, ' + fail + ' failed');
  // Explicit exit, like console-honest-status-harness: a booted console keeps
  // its own refresh timers, so the event loop never drains on its own and the
  // gate would sit on a finished harness forever.
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness crashed:', e); process.exit(2); });
