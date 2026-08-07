# cayman-form-static

Legacy Value Partners' LP-facing onboarding/signing static site: plain HTML/CSS/JS,
no framework, no build step, no npm dependencies. Domain: **sign.legacyvpartners.com**
(see `CNAME`). Deployed via GitHub Pages directly off this repo's `main` branch.

This is Project Ju's static front end. The actual business logic (validation rules
mirrored client-side here, submission processing, PDF sealing, tracker writes) lives
server-side in `ju-cayman` (`~/Desktop/legacy-tools/ju-cayman/`, GAS). Read that repo's
own `CLAUDE.md` for the server side. This file only covers the static site.

## A push to `main` IS a production deploy (but the build is ASYNC and can fail)

`git push origin main` publishes to the live LP-signing domain via GitHub
Pages. The pre-push hook gates the code, but the Pages build runs AFTER the
push and can fail or hang silently: on 2026-08-06 it failed twice on abe4dec
then sat "building" ~20 hours, so the live domain served Thursday-afternoon
code while every push read green (Shimon's flow.html link went out mid-outage).
A push is NOT deployed until the live domain serves the pushed `__BUILD_TAG`s.
`.github/workflows/verify-pages.yml` now checks exactly that after every push
and goes red (emailing the pusher) if Pages is stale after 10 minutes; a stuck
build is fixed by requesting a fresh one:
`gh api -X POST repos/{owner}/{repo}/pages/builds`.

## Deploy gate (read before your first push in a fresh clone)

`githooks/pre-push` runs the full test suite before every push and refuses to
push if anything fails (`git push --no-verify` bypasses it, emergencies
only). It is tracked here (not just in the untracked `.git/hooks/`), so wire
it up once per clone:

```bash
git config core.hooksPath githooks
```

Most of `test/*.cjs` is deliberately gitignored (`test/*` with individual
files un-ignored by name in `.gitignore`) so the bulk of the test rig never
ships to the LP-facing domain. This means the gitignore allowlist is a real
footgun: a new test file that is not explicitly un-ignored will run fine
locally but silently vanish on `git clone`, and if `githooks/pre-push`
references it, the deploy gate itself breaks on a fresh clone (this exact bug
hit `test/rig.cjs` and 9 other files, fixed 2026-08-02). When you add a new
test file that should ship, add a matching `!test/<name>.cjs` line to
`.gitignore` in the same commit.

## File map

- `index.html`. Cayman onboarding form (English, LTR). The multi-page
  adaptive process: page 1 branches individual vs entity, later pages show
  only applicable sections. `entity.type` is hardcoded to `Corporation` only
  (the fund accepts Israeli corporations; trusts/partnerships/LLCs are
  off-scope, see `index.html:704`). Do not assume the old 4-type branching
  some historical test fixtures still reference.
- `israel.html`. Israeli (domestic) onboarding form. Hebrew is the source
  language (RTL); the EN toggle is a translation overlay.
- `flow.html`. Israeli-lane Increase/Withdrawal form.
- `signer.html`. The per-signer signature page for both lanes (controlling
  persons, lawyers, co-holders). `LANE` (from the server response) gates
  language: Hebrew only on `lane=israeli`, English on `lane=cayman`/unknown.
- `sign.html`. A thin redirect stub for ancient emailed links that predate
  `signer.html`. Forwards `?t=` and hash, no signing logic. Do not add logic
  here.
- `console/index.html`. The operator console (internal, Google-SSO gated).
  Single large file (~6000+ lines). Carries its own `:root`/`:root[data-theme="light"]`
  CSS tokens (colors are defined once, in the light-theme block. This file
  bakes `data-theme="light"` statically with no toggle, see `console/index.html:1`).
- `lvp-gateway.js`. Shared `/exec` POST transport (fetch + timeout + envelope
  check + timeout-only retry) loaded by index.html/israel.html/flow.html.
  signer.html and console/index.html do not load it (each keeps its own
  minimal XHR-based submit path). See the gateway-URL note below before
  changing that.
- `validation-rules.js`. The Israeli-lane FORMAT rules (ID checksum, phone,
  SSN, company number, dates), a verbatim client port of the server validator
  (`ju-cayman/IsraeliValidation.js`), loaded by israel.html/flow.html and now
  signer.html (for the National-ID-only checksum branch).
- `doc-sanitize.js`. Shared doc-preview sanitizer (strips
  script/iframe/object/embed, `on*` handlers, `javascript:`/`data:text/html`
  URLs) loaded by index.html/israel.html/signer.html before rendering any
  server-returned document HTML.
- `bank-registry.json`. Bank/branch lookup data used by the form's bank
  fields.
- `test/*.cjs`. jsdom-based node test suite. `rig.cjs`/`rig-israel.cjs` boot
  the REAL index.html/israel.html in a virtual DOM (inlining `<script src>`
  dependencies, since jsdom's `runScripts:'dangerously'` does not fetch
  external scripts) so tests exercise production code, not hand-written
  copies. Most other harnesses extract real functions from the live HTML via
  brace-counting (`extractFn`) and drive them directly. Prefer that pattern
  over reimplementing logic by hand when adding a new test.

## The gateway URL is duplicated 5 times

The same `/exec` deployment URL is hardcoded independently in index.html,
israel.html, flow.html, signer.html, and console/index.html. Not
single-sourced, deliberately left as-is (see the 2026-08-02 CTO-review pass:
consolidating it would mean wiring `lvp-gateway.js` into signer.html and
console/index.html, both of which currently load no shared script, and a
wiring mistake there breaks the gateway bootstrap fleet-wide). The
duplication is drift-protected: `test/coupling-check.cjs`'s C1 check asserts
all 5 copies agree, so a missed update on a deployment-ID rotation fails the
deploy gate rather than silently shipping a broken form.

## Gotchas

- `?mock=inc-ind|inc-ent|red-ind|red-ent` on flow.html bypasses the real
  config fetch with a fixed stub (`stubConfigForMock`) for local render
  verification. The fake PII in that stub (`123456782` etc) is the same
  deliberate, checksum-valid synthetic ID the test suite uses everywhere.
  Not a leftover, not real.
- `investment.currency` on index.html defaults to ILS (its first-listed
  `<option>`, no explicit default) unlike every other required field on the
  form, which defaults empty to force an active choice. Confirmed
  intentional with Noa 2026-08-02. `test/select-default-probe.cjs`
  allowlists it by name so the "no required select defaults non-empty"
  check still catches any other field regressing the same way.
- Submit DOES re-validate client-side, even for a field tampered with
  directly via the DOM. A stale test assumption (fixed 2026-08-02) claimed
  the opposite. Verified against the live `doSubmit()`/`doSubmitNow_()` flow
  in index.html.
- Shared local checkout. If more than one Claude Code session is working in
  `~/Desktop/legacy-tools/cayman-form-static/` at once, they share the same
  `.git`. A commit made by one session appears directly in the other's `git
  log`, and two concurrent pushes can race (usually resolves cleanly if both
  intend the same end state; run `git fetch` and compare `git log` before
  assuming a push failure means something was lost).
