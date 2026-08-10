/* lvp-gateway.js - Batch D shared gateway transport module (2026-07-18).
 *
 * ONE source of the /exec gateway POST transport for the three LP forms
 * (israel.html, index.html, flow.html), following the validation-rules.js
 * precedent: UMD, attaches window.LVPGateway in the browser, module.exports
 * in node. No dependencies.
 *
 * The module carries MECHANICS ONLY:
 *   - fetch + AbortController bounded by a caller-supplied timeout budget
 *   - JSON parse of the response body
 *   - the tightened envelope check (ok !== true rejects: a JSON body WITHOUT
 *     ok, e.g. an HTTP 500 page that happens to parse or a truncated proxy
 *     response, is not a success and must not sail through)
 *   - a timeout-only retry helper (a real server error never retries; the
 *     gateway's server-side idempotency bounds any replay)
 *
 * Everything per-form stays at the call site, passed in per call:
 *   - the gateway URL (this file carries NO deployment id, so the coupling
 *     check's single-/exec-id assertion keeps operating on the forms alone)
 *   - the envelope body (action / token / lane / payload shape is the form's)
 *   - the per-action timeout budget and the retry count/backoff
 *   - classifyReject / classifyTimeout callbacks, which own every console
 *     diagnostic and every LP-facing error string (LP copy is per-form
 *     approved wording and never lives here)
 *
 * TIMEOUTS (2026-08-10): the ONE source of the two client-side timeout
 * budgets every LVPGateway.post call site should use. Before this, each of
 * index.html/israel.html/flow.html hardcoded its own numbers independently,
 * and they drifted: flow.html's submit got raised to 180000 (the fix that
 * unstuck Maxim Fainshtein and Alex Glotzky, both stranded by a client abort
 * racing a slow-but-live gateway - see fund-wiki tools/ju-lp-issue-log.md),
 * but israel.html's submit/record_signature and index.html's non-submit
 * budget were never carried forward and stayed stale below the ~20s+work
 * floor the gateway itself pays (measured 39.1s of pure overhead on
 * 2026-08-06 before any action work begins). Every caller should read
 * TIMEOUTS.submit / TIMEOUTS.default instead of a literal, so the next fix
 * to either number reaches every page in one edit.
 *   - submit:  180000ms. The heaviest client actions - the initial full-pack
 *     submit and a signer's record_signature - which do real server-side
 *     work (pack assembly/render, Drive upload, seal) on top of the gateway's
 *     own cold-start floor. 180s covers the measured ~39s floor plus a cold
 *     ~25-40s of actual work with room to spare, same number flow.html and
 *     signer.html already proved live.
 *   - default: 120000ms. Every other action (save_page, save_signer_progress,
 *     upload_file, kyc_extract, etc). Lower than submit, but still clears the
 *     ~39s floor by 3x so a "snappy" action does not abort on a server that
 *     is still answering.
 * A caller with a genuinely different, justified budget (israel.html's
 * render_preview: a cold full-pack render measured just over 20s, watched by
 * its own sign-preview race guard) may still pass an explicit override - this
 * table is the DEFAULT, not a hard cap.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LVPGateway = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // POST one envelope to the gateway. opts:
  //   url             the form's /exec gateway URL (module appends ?source=lp)
  //   body            the full envelope object; sent as JSON with the
  //                   text/plain content type (the CORS-simple contract all
  //                   three forms already use against GAS)
  //   timeoutMs       hard budget; on expiry the fetch is aborted
  //   classifyReject  function(res) -> Error, called when the parsed body is
  //                   missing or carries ok !== true (the caller's console
  //                   diagnostics + curated error copy live in there)
  //   classifyTimeout function() -> Error, called when the abort fired
  // Resolves with the parsed envelope on ok === true. Every other failure
  // (network error, non-JSON body) rethrows untouched for the caller's catch.
  function post(opts) {
    if (!opts || !opts.url) return Promise.reject(new Error('lvp_gateway_no_url'));
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeoutMs) : null;
    return fetch(opts.url + '?source=lp', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(opts.body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      return r.json();
    }).then(function (res) {
      if (!res || res.ok !== true) throw opts.classifyReject(res);
      return res;
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === 'AbortError') throw opts.classifyTimeout();
      throw err;
    });
  }

  // Timeout-only retry loop shared by the three submit paths. makeAttempt()
  // returns a Promise for ONE full attempt (the POST plus the caller's
  // response routing, which stays at the call site). opts:
  //   retries    how many retries remain after the first attempt
  //   backoffMs  fixed wait between attempts
  //   isTimeout  function(err) -> bool; ONLY a timeout retries
  //   onRetry    function(retriesLeft); the caller's exact retry console line
  function retryOnTimeout(makeAttempt, opts) {
    function run(retriesLeft) {
      return makeAttempt().catch(function (err) {
        if (opts.isTimeout(err) && retriesLeft > 0) {
          if (opts.onRetry) opts.onRetry(retriesLeft);
          return new Promise(function (r) { setTimeout(r, opts.backoffMs); }).then(function () {
            return run(retriesLeft - 1);
          });
        }
        throw err;
      });
    }
    return run(opts.retries);
  }

  // Shared timeout budget table (see the docblock above for why these two
  // numbers exist and what they cover). Frozen where supported so a call
  // site cannot accidentally mutate the shared table for every other caller.
  var TIMEOUTS = { submit: 180000, default: 120000 };
  if (typeof Object.freeze === 'function') Object.freeze(TIMEOUTS);

  return { post: post, retryOnTimeout: retryOnTimeout, TIMEOUTS: TIMEOUTS };
}));
