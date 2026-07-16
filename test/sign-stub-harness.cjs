// Focused harness for the sign.html redirect stub (2026-07-16).
// sign.html was the orphaned pre-signer.html signing page; it is now a minimal
// stub that forwards ancient emailed links (?t=<token>) to /signer.html.
// Proves, from the LIVE file:
//   S1  the inline script location.replace-s to /signer.html preserving the
//       FULL query string and hash (functional check against a mock location);
//   S2  a bare hit (no query, no hash) redirects to exactly /signer.html;
//   S3  a throwing location.replace does not escape the stub script;
//   S4  the <meta http-equiv="refresh"> no-JS fallback exists and targets
//       /signer.html;
//   S5  the stub carries NO signing machinery: no gateway /exec URL, no
//       canvas/signature code, and the visible body copy is exactly the
//       established single-word "Redirecting…".
// Run: node test/sign-stub-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const signHtml = fs.readFileSync(path.join(__dirname, '..', 'sign.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); }
}

// ---- extract the inline redirect script -------------------------------------
const sm = signHtml.match(/<script>([\s\S]*?)<\/script>/);
ok('S1 inline script present', !!sm);
function runStub(search, hash, replaceImpl) {
  const calls = [];
  const location = {
    search, hash,
    replace: replaceImpl || function (url) { calls.push(url); }
  };
  new Function('location', sm ? sm[1] : '')(location);
  return calls;
}

// ---- S1: query + hash preserved ----------------------------------------------
(function () {
  const calls = runStub('?t=TOK123&lang=en', '#pad');
  ok('S1 replace called exactly once', calls.length === 1, JSON.stringify(calls));
  ok('S1 redirects to /signer.html with full query + hash preserved',
    calls[0] === '/signer.html?t=TOK123&lang=en#pad', calls[0]);
})();
(function () {
  const calls = runStub('?t=TOK456', '');
  ok('S1 ?t= alone preserved', calls[0] === '/signer.html?t=TOK456', calls[0]);
})();

// ---- S2: bare hit -------------------------------------------------------------
(function () {
  const calls = runStub('', '');
  ok('S2 bare hit redirects to exactly /signer.html', calls[0] === '/signer.html', calls[0]);
})();

// ---- S3: throwing replace swallowed --------------------------------------------
(function () {
  let threw = false;
  try { runStub('?t=x', '', function () { throw new Error('SecurityError'); }); } catch (e) { threw = true; }
  ok('S3 throwing location.replace swallowed', threw === false);
})();

// ---- S4: meta refresh fallback --------------------------------------------------
(function () {
  const meta = signHtml.match(/<meta http-equiv="refresh" content="([^"]+)"/);
  ok('S4 meta refresh fallback present', !!meta);
  ok('S4 meta refresh targets /signer.html', !!meta && /^\d+;url=\/signer\.html$/.test(meta[1]), meta && meta[1]);
})();

// ---- S5: no stale signing machinery ----------------------------------------------
(function () {
  ok('S5 no gateway /exec URL left in the stub', !/script\.google\.com\/macros/.test(signHtml));
  ok('S5 no canvas/signature machinery left', !/canvas|HE_MAP|applyLang|signature-pad/i.test(signHtml));
  const body = signHtml.match(/<body>([\s\S]*?)<\/body>/);
  ok('S5 body is exactly the single word Redirecting…', !!body && body[1].trim() === 'Redirecting…', body && JSON.stringify(body[1]));
})();

console.log(`\n${fail ? 'SIGN STUB FAILED: ' : 'SIGN STUB PASSED: '}${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
