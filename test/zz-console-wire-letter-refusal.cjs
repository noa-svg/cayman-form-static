// zz-console-wire-letter-refusal.cjs - the wire letter's COMMIT path must not
// announce a settlement the server refused.
//
// domain/generateWireLetter.ts returns {ok:true, go:false, blocking, warnings}
// with NO document when the HY-close gate blocks a batch. go:false is the
// discriminator, not ok:false. The verify path has checked that since the first
// live run and says so in its own comment; the COMMIT path checked only r.ok,
// so it announced "Settled <month> on the tracker", closed the gate, and
// rendered <a href="undefined">Open the doc</a> - on the money path.
//
// Both paths are extracted from the REAL console/index.html and compared, so
// the guard cannot exist in one and rot out of the other again.
'use strict';
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(l, c, x) { if (c) { pass++; console.log('ok   ' + l); } else { fail++; console.log('FAIL ' + l + (x === undefined ? '' : ' :: ' + String(x).slice(0, 220))); } }

const html = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');

function handlerAfter(marker) {
  const i = html.indexOf(marker);
  if (i < 0) return '';
  const j = html.indexOf('}).catch(', i);
  return j > i ? html.slice(i, j) : '';
}

// The commit path is the one that settles; the verify path is the one that has
// always been right. Anchored on the query each sends.
const COMMIT = handlerAfter("&createDraft=");
const VERIFY = handlerAfter("&verifyOnly=true");

ok('W0 the commit path is present', COMMIT.length > 0);
ok('W1 the verify path is present', VERIFY.length > 0);

ok('W2 the COMMIT path checks go===false before claiming a settlement',
   /if\(r\.go===false\)\{/.test(COMMIT), COMMIT.slice(0, 200));
ok('W3 the verify path still checks it too', /if\(r\.go===false\)\{/.test(VERIFY));

// The ordering is the whole defect: a go:false return must be refused BEFORE
// the "Settled" announcement, not after it.
const goIdx = COMMIT.indexOf('if(r.go===false)');
const settledIdx = COMMIT.indexOf("wlAnnounce('Settled ");
ok('W4 the refusal is checked BEFORE the Settled announcement',
   goIdx >= 0 && settledIdx >= 0 && goIdx < settledIdx, 'go@' + goIdx + ' settled@' + settledIdx);

// A settle with no document is not a settle.
const docIdx = COMMIT.indexOf('if(!r.docUrl)');
ok('W5 a missing document is refused before the Settled announcement',
   docIdx >= 0 && docIdx < settledIdx, 'doc@' + docIdx + ' settled@' + settledIdx);

// The refusal must surface the server's OWN findings, not a bare message.
ok('W6 the refusal renders the server blocking/warnings findings',
   /findEl\.innerHTML=wlFindingsHtml\(r\.blocking,r\.warnings\)/.test(COMMIT), COMMIT.slice(0, 200));

// And it must leave the operator able to act again rather than stuck.
ok('W7 the refusal re-enables Generate', /if\(r\.go===false\)\{[\s\S]{0,200}genBtn\.disabled=false/.test(COMMIT));

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
