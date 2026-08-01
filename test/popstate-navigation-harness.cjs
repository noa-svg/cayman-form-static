// popstate-navigation-harness.cjs (2026-08-02, /cto-review follow-up pass).
//
// Proves index.html's and israel.html's popstate handlers now read
// e.state.lvpIdx instead of always stepping exactly one page backward
// regardless of what the browser's own history navigation actually did.
// Before this fix, a multi-entry browser back/forward jump (or a raced
// double-back before showPage/idx caught up) could under- or over-shoot
// relative to where the browser's address-bar history position actually
// was. Matches flow.html's already-correct, already-proven pattern (read
// e.state, clamp any same-or-forward target back to idx - 1, never trust a
// jump the browser handed us if it isn't genuinely backward).
//
// Extracts the REAL popstate handler from each live file (anchor +
// brace-counting) and drives it directly with a fake event/showPage spy.
//
// Run: node test/popstate-navigation-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }

// Extracts just the `function (e) {...}` handler expression passed to
// addEventListener('popstate', ...), via brace-counting from the anchor.
function extractHandlerFn(html, fileLabel) {
  const outerAnchor = "window.addEventListener('popstate', function (e) {";
  const outerStart = html.indexOf(outerAnchor);
  if (outerStart < 0) throw new Error(fileLabel + ': popstate handler anchor not found (boot contract changed)');
  const fnStart = outerStart + "window.addEventListener('popstate', ".length;
  const bodyOpen = html.indexOf('{', fnStart);
  let i = bodyOpen, depth = 0, fnEnd = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { fnEnd = i + 1; break; } }
  }
  if (fnEnd < 0) throw new Error(fileLabel + ': unbalanced braces in popstate handler');
  return html.slice(fnStart, fnEnd);
}

function testFile(filePath, fileLabel) {
  const html = fs.readFileSync(filePath, 'utf8');
  const fnSrc = extractHandlerFn(html, fileLabel);

  function drive(currentIdx, eventState) {
    const calls = [];
    const factory = new Function('idx', 'showPage', 'return (' + fnSrc + ');');
    const handler = factory(currentIdx, (target) => calls.push(target));
    handler({ state: eventState });
    return calls;
  }

  ok(fileLabel + ': on the first page (idx=0), popstate is a no-op (browser handles leaving)', drive(0, null).length === 0);

  ok(fileLabel + ': with no e.state, falls back to idx - 1 (unknown-state safety)', JSON.stringify(drive(3, null)) === JSON.stringify([2]));

  ok(fileLabel + ': a genuine single-step backward e.state is honored exactly', JSON.stringify(drive(3, { lvpIdx: 2 })) === JSON.stringify([2]));

  ok(fileLabel + ': a genuine MULTI-step backward e.state is honored exactly (the actual fix - not forced to idx-1)', JSON.stringify(drive(5, { lvpIdx: 1 })) === JSON.stringify([1]));

  ok(fileLabel + ': a same-index e.state (no real move) clamps to idx - 1, never re-shows the current page as if it moved', JSON.stringify(drive(3, { lvpIdx: 3 })) === JSON.stringify([2]));

  ok(fileLabel + ': a FORWARD e.state is never honored (clamped to idx - 1, no validation bypass)', JSON.stringify(drive(2, { lvpIdx: 4 })) === JSON.stringify([1]));
}

testFile(path.join(__dirname, '..', 'index.html'), 'index.html');
testFile(path.join(__dirname, '..', 'israel.html'), 'israel.html');

console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
