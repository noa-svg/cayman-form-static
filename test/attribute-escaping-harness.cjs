// attribute-escaping-harness.cjs (2026-08-02, CTO review finding #11).
//
// Proves two real escaping gaps are closed:
// 1. signer.html's esc() is used to build double-quoted HTML attributes
//    (value="..."/data-field="..." etc, see controlMarkup) as well as text
//    content, but only escaped &/</> - a " in a value would break out of
//    the attribute. Now matches flow.html's escHtml (all five chars).
// 2. flow.html's submitTopErr(msg) rendered msg (which can be server-echoed
//    - a validation string or res.error straight off the gateway response,
//    see classifyReject) into innerHTML completely unescaped.
//
// index.html/israel.html's own weaker esc() (only &/</>) was audited and
// confirmed SAFE as-is: every call site there renders into a text node, not
// an attribute, and quotes cannot break out of a text node - no change
// needed there, and this harness does not touch those two files.
//
// Extracts the REAL esc()/escHtml()/submitTopErr() from the live files
// (brace-counting, same pattern as upload-race-harness.cjs) and drives them
// directly.
//
// Run: node test/attribute-escaping-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const signerHtml = fs.readFileSync(path.join(__dirname, '..', 'signer.html'), 'utf8');
const flowHtml = fs.readFileSync(path.join(__dirname, '..', 'flow.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); } }

function extractFn(html, name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}

// ---- 1. signer.html esc() now escapes quotes too ---------------------------
const esc = new Function(extractFn(signerHtml, 'esc') + '; return esc;')();
ok('esc() still escapes & (regression guard)', esc('a & b') === 'a &amp; b');
ok('esc() still escapes < and > (regression guard)', esc('<script>') === '&lt;script&gt;');
ok('esc() now escapes " (the actual fix)', esc('"') === '&quot;');
ok('esc() now escapes \' (the actual fix)', esc("'") === '&#39;');
// The concrete exploit this closes: a value containing a double-quote can no
// longer break out of a value="..." attribute built via esc().
(function () {
  const injected = '" onmouseover="alert(1)';
  const attrHtml = '<input value="' + esc(injected) + '">';
  ok('a " in a value can no longer break out of value="..."', !/value="[^"]*"\s*onmouseover=/.test(attrHtml), attrHtml);
})();
ok('esc() handles null/undefined without throwing', esc(null) === '' && esc(undefined) === '');

// ---- 2. flow.html submitTopErr() now escapes msg ----------------------------
function extractSubmitTopErr() {
  const anchor = 'function submitTopErr(msg) {';
  const start = flowHtml.indexOf(anchor);
  if (start < 0) throw new Error('submitTopErr anchor not found (boot contract changed)');
  let i = flowHtml.indexOf('{', start), depth = 0;
  for (; i < flowHtml.length; i++) {
    if (flowHtml[i] === '{') depth++;
    else if (flowHtml[i] === '}') { depth--; if (depth === 0) return flowHtml.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces for submitTopErr');
}
const escHtml = new Function(extractFn(flowHtml, 'escHtml') + '; return escHtml;')();
const submitTopErrSrc = extractSubmitTopErr();
if (submitTopErrSrc.indexOf('escHtml(msg)') === -1) throw new Error('submitTopErr no longer calls escHtml(msg) - fix regressed');

function runSubmitTopErr(msg) {
  const summary = { innerHTML: '', hidden: true };
  const document = { getElementById: (id) => (id === 'lvp-uploads-summary' ? summary : null) };
  const fn = new Function('document', 'escHtml', 'return (' + submitTopErrSrc + ');');
  fn(document, escHtml)(msg);
  return summary;
}
(function () {
  const malicious = '<img src=x onerror=alert(1)>';
  const summary = runSubmitTopErr(malicious);
  ok('a server-echoed validation string with a raw tag is escaped, not injected', !summary.innerHTML.includes('<img'), summary.innerHTML);
  ok('the escaped text is still present (message not silently dropped)', summary.innerHTML.includes('&lt;img'));
  ok('summary is unhidden (existing behavior preserved)', summary.hidden === false);
})();
(function () {
  const summary = runSubmitTopErr('נא לנסות שוב');
  ok('a normal Hebrew message renders unmangled', summary.innerHTML.includes('נא לנסות שוב'));
})();

console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
