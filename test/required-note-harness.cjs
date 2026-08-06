// required-note-harness.cjs (2026-08-06, Noa: the "all fields are required"
// note showed on a withdrawal page whose every field was prefilled and
// locked - "this shouldnt show on a page with all locked fields").
//
// Proves flow.html's .lvp-required-note now follows the ACTIVE page: visible
// only when that page still has at least one visible, editable, required
// field. Extracts the REAL updateRequiredNote from the live file
// (brace-counting, same pattern as flow-double-submit-harness.cjs) and drives
// it against jsdom DOMs modeling the three states that matter:
//   1. an editable required field present -> note shown
//   2. everything locked (readOnly / required stripped, prefillRO's shape) -> note hidden
//   3. the only required field sits inside a [hidden] subsection -> note hidden
//
// Run: node test/required-note-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(__dirname, 'node_modules', 'jsdom'));
const html = fs.readFileSync(path.join(__dirname, '..', 'flow.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); } }

// ---- Static wiring assertions ------------------------------------------------
ok('goToPage syncs the note on every page change',
  /title\.focus\(\); \}\s*\}\s*updateRequiredNote\(\);\s*\}/.test(html));
ok('boot reveal syncs the note after prefill locking',
  /\$form\.hidden = false;[\s\S]{0,300}updateRequiredNote\(\);/.test(html));

// ---- Extract the real function ----------------------------------------------
function extractFn(anchor) {
  const start = html.indexOf(anchor);
  if (start < 0) throw new Error('anchor not found: ' + anchor);
  let i = html.indexOf('{', start), depth = 0;
  const fnStart = start;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(fnStart, i + 1); }
  }
  throw new Error('unbalanced braces for ' + anchor);
}
const src = extractFn('function updateRequiredNote()');

function run(bodyHtml) {
  const dom = new JSDOM('<body><p class="lvp-required-note" >note</p>' + bodyHtml + '</body>');
  const fn = new Function('document', src + '\nupdateRequiredNote();');
  fn(dom.window.document);
  return dom.window.document.querySelector('.lvp-required-note').hidden;
}

// 1. Editable required field on the active page -> note stays visible.
ok('editable required field keeps the note', run(
  '<section class="lvp-page is-active"><input required></section>') === false);

// 2. prefillRO shape: locked fields (readOnly, or required stripped) -> hidden.
ok('all-locked page hides the note', run(
  '<section class="lvp-page is-active"><input required readonly><input value="x"></section>') === true);

// 3. Required field only inside a [hidden] subsection -> hidden.
ok('hidden-subsection required field does not count', run(
  '<section class="lvp-page is-active"><div hidden><input required></div></section>') === true);

// 4. Disabled required field does not count.
ok('disabled required field does not count', run(
  '<section class="lvp-page is-active"><input required disabled></section>') === true);

// 5. Inactive page fields never count toward the active page.
ok('other pages do not leak into the check', run(
  '<section class="lvp-page is-active"><input readonly required></section>' +
  '<section class="lvp-page"><input required></section>') === true);

console.log('required-note-harness:', pass + ' passed,', fail + ' failed');
process.exit(fail ? 1 : 0);
