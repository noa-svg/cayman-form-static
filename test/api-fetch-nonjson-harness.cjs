/**
 * api-fetch-nonjson-harness.cjs
 *
 * THE BUG (Noa hit it in the console, 2026-08-04):
 *   "Server error: Unexpected token '<', "<!DOCTYPE "... is not valid JSON"
 *
 * apiFetch called r.json() unconditionally. Neither backend returns JSON
 * unconditionally: GAS intermittently serves Google's own HTML (a Drive
 * "cannot open the file" page, a 302 interstitial, a login page) and
 * ju-service behind Cloud Run serves HTML 502/503 and IAM redirects. The
 * operator got a parser message for a transient hiccup, with no hint that
 * retrying would work.
 *
 * PREVENT: read the body as text, classify it, retry once, report in words
 * that say what to do. DETECT: this harness. Both engines are covered, and
 * every scenario runs against BOTH gateways, because the retry carries `base`
 * and an engine it silently fell back to would be invisible otherwise.
 *
 * REWRITTEN 2026-09-07, dead on main since 2026-08-23. It extracted apiFetch
 * and eval'd it in a hand-built scope naming the globals apiFetch used the day
 * it was written. d6eb87f gave apiFetch its required `base` (the guard at
 * console/index.html:4943), the scope had no JU_API, and all 12 assertions
 * failed on `ReferenceError` before any of them could be evaluated. Unnoticed
 * for 15 days because it was not in githooks/pre-push's HARNESSES list.
 *
 * So it now drives the REAL console/index.html in jsdom with a scriptable
 * window.fetch and calls the real window.apiFetch, as
 * console-honest-status-harness.cjs does. The board is SSO-gated, so the
 * harness seeds a valid unexpired id_token in localStorage (the console reads
 * only its exp/email claims client-side) to reach it without DEMO fixtures.
 *
 * Run: node test/api-fetch-nonjson-harness.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('FAIL', label, extra === undefined ? '' : String(extra).slice(0, 400)); }
}

const DRIVE_HTML = '<!DOCTYPE html><html lang="he" dir="rtl"><head><title>הדף לא נמצא</title></head>' +
  '<body><p class="errorMessage">מצטערים, לא ניתן לפתוח את הקובץ כרגע.</p></body></html>';
const LOGIN_HTML = '<!DOCTYPE html><html><head><title>Sign in</title></head>' +
  '<body><a href="https://accounts.google.com/ServiceLogin">Sign in</a></body></html>';
const NGINX_HTML = '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1>' +
  '<hr><center>nginx</center></body></html>';

const TOKEN_KEY = 'lvp_op_token_v1';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function fakeIdToken() {
  return b64u({ alg: 'RS256', typ: 'JWT' }) + '.'
    + b64u({ email: 'noa@legacyvpartners.com', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig';
}

// Benign answers for the boot fetches, so the board reaches its authed steady
// state without the harness modelling it.
function bootAnswer(route) {
  if (route === 'list') return { processes: [], generatedAt: '' };
  if (route === 'opNotes') return { notes: {} };
  if (route === 'opBoardDetail') return { ok: true, rows: {} };
  if (route === 'opGetRowReview') return { ok: true, reviews: {} };
  if (route === 'w8renewals') return { counts: {}, due: [] };
  if (route === 'messages') return { ok: true, messages: [] };
  if (route === 'foShareLabels') return { ok: true, labels: [] };
  return { ok: true };
}

// Boot the console once; each scenario installs its own response QUEUE, so the
// retry recursion consumes the next entry as a real second round trip would.
// Calls record query string + gateway, making "retried once" and "did not
// switch engines" both assertable.
const settle = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 200 : ms));

async function bootConsole() {
  const state = { queue: null, calls: [] };
  const dom = new JSDOM(html, {
    url: 'http://localhost:8000/console/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem(TOKEN_KEY, fakeIdToken());
      w.fetch = function (url, o) {
        let q = '';
        try { q = JSON.parse(o.body).q || ''; } catch (e) { q = ''; }
        if (state.queue) {
          state.calls.push({ q, base: String(url).replace(/\?source=op$/, '') });
          const next = state.queue.shift();
          if (!next) return Promise.reject(new Error('stub ran out of responses for ' + q));
          // text() only. json() is deliberately ABSENT so a regression back
          // to r.json() fails loudly instead of parsing and hiding itself.
          return Promise.resolve({
            status: next.status,
            text: () => Promise.resolve(next.body),
          });
        }
        const route = (q.match(/^\?(?:api|admin)=([A-Za-z0-9_]+)/) || [])[1] || '';
        return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(bootAnswer(route))) });
      };
    },
  });
  await settle(400);
  const win = dom.window;
  if (typeof win.apiFetch !== 'function') throw new Error('apiFetch is not a global on the booted console');
  if (typeof win.GW !== 'string' || typeof win.JU_API !== 'string') throw new Error('GW / JU_API are not globals on the booted console');
  return { dom, win, state };
}

let ENV = null;

// clearAuth is spied and restored, so session effects are observable without
// the login screen tearing the DOM down between scenarios. The real one is
// exercised at the end.
async function probe(qs, base, responses) {
  const win = ENV.win;
  ENV.state.queue = responses.slice();
  ENV.state.calls.length = 0;
  const cleared = [];
  const realClearAuth = win.clearAuth;
  win.clearAuth = function (reason) { cleared.push(reason); };
  win.localStorage.setItem(TOKEN_KEY, fakeIdToken());
  let data = null, err = null;
  try { data = await win.apiFetch(qs, undefined, base); } catch (e) { err = e; }
  win.clearAuth = realClearAuth;
  ENV.state.queue = null;
  return { data, err, cleared, calls: ENV.state.calls.slice() };
}

// Every scenario runs on BOTH gateways. `label` is suffixed with the engine so
// a one-sided failure names which engine it was.
async function onBoth(fn) {
  await fn(ENV.win.GW, 'GAS');
  await fn(ENV.win.JU_API, 'ju-service');
}

(async () => {
  ENV = await bootConsole();
  const { win } = ENV;

  // 0. Testing the shipped file, not a copy. The assertion the extract-and-eval
  // version could not make, which is how it went dead unnoticed.
  ok('apiFetch under test is the one console/index.html actually ships',
    html.indexOf(String(win.apiFetch)) >= 0, String(win.apiFetch).slice(0, 90));
  ok('base is REQUIRED: a call naming no gateway throws instead of defaulting to GAS',
    (() => { try { win.apiFetch('?api=list'); return false; } catch (e) { return /base is required/.test(String(e.message)); } })());

  // 1. THE REPORTED SYMPTOM: an HTML page must never surface as a parser message.
  await onBoth(async (base, eng) => {
    const r = await probe('?api=list', base, [
      { status: 404, body: DRIVE_HTML },
      { status: 404, body: DRIVE_HTML },
    ]);
    ok('[' + eng + '] an HTML body throws an honest error, not a JSON parser message',
      !!r.err && !/Unexpected token/.test(String(r.err.serverError)), r.err && r.err.serverError);
    ok('[' + eng + '] the message names a server hiccup rather than blaming the operator',
      /google|ju/i.test(String(r.err && r.err.serverError)), r.err && r.err.serverError);
    ok('[' + eng + '] it is tagged as non_json for callers that want to branch',
      r.err && r.err.nonJson === 'transient', r.err && r.err.nonJson);
    ok('[' + eng + '] it retried exactly once before giving up', r.calls.length === 2, r.calls.length);
    ok('[' + eng + '] the retry stayed on the same gateway', r.calls.every((c) => c.base === base),
      r.calls.map((c) => c.base).join(' | '));
  });

  // 2. THE COMMON CASE: every live instance on this deployment cleared on the
  // immediate retry, so the operator should never see these at all.
  await onBoth(async (base, eng) => {
    const r = await probe('?admin=searchLps&q=maxim', base, [
      { status: 404, body: DRIVE_HTML },
      { status: 200, body: JSON.stringify({ ok: true, matches: [{ itemId: '1' }] }) },
    ]);
    ok('[' + eng + '] a transient HTML page followed by real JSON resolves silently',
      !!r.data && r.data.ok === true && r.data.matches.length === 1, r.err && String(r.err.serverError || r.err.message));
    ok('[' + eng + '] the silent recovery took exactly two calls', r.calls.length === 2, r.calls.length);
    ok('[' + eng + '] the retry re-sent the SAME route, not a different one',
      r.calls.every((c) => c.q === '?admin=searchLps&q=maxim'), r.calls.map((c) => c.q).join(' | '));
  });

  // 3. ju-service / Cloud Run shapes are covered too, not just Google's.
  await onBoth(async (base, eng) => {
    const r = await probe('?api=list', base, [
      { status: 502, body: NGINX_HTML },
      { status: 502, body: NGINX_HTML },
    ]);
    ok('[' + eng + '] a Cloud Run 502 HTML page is classified as transient, not as a mystery',
      r.err && r.err.nonJson === 'transient', r.err && r.err.nonJson);
    ok('[' + eng + '] the 502 message carries the status code',
      /502/.test(String(r.err && r.err.serverError)), r.err && r.err.serverError);
  });

  // 4. An auth page must NOT be retried: retrying a dead session just loops.
  await onBoth(async (base, eng) => {
    const r = await probe('?api=list', base, [{ status: 200, body: LOGIN_HTML }]);
    ok('[' + eng + '] a login page is NOT retried', r.calls.length === 1, r.calls.length);
    ok('[' + eng + '] a login page clears the session',
      r.cleared.length === 1 && r.cleared[0] === 'session_expired', JSON.stringify(r.cleared));
    ok('[' + eng + '] a login page tells the operator to sign in again',
      /sign out and back in/i.test(String(r.err && r.err.serverError)), r.err && r.err.serverError);
  });

  // 5. Regression guard on everything that already worked: JSON envelopes are
  // untouched (the 2026-07-17 review's honest-error contract).
  await onBoth(async (base, eng) => {
    const r = await probe('?admin=searchLps&q=x', base, [
      { status: 200, body: JSON.stringify({ ok: false, error: 'monday query failed' }) },
    ]);
    ok('[' + eng + '] an {ok:false} envelope still throws with its server error',
      r.err && r.err.serverError === 'monday query failed', r.err && (r.err.serverError || r.err.message));
    ok('[' + eng + '] an {ok:false} envelope is not retried', r.calls.length === 1, r.calls.length);
  });
  await onBoth(async (base, eng) => {
    const r = await probe('?api=list', base, [
      { status: 200, body: JSON.stringify({ ok: false, error: 'unauthorized', reason: 'bad_token' }) },
    ]);
    ok('[' + eng + '] a definitive unauthorized still clears auth exactly once',
      r.cleared.length === 1 && r.cleared[0] === 'bad_token', JSON.stringify(r.cleared));
    ok('[' + eng + '] a definitive unauthorized is not retried', r.calls.length === 1, r.calls.length);
  });
  await onBoth(async (base, eng) => {
    const r = await probe('?api=list', base, [
      { status: 200, body: JSON.stringify({ ok: false, error: 'unauthorized', reason: 'tokeninfo_timeout' }) },
    ]);
    ok('[' + eng + '] a TRANSIENT tokeninfo failure still does not log the operator out',
      /unauthorized_transient/.test(String(r.err && r.err.message)) && r.cleared.length === 0,
      String(r.err && r.err.message) + ' cleared=' + JSON.stringify(r.cleared));
  });
  await onBoth(async (base, eng) => {
    const r = await probe('?api=list', base, [{ status: 200, body: JSON.stringify({ processes: [] }) }]);
    ok('[' + eng + '] a bare-data response with no ok field still passes through',
      !!r.data && Array.isArray(r.data.processes), r.err && String(r.err.serverError || r.err.message));
  });
  // A refusal that carries only {ok:false, reason} must surface the SENTENCE
  // explaining why the write was refused, not the bare word "unknown"
  // (2026-08-15: opSetRowAmount's placeholder guard was rendering "unknown").
  await onBoth(async (base, eng) => {
    const r = await probe('?api=opSetRowAmount', base, [
      { status: 200, body: JSON.stringify({ ok: false, reason: 'That row still holds a placeholder amount.' }) },
    ]);
    ok('[' + eng + '] an {ok:false, reason} refusal surfaces the reason, not "unknown"',
      r.err && r.err.serverError === 'That row still holds a placeholder amount.', r.err && r.err.serverError);
  });

  // 6. END TO END through the REAL clearAuth. The assertions above prove
  // apiFetch CALLS it; this proves the call ends the session. Last, because the
  // real clearAuth tears the board down.
  {
    ENV.state.queue = [{ status: 200, body: LOGIN_HTML }];
    ENV.state.calls.length = 0;
    win.localStorage.setItem(TOKEN_KEY, fakeIdToken());
    try { await win.apiFetch('?api=list', undefined, win.GW); } catch (e) { /* asserted above */ }
    ENV.state.queue = null;
    ok('a login page really does end the session (stored token gone)',
      !win.localStorage.getItem(TOKEN_KEY), win.localStorage.getItem(TOKEN_KEY));
    const login = win.document.getElementById('login-screen');
    ok('a login page really does put the operator back on the sign-in screen',
      login && !login.classList.contains('off'), login && login.className);
  }

  ENV.dom.window.close();
  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('HARNESS CRASHED', e && e.stack || e); process.exit(1); });
