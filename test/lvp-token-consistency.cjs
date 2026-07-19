// LP-facing brand-token consistency check (2026-07-20).
// The exact bug this exists to catch: signer.html carried its own local
// :root with an unprefixed --line:#C2C2C2 that silently diverged from
// index.html/israel.html's --lvp-input-line:#8E8E8E for the same visual
// role (input-field border), on the same live domain, same day of use.
// Fixed by hand 2026-07-19; this harness is what stops it recurring
// unnoticed, the same way check-atelier-drift.mjs guards the GAS operator
// fleet. Every file here defines its own :root by hand (no shared include
// possible on a plain static site with no build step), so brand-color
// names differ per file (--lvp-navy vs --navy) even where the ROLE is
// identical -- ROLE_GROUPS below declares the known equivalences and
// asserts every file that defines a token in the group agrees on the value.
// Run: node test/lvp-token-consistency.cjs
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = ['index.html', 'israel.html', 'flow.html', 'signer.html'];

// role -> [ {file, varName} ] the token is known to appear under in each file.
// Add a new file/varName pair here whenever a new LP-facing page defines its
// own :root, so it gets pulled into the same check.
const ROLE_GROUPS = {
  navy: [
    ['index.html', '--lvp-navy'], ['israel.html', '--lvp-navy'], ['flow.html', '--lvp-navy'],
    ['signer.html', '--navy'],
  ],
  yellow_gold: [
    ['index.html', '--lvp-yellow'], ['israel.html', '--lvp-yellow'], ['flow.html', '--lvp-yellow'],
    ['signer.html', '--gold'],
  ],
  input_line: [
    ['index.html', '--lvp-input-line'], ['israel.html', '--lvp-input-line'], ['flow.html', '--lvp-input-line'],
    ['signer.html', '--line'],
  ],
  text: [
    ['index.html', '--lvp-text'], ['israel.html', '--lvp-text'], ['flow.html', '--lvp-text'],
    ['signer.html', '--text'],
  ],
  text_muted: [
    ['index.html', '--lvp-text-muted'], ['israel.html', '--lvp-text-muted'], ['flow.html', '--lvp-text-muted'],
    ['signer.html', '--muted'],
  ],
  error: [
    ['index.html', '--lvp-error'], ['israel.html', '--lvp-error'], ['flow.html', '--lvp-error'],
    ['signer.html', '--error'],
  ],
  card_bg: [
    ['index.html', '--lvp-card-bg'], ['israel.html', '--lvp-card-bg'], ['flow.html', '--lvp-card-bg'],
    ['signer.html', '--card-bg'],
  ],
};

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}

const html = {};
for (const f of FILES) html[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

// #FFF and #FFFFFF are the same color, not drift -- normalize 3-digit hex
// shorthand to 6-digit before comparing values.
function normalizeHex(value) {
  const m = value.match(/^#([0-9A-Fa-f]{3})$/);
  if (!m) return value;
  const [r, g, b] = m[1].split('');
  return '#' + r + r + g + g + b + b;
}

function extractValue(fileText, varName) {
  // Matches `--name: #hex;` or `--name:#hex;`, first occurrence only (each
  // file's own :root is defined once, no per-theme override on this site).
  const re = new RegExp(varName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*:\\s*([^;]+);');
  const m = fileText.match(re);
  return m ? normalizeHex(m[1].trim().toUpperCase()) : null;
}

for (const [role, entries] of Object.entries(ROLE_GROUPS)) {
  const found = entries
    .map(([file, varName]) => ({ file, varName, value: extractValue(html[file], varName) }))
    .filter((e) => e.value !== null);
  if (found.length === 0) {
    ok(role + ': at least one file defines it', false, 'none of ' + JSON.stringify(entries) + ' matched');
    continue;
  }
  const distinct = new Set(found.map((e) => e.value));
  ok(
    role + ': all ' + found.length + ' defining file(s) agree on the value',
    distinct.size === 1,
    JSON.stringify(found.map((e) => e.file + ' ' + e.varName + '=' + e.value)),
  );
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
