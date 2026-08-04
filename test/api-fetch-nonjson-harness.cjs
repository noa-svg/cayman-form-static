/**
 * api-fetch-nonjson-harness.cjs
 *
 * THE BUG (Noa hit it herself in the console, 2026-08-04):
 *   "Server error: Unexpected token '<', "<!DOCTYPE "... is not valid JSON"
 *
 * apiFetch called r.json() unconditionally. Neither Ju backend returns JSON
 * unconditionally: the GAS deployment intermittently serves Google's own HTML
 * (a Drive "cannot open the file" page - seen 8+ times on this deployment, and
 * twice more during the session that fixed this - a 302 interstitial, or a login
 * page), and ju-service behind Cloud Run can serve an HTML 502/503 or an IAM
 * redirect. So the operator got a JavaScript parser message for a transient
 * server hiccup, with no hint that retrying would just work.
 *
 * PREVENT: read the body as text, classify it, retry once, and report in words
 * that say what to do. DETECT: this harness, which executes the real extracted
 * apiFetch against stubbed responses rather than regexing its source, so it
 * fails if the behaviour regresses even when the code still "looks right".
 *
 * Deliberately written against BOTH Ju architectures (Noa: "adjust for both ju
 * architects"): the GAS HTML shapes and the Cloud Run ones are both covered, so
 * the guard survives the ju-service cutover.
 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); }
}
function extractFn(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}

const DRIVE_HTML = '<!DOCTYPE html><html lang="he" dir="rtl"><head><title>הדף לא נמצא</title></head>' +
  '<body><p class="errorMessage">מצטערים, לא ניתן לפתוח את הקובץ כרגע.</p></body></html>';
const LOGIN_HTML = '<!DOCTYPE html><html><head><title>Sign in</title></head>' +
  '<body><a href="https://accounts.google.com/ServiceLogin">Sign in</a></body></html>';
const NGINX_HTML = '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1>' +
  '<hr><center>nginx</center></body></html>';

// Build a sandbox holding the REAL apiFetch + its classifier.
function build(responses) {
  const calls = [];
  const cleared = [];
  const sandbox = {
    DEMO: false, GW: 'https://example.invalid/exec', ID_TOKEN: 'tok', OP_FALLBACK: '',
    clearAuth: (r) => cleared.push(r),
    demoResolve_: () => ({}),
    calls, cleared,
    setTimeout, Promise, JSON, Error, String,
  };
  sandbox.fetch = function (url, opts) {
    calls.push(JSON.parse(opts.body).q);
    const next = responses.shift();
    if (!next) throw new Error('stub ran out of responses');
    // A faithful Response stub: BOTH json() and text(), with json() rejecting on
    // a non-JSON body exactly as the browser's does. Without json() here the
    // harness would crash rather than fail when run against the old
    // r.json()-only code, which would make it useless as a ratchet - it has to
    // reproduce the operator's actual symptom ("Unexpected token '<'"), not a
    // missing-stub TypeError.
    return Promise.resolve({
      status: next.status,
      text: () => Promise.resolve(next.body),
      json: () => new Promise((res) => res(JSON.parse(next.body))),
    });
  };
  const src = extractFn('apiClassifyNonJson_') + '\n' + extractFn('apiFetch') + '\nreturn apiFetch;';
  const keys = Object.keys(sandbox);
  const apiFetch = new Function(...keys, src)(...keys.map((k) => sandbox[k]));
  return { apiFetch, sandbox };
}

(async () => {
  // 1. THE REPORTED SYMPTOM: an HTML page must never surface as a parser message.
  {
    const { apiFetch, sandbox } = build([
      { status: 404, body: DRIVE_HTML },
      { status: 404, body: DRIVE_HTML },
    ]);
    let err = null;
    try { await apiFetch('?api=list'); } catch (e) { err = e; }
    ok('an HTML body throws an honest error, not a JSON parser message', !!err && !/Unexpected token/.test(String(err.serverError)));
    ok('the message names a server hiccup rather than blaming the operator', /google|ju/i.test(String(err.serverError)), err && err.serverError);
    ok('it is tagged as non_json for callers that want to branch', err && err.nonJson === 'transient');
    ok('it retried exactly once before giving up', sandbox.calls.length === 2, sandbox.calls.length);
  }

  // 2. THE COMMON CASE: these shapes clear on one retry, and the operator should
  // never see them at all. Every live instance recorded on this deployment
  // cleared on the immediate retry.
  {
    const { apiFetch, sandbox } = build([
      { status: 404, body: DRIVE_HTML },
      { status: 200, body: JSON.stringify({ ok: true, matches: [{ itemId: '1' }] }) },
    ]);
    // Caught deliberately: against the OLD r.json()-only code this rejects, and a
    // ratchet has to report a clean FAIL rather than crash the whole run.
    let d = null;
    try { d = await apiFetch('?admin=searchLps&q=maxim'); } catch (_) { /* reported by the assertion below */ }
    ok('a transient HTML page followed by real JSON resolves silently', !!d && d.ok === true && d.matches.length === 1);
    ok('the silent recovery took exactly two calls', sandbox.calls.length === 2, sandbox.calls.length);
  }

  // 3. ju-service / Cloud Run shapes are covered too, not just Google's.
  {
    const { apiFetch } = build([
      { status: 502, body: NGINX_HTML },
      { status: 502, body: NGINX_HTML },
    ]);
    let err = null;
    try { await apiFetch('?api=list'); } catch (e) { err = e; }
    ok('a Cloud Run 502 HTML page is classified as transient, not as a mystery', err && err.nonJson === 'transient');
    ok('the 502 message carries the status code', /502/.test(String(err.serverError)), err && err.serverError);
  }

  // 4. An auth page must NOT be retried: retrying a dead session just loops.
  {
    const { apiFetch, sandbox } = build([{ status: 200, body: LOGIN_HTML }]);
    let err = null;
    try { await apiFetch('?api=list'); } catch (e) { err = e; }
    ok('a login page is NOT retried', sandbox.calls.length === 1, sandbox.calls.length);
    ok('a login page clears the session', sandbox.cleared.length === 1 && sandbox.cleared[0] === 'session_expired');
    ok('a login page tells the operator to sign in again', /sign out and back in/i.test(String(err.serverError)), err && err.serverError);
  }

  // 5. Regression guard on everything that already worked: JSON envelopes are
  // untouched (the 2026-07-17 review's honest-error contract).
  {
    const { apiFetch } = build([{ status: 200, body: JSON.stringify({ ok: false, error: 'monday query failed' }) }]);
    let err = null;
    try { await apiFetch('?admin=searchLps&q=x'); } catch (e) { err = e; }
    ok('an {ok:false} envelope still throws with its server error', err && err.serverError === 'monday query failed');
  }
  {
    const { apiFetch, sandbox } = build([{ status: 200, body: JSON.stringify({ ok: false, error: 'unauthorized', reason: 'bad_token' }) }]);
    let err = null;
    try { await apiFetch('?api=list'); } catch (e) { err = e; }
    ok('a definitive unauthorized still clears auth exactly once', sandbox.cleared.length === 1 && sandbox.cleared[0] === 'bad_token');
    ok('a definitive unauthorized is not retried', sandbox.calls.length === 1);
  }
  {
    const { apiFetch } = build([{ status: 200, body: JSON.stringify({ ok: false, error: 'unauthorized', reason: 'tokeninfo_timeout' }) }]);
    let err = null;
    const { sandbox } = { sandbox: null };
    try { await apiFetch('?api=list'); } catch (e) { err = e; }
    ok('a TRANSIENT tokeninfo failure still does not log the operator out', /unauthorized_transient/.test(String(err && err.message)));
  }
  {
    const { apiFetch } = build([{ status: 200, body: JSON.stringify({ processes: [] }) }]);
    const d = await apiFetch('?api=list');
    ok('a bare-data response with no ok field still passes through', !!d && Array.isArray(d.processes));
  }

  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
