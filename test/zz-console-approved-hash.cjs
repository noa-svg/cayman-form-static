// zz-console-approved-hash.cjs - the approved-letter guard must actually FIRE.
//
// ju-service merged domain/wireLetterFacts.ts: ?api=opRenderMonthLetter returns
// a factsHash over the letter's material facts, and
// ?api=opGenerateMonthlyWireLetter refuses when a recompose disagrees with a
// hash the caller supplied. The guard is `if (expectedHash)`, so a console that
// sends nothing leaves the whole protection inert in production: a letter the
// sheet changed between review and generate still shipped, silently.
//
// This file locks the console side of it.
//
//   H1  The render stores the facts of the letter now on screen, and clears
//       them on entry so an in-flight or failed render can never leave a stale
//       hash behind a newer letter.
//   H2  The generate click sends the hash ONLY when the stored render is this
//       exact month and currency, and sends nothing otherwise - unwired
//       generate must behave exactly as it did before.
//   H3  No LP name, amount or bank line rides in the query string: ids and
//       digests only.
//   H4  A refusal is READ BACK, before the generic error line and before the
//       Settled announcement, and renders the changed rows in words.
//   H5  The parameter names are the ones ju-service actually reads, checked
//       against the mono repo's origin/main rather than against memory.
//
// Run: node test/zz-console-approved-hash.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { monoSource } = require('./lib-mono-source.cjs');

let pass = 0, fail = 0;
function ok(l, c, x) { if (c) { pass++; console.log('ok   ' + l); } else { fail++; console.log('FAIL ' + l + (x === undefined ? '' : ' :: ' + String(x).slice(0, 300))); } }

const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');

// Brace-counting extractor, the house pattern (console-harness.cjs).
// Returns '' when the function is absent. A missing piece must come back as a
// named FAIL, never as a stack trace: a harness that crashes reports the same
// exit code for "the guard is gone" and "the rig is broken".
function rawFn(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) return '';
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  return '';
}
function esc2Src() { return (html.match(/function esc2\(s\)\{[^\n]*\}/) || [''])[0]; }

