/**
 * Locks the deploy gate's result-marker contract (githooks/run-harness.sh +
 * the REPORTED-COUNT GUARD in githooks/pre-push).
 *
 * Regression under test, live 2026-09-07: the guard counted *.log files, and
 * the worker's `> $OUT/$1.log` redirect creates that file the instant the
 * process starts. A concurrent session's `pkill -f 'node
 * test/beneficiary-declaration-harness'` (pkill matches machine-wide) SIGTERMed
 * a harness mid-run; it produced neither an OK line nor a failure marker, yet
 * its empty log satisfied the guard and the gate printed "all green" having
 * heard back from only 43 of 44 harnesses.
 *
 * PREVENT: a worker writes exactly one .done/.failed/.killed marker, and only
 * AFTER node returns, so a harness that dies mid-run leaves no marker at all.
 * DETECT: this harness, which fails if the marker contract regresses or if the
 * guard goes back to counting logs.
 */
const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const worker = path.join(repo, 'githooks', 'run-harness.sh');
const prePush = fs.readFileSync(path.join(repo, 'githooks', 'pre-push'), 'utf8');
let checks = 0;
const ok = (name) => { checks++; console.log('  ok ' + name); };

// --- the worker's marker contract -----------------------------------------
function runWorker(name, body, killWorkerAfterMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'markerout-'));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', name + '.cjs'), body);
  const child = spawnSync('bash', [worker, name], {
    cwd: dir,
    env: Object.assign({}, process.env, { OUT: out }),
    encoding: 'utf8',
    timeout: 20000,
    ...(killWorkerAfterMs ? { killSignal: 'SIGTERM', timeout: killWorkerAfterMs } : {}),
  });
  const markers = fs.readdirSync(out).filter((f) => !f.endsWith('.log'));
  return { out, markers, stdout: child.stdout || '' };
}

let r = runWorker('pass', 'process.exit(0);');
assert.deepStrictEqual(r.markers, ['pass.done'], 'exit 0 must write exactly one .done marker');
ok('exit 0 -> .done, and nothing else');

r = runWorker('fail', 'process.exit(3);');
assert.deepStrictEqual(r.markers, ['fail.failed'], 'a non-zero exit must write exactly one .failed marker');
assert.strictEqual(fs.readFileSync(path.join(r.out, 'fail.failed'), 'utf8').trim(), '3',
  'the .failed marker records the exit code');
assert.ok(/FAIL fail \(exit 3\)/.test(r.stdout), 'a non-zero exit reads as FAIL with its exit code');
ok('non-zero exit -> .failed carrying the exit code');

// A signalled harness is an ENVIRONMENT problem, not a test failure, and must
// not be reported as one: conflating the two sends the next person hunting a
// broken test that never actually complained.
r = runWorker('killed', 'process.kill(process.pid, "SIGTERM"); setTimeout(()=>{}, 5000);');
assert.deepStrictEqual(r.markers, ['killed.killed'], 'a signalled harness must write .killed, never .failed');
assert.strictEqual(fs.readFileSync(path.join(r.out, 'killed.killed'), 'utf8').trim(), '15',
  'the .killed marker records the signal number');
assert.ok(/KILL killed \(signal 15/.test(r.stdout), 'a signalled harness reads as KILL, not FAIL');
ok('signalled harness -> .killed, reported as KILL not FAIL');

// THE HOLE ITSELF: the worker dies before it can report. A log file exists;
// no marker does. This is the case the old ran-count guard waved through.
r = runWorker('vanish', 'setTimeout(()=>{}, 10000);', 1200);
assert.deepStrictEqual(r.markers, [], 'a worker killed mid-run must leave NO result marker');
assert.ok(fs.existsSync(path.join(r.out, 'vanish.log')),
  'the log file still exists, which is exactly why a log is not a result');
ok('worker killed mid-run -> log but NO marker (the 2026-09-07 hole)');

// --- the guard must count markers, not logs -------------------------------
assert.ok(/REPORTED=\$\(\(DONE \+ FAILED \+ KILLED\)\)/.test(prePush),
  'pre-push must total the three result markers');
assert.ok(/if \[ "\$REPORTED" != "\$EXPECTED" \]/.test(prePush),
  'pre-push must gate on the marker total against the harness count');
assert.ok(!/RAN=\$\(ls "\$OUT"\/\*\.log/.test(prePush),
  'pre-push must NOT count *.log files as evidence a harness ran');
ok('pre-push gates on result markers, not log files');

assert.ok(/xargs -P "\$JOBS" -I\{\} \.\/githooks\/run-harness\.sh \{\}/.test(prePush),
  'the xargs worker line must stay a fixed short invocation of the helper');
assert.ok(!/xargs[\s\S]{0,80}bash -c/.test(prePush),
  'no inline bash -c body: interpolating into it is what made BSD xargs refuse the line and run nothing');
ok('the xargs line stays short (no inline bash -c body to grow)');

console.log('prepush-marker-contract: ' + checks + ' checks passed');
