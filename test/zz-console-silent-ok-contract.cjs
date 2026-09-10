// zz-console-silent-ok-contract.cjs - THE SILENT-OK CLASS, both halves.
//
// The class: a route answers ok:true and says in a SUB-FIELD that it did
// nothing, or that part of it failed. apiFetch throws on any {ok:false}
// (console/index.html, 2026-07-17), so the console is well defended against a
// refusal and was, until 2026-09-10, blind to a no-op. 32 of its 33 action
// call sites branched on `ok` alone; companyStamp was the one exception.
//
// PREVENT (S1-S5): drive the REAL actionOutcome()/SILENT_OK_FIELDS out of
// console/index.html and assert it names each no-op field, and that the shared
// RECOVERY_ACTIONS send() funnel routes every action through it.
//
// DETECT (S6-S7): read the mono routes the console calls FROM origin/main
// (lib-mono-source.cjs - never a working tree, see its header) and fail when a
// result field that looks like a "did nothing / partly failed" signal is not
// declared in SILENT_OK_FIELDS. A route that grows a new one cannot be ignored
// by default: it is either a table entry or a deliberate, reasoned line in
// NOT_A_SIGNAL below.
//
// Run: node test/zz-console-silent-ok-contract.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { monoSource } = require('./lib-mono-source.cjs');

let pass = 0, fail = 0;
function ok(l, c, x) { if (c) { pass++; console.log('ok   ' + l); } else { fail++; console.log('FAIL ' + l + (x === undefined ? '' : ' :: ' + String(x).slice(0, 300))); } }

const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');

// ---------------------------------------------------------------- PREVENT
// Extract the SHIPPED table and function, so these assertions are about the
// file that deploys and cannot drift from a copy kept here.
const START = 'var SILENT_OK_FIELDS=[';
const END_MARK = "return o.clean?'':(' Server also reported: '+o.notes.join('; ')+'.');\n  }";
const s0 = html.indexOf(START);
ok('S1 console/index.html declares SILENT_OK_FIELDS', s0 > 0);
const s1 = html.indexOf(END_MARK, s0);
ok('S2 and actionOutcomeText closes the block', s1 > s0);
if (s1 < 0) { console.log('\n' + pass + ' pass, ' + fail + ' fail'); process.exit(1); }
const body = html.slice(s0, s1 + END_MARK.length);

// eslint-disable-next-line no-new-func
const mod = new Function(body + '\nreturn {SILENT_OK_FIELDS:SILENT_OK_FIELDS,actionOutcome:actionOutcome,actionOutcomeText:actionOutcomeText};')();
const actionOutcome = mod.actionOutcome;
const actionOutcomeText = mod.actionOutcomeText;
const DECLARED = mod.SILENT_OK_FIELDS.map((f) => f.field);

// S3: a clean answer stays clean. A guard that fires on everything is not a
// guard, it is a broken status line.
ok('S3 a plain ok result carries no notes', actionOutcome({ ok: true, processId: 'p1' }).clean === true);
ok('S3b and renders as nothing at all', actionOutcomeText({ ok: true, processId: 'p1' }) === '');
ok('S3c a null result is clean, never a throw', actionOutcome(null).clean === true);
ok('S3d a real GO wire letter is clean', actionOutcome({ ok: true, go: true, docUrl: 'u', settled: [{ masterRid: 'r1', ok: true }] }).clean === true);

// S4: THE SEVEN. Each defect, driven through the real table.
const CASES = [
  ['S4a re-pause names the reason the server KEPT, not the one just typed',
    { ok: true, alreadyPaused: true, pausedAt: '2026-07-02T09:00:00Z', reason: 'asked for time until the audit closes' },
    ['asked for time until the audit closes', '2026-07-02']],
  ['S4b a replayed paper qualification says the upload was not applied',
    { ok: true, replay: true, signerXofY: '2 of 3' }, ['replay', '2 of 3']],
  ['S4c reassign surfaces a stale sealed-doc identity',
    { ok: true, snapshotSynced: false, snapshotSyncError: 'no docRef.submissionSnapshot on this record' },
    ['snapshotSyncError', 'no docRef.submissionSnapshot']],
  ['S4d reassign surfaces an unrevoked SIGN link',
    { ok: true, signerLinkRevoked: false, signerLinkRevokeError: 'token store write failed' },
    ['signerLinkRevokeError', 'token store write failed']],
  ['S4e park names the settled row it refused, with tab and row',
    { ok: true, refusedSettled: [{ tab: '08/2026', row: 10, execStatus: 'Paid to client' }] },
    ['08/2026', '10', 'Paid to client']],
  ['S4f park says when NOTHING was written', { ok: true, alreadyParkedAll: true, alreadyParked: [{ tab: '08/2026', row: 3 }], parked: [] }, ['alreadyParkedAll']],
  ['S4f2 a PARTIAL park names the legs that were already parked',
    { ok: true, alreadyParkedAll: false, parked: [{ tab: '08/2026', row: 3 }], alreadyParked: [{ tab: '07/2026', row: 9 }] },
    ['alreadyParked', '07/2026', '9']],
  ['S4g the peek names every row the gate refused',
    { ok: true, refused: [{ rowNum: 14, name: 'Row Fourteen', reason: 'AMOUNT cell unreadable', cell: 'F14' }] },
    ['14', 'AMOUNT cell unreadable']],
  ['S4h a no-op month move reports the server note, not a move',
    { ok: true, unchanged: true, note: 'already correct; no write issued' },
    ['already correct; no write issued']],
  ['S4i a per-row settle failure is named by masterRid and server detail',
    { ok: true, settled: [{ masterRid: 'r1', name: 'A', ok: true }, { masterRid: 'r2', name: 'B', ok: false, detail: 'sheets write threw' }] },
    ['r2', 'sheets write threw']],
  ['S4j a printed-but-unsettlable row is named',
    { ok: true, unsettlable: [{ rowNum: 12, name: 'C', reason: 'no MASTER_RID to key a settlement stamp on' }] },
    ['12', 'no MASTER_RID']],
  ['S4k a draft that threw is never reported as created',
    { ok: true, docUrl: 'u', draftError: 'gmail quota exceeded' }, ['draftError', 'gmail quota exceeded']],
  ['S4l the archetype: ok:true with go:false',
    { ok: true, go: false, verdict: 'NO-GO' }, ['go: false', 'NO-GO']],
];
for (const [label, res, needles] of CASES) {
  const out = actionOutcomeText(res);
  ok(label, needles.every((n) => out.indexOf(n) >= 0) && actionOutcome(res).clean === false, out);
}

