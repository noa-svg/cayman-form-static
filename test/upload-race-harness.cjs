// upload-race-harness.cjs (2026-08-02, CTO review finding #1).
//
// Proves the file-upload race fix in signer.html: a signer who taps Submit
// right after picking an ID/stamp photo used to hit a false "please upload"
// error, because handleIdUpload/handleLawyerStamp populate pendingIdUploads/
// pendingLawyerStamp asynchronously (inside FileReader.onload), and the
// submit-time gate checked those maps before the read had finished. The fix
// (ported from flow.html's already-proven "photo errored for no reason" fix)
// reserves the slot synchronously with reading:true the moment a file is
// picked, and whenUploadsReady() waits out any in-flight read before the
// gate runs.
//
// Extracts the REAL handleIdUpload/handleLawyerStamp/uploadsReading/
// whenUploadsReady functions from the live signer.html source and drives
// them with a controllable mock FileReader, so this test fails if a future
// edit reintroduces the race - not just if someone breaks a hand-written
// copy of the logic.
//
// Run: node test/upload-race-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'signer.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); } }

function extractFn(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}

// Controllable mock: readAsDataURL does NOT fire onload synchronously (like
// the real browser) - it only fires when the test calls flush(). This is
// exactly the window the real bug lived in.
function makeMockFileReaderCtor(queue) {
  return function MockFileReader() {
    var self = this;
    this.readAsDataURL = function (file) {
      queue.push(function () {
        self.result = 'data:' + file.type + ';base64,ZmFrZQ=='; // "fake"
        if (self.onload) self.onload();
      });
    };
  };
}

function runCase(label, assertFn) {
  const queue = [];
  const src = extractFn('handleIdUpload') + ';'
    + extractFn('handleLawyerStamp') + ';'
    + extractFn('uploadsReading') + ';'
    + extractFn('whenUploadsReady') + ';'
    + 'return {handleIdUpload:handleIdUpload, handleLawyerStamp:handleLawyerStamp, uploadsReading:uploadsReading, whenUploadsReady:whenUploadsReady, getPendingId:function(){return pendingIdUploads;}, getPendingLawyer:function(){return pendingLawyerStamp;}};';
  // pendingIdUploads/pendingLawyerStamp are free variables in the real file
  // (module-level `var` in signer.html's IIFE); declare them in this
  // function's own scope so the extracted functions close over THESE, then
  // expose getters so the test can inspect them.
  const wrapped = 'var pendingIdUploads={}; var pendingLawyerStamp={}; var FileReader=MOCK_FR; var tHe=function(s){return s;}; ' + src;
  const factory = new Function('MOCK_FR', wrapped);
  const api = factory(makeMockFileReaderCtor(queue));
  assertFn(api, queue);
}

// ---- 1. Immediately after picking a file (read not yet flushed), the slot
//         must already read as "present" to uploadsReading()/the gate logic -
//         not silently absent the way it was before the fix. ----------------
runCase('id-upload: reserved synchronously', function (api, queue) {
  var input = { files: [{ name: 'passport.jpg', type: 'image/jpeg', size: 1000 }], value: '' };
  api.handleIdUpload('passportPrimary', input, null);
  var pending = api.getPendingId();
  ok('slot exists immediately after pick (before FileReader.onload fires)', !!pending.passportPrimary);
  ok('slot is flagged reading:true before the read completes', pending.passportPrimary && pending.passportPrimary.reading === true);
  ok('uploadsReading() is true while the read is in flight', api.uploadsReading() === true);
  ok('base64 is empty until the read completes (not yet usable, but not missing either)', pending.passportPrimary.base64 === '');
});

// ---- 2. The actual race: whenUploadsReady must not fire its callback until
//         the queued FileReader.onload has actually run. ---------------------
runCase('id-upload: whenUploadsReady waits for the real async read', function (api, queue) {
  var input = { files: [{ name: 'passport.jpg', type: 'image/jpeg', size: 1000 }], value: '' };
  api.handleIdUpload('passportPrimary', input, null);
  var calledBeforeFlush = false, calledAfterFlush = false;
  api.whenUploadsReady(function () { calledAfterFlush = true; });
  // whenUploadsReady polls on a timer; a submit that raced the pick would have
  // seen an incomplete state at THIS exact instant if the fix were absent.
  ok('read is still in flight right after handleIdUpload returns', api.uploadsReading() === true);
  ok('callback has not fired yet (nothing to flush)', calledAfterFlush === false);
  // Flush the queued FileReader.onload (simulates the async read completing).
  queue.forEach(function (fn) { fn(); });
  var pending = api.getPendingId();
  ok('base64 is populated once the read completes', pending.passportPrimary.base64 === 'ZmFrZQ==');
  ok('reading flips to false once the read completes', pending.passportPrimary.reading === false);
  ok('uploadsReading() is false once nothing is in flight', api.uploadsReading() === false);
});

// ---- 3. Lawyer stamp: identical fix, same shape, different map. ------------
runCase('lawyer-stamp: reserved synchronously, same as ID uploads', function (api, queue) {
  var input = { files: [{ name: 'stamp.png', type: 'image/png', size: 500 }], value: '' };
  api.handleLawyerStamp('lawyer_stamp', input, null);
  var pending = api.getPendingLawyer();
  ok('stamp slot exists immediately after pick', !!pending.lawyer_stamp);
  ok('stamp slot flagged reading:true before the read completes', pending.lawyer_stamp && pending.lawyer_stamp.reading === true);
  ok('uploadsReading() sees the lawyer-stamp map too, not just pendingIdUploads', api.uploadsReading() === true);
  queue.forEach(function (fn) { fn(); });
  ok('stamp base64 populated after flush', pending.lawyer_stamp.base64 === 'ZmFrZQ==');
});

// ---- 4. Clearing the input (signer removes the file) must still delete the
//         slot cleanly even while a read was in flight - no orphaned entry. --
runCase('clearing mid-read removes the slot, no stale reading:true left behind', function (api, queue) {
  var input = { files: [{ name: 'passport.jpg', type: 'image/jpeg', size: 1000 }], value: '' };
  api.handleIdUpload('passportPrimary', input, null);
  ok('slot present before clear', !!api.getPendingId().passportPrimary);
  var emptyInput = { files: [], value: '' };
  api.handleIdUpload('passportPrimary', emptyInput, null);
  ok('slot removed on clear even though the original read was never flushed', !api.getPendingId().passportPrimary);
  ok('uploadsReading() is false after the only in-flight slot was cleared', api.uploadsReading() === false);
});

console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
