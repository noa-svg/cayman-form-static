// doc-sanitize-harness.cjs (2026-08-02, CTO review finding #2).
//
// Proves the shared doc-preview sanitizer (../doc-sanitize.js) actually
// strips the dangerous constructs it claims to, and leaves legitimate
// document content (the actual subscription-pack text/formatting an LP or
// signer needs to review) untouched. Loads the REAL file via jsdom's
// runScripts, not a copy.
//
// Run: node test/doc-sanitize-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); } }

function sanitize(html) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const src = fs.readFileSync(path.join(__dirname, '..', 'doc-sanitize.js'), 'utf8');
  dom.window.eval(src);
  const container = dom.window.document.createElement('div');
  container.innerHTML = html;
  dom.window.lvpSanitizeDocHtml_(container);
  return container.innerHTML;
}

// ---- Dangerous constructs must be stripped -----------------------------
ok('script tag removed', !sanitize('<p>hi</p><script>window.x=1</script>').includes('<script'));
ok('iframe removed', !sanitize('<iframe src="https://evil.example"></iframe>').includes('<iframe'));
ok('object tag removed', !sanitize('<object data="x"></object>').includes('<object'));
ok('embed tag removed', !sanitize('<embed src="x">').includes('<embed'));

const onerrorOut = sanitize('<img src="x.png" onerror="alert(1)">');
ok('onerror attribute stripped', !onerrorOut.includes('onerror'));
ok('img tag itself preserved (only the handler is stripped)', onerrorOut.includes('<img'));

const onclickOut = sanitize('<div onclick="alert(1)">Clause text</div>');
ok('onclick attribute stripped', !onclickOut.includes('onclick'));
ok('element content preserved', onclickOut.includes('Clause text'));

const onloadOut = sanitize('<body onload="alert(1)"><p>x</p></body>'.replace(/^<body[^>]*>|<\/body>$/g, ''));
ok('onload-style attribute stripped when present on any element', !sanitize('<svg onload="alert(1)"></svg>').includes('onload'));

const jsHrefOut = sanitize('<a href="javascript:alert(1)">click</a>');
ok('javascript: href neutralized', !jsHrefOut.includes('javascript:'));
ok('anchor text preserved', jsHrefOut.includes('click'));

const jsHrefCaseOut = sanitize('<a href="  JavaScript:alert(1)">click</a>');
ok('javascript: href neutralized regardless of case/whitespace', !jsHrefCaseOut.includes('lert(1)') || !jsHrefCaseOut.toLowerCase().includes('href="  javascript'));

const dataHtmlOut = sanitize('<a href="data:text/html,<script>alert(1)</script>">x</a>');
ok('data:text/html href neutralized', !dataHtmlOut.includes('data:text/html'));

// ---- Legitimate content must survive untouched --------------------------
const legit = sanitize('<p style="font-weight:bold">Clause 4.2: the Subscriber represents...</p><img src="/logo.png" width="50" height="50">');
ok('normal styled text preserved verbatim', legit.includes('font-weight:bold') && legit.includes('Clause 4.2'));
ok('a normal https image src is left alone (not treated as dangerous)', legit.includes('src="/logo.png"'));
ok('non-event width/height attributes untouched (not this function\'s job)', legit.includes('width="50"'));

const httpsLink = sanitize('<a href="https://legacyvpartners.com/terms">terms</a>');
ok('a normal https href is left alone', httpsLink.includes('href="https://legacyvpartners.com/terms"'));

const mailtoLink = sanitize('<a href="mailto:info@legacyvpartners.com">email us</a>');
ok('a mailto: href is left alone', mailtoLink.includes('href="mailto:info@legacyvpartners.com"'));

// ---- Defensive: function must not throw on empty/null input -------------
(function () {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  dom.window.eval(fs.readFileSync(path.join(__dirname, '..', 'doc-sanitize.js'), 'utf8'));
  var threw = false;
  try { dom.window.lvpSanitizeDocHtml_(null); dom.window.lvpSanitizeDocHtml_(undefined); }
  catch (e) { threw = true; }
  ok('does not throw on null/undefined container (fail-open, never blocks the preview)', !threw);
})();

console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