// S5: the funnel. Without this the table is a library nobody calls.
const sendIdx = html.indexOf('function send(opt){');
ok('S5 the shared recovery send() exists', sendIdx > 0);
const sendBody = html.slice(sendIdx, sendIdx + 2000);
ok('S5b every recovery action routes its ok branch through actionOutcome', /var out_=actionOutcome\(r\);/.test(sendBody), sendBody.slice(0, 200));
ok('S5c and a result with notes is NOT rendered as an ok status', /out_\.clean\?"ok":"error"/.test(sendBody));

// ----------------------------------------------------------------- DETECT
// Result fields on the routes this console calls that carry a "did nothing /
// partly failed" meaning. Read from origin/main, never a working tree.
const ROUTES = [
  'apps/ju-service/src/domain/generateWireLetter.ts',
  'apps/ju-service/src/routes/reminderpause.ts',
  'apps/ju-service/src/domain/recordSignature.ts',
  'apps/ju-service/src/routes/opparkrow.ts',
  'apps/ju-service/src/routes/transferformpeek.ts',
  'apps/ju-service/src/routes/diagcorrecttrackerdate.ts',
  'apps/ju-service/src/domain/updateSignerContact.ts',
  'apps/ju-cayman/src/server/CaymanOperatorApi.ts',
];
// The shape of a silent-ok field name. Deliberately vocabulary-driven rather
// than clever: these are the words this codebase uses for "I did not do it".
const SIGNAL = /^(already[A-Z]\w*|refused\w*|unchanged|replay|skipped|unsettlable|writeErrors|settled|go|\w+Error|\w+Skipped)$/;
// Names that match the shape and are NOT a caller-visible silent-ok signal.
// Every entry is a decision, not a convenience: a field belongs here only
// because reading it would tell the operator nothing she can act on.
const NOT_A_SIGNAL = {
  error: 'the ok:false channel; apiFetch already throws on it',
  serverError: 'apiFetch attaches this to the thrown error, not a result field',
  signerDataClearError: null, // declared - listed for readability only
};
let sourcesRead = 0;
const undeclared = [];
for (const rel of ROUTES) {
  const src = monoSource(rel);
  ok('S6 source present: ' + rel + ' (absent = vacuous contract, hard fail)', src.length > 0, rel);
  if (!src.length) continue;
  sourcesRead++;
  // Object-literal keys only: `foo:` / `foo,` at the head of a line inside a
  // returned result. Cheap and mechanical on purpose - a scan that needs a TS
  // parser is a scan that stops being run.
  const keys = new Set();
  const re = /^\s{4,}([A-Za-z_$][\w$]*)\s*[:,]/gm;
  let m;
  while ((m = re.exec(src))) keys.add(m[1]);
  for (const k of keys) {
    if (!SIGNAL.test(k)) continue;
    if (DECLARED.indexOf(k) >= 0) continue;
    if (Object.prototype.hasOwnProperty.call(NOT_A_SIGNAL, k) && NOT_A_SIGNAL[k]) continue;
    undeclared.push(rel.split('/').pop() + ':' + k);
  }
}
ok('S6b every route source was read', sourcesRead === ROUTES.length, sourcesRead + '/' + ROUTES.length);
ok('S7 no silent-ok field on a called route is missing from SILENT_OK_FIELDS',
  undeclared.length === 0,
  undeclared.join(', ') + ' - declare it in SILENT_OK_FIELDS, or give it a reasoned line in NOT_A_SIGNAL');

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
