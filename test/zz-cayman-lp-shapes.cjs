// zz-cayman-lp-shapes.cjs (2026-09-09)
//
// THE CLASS THIS LOCKS: a server-declared field an LP can never fill in, and a
// field the LP fills in that never leaves the browser.
//
// signer.html has TWO independent drop points between what
// apps/ju-service/src/routes/signerform.ts declares and what reaches the
// server, and the attester leg was found holed at BOTH of them on 2026-09-08:
//   1. RENDER. Each field is drawn from the client-side `fieldDefs` table
//      (signer.html:1261-1349). A server field with no def renders as
//      .field--unsupported and doSignSubmit_ hard-blocks the submit
//      (signer.html:2291-2295) - the signer cannot get through the page at all.
//   2. PAYLOAD. A field can render fine and still never reach the server if
//      the submit builder does not read it.
// zz-cayman-lawyer-fields.cjs locks those two points for the ATTESTER leg.
// This file does the same for the four LP-FACING Cayman shapes, which had no
// equivalent guard: a joint individual co-holder (subscriber2 and subscriber3),
// an entity's second authorized signatory (subscriber2, entity applicant), and
// each controlling person (cp1..cp4).
//
// The field sets below are copied VERBATIM from buildEditableFields in
// apps/ju-service/src/routes/signerform.ts:224-282 (agent/lp-leg-parity-svc,
// main aaade18e). If that function changes and this file is not updated, the
// "no unsupported field" assertions here go red on the next real set, which is
// the point.
//
// The Cayman lane is ENGLISH-ONLY, so every shape also asserts no Hebrew
// codepoint reaches the editable pane. One Hebrew leak was fixed in the
// attester fieldDefs on 2026-09-08; nothing was watching the LP legs.
//
// NO MAILBOX, NO REAL LP. Every name here is invented and every submit lands
// in the rig's XHR stub, never on a network.
//
// Run: node test/zz-cayman-lp-shapes.cjs
'use strict';
const { loadSignerPage, makeSignerCtx } = require('./rig-signer.cjs');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + String(extra).slice(0, 300))); }
}

// signerform.ts:231-239 (role subscriber2 / subscriber3, individual applicant)
const JOINT_INDIVIDUAL = [
  'firstName', 'lastName', 'email', 'phone', 'idNumber', 'idType', 'dateOfBirth',
  'nationality', 'address', 'city', 'country', 'postalCode', 'taxResidency', 'taxId',
  'fatcaStatus', 'qualification', 'bankName', 'bankBranch', 'bankAccount', 'bankSwift', 'beneficiaries',
];
// signerform.ts:225-230 (role subscriber2, ENTITY applicant)
const ENTITY_SECOND_AUTHORIZED = [
  'firstName', 'lastName', 'title', 'email', 'phone', 'idNumber', 'idType',
  'dateOfBirth', 'nationality', 'address', 'city', 'country', 'postalCode',
];
// signerform.ts:241-245 (roles cp1..cp4)
const CONTROLLING_PERSON = [
  'firstName', 'lastName', 'email', 'phone', 'idNumber', 'idType', 'dateOfBirth',
  'nationality', 'address', 'city', 'country', 'postalCode', 'taxResidency', 'taxId',
  'controlType', 'ownershipPercentage',
];

const HEBREW = /[֐-׿]/;
// A checksum-valid Israeli teudat zehut, invented. signer.html:2086-2091 runs
// LVPRules.validId over idNumber whenever idType is 'National ID', so a fixture
// that fails the checksum would block the submit for the wrong reason and this
// harness would report a lockout that does not exist.
const VALID_ID = '123456782';

function bootCtx(role, fields, locked) {
  return makeSignerCtx({
    lane: 'cayman',
    role: role,
    signerName: 'Rivka Tannenbaum',
    lockedContext: locked || {},
    docs: [{ key: 'subscription', title: 'Subscription agreement', html: '<p>Agreement body</p>' }],
    editableFields: { type: 'x', fields: fields },
  });
}

function unsupported(rig) {
  return Array.from(rig.document.querySelectorAll('#signer-form .field--unsupported'))
    .map((e) => (e.textContent || '').trim().slice(0, 40));
}
function el(rig, name) { return rig.document.querySelector('#signer-form [name="' + name + '"]'); }

// Fill every rendered control with something the page's own validators accept.
function fillAll(rig, fields) {
  fields.forEach(function (f) {
    const e = el(rig, f);
    if (!e) return;
    if (e.type === 'checkbox') { e.checked = true; }
    else if (e.tagName === 'SELECT') { e.value = e.options[1] ? e.options[1].value : ''; }
    else if (e.type === 'date') { e.value = '1980-01-01'; }
    else if (e.type === 'email') { e.value = 'holder@example.invalid'; }
    else if (e.type === 'tel') { e.value = '+972500000000'; }
    else if (f === 'idNumber') { e.value = VALID_ID; }
    else if (f === 'ownershipPercentage') { e.value = '25'; }
    else { e.value = 'Value'; }
    e.dispatchEvent(new rig.window.Event('input', { bubbles: true }));
    e.dispatchEvent(new rig.window.Event('change', { bubbles: true }));
  });
}

// Every one of these roles renders the identification section
// (signer.html:1019, isControllingPersonRole matches cp* AND subscriber2/3) and
// doSignSubmit_ refuses to submit without a passport or national-ID front
// (:2427). Attach one the way the picker would.
async function attachId(rig) {
  const inp = rig.document.querySelector('#id-uploads input[type=file]');
  if (!inp) return false;
  const f = new rig.window.File([new Uint8Array([1, 2, 3, 4])], 'id.png', { type: 'image/png' });
  Object.defineProperty(inp, 'files', { value: [f], configurable: true });
  inp.dispatchEvent(new rig.window.Event('change', { bubbles: true }));
  await rig.settle(250);
  return true;
}

