#!/bin/bash
# One deploy-gate harness worker. Invoked by githooks/pre-push via xargs, once
# per harness name, with $OUT (a mktemp dir) exported by the parent.
#
# This lives in its own file rather than inline in the hook's `xargs ... bash -c
# '...'` on purpose. On 2026-08-06 interpolating $OUT into that command STRING
# made the assembled line long enough that BSD xargs refused with "command line
# cannot be assembled, too long", ran NOTHING, and the gate printed all-green in
# five seconds. The inline body was kept deliberately tiny ever since. Putting
# the logic in a script keeps the xargs line a fixed handful of bytes no matter
# how much the worker has to do, so the hazard cannot come back.
#
# CONTRACT (the pre-push ran-count guard depends on it): every invocation writes
# EXACTLY ONE result marker into $OUT before exiting:
#   $OUT/<name>.done    harness exited 0
#   $OUT/<name>.failed  harness exited non-zero (a real test failure)
#   $OUT/<name>.killed  harness died on a signal (an environment problem)
# The log file alone is NOT a result: `> "$OUT/$1.log"` creates it the instant
# the worker starts, so a harness killed one second in still leaves a log behind.
# That is exactly what happened on 2026-09-07, when a concurrent session ran
# `pkill -f 'node test/beneficiary-declaration-harness'` (pkill matches across
# the whole machine, not just its own worktree). The harness was SIGTERMed
# mid-run, produced neither an OK line nor a .failed marker, and the gate
# printed "all green" having actually heard back from only 44 of 45 harnesses.
name="$1"

node "test/$name.cjs" > "$OUT/$name.log" 2>&1
code=$?

if [ "$code" -eq 0 ]; then
  touch "$OUT/$name.done"
  echo "  OK   $name"
elif [ "$code" -gt 128 ]; then
  # 128+N is bash's encoding of "terminated by signal N". A kill is not a test
  # result: the harness never got to say whether the code under test is sound.
  sig=$((code - 128))
  echo "$sig" > "$OUT/$name.killed"
  echo "  KILL $name (signal $sig - killed, NOT a test failure)"
else
  echo "$code" > "$OUT/$name.failed"
  echo "  FAIL $name (exit $code)"
fi
