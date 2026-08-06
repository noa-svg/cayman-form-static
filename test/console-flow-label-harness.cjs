// Console FLOW-LABEL CONTRACT (2026-08-06).
//
// Born from Noa's direct complaint: the operator console captioned EVERY
// process's resume link "Onboarding link" - including increases and
// redemptions - and the drawer never named the flow at all. The fix derives
// the label from the registry flowType the server now sends on the
// ?api=opprocess drawer payload (field name onboardingLink itself is frozen
// client contract and unchanged).
//
// What this harness locks:
//   L1  flowLinkLabel: full mapping table, every known flowType + the
//       unknown/missing fallback. The fallback is "Form link" and must NEVER
//       be "Onboarding link" (defaulting to onboarding IS the original bug).
//   L2  flowHumanLabel (drawer Details "Flow" row): Join / Increase /
//       Redemption / Transfer; unknown values humanize instead of leaking a
//       raw machine string; missing renders empty (row suppressed).
//   L3  Operator vocabulary: "Redemption", never "withdrawal", anywhere in
//       the two label maps (standing rule; the tracker write is already
//       Redemption).
//   L4  Wiring: the drawer's Quick-links push and the board row copy-button
//       tooltip both go through flowLinkLabel; the Details block renders the
//       Flow row through flowHumanLabel; no hardcoded "label:'Onboarding
//       link'" literal survives anywhere in the file.
//   L5  Search compatibility: FLOW_WORD may say "redemption", but rowHay must
//       still carry the RAW flowType so an operator typing "withdrawal"
//       keeps matching (cayman_withdrawal contains the word).
//   L6  Server coupling, same shape as console-action-contract A1/A2: the
//       mono drawer payload builders (GAS CaymanOperatorApi.ts caymanOpProcess
//       AND ju-service routes/opprocess.ts) actually send flowType. The mono
//       repo being absent is a HARD FAIL, never a silent skip. Override the
//       mono location with LVP_MONO_ROOT for worktree runs.
//
// Run: node test/console-flow-label-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); } }

// ---- extract the real helpers (never a hand-written copy) ----
const mapsM = html.match(/var FLOW_LINK_LABEL=\{[^}]*\};\s*\n\s*var FLOW_HUMAN_LABEL=\{[^}]*\};\s*\n\s*function flowLinkLabel\(ft\)\{[^\n]*\}\s*\n\s*function flowHumanLabel\(ft\)\{[^\n]*\}/);
ok('extract: FLOW_LINK_LABEL + FLOW_HUMAN_LABEL + both helpers found as one block', !!mapsM);
if (!mapsM) { console.log(`console-flow-label: ${pass} passed, ${fail} FAILED`); process.exit(1); }

const humanKeySrc = (html.match(/function humanKey\(k\)\{[\s\S]*?\n  \}/) || [])[0];
ok('extract: humanKey (flowHumanLabel fallback dependency)', !!humanKeySrc);

const rig = new Function(humanKeySrc + ';' + mapsM[0] + '; return { flowLinkLabel: flowLinkLabel, flowHumanLabel: flowHumanLabel, FLOW_LINK_LABEL: FLOW_LINK_LABEL, FLOW_HUMAN_LABEL: FLOW_HUMAN_LABEL };')();

// ---- L1: link-label table ----
const LINK_EXPECT = {
  cayman_subscription: 'Onboarding link',
  cayman_increase: 'Increase link',
  cayman_withdrawal: 'Redemption link',
  cayman_transfer: 'Transfer link',
  israeli_increase: 'Increase link',
  israeli_withdrawal: 'Redemption link',
};
Object.keys(LINK_EXPECT).forEach((ft) => {
  ok('L1 flowLinkLabel(' + ft + ') = "' + LINK_EXPECT[ft] + '"', rig.flowLinkLabel(ft) === LINK_EXPECT[ft], rig.flowLinkLabel(ft));
});
ok('L1 unknown flowType -> "Form link" (never Onboarding)', rig.flowLinkLabel('cayman_w8_renewal') === 'Form link', rig.flowLinkLabel('cayman_w8_renewal'));
ok('L1 missing flowType ("") -> "Form link"', rig.flowLinkLabel('') === 'Form link');
ok('L1 undefined flowType -> "Form link"', rig.flowLinkLabel(undefined) === 'Form link');
ok('L1 null flowType -> "Form link"', rig.flowLinkLabel(null) === 'Form link');

