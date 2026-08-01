// security-review-fixes-harness.cjs (2026-08-02, /cto-review follow-up pass).
//
// Two real security findings surfaced by a fresh CTO review of the already-
// shipped state, both fixed in the same pass this test proves:
// 1. console/index.html's esc2() didn't escape quotes but is used to build
//    double-quoted HTML attributes (value=/data-note=/data-c=/href=) from
//    LP/counterparty-controlled names and emails - the same bug class
//    already fixed in signer.html/flow.html this session, just missed for
//    the console. Now escapes all five chars.
// 2. index.html's applyCfgVisuals() built a <style> block with
//    cfg.brandBgUrl (server config response) completely unescaped - a value
//    containing a " or CSS special char could break out of url("...") and
//    inject arbitrary CSS. Now CSS-string-escaped before interpolating.
//
// Extracts the REAL functions from the live files and drives them directly.
//
// Run: node test/security-review-fixes-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const consoleHtml = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }

// ---- 1. console/index.html esc2() ------------------------------------------
function extractLine(html, anchor) {
  const start = html.indexOf(anchor);
  if (start < 0) throw new Error('anchor not found: ' + anchor);
  const end = html.indexOf('\n', start);
  return html.slice(start, end);
}
const esc2Src = extractLine(consoleHtml, 'function esc2(s){');
const esc2 = new Function(esc2Src + '; return esc2;')();

ok('esc2 still escapes & (regression guard)', esc2('a & b') === 'a &amp; b');
ok('esc2 still escapes < and > (regression guard)', esc2('<script>') === '&lt;script&gt;');
ok('esc2 now escapes " (the actual fix)', esc2('"') === '&quot;');
ok('esc2 now escapes \' (the actual fix)', esc2("'") === '&#39;');
(function () {
  const injected = '" onmouseover="alert(1)';
  const attrHtml = '<input value="' + esc2(injected) + '">';
  ok('a " in an LP-typed name can no longer break out of value="..."', !/value="[^"]*"\s*onmouseover=/.test(attrHtml), attrHtml);
})();
ok('esc2 handles null/undefined without throwing', esc2(null) === '' && esc2(undefined) === '');

// ---- 2. index.html applyCfgVisuals() CSS-injection fix ---------------------
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
const applyCfgVisualsSrc = extractFn(indexHtml, 'applyCfgVisuals');
if (applyCfgVisualsSrc.indexOf('replace(/"/g, \'\\\\"\')') === -1) {
  throw new Error('applyCfgVisuals no longer CSS-string-escapes brandBgUrl - fix regressed');
}

function runApplyCfgVisuals(brandBgUrl) {
  const styleEls = [];
  const document = {
    querySelector: () => null,
    createElement: () => { const el = { textContent: '' }; return el; },
    head: { appendChild: (el) => { styleEls.push(el); } },
  };
  const fn = new Function('document', 'return (' + applyCfgVisualsSrc + ');')(document);
  fn({ brandBgUrl });
  return styleEls[0] ? styleEls[0].textContent : null;
}

(function () {
  const malicious = '"); } * { display: none !important; } body::after { content: "pwned';
  const css = runApplyCfgVisuals(malicious);
  // The whole payload must survive as INERT STRING CONTENT inside one
  // continuous url("...") value - a real CSS parser only ever sees a single
  // string token, never a second rule. Verify by finding every quote
  // character and confirming none of them (other than the two real
  // delimiters this function itself adds) is unescaped.
  const opener = 'url("';
  const openerIdx = css.indexOf(opener);
  const bodyStart = openerIdx + opener.length;
  const closerIdx = css.lastIndexOf('")}');
  ok('output still has the expected url("...")}  wrapper (fixture sanity)', openerIdx !== -1 && closerIdx > bodyStart);
  const middle = css.slice(bodyStart, closerIdx);
  const unescapedQuote = /(^|[^\\])"/.test(middle);
  ok('a malicious brandBgUrl cannot close the url("...") string early (no unescaped quote inside it)', !unescapedQuote, middle);
  ok('the quote is escaped in place, not stripped (fails safe, not silently)', middle.indexOf('\\"') !== -1, middle);
})();
(function () {
  const withBackslash = 'https://example.com/bg.png?x=\\"};evil{y=1';
  const css = runApplyCfgVisuals(withBackslash);
  ok('a backslash-quote combination cannot smuggle an unescaped quote through', css.indexOf('\\\\"') !== -1 || css.indexOf('};evil{') === -1, css);
})();
(function () {
  const withNewline = 'https://example.com/bg.png\n}body{display:none';
  const css = runApplyCfgVisuals(withNewline);
  ok('a raw newline in the value is stripped (cannot terminate the CSS string unescaped)', css.indexOf('\n') === -1, css);
})();
(function () {
  const normal = 'https://legacyvpartners.com/bg.png';
  const css = runApplyCfgVisuals(normal);
  ok('a normal https URL renders unmangled', css.indexOf('url("https://legacyvpartners.com/bg.png")') !== -1, css);
})();

console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
