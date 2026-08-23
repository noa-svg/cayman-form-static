// flow-account-normalise-harness.cjs (2026-08-23, CTO review findings #10, #31, #51).
//
// flow.html is the increase/redemption form: the bank account an LP types here
// is the account money is WIRED TO. Three claims, all driven through the REAL
// page under the jsdom boot rig (rig-flow.cjs), never a hand-copied validator:
//
//   A (finding #10, money). The legitimate Israeli sub-account notation
//     nnnnnn/nn (e.g. 740800/88) is ACCEPTED. It used to be rejected: the
//     validator stripped spaces and hyphens and then demanded pure digits, so
//     an LP whose account carries a sub-account could not file at all.
//     israel.html has always accepted it and validation-rules.js records
//     digits-only as an already-fixed incident, so flow.html was the one page
//     still carrying the bug.
//   B (finding #10, money). The posted account is normalised the SAME way it
//     is validated. A typed "123-4567" used to validate clean (hyphen stripped
//     before the check) and then post RAW, putting a hyphen in the tracker.
//   C (finding #10, guardrail). Widening the rule must not open the field up:
//     letters and an out-of-range digit count are still refused.
//   D (finding #51). The redemption-month code carries no claim of a 14-day
//     buffer. The code has never had one (Noa removed the rule 2026-06-27, the
//     server agrees with the code) and three comments said it did, which is how
//     someone "restores" a rule that was deliberately deleted. Asserted on the
//     source text because a comment is exactly what has no runtime behaviour.
//   E (finding #31). The boot config fetch (budgeted 180s over 3 attempts, and
//     measured at 18-47s in the GOOD case) shows the page's real busy overlay,
//     not a static word, and drops it again on every boot exit.
//
// Run: node test/flow-account-normalise-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { loadFlowForm, makeFlowCfg } = require('./rig-flow.cjs');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}