// ---- L2: Details human-label table ----
const HUMAN_EXPECT = {
  cayman_subscription: 'Join',
  cayman_increase: 'Increase',
  cayman_withdrawal: 'Redemption',
  cayman_transfer: 'Transfer',
  israeli_increase: 'Increase',
  israeli_withdrawal: 'Redemption',
};
Object.keys(HUMAN_EXPECT).forEach((ft) => {
  ok('L2 flowHumanLabel(' + ft + ') = "' + HUMAN_EXPECT[ft] + '"', rig.flowHumanLabel(ft) === HUMAN_EXPECT[ft], rig.flowHumanLabel(ft));
});
ok('L2 unknown flowType humanizes (no raw machine string)', rig.flowHumanLabel('cayman_w8_renewal') === 'Cayman W8 Renewal', rig.flowHumanLabel('cayman_w8_renewal'));
ok('L2 missing flowType -> "" (Details row suppressed)', rig.flowHumanLabel('') === '' && rig.flowHumanLabel(undefined) === '');

// ---- L3: Redemption, never withdrawal, in the label maps ----
const allLabels = Object.values(rig.FLOW_LINK_LABEL).concat(Object.values(rig.FLOW_HUMAN_LABEL)).join(' ');
ok('L3 no "withdrawal" wording in any flow label', !/withdrawal/i.test(allLabels), allLabels);
// The drawer History map (FLOW_LABEL, lpHistory block) must agree - one drawer,
// one word for the same event.
const histMap = html.match(/var FLOW_LABEL=\{[^}]*\}/);
ok('L3 History FLOW_LABEL present', !!histMap);
if (histMap) ok('L3 History FLOW_LABEL says Redemption, not Withdrawal', !/Withdrawal/.test(histMap[0]) && /Redemption/.test(histMap[0]), histMap[0]);

// ---- L4: wiring, not just definitions ----
ok('L4 Quick-links label goes through flowLinkLabel(d.flowType)', html.indexOf("qlinks.push({label:flowLinkLabel(d.flowType),url:d.onboardingLink,copy:true})") !== -1);
ok('L4 no hardcoded label:\'Onboarding link\' literal anywhere', html.indexOf("label:'Onboarding link'") === -1);
ok('L4 row copy-button tooltip goes through flowLinkLabel(r.type)', /title="'\+esc2\('Copy '\+flowLinkLabel\(r\.type\)\.toLowerCase\(\)\)/.test(html));
ok('L4 no hardcoded "Copy onboarding link" tooltip left', html.indexOf('Copy onboarding link') === -1);
ok('L4 Details renders the Flow row through flowHumanLabel', /<span class="k">Flow<\/span><span class="v">'\+esc2\(flowHumanLabel\(d\.flowType\)\)/.test(html));
ok('L4 Details section gate includes d.flowType', html.indexOf('if(d.flowType||d.fields||d.createdAt||d.updatedAt){') !== -1);

// ---- L5: search still matches "withdrawal" via the raw flowType ----
ok('L5 rowHay carries the raw flowType (r.type)', /function rowHay\(r\)\{[\s\S]*?r\.typeLabel,r\.type,/.test(html));
ok('L5 raw flowType contains the word an operator would type', 'cayman_withdrawal'.indexOf('withdrawal') !== -1);

// ---- L6: server coupling (hard fail when mono is absent - vacuous = broken) ----
const MONO = process.env.LVP_MONO_ROOT || path.join(os.homedir(), 'Desktop', 'legacy-tools-mono');
const GAS_API = path.join(MONO, 'apps', 'ju-cayman', 'src', 'server', 'CaymanOperatorApi.ts');
const SVC_API = path.join(MONO, 'apps', 'ju-service', 'src', 'routes', 'opprocess.ts');
let gasSrc = '', svcSrc = '';
try { gasSrc = fs.readFileSync(GAS_API, 'utf8'); } catch (e) { gasSrc = ''; }
try { svcSrc = fs.readFileSync(SVC_API, 'utf8'); } catch (e) { svcSrc = ''; }
ok('L6 mono GAS CaymanOperatorApi.ts present (absent = vacuous contract, hard fail)', gasSrc.length > 0, GAS_API);
ok('L6 mono ju-service routes/opprocess.ts present (absent = vacuous contract, hard fail)', svcSrc.length > 0, SVC_API);
// The drawer payload builders SEND flowType (server must land before, or with,
// this client - a client without it degrades honestly to "Form link", but the
// gate refuses to certify a pair that would strand every link on the fallback).
ok('L6 GAS caymanOpProcess sends flowType', /flowType:\s*snap\.flowType\s*\|\|\s*''/.test(gasSrc));
ok('L6 ju-service opProcess sends flowType', /flowType:\s*snap\.flowType\s*\|\|\s*''/.test(svcSrc));
// And both still send the frozen-name onboardingLink (the field this whole
// label rides on; renaming it server-side would silently kill the link).
ok('L6 GAS still sends onboardingLink (frozen field name)', gasSrc.indexOf('out.onboardingLink') !== -1);
ok('L6 ju-service still sends onboardingLink (frozen field name)', svcSrc.indexOf('out.onboardingLink') !== -1);

console.log(`console-flow-label: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