// ---- H1: the render owns the facts, and clears them first -----------------
const renderFn = rawFn('renderLetter');
ok('H1 renderLetter is present', renderFn.length > 0);
ok('H1 renderLetter clears the stored facts before anything else',
  /^function renderLetter\(\)\{\s*wlApproved=null;/.test(renderFn), renderFn.slice(0, 120));
ok('H1 the stored facts come from the render response, never from the page',
  /if\(r\.factsHash\)wlApproved=\{month:month,currency:ccy,hash:String\(r\.factsHash\),rowFacts:String\(r\.rowFacts\|\|''\)\}/.test(renderFn),
  renderFn.slice(renderFn.indexOf('factsHash') - 80, renderFn.indexOf('factsHash') + 200));
ok('H1 a render that answers with no hash leaves nothing stored',
  renderFn.indexOf('wlApproved={') === renderFn.lastIndexOf('wlApproved={'));

// ---- H2: the generate click, executed for real -----------------------------
// The shipped expression itself is pulled out and RUN against fabricated
// state. Asserting on the source text alone would pass on an expression that
// reads the wrong field.
const qsSrc = (html.match(/var facts=\(wlApproved[\s\S]*?:'';/) || [''])[0];
ok('H2 the generate handler builds a facts query', qsSrc.length > 0);
// Absent = the wiring is gone, which is exactly what this file exists to
// catch; every case below then FAILS by name instead of the rig throwing.
const buildQs = qsSrc ? new Function('wlApproved', 'snap', qsSrc + ' return factsQs;') : function () { return null; };
const RENDERED = { month: '09/2026', currency: 'NIS', hash: 'abc123hash', rowFacts: 'MR-1:aaaaaaaaaaaa,row12:bbbbbbbbbbbb' };

const sent = buildQs(RENDERED, { month: '09/2026', currency: 'NIS' }) || '';
ok('H2 a matching render sends the hash', sent.indexOf('&expectedFactsHash=abc123hash') === 0, sent);
ok('H2 a matching render sends the row facts too',
  sent.indexOf('&expectedRowFacts=' + encodeURIComponent(RENDERED.rowFacts)) > 0, sent);
ok('H2 nothing is sent when nothing was rendered', buildQs(null, { month: '09/2026', currency: 'NIS' }) === '');
ok('H2 nothing is sent when the render was another month',
  buildQs(RENDERED, { month: '08/2026', currency: 'NIS' }) === '');
ok('H2 nothing is sent when the render was another currency',
  buildQs(RENDERED, { month: '09/2026', currency: 'USD' }) === '');
ok('H2 nothing is sent when the render answered without a hash',
  buildQs({ month: '09/2026', currency: 'NIS', hash: '', rowFacts: '' }, { month: '09/2026', currency: 'NIS' }) === '');

// ---- H3: ids and digests only ----------------------------------------------
ok('H3 the query carries the hash and the row facts and nothing else',
  (sent.match(/&[a-zA-Z]+=/g) || []).join(',') === '&expectedFactsHash=,&expectedRowFacts=', sent);
ok('H3 the console never puts a transfer name or amount on this query',
  !/expected[A-Za-z]*=.{0,40}(name|amount|bank)/i.test(qsSrc), qsSrc);

// ---- H4: the refusal, rendered ---------------------------------------------
const genStart = html.indexOf('function wlDoGenerate()');
const genEnd = html.indexOf('if(confirmGoEl)confirmGoEl.onclick=wlDoGenerate;');
const COMMIT = genStart >= 0 && genEnd > genStart ? html.slice(genStart, genEnd) : '';
ok('H4 the commit path is present', COMMIT.length > 0);
const mismatchIdx = COMMIT.indexOf('if(r&&r.factsMismatch)');
const genericIdx = COMMIT.indexOf('if(!r||!r.ok)');
const settledIdx = COMMIT.indexOf("wlAnnounce('Settled ");
ok('H4 the refusal is read back at all', mismatchIdx >= 0);
ok('H4 it is read BEFORE the generic error line', mismatchIdx >= 0 && genericIdx > mismatchIdx,
  'mismatch@' + mismatchIdx + ' generic@' + genericIdx);
ok('H4 it is read BEFORE the Settled announcement', mismatchIdx >= 0 && settledIdx > mismatchIdx,
  'mismatch@' + mismatchIdx + ' settled@' + settledIdx);
ok('H4 the refusal closes the gate rather than leaving Generate armed',
  /if\(r&&r\.factsMismatch\)\{[\s\S]{0,400}wlCloseGate\(/.test(COMMIT));
ok('H4 the refusal re-reads the rows and the letter, so the screen stops being stale',
  /if\(r&&r\.factsMismatch\)\{[\s\S]{0,500}peekRows\(\);renderLetter\(\);/.test(COMMIT));
ok('H4 the refusal is spoken to a screen reader too',
  /if\(r&&r\.factsMismatch\)\{[\s\S]{0,500}wlAnnounce\(/.test(COMMIT));

// The renderer, executed. A raw JSON dump and a silent failure are both
// failures of this requirement, so the output is read, not just located.
const parts = [esc2Src(), rawFn('wlRowKeyWords'), rawFn('wlFactsMismatchList'), rawFn('wlFactsMismatchHtml')];
const rendererPresent = parts.every((p) => p.length > 0);
ok('H4 the plain-language refusal renderer is present', rendererPresent,
  ['esc2', 'wlRowKeyWords', 'wlFactsMismatchList', 'wlFactsMismatchHtml'].filter((n, i) => !parts[i].length).join(', ') + ' missing');
const mismatchHtml = rendererPresent
  ? new Function(parts.join(';') + '; return wlFactsMismatchHtml;')()
  : function () { return ''; };
const out = mismatchHtml({
  changed: ['MR-4417'], removed: ['row12'], added: [],
  reasons: ['rows edited since review: MR-4417'],
});
ok('H4 the operator is told nothing was generated and nothing settled',
  /Nothing was generated and nothing was settled/.test(out), out);
ok('H4 a row with a reference is named by it', out.indexOf('reference MR-4417') > 0, out);
ok('H4 a row with no reference is named by its row number, not by "row12"',
  out.indexOf('row 12 on the tab') > 0 && out.indexOf('>row12') < 0, out);
ok('H4 an empty list is not printed as an empty heading', out.indexOf('Added since you looked') < 0, out);
ok('H4 no JSON is dumped at the operator', out.indexOf('{') < 0 && out.indexOf('[') < 0, out);
const totalsOnly = mismatchHtml({ changed: [], removed: [], added: [], reasons: ['the letter totals, row count, month or currency changed since review (no individual row differs)'] });
ok('H4 a mismatch that names no row still says what changed',
  /totals, row count, month or currency/.test(totalsOnly), totalsOnly);
const noDetail = mismatchHtml({ reasons: [] });
ok('H4 a refusal with no detail at all still refuses in words',
  /no longer matches the one you reviewed/.test(noDetail), noDetail);
ok('H4 a malformed refusal does not throw', typeof mismatchHtml(undefined) === 'string');
ok('H4 the row keys are escaped on the way out',
  mismatchHtml({ changed: ['<img src=x>'] }).indexOf('<img') < 0);

// ---- H5: the wire names, checked against the server that reads them ---------
const dispatch = monoSource('apps/ju-service/src/routes/consoledispatch.ts');
ok('H5 the ju-service dispatch source could be read (empty = not checked)', dispatch.length > 0);
if (dispatch.length > 0) {
  ok('H5 the server reads params.expectedFactsHash', dispatch.indexOf('params.expectedFactsHash') > 0);
  ok('H5 the server reads params.expectedRowFacts', dispatch.indexOf('params.expectedRowFacts') > 0);
  ok('H5 both reads sit in the opGenerateMonthlyWireLetter branch',
    dispatch.indexOf('params.expectedFactsHash') > dispatch.indexOf("api === 'opGenerateMonthlyWireLetter'"));
}
const render = monoSource('apps/ju-service/src/routes/transferformrender.ts');
ok('H5 the ju-service render source could be read (empty = not checked)', render.length > 0);
if (render.length > 0) {
  ok('H5 the render route returns factsHash', /factsHash:/.test(render));
  ok('H5 the render route returns rowFacts', /rowFacts:/.test(render));
}

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
