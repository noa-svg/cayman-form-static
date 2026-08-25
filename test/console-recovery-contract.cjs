// Console RECOVERY-CONTROL CONTRACT (2026-08-25).
//
// test/console-action-contract.cjs catches a button with no BACKEND: a route
// the console names that no gateway handles. It cannot catch the failure that
// actually shipped on 2026-08-25, because that button's backend was real and
// live. "Attach signed qualification" was copy-pasted from the company-stamp
// block, and its handler stayed inside THAT block's IIFE, behind
// `if(!atoggle2||!aform2)return;`. The stamp control renders only for
// role==='subscriber'; the new button renders only on the attester card. On
// the one card it appeared on, the guard returned early and nothing bound. The
// button rendered and did nothing. Markup and wiring were added in the same
// commit, by the same author, minutes apart - and still came apart, because
// they lived in two scopes with different render conditions.
//
// The console now renders every one of those controls from a single registry
// (RECOVERY_ACTIONS) and binds them by walking the rendered nodes back to that
// same registry, which makes the split structurally impossible FOR CONTROLS
// INSIDE THE COMPONENT. This file is the part that keeps it that way: it fails
// the deploy gate when a sixth control is added the old way, outside the
// component, where the guarantee does not reach.
//
//   R1  The registry is well-formed: every row has key/label/cta/when/fields/run.
//   R2  The renderer emits data-recov ONLY from a registry key - never a literal.
//   R3  The wirer resolves that key back through the registry, and an
//       unresolvable key fails LOUDLY (disabled control + console.error),
//       never as a silent dead button.
//   R4  No disclosure toggle is rendered into the drawer outside the component
//       except the ones explicitly accounted for here. THIS is the check that
//       would have caught the original bug: a sixth hand-rolled
//       `cs-<something>-toggle` fails the gate on sight.
//   R5  Every interactive class the renderer emits is queried by the wirer, so
//       a new field or button in the markup cannot go unbound.
//
// Run: node test/console-recovery-contract.cjs
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');
let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); } }

// ---- locate the registry by bracket-counting (same technique as console-harness) ----
function registrySrc() {
  const start = html.indexOf('var RECOVERY_ACTIONS=[');
  if (start < 0) return '';
  let i = html.indexOf('[', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  return '';
}
const REG = registrySrc();
ok('R0 RECOVERY_ACTIONS registry present (absent = vacuous contract, hard fail)', REG.length > 0);

// ---- R1: well-formed rows ----
const keys = (REG.match(/\n\s*key:'([A-Za-z0-9_]+)'/g) || []).map(s => s.split("'")[1]);
ok('R1 registry has rows', keys.length >= 5, keys.join(','));
ok('R1 registry keys are unique', new Set(keys).size === keys.length, keys.join(','));
// Split the registry into per-row slices at each `key:` so each row's required
// members are checked against THAT row, not against the file as a whole.
const rowStarts = [];
const keyRe = /\n\s*key:'([A-Za-z0-9_]+)'/g;
let km;
while ((km = keyRe.exec(REG)) !== null) rowStarts.push({ key: km[1], at: km.index });
rowStarts.forEach((r, n) => {
  const slice = REG.slice(r.at, n + 1 < rowStarts.length ? rowStarts[n + 1].at : REG.length);
  ['label:', 'cta:', 'when:', 'fields:', 'run:'].forEach((member) => {
    ok('R1 ' + r.key + ' declares ' + member, slice.indexOf(member) >= 0);
  });
});

// ---- R2: the renderer emits data-recov only from a registry key ----
ok('R2 renderer emits data-recov from the registry key',
  html.indexOf('data-recov="\'+esc2(a.key)+\'"') >= 0);
// Any OTHER data-recov literal in the file would be a control that bypassed the
// registry on the render side.
const literalRecov = (html.match(/data-recov="[A-Za-z0-9_]+"/g) || []);
ok('R2 no hand-written data-recov literal anywhere', literalRecov.length === 0, literalRecov.join(','));

// ---- R3: the wirer resolves through the registry, and fails loudly ----
ok('R3 wirer looks the rendered key back up in the registry',
  /var a=recoveryActionByKey\(key\);/.test(html));
ok('R3 an unresolvable key disables the control instead of leaving it dead',
  /if\(!a\)\{[\s\S]{0,400}toggle\.disabled=true/.test(html));
ok('R3 an unresolvable key is reported, not swallowed',
  /console\.error\("recovery action rendered with no registry entry:"/.test(html));
ok('R3 the wirer binds by walking the RENDERED nodes (not per-control querySelector)',
  html.indexOf('document.querySelectorAll("#drawer .recov")') >= 0);

// ---- R4: no disclosure toggle outside the component ----
// THE CHECK THAT CATCHES THE ORIGINAL BUG CLASS. Every toggle class rendered
// anywhere in this file must be one of these two. A sixth recovery control
// hand-rolled the old way introduces a third and fails here, with the fix
// named in the failure message.
const ALLOWED_TOGGLES = new Set([
  'recov-toggle',      // the unified recovery component (registry-bound)
  'doc-correct-toggle' // per-sealed-document control, bound by querySelectorAll
                       // over .doccorrect - one handler for N rendered nodes,
                       // the same render-and-bind-from-one-place shape.
]);
const toggles = new Set();
const tRe = /class="([A-Za-z0-9_ -]*?-toggle)"/g;
let tm;
while ((tm = tRe.exec(html)) !== null) tm[1].split(/\s+/).forEach(c => { if (/-toggle$/.test(c)) toggles.add(c); });
toggles.forEach((c) => {
  ok('R4 toggle "' + c + '" belongs to a render-and-bind-from-one-place component',
    ALLOWED_TOGGLES.has(c),
    'a disclosure control was added outside RECOVERY_ACTIONS. Markup and handler in two scopes is exactly how "Attach signed qualification" shipped rendering-but-dead on 2026-08-25. Add a row to RECOVERY_ACTIONS instead, or - if it genuinely is not a current-signer recovery action - add it to ALLOWED_TOGGLES here with the reason.');
});
ok('R4 the retired per-action class families are gone',
  ['cs-attach-toggle', 'cs-attach2-toggle', 'cs-paperq-toggle', 'cs-fixaddr-toggle', 'cs-edit-toggle',
   'cs-at-save', 'cs-at2-save', 'cs-pq-save', 'cs-fa-save', 'cs-ed-save'].every(c => html.indexOf(c) < 0));

// ---- R5: every interactive class the renderer emits is queried by the wirer ----
const RENDERED = ['recov-toggle', 'recov-body', 'recov-go', 'recov-cancel', 'recov-status', 'recov-in'];
RENDERED.forEach((c) => {
  ok('R5 renderer emits .' + c, html.indexOf('class="' + c + '"') >= 0 || html.indexOf('"' + c + '"') >= 0);
  ok('R5 wirer queries .' + c, html.indexOf('".' + c + '"') >= 0 || html.indexOf("'." + c) >= 0);
});

console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
