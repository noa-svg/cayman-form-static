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

  return { post: post, retryOnTimeout: retryOnTimeout };
}));
