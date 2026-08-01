// Console-to-Atrium palette sync check (2026-07-20).
// The bug this exists to catch: console/index.html's live color palette
// (:root[data-theme="light"]) silently drifted from Atrium/NavPortal's
// (operate.legacyvpartners.com), the actual canonical brand-color source
// (pixel-sampled off the real Fact Sheet PDF, see nav-portal's tokens.css
// header comments). --color-atrium sat at #3F729A for weeks while Atrium's
// real --blue moved to #1F5DB0; only --color-info happened to still match
// --banner-blue, by coincidence not design. Retinted by hand 2026-07-19;
// this harness is what stops it recurring unnoticed.
//
// Reads Atrium's tokens.css directly (both repos live under ~/Desktop on
// this machine, per this whole codebase's established convention of
// cross-repo file reads for exactly this kind of check). If that path ever
// moves, this fails LOUD (a clear "could not read" error), not silently
// skips -- a missing canonical source is worse than a stale hardcoded
// fallback would be, so no fallback is used.
// Run: node test/atrium-palette-sync.cjs
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONSOLE_FILE = path.join(ROOT, 'console', 'index.html');
const ATRIUM_TOKENS_CSS = path.join(
  process.env.HOME || '/Users/noa',
  'Desktop/legacy-tools-mono/apps/nav-portal/src/atrium/styles/tokens.css',
);

// console --color-* name -> Atrium tokens.css --name role it must match.
// Only roles with a real Atrium equivalent are checked; console-only
// concepts (e.g. --color-dim, tint/bg pale variants, ink-disabled) are not
// forced into a role Atrium doesn't define, per the retint's own reasoning.
const ROLE_MAP = {
  '--color-atrium': '--blue',
  '--color-bg-sidebar': '--navy',
  '--color-ink': '--ink',
  '--color-ink-sub': '--ink-soft',
  '--color-ink-muted': '--ink-faint',
  '--color-border-focus': '--banner-blue',
  '--color-coral': '--coral',
  '--color-bg-page': '--paper',
  '--color-bg-strip': '--paper',
};
// console --color-* name -> a literal expected hex (no single Atrium token
// name to reference, e.g. a derived "-deep" hover shade, or Atrium's
// green/red aliases which live under --up/--down not --green/--red).
const LITERAL_MAP = {
  '--color-atrium-deep': '#184C90', // paired --s-accent-deep for Atrium's --blue elsewhere in this codebase
  '--color-green': '#2E8540', // Atrium --up
  '--color-red': '#C0202E', // Atrium --down
};

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}

function normalizeHex(value) {
  const m = value.match(/^#([0-9A-Fa-f]{3})$/);
  if (!m) return value.toUpperCase();
  const [r, g, b] = m[1].split('');
  return ('#' + r + r + g + g + b + b).toUpperCase();
}

function extractVar(text, varName, occurrence) {
  const re = new RegExp(varName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*:\\s*([^;]+);', 'g');
  const matches = [...text.matchAll(re)];
  const m = matches[occurrence || 0];
  return m ? normalizeHex(m[1].trim()) : null;
}

let atriumCss;
try {
  atriumCss = fs.readFileSync(ATRIUM_TOKENS_CSS, 'utf8');
} catch (e) {
  console.error('FATAL: could not read Atrium tokens.css at ' + ATRIUM_TOKENS_CSS + ' -- ' + e.message);
  console.error('This check has no fallback by design: a missing canonical source must fail loud.');
  process.exit(1);
}

// console/index.html previously carried these color vars in TWO :root blocks
// (a stale pre-retint base, unconditionally overridden by
// :root[data-theme="light"] per CSS specificity). The base duplicates were
// removed 2026-08-02 (CTO review finding #10, dead weight - see the retint
// commit and the removal commit) since this file has no second theme, so
// every var checked here now has exactly one definition, in the
// light-theme block.
const consoleHtml = fs.readFileSync(CONSOLE_FILE, 'utf8');

for (const [consoleVar, atriumVar] of Object.entries(ROLE_MAP)) {
  const consoleValue = extractVar(consoleHtml, consoleVar, 0);
  const atriumValue = extractVar(atriumCss, atriumVar, 0);
  if (atriumValue === null) {
    ok(consoleVar + ': Atrium source defines ' + atriumVar, false, 'not found in tokens.css, role map may be stale');
    continue;
  }
  if (consoleValue === null) {
    ok(consoleVar + ': present in console light theme', false, 'not found in :root[data-theme="light"]');
    continue;
  }
  ok(
    consoleVar + ' matches Atrium ' + atriumVar,
    consoleValue === atriumValue,
    consoleVar + '=' + consoleValue + ' vs Atrium ' + atriumVar + '=' + atriumValue,
  );
}

for (const [consoleVar, expected] of Object.entries(LITERAL_MAP)) {
  const consoleValue = extractVar(consoleHtml, consoleVar, 0);
  ok(
    consoleVar + ' matches its documented derived value',
    consoleValue === normalizeHex(expected),
    consoleVar + '=' + consoleValue + ' vs expected ' + normalizeHex(expected),
  );
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
