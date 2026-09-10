// zz-console-money-received-truth.cjs - "Mark money received" must report what
// the SERVER said happened, never a sentence of its own.
//
// Until 2026-09-10 the renderer read `r.tracker` and `r.monday`. ju-service
// returns neither (domain/markMoneyReceived.ts returns {ok, processId, rows,
// drafts, draftsFolderUrl}); only the retired GAS twin ever did. So the status
// line fell through to its own literal and printed
// "Wire status: Pending -> Received in transit." on EVERY press, including when
// every tracker write failed - a failed row comes back with newStatus undefined
// and the call still answers ok:true.
//
// This drives the REAL renderer out of console/index.html rather than a copy.
'use strict';
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(l, c, x) { if (c) { pass++; console.log('ok   ' + l); } else { fail++; console.log('FAIL ' + l + (x === undefined ? '' : ' :: ' + String(x).slice(0, 200))); } }

const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');

// Extract the renderer body and run it with a stub esc2, so the assertions are
// about the shipped code and cannot drift from it.
const start = html.indexOf('var rows=(r.rows||[]);');
ok('M0 the renderer reads r.rows', start > 0);
const endMark = 'return trackerLine+mondayLine+failedLine+draftsHtml;';
const end = html.indexOf(endMark, start);
ok('M1 the renderer returns the failed-row line too', end > start);
const body = html.slice(start, end + endMark.length);

const esc2 = (v) => String(v == null ? '' : v);
// eslint-disable-next-line no-new-func
const render = new Function('r', 'esc2', body);

// 1. A real advance reports the REAL previous and new status, not a literal.
{
  const out = render({ rows: [{ tab: '2026-09', row: 12, alreadyAdvanced: false, previousStatus: 'Parked: awaiting KYC', newStatus: 'Received in transit' }] }, esc2);
  ok('M2 a real advance names the real previous status', out.indexOf('Parked: awaiting KYC') >= 0, out.slice(0, 120));
  ok('M3 and the real new status', out.indexOf('Received in transit') >= 0);
}

// 2. THE DEFECT. Every row failed to write: newStatus undefined, ok:true.
//    The old code printed "Pending -> Received in transit" here.
{
  const out = render({ rows: [{ tab: '2026-09', row: 12, alreadyAdvanced: false, previousStatus: 'Pending', newStatus: undefined }] }, esc2);
  ok('M4 a FAILED write never claims the wire advanced', out.indexOf('Received in transit') < 0, out.slice(0, 200));
  ok('M5 and the row that did not advance is named, with tab and row', out.indexOf('2026-09') >= 0 && out.indexOf('12') >= 0, out.slice(0, 200));
}

// 3. Already advanced reports the status it is ALREADY at.
{
  const out = render({ rows: [{ tab: '2026-08', row: 4, alreadyAdvanced: true, previousStatus: 'Completed' }] }, esc2);
  ok('M6 an already-advanced row names its current status', out.indexOf('Completed') >= 0, out.slice(0, 120));
  ok('M7 and does not claim a fresh advance', out.indexOf('->') < 0, out.slice(0, 120));
}

// 4. No rows at all: say nothing about the wire rather than inventing.
{
  const out = render({ rows: [] }, esc2);
  ok('M8 no rows means no wire-status claim at all', out.indexOf('Wire status') < 0, out.slice(0, 120));
}

// 5. Partial: one advanced, one failed. Both are reported.
{
  const out = render({ rows: [
    { tab: '2026-09', row: 12, alreadyAdvanced: false, previousStatus: 'Pending', newStatus: 'Received in transit' },
    { tab: '2026-09', row: 13, alreadyAdvanced: false, previousStatus: 'Pending', newStatus: undefined },
  ] }, esc2);
  ok('M9 a partial advance still reports the advance', out.indexOf('Received in transit') >= 0);
  ok('M10 and still names the row that did not advance', out.indexOf('row 13') >= 0, out.slice(0, 260));
}

// 6. The dead keys are gone for good.
ok('M11 the renderer no longer reads r.tracker, which no engine sends', body.indexOf('r.tracker') < 0);
ok('M12 the renderer no longer reads r.monday, which no engine sends', body.indexOf('r.monday') < 0);

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
