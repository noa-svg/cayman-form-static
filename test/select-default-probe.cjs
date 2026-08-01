// select-default-probe.cjs (2026-08-02, CTO review finding #12 - converted
// from an exploratory console.log probe to real pass/fail assertions).
//
// Claim: no REQUIRED <select> on index.html defaults to a non-empty value.
// A required select with a pre-picked default would silently pass
// validation without the LP ever having made an active choice - the classic
// "accidentally correct by default" bug class for a required dropdown
// (e.g. a nationality/country/FATCA-status select defaulting to its first
// option). Checked for both applicant types since the entity/individual
// branches render different required-select sets.
//
// Run: node test/select-default-probe.cjs
'use strict';
const { loadForm } = require('./rig.cjs');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }

// Noa-approved exception (2026-08-02): investment.currency intentionally
// defaults to ILS (its first-listed <option>, index.html:921) rather than
// forcing an active choice like every other required select. Every OTHER
// required select must still default empty; this is the one named,
// deliberate exception, not a silent allowlist-everything escape hatch.
const ALLOWED_NON_EMPTY_DEFAULTS = new Set(['investment.currency']);

(async () => {
  for (const at of ['individual', 'entity']) {
    const pf = at === 'entity'
      ? { __testUploads: ['certificateOfIncorporation'], entity: { type: 'Corporation' }, _pad: '1' }
      : { __testUploads: ['passportPrimary'], _pad: '1' };
    const { document } = await loadForm({ cfg: { applicantType: at, prefill: pf } });

    const requiredHolders = document.querySelectorAll('[data-required]');
    ok(at + ': at least one required field exists (fixture sanity)', requiredHolders.length > 0);

    const flagged = [];
    let selectCount = 0;
    requiredHolders.forEach((h) => {
      h.querySelectorAll('select').forEach((s) => {
        selectCount++;
        const v = (s.value || '').trim();
        if (v && !ALLOWED_NON_EMPTY_DEFAULTS.has(s.name)) flagged.push({ name: s.name || '(noname)', value: v });
      });
    });
    ok(at + ': at least one required <select> exists to check (fixture sanity)', selectCount > 0);
    ok(
      at + ': no unexpected required select defaults to a non-empty value (' + selectCount + ' checked, '
        + ALLOWED_NON_EMPTY_DEFAULTS.size + ' allowlisted exception(s))',
      flagged.length === 0,
      flagged
    );
  }
  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e); process.exit(1); });