async function walkShape(label, role, fields, locked) {
  const p = label + ' ';

  // --- render -------------------------------------------------------------
  const rig = await loadSignerPage({ ctx: bootCtx(role, fields, locked) });
  ok(p + 'boots with no page error', rig.errors.length === 0, rig.errors[0]);
  const un = unsupported(rig);
  ok(p + 'every server-declared field has a client renderer', un.length === 0, JSON.stringify(un));
  const missing = fields.filter(function (f) { return !el(rig, f); });
  ok(p + 'all ' + fields.length + ' declared fields render a named control', missing.length === 0, JSON.stringify(missing));

  // --- English-only lane --------------------------------------------------
  const pane = rig.document.querySelector('#signer-form');
  const paneText = pane ? pane.textContent : '';
  ok(p + 'the pane carries no Hebrew (Cayman lane is English-only)', !HEBREW.test(paneText),
    (paneText.match(/[֐-׿][^\n]{0,50}/) || [''])[0]);

  // --- validation refuses an empty form -----------------------------------
  await rig.signTyped('Rivka Tannenbaum');
  await attachId(rig);
  rig.click('#done'); await rig.settle(400);
  ok(p + 'an empty required set is refused, no POST leaves the page', rig.posts().length === 0,
    'posts=' + rig.posts().length);
  ok(p + 'the refusal names the problem', /required/i.test(rig.q('#err').textContent),
    rig.q('#err').textContent);

  // --- validation lets a complete form through ----------------------------
  fillAll(rig, fields);
  rig.click('#done'); await rig.settle(900);
  const posts = rig.posts();
  ok(p + 'a complete form actually submits', posts.length === 1,
    'err="' + rig.q('#err').textContent + '" unsupported=' + JSON.stringify(unsupported(rig)));
  if (posts.length !== 1) return;

  // --- payload ------------------------------------------------------------
  const body = JSON.parse(posts[0].body);
  ok(p + 'the POST is a record_signature on the cayman lane',
    body.action === 'record_signature' && body.lane === 'cayman', JSON.stringify({ a: body.action, l: body.lane }));
  const sfd = (body.payload && body.payload.signerFormData) || {};
  const dropped = fields.filter(function (f) { return !(f in sfd); });
  ok(p + 'all ' + fields.length + ' rendered fields reach signerFormData', dropped.length === 0, JSON.stringify(dropped));
  const nonEmpty = fields.filter(function (f) { return String(sfd[f] || '').trim() !== ''; });
  ok(p + 'every field carries the typed VALUE, not just the key', nonEmpty.length === fields.length,
    JSON.stringify(fields.filter(function (f) { return String(sfd[f] || '').trim() === ''; })));
  // payload.lawyer is the attester leg's object and must never appear on an LP leg.
  ok(p + 'no attester payload leaks onto an LP leg', !body.payload.lawyer, JSON.stringify(Object.keys(body.payload)));
}

(async function () {
  await walkShape('J2', 'subscriber2', JOINT_INDIVIDUAL);
  await walkShape('J3', 'subscriber3', JOINT_INDIVIDUAL);
  await walkShape('E2', 'subscriber2', ENTITY_SECOND_AUTHORIZED, { companyName: 'Northgate Trading Ltd' });
  await walkShape('C1', 'cp1', CONTROLLING_PERSON, { companyName: 'Northgate Trading Ltd' });
  await walkShape('C2', 'cp2', CONTROLLING_PERSON, { companyName: 'Northgate Trading Ltd' });
  await walkShape('C3', 'cp3', CONTROLLING_PERSON, { companyName: 'Northgate Trading Ltd' });
  await walkShape('C4', 'cp4', CONTROLLING_PERSON, { companyName: 'Northgate Trading Ltd' });

  // ---- the ID-number format rule bites where it should, and only there ----
  // signer.html:2086-2091 gates the Israeli checksum on idType === 'National
  // ID'. idNumber is a SHARED field that also carries passport and company
  // registration numbers, so an unguarded checksum would refuse a passport
  // holder outright. Both directions are asserted: a bad national ID is
  // refused, and the same string as a passport number is let through.
  {
    const rig = await loadSignerPage({ ctx: bootCtx('cp1', CONTROLLING_PERSON, { companyName: 'Northgate Trading Ltd' }) });
    fillAll(rig, CONTROLLING_PERSON);
    const idT = el(rig, 'idType'); const idN = el(rig, 'idNumber');
    idT.value = 'National ID'; idT.dispatchEvent(new rig.window.Event('change', { bubbles: true }));
    idN.value = '111111111'; idN.dispatchEvent(new rig.window.Event('input', { bubbles: true }));
    await rig.signTyped('Rivka Tannenbaum');
    await attachId(rig);
    rig.click('#done'); await rig.settle(500);
    ok('ID1 a checksum-invalid National ID is refused', rig.posts().length === 0, 'posts=' + rig.posts().length);

    idT.value = 'Passport'; idT.dispatchEvent(new rig.window.Event('change', { bubbles: true }));
    idN.value = 'X1234567'; idN.dispatchEvent(new rig.window.Event('input', { bubbles: true }));
    rig.click('#done'); await rig.settle(900);
    ok('ID2 the same string as a PASSPORT number is accepted', rig.posts().length === 1,
      'err="' + rig.q('#err').textContent + '"');
  }

  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  if (fail) process.exit(1);
})().catch(function (e) { console.error('THREW', e); process.exit(2); });
