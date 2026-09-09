// zz-cayman-lawyer-fields.cjs - drives signer.html with the EXACT editableFields
// sets ju-service/src/routes/signerform.ts:247-279 (origin/main 54317d35) returns
// for a Cayman-lane lawyer, individual and entity.
'use strict';
const { loadSignerPage, makeSignerCtx } = require('./rig-signer.cjs');
let pass = 0, fail = 0;
function ok(l, c, x) { if (c) { pass++; console.log('ok   ' + l); } else { fail++; console.log('FAIL ' + l + (x === undefined ? '' : ' :: ' + x)); } }

const CAY_IND = ['firstName','lastName','licenseNumber','firmName','email','phone','attestationConfirmed','verifiedOn','checkLiquid','evidenceDate','checkIncome','checkOther','otherEvidence'];
const CAY_ENT = ['firstName','lastName','licenseNumber','firmName','email','phone','attestationConfirmed','verifiedOn','checkAuditedFinancials','auditedFinancialsDate','checkShareholders','checkOther','otherEvidence'];
const IL_SET  = ['firstName','lastName','licenseNumber','email','phone','checkLiquid','checkIncome','checkOther','evidenceDate','otherEvidence'];

async function boot(fields, locked) {
  return loadSignerPage({ ctx: makeSignerCtx({
    lane: 'cayman', role: 'lawyer',
    docs: [{ key: 'schedule2_lawyer', title: 'Schedule 2 - Qualification', html: '<p>Qualification body</p>' }],
    lockedContext: locked || {},
    editableFields: { type: 'lawyer_attestation', fields: fields }
  })});
}
async function attach(rig, sel, name, type) {
  const inp = rig.q(sel);
  const f = new rig.window.File([new Uint8Array([1,2,3,4])], name, { type: type });
  Object.defineProperty(inp, 'files', { value: [f], configurable: true });
  inp.dispatchEvent(new rig.window.Event('change', { bubbles: true }));
  await rig.settle(220);
}
function unsupported(rig) {
  return Array.from(rig.document.querySelectorAll('#signer-form .field--unsupported'))
    .map(e => (e.getAttribute('data-field') || e.textContent || '').trim());
}
function has(rig, name) { return !!rig.document.querySelector('#signer-form [name="' + name + '"]'); }

(async () => {
  // ---- Cayman individual attester -----------------------------------------
  {
    const rig = await boot(CAY_IND);
    ok('CI0 boots clean', rig.errors.length === 0, rig.errors[0]);
    const un = unsupported(rig);
    ok('CI1 every server field has a client renderer', un.length === 0, JSON.stringify(un));
    ok('CI2 verifiedOn rendered', has(rig, 'verifiedOn'));
    // fill everything that DID render, sign, stamp, submit
    ['firstName','lastName','licenseNumber','firmName','email','phone','evidenceDate','otherEvidence','verifiedOn']
      .forEach(n => { const el = rig.document.querySelector('#signer-form [name="'+n+'"]'); if (el) { el.value = (n==='email')?'a@example.invalid':(n==='evidenceDate'||n==='verifiedOn')?'2026-09-01':'X'; el.dispatchEvent(new rig.window.Event('input',{bubbles:true})); } });
    ['attestationConfirmed','checkIncome'].forEach(n => { const el = rig.document.querySelector('#signer-form [name="'+n+'"]'); if (el) { el.checked = true; el.dispatchEvent(new rig.window.Event('change',{bubbles:true})); } });
    await rig.signTyped('Ada Attester');
    await attach(rig, '#stamp-lawyer_stamp', 'stamp.png', 'image/png');
    rig.click('#done'); await rig.settle(800);
    ok('CI3 a Cayman individual attester can actually submit', rig.posts().length === 1,
       'err="' + rig.q('#err').textContent + '" unsupported=' + JSON.stringify(unsupported(rig)));
    if (rig.posts().length === 1) {
      const pl = JSON.parse(rig.posts()[0].body).payload;
      ok('CI4 payload.lawyer carries verifiedOn', !!(pl.lawyer && pl.lawyer.verifiedOn), JSON.stringify(pl.lawyer));
      ok('CI5 payload.lawyer carries firmName', !!(pl.lawyer && pl.lawyer.firmName), JSON.stringify(pl.lawyer && Object.keys(pl.lawyer)));
      ok('CI6 payload.lawyer carries attestationConfirmed', pl.lawyer && 'attestationConfirmed' in pl.lawyer, JSON.stringify(pl.lawyer && Object.keys(pl.lawyer)));
    }
  }

  // ---- Cayman ENTITY attester ---------------------------------------------
  {
    const rig = await boot(CAY_ENT, { companyName: 'Test Holdings Ltd' });
    ok('CE0 boots clean', rig.errors.length === 0, rig.errors[0]);
    const un = unsupported(rig);
    ok('CE1 every server field has a client renderer', un.length === 0, JSON.stringify(un));
    ok('CE2 checkAuditedFinancials rendered', has(rig, 'checkAuditedFinancials'));
    ok('CE3 checkShareholders rendered', has(rig, 'checkShareholders'));
    ['firstName','lastName','licenseNumber','firmName','email','phone','auditedFinancialsDate','otherEvidence','verifiedOn']
      .forEach(n => { const el = rig.document.querySelector('#signer-form [name="'+n+'"]'); if (el) { el.value = (n==='email')?'a@example.invalid':(/Date|verifiedOn/.test(n))?'2026-09-01':'X'; el.dispatchEvent(new rig.window.Event('input',{bubbles:true})); } });
    ['attestationConfirmed','checkAuditedFinancials'].forEach(n => { const el = rig.document.querySelector('#signer-form [name="'+n+'"]'); if (el) { el.checked = true; el.dispatchEvent(new rig.window.Event('change',{bubbles:true})); } });
    await rig.signTyped('Ada Attester');
    await attach(rig, '#stamp-lawyer_stamp', 'stamp.png', 'image/png');
    rig.click('#done'); await rig.settle(800);
    ok('CE4 a Cayman entity attester can actually submit', rig.posts().length === 1,
       'err="' + rig.q('#err').textContent + '" unsupported=' + JSON.stringify(unsupported(rig)));
    if (rig.posts().length === 1) {
      const pl = JSON.parse(rig.posts()[0].body).payload;
      ok('CE5 payload.lawyer built for the entity attester', !!pl.lawyer, JSON.stringify(Object.keys(pl)));
      ok('CE6 the corporate evidence boxes reach payload.lawyer',
         !!(pl.lawyer && 'checkAuditedFinancials' in pl.lawyer), JSON.stringify(pl.lawyer && Object.keys(pl.lawyer)));
      ok('CE7 signerFormData at least carries them as strings',
         pl.signerFormData && pl.signerFormData.checkAuditedFinancials === 'true', JSON.stringify(pl.signerFormData));
    }
  }

  // ---- Israeli lawyer set on signer.html, for contrast ---------------------
  {
    const rig = await loadSignerPage({ ctx: makeSignerCtx({
      lane: 'israeli', role: 'lawyer',
      docs: [{ key: 'q', title: 'Q', html: '<p>b</p>' }],
      editableFields: { fields: IL_SET }
    })});
    ok('IL1 the Israeli lawyer set renders with no unsupported field', unsupported(rig).length === 0, JSON.stringify(unsupported(rig)));
  }

  console.log('\n' + pass + ' pass, ' + fail + ' fail');
})().catch(e => { console.error('THREW', e); process.exit(2); });