const flowSrc = fs.readFileSync(path.join(__dirname, '..', 'flow.html'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fire(el, type) {
  el.dispatchEvent(new (el.ownerDocument.defaultView.Event)(type, { bubbles: true }));
}
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
function fieldError(document, name) {
  const wrap = document.querySelector('[data-field="' + name + '"]');
  if (!wrap) return null;
  return {
    invalid: wrap.classList.contains('is-invalid'),
    msg: (wrap.querySelector('.lvp-field__error') || {}).textContent || ''
  };
}

// Boot an increase flow and walk to the request page (start -> request), which
// is the page carrying the bank block.
async function bootToRequestPage(accountValue) {
  const rig = await loadFlowForm({
    token: 'ACCT-TEST',
    configXhr: () => ({ status: 200, body: makeFlowCfg({ flowType: 'cayman_increase', applicantType: 'individual' }) })
  });
  const d = rig.document;
  if (currentPage(d) !== 'start') throw new Error('boot did not land on start: ' + currentPage(d));
  setVal(d, 'ind-fullName', 'משקיע בדיקה');
  setVal(d, 'ind-idNumber', '123456782');            // checksum-valid synthetic
  setVal(d, 'lp-email', 'noa+test@legacyvpartners.com');
  clickGo(d, 'request');
  await sleep(40);
  if (currentPage(d) !== 'request') throw new Error('start page did not advance: ' + currentPage(d));
  // One increase amount row + the bank block. Bank/branch fall back to a plain
  // non-empty check when the registry has not loaded, which is the case here.
  const row = d.querySelector('#amount-rows-increase .lvp-amount-row');
  row.querySelector('[data-amount]').value = '500000';
  fire(row.querySelector('[data-amount]'), 'input');
  row.querySelector('[data-currency]').value = 'שקל';
  fire(row.querySelector('[data-currency]'), 'change');
  setVal(d, 'bank-name', 'בנק לאומי');
  setVal(d, 'bank-branch', '800');
  setVal(d, 'bank-account', accountValue);
  return rig;
}

(async () => {
  // ---- A: the sub-account notation is accepted and the LP moves on ----------
  {
    const rig = await bootToRequestPage('740800/88');
    clickGo(rig.document, 'uploads');
    await sleep(40);
    ok('A LP typing the sub-account 740800/88 advances past the bank page',
      currentPage(rig.document) === 'uploads', currentPage(rig.document));
    const err = fieldError(rig.document, 'bank-account');
    ok('A the account field carries no error for 740800/88',
      err && !err.invalid && !err.msg, JSON.stringify(err));
  }

  // ---- A2: a plain digits account still works (no regression) ---------------
  {
    const rig = await bootToRequestPage('740800');
    clickGo(rig.document, 'uploads');
    await sleep(40);
    ok('A2 a plain 6-digit account still advances', currentPage(rig.document) === 'uploads',
      currentPage(rig.document));
  }

  // ---- B: what is POSTED is what was VALIDATED ------------------------------
  // Drive the real submit and read the envelope off the wire. The account is
  // typed with a hyphen: the validator has always ignored it, so the only
  // question is whether the tracker receives it.
  for (const [typed, expected, label] of [
    ['123-4567', '1234567', 'a hyphen the LP typed is stripped before it is posted'],
    ['740800/88', '740800/88', 'the sub-account suffix is posted intact']
  ]) {
    const rig = await bootToRequestPage(typed);
    clickGo(rig.document, 'uploads');
    await sleep(40);
    if (currentPage(rig.document) !== 'uploads') { ok('B ' + label + ' (reached uploads)', false, currentPage(rig.document)); continue; }

    // Required upload slot: attach a real File and let the page's own
    // FileReader read it to base64, exactly as a phone picker would.
    const w = rig.window;
    const upl = rig.document.getElementById('file-accountManagementApproval');
    const f = new w.File([new Uint8Array([1, 2, 3, 4])], 'ishur.pdf', { type: 'application/pdf' });
    Object.defineProperty(upl, 'files', { value: [f], configurable: true });
    fire(upl, 'change');
    await sleep(250);

    // Capture the submit envelope off the shared gateway transport.
    const posted = [];
    w.fetch = function (url, init) {
      posted.push({ url: String(url), body: (init && init.body) || null });
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ ok: true, stage: 'submitted', detail: { flowType: 'cayman_increase' } }),
        text: () => Promise.resolve('{"ok":true}')
      });
    };
    const submitBtn = rig.document.getElementById('lvp-submit-btn');
    submitBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(500);

    const call = posted.find((c) => c.body && String(c.body).indexOf('"action":"submit"') !== -1);
    ok('B submit POST left the page (' + typed + ')', !!call,
      JSON.stringify(posted.map((c) => c.url)));
    if (call) {
      const env = JSON.parse(call.body);
      const acct = env.payload.submission.lpBank.accountNumber;
      ok('B ' + label, acct === expected, 'typed ' + typed + ' -> posted ' + JSON.stringify(acct));
    }
  }

  // ---- C: widening the rule did not open the field up -----------------------
  for (const [bad, why] of [['12', 'too few digits'], ['abcd1234', 'letters'],
    ['12345678901234', 'too many digits'], ['740800/8888', 'sub-account too long'],
    ['740800/', 'a bare trailing slash']]) {
    const rig = await bootToRequestPage(bad);
    clickGo(rig.document, 'uploads');
    await sleep(40);
    ok('C ' + JSON.stringify(bad) + ' is still refused (' + why + ')',
      currentPage(rig.document) === 'request', currentPage(rig.document));
  }

  // ---- D: no resurrected 14-day claim in the redemption-date code -----------
  {
    const redemptionBlock = flowSrc.slice(
      flowSrc.indexOf('---- redemption month picker'),
      flowSrc.indexOf('function populateRedemptionMonths')
    );
    ok('D the redemption-picker header block exists to check', redemptionBlock.length > 100);
    // The three retired claims, in the exact shapes they were written in.
    ok('D no "+ 14 days" claim survives anywhere in flow.html',
      !/\+\s*14\s*days/.test(flowSrc), (flowSrc.match(/.{0,60}\+\s*14\s*days.{0,60}/) || [])[0]);
    ok('D no "never carry today\'s date" claim survives',
      !/can never carry today's\s*\n?\s*\/\/\s*date|never carry today's date/.test(flowSrc));
    // And the CODE itself, not another comment: populateRedemptionMonths must
    // still contain no day arithmetic at all. Its whole rule is "start at the
    // 1st of this month, step forward a month if that is already past".
    const fnStart = flowSrc.indexOf('function populateRedemptionMonths');
    let depth = 0, i = flowSrc.indexOf('{', fnStart), fnEnd = -1;
    for (; i < flowSrc.length; i++) {
      if (flowSrc[i] === '{') depth++;
      else if (flowSrc[i] === '}') { depth--; if (depth === 0) { fnEnd = i; break; } }
    }
    const fnBody = flowSrc.slice(fnStart, fnEnd + 1);
    const code = fnBody.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n');
    ok('D populateRedemptionMonths was located', fnEnd > fnStart);
    ok('D the redemption-date CODE contains no day arithmetic (no buffer)',
      !/setDate\(|\b14\b|\* *24 *\* *3600|86400/.test(code),
      (code.match(/.*(setDate\(|\b14\b|86400).*/) || [])[0]);
    ok('D the rule is still month-stepping from the 1st',
      /cursor\.setMonth\(cursor\.getMonth\(\) \+ 1\)/.test(code));
  }

  // ---- E: what the LP looks at WHILE the boot fetch is in flight -----------
  // The rig holds ?api=config open, which is the state a real LP sits in for
  // 18-47s in the GOOD case and up to 180s x 3 attempts in the bad one.
  {
    const rig = await loadFlowForm({ token: 'BOOT-WAIT', configXhr: () => ({ hold: true }) });
    const busy = rig.document.getElementById('lvp-busy');
    const warn = rig.document.getElementById('lvp-busy-warn');
    ok('E mid-boot the LP sees the busy overlay, not a static word',
      !!busy && busy.classList.contains('is-active'), busy && busy.className);
    ok('E the overlay carries a spinner', !!rig.document.querySelector('#lvp-busy .lvp-busy__spinner'));
    ok('E the "do not close the window" line is NOT shown in the first seconds',
      !!warn && warn.hasAttribute('hidden'), warn && warn.outerHTML);
    // ... and IS shown once the wait has visibly gone long. Real time, because
    // the delay is the whole point of the assertion.
    await sleep(10400);
    ok('E after ~10s the "do not close the window" line appears',
      !!warn && !warn.hasAttribute('hidden'), warn && warn.outerHTML);
    ok('E the form is still hidden behind the overlay (nothing rendered yet)',
      rig.document.getElementById('lvp-form').hasAttribute('hidden'));
  }

  // ---- E1: a successful boot drops the overlay ------------------------------
  {
    const rig = await loadFlowForm({
      token: 'BOOT-OK',
      configXhr: () => ({ status: 200, body: makeFlowCfg({ flowType: 'cayman_increase' }) })
    });
    const busy = rig.document.getElementById('lvp-busy');
    const warn = rig.document.getElementById('lvp-busy-warn');
    ok('E1 a booted form is not left covered by the overlay',
      !!busy && !busy.classList.contains('is-active'), busy && busy.className);
    ok('E1 the warn line is restored for the submit overlay to reuse',
      !!warn && !warn.hasAttribute('hidden'));
    ok('E1 the form is up', !rig.document.getElementById('lvp-form').hasAttribute('hidden'));
  }

  // ---- E2: a boot that FAILS also drops the overlay -------------------------
  {
    const rig = await loadFlowForm({ token: 'BOOT-BROKEN', configXhr: () => ({ status: 404, body: {} }) });
    const busy = rig.document.getElementById('lvp-busy');
    ok('E2 a broken link drops the overlay so the message underneath is readable',
      !!busy && !busy.classList.contains('is-active'), busy && busy.className);
    ok('E2 the broken-link message is the one showing',
      /\u05d4\u05e7\u05d9\u05e9\u05d5\u05e8 \u05e9\u05d1\u05d5\u05e8/.test(rig.document.getElementById('lvp-loading').textContent),
      rig.document.getElementById('lvp-loading').textContent);
  }

  // ---- E3: every boot exit is wired to drop it ------------------------------
  // Static, and deliberately so: the four terminal error branches are cheap to
  // add and easy to forget, and an overlay left up over an error message is a
  // dead-looking page. This catches a NEW exit that forgets the call.
  {
    ok('E3 the boot path raises the busy overlay', /bootBusyStart_\(\);\s*\n\s*loadConfig\(\);/.test(flowSrc));
    const doneCalls = (flowSrc.match(/bootBusyDone_\(\)/g) || []).length;
    ok('E3 every boot exit drops it (4 terminal branches + success)', doneCalls >= 4, 'found ' + doneCalls);
  }

  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS CRASH:', e); process.exit(1); });
