/**
 * rig-flow.cjs (2026-08-08, agent/money-flow-juapi) - jsdom boot rig for the
 * MONEY-FLOW form (../flow.html), counterpart of rig-israel.cjs. Loads the
 * REAL flow.html, inlines validation-rules.js / lvp-gateway.js (jsdom under
 * runScripts:'dangerously' does not fetch external <script src>), stubs the
 * canvas signature pad, and mocks BOTH transports flow.html actually uses:
 *   - XMLHttpRequest for ?api=config (the money-flow gateway seam this rig
 *     exists to test), branchable PER HOST via opts.configXhr(url) so a test
 *     can answer the ju-api primary and the GAS legacy fallback differently.
 *   - window.fetch as a safety net (unused by flow.html today, but kept
 *     inert-safe in case a future edit adds one, mirroring rig-israel).
 *
 * Usage:
 *   const { loadFlowForm, makeFlowCfg } = require('./rig-flow.cjs');
 *   const rig = await loadFlowForm({ token: 'T1', configXhr: (url) => ... });
 *   rig.document / rig.window / rig.xhrCalls / rig.sessionStorageData
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', 'flow.html');
const RULES_PATH = path.join(__dirname, '..', 'validation-rules.js');
const GATEWAY_PATH = path.join(__dirname, '..', 'lvp-gateway.js');

function makeFlowCfg(over) {
  return Object.assign({
    flowType: 'cayman_increase',
    applicantType: 'individual',
    lane: 'israeli',
    language: 'he',
    completed: false,
    resumePage: '',
    prefill: {}
  }, over || {});
}

// The specific token-unknown envelope ju-service's ?api=config answers with
// for a token it has never seen (see flow.html's cfgTokenUnknown_ comment).
function tokenUnknownCfg() {
  return { flowType: '', resumePage: '', completed: false };
}

async function loadFlowForm(opts) {
  opts = opts || {};
  const token = opts.token || 'TESTTOKEN';
  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const rules = fs.readFileSync(RULES_PATH, 'utf8');

  const SRC_TAG = '<script src="validation-rules.js"></script>';
  if (html.indexOf(SRC_TAG) === -1) throw new Error('rig-flow: validation-rules.js tag not found (boot contract changed)');
  html = html.replace(SRC_TAG, '<script>\n' + rules + '\n</script>');
  const GW_TAG = '<script src="lvp-gateway.js"></script>';
  if (html.indexOf(GW_TAG) === -1) throw new Error('rig-flow: lvp-gateway.js tag not found (boot contract changed)');
  html = html.replace(GW_TAG, '<script>\n' + fs.readFileSync(GATEWAY_PATH, 'utf8') + '\n</script>');

  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push(String((e && e.message) || e)));

  const xhrCalls = [];   // every XHR: { url, method, body }

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://sign.legacyvpartners.com/flow.html?t=' + encodeURIComponent(token),
    virtualConsole: vc,
    beforeParse(window) {
      // sessionStorage: jsdom's own Storage object is spec-exotic (property
      // assignment writes THROUGH to the backing store rather than shadowing
      // methods), so it is used as-is; the rig reads it back directly after
      // boot via dumpSessionStorage() below instead of mirroring writes.

      function XHRStub() { this.readyState = 0; this.status = 0; this.responseText = ''; this.timeout = 0; }
      XHRStub.prototype.open = function (method, url) { this._method = method; this._url = String(url); };
      XHRStub.prototype.setRequestHeader = function () {};
      XHRStub.prototype.send = function (body) {
        const self = this;
        xhrCalls.push({ url: self._url, method: self._method, body: body || null });
        function settle(status, text) {
          self.status = status; self.responseText = text; self.readyState = 4;
          if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
        }
        function fail() {
          if (typeof self.onerror === 'function') self.onerror();
        }
        function timeout() {
          if (typeof self.ontimeout === 'function') self.ontimeout();
        }
        // ?api=config: the seam under test. opts.configXhr(url) picks the
        // response PER HOST so a test can answer ju-api and legacy GAS
        // differently. Returns {status, body} | {network:true} | {timeout:true}.
        if (self._url.indexOf('api=config') !== -1) {
          const r = (typeof opts.configXhr === 'function') ? opts.configXhr(self._url) : null;
          const resp = r || { status: 200, body: makeFlowCfg() };
          if (resp.network) { fail(); return; }
          if (resp.timeout) { timeout(); return; }
          settle(resp.status, JSON.stringify(resp.body));
          return;
        }
        // source=lp (save_page / submit / client_error): default success, no
        // opinion needed for the gateway-seam tests this rig exists for.
        if (self._url.indexOf('source=lp') !== -1) {
          settle(200, JSON.stringify({ ok: true }));
          return;
        }
        // Stale-tab self-fetch (location.pathname?nocache=...): serve back
        // the ORIGINAL page source with a MATCHING build tag so the guard
        // never fires mid-test.
        settle(200, html);
      };
      XHRStub.prototype.addEventListener = function () {};
      window.XMLHttpRequest = XHRStub;

      window.fetch = function () {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
      };

      window.HTMLCanvasElement.prototype.getContext = function () {
        return {
          fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
          save() {}, restore() {}, scale() {}, setTransform() {}, fillText() {}, translate() {},
          measureText() { return { width: 10 }; }, getImageData() { return { data: [] }; },
          putImageData() {}, drawImage() {}, closePath() {}, arc() {},
          fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', font: '', textAlign: '', textBaseline: ''
        };
      };
      window.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'; };
      window.matchMedia = window.matchMedia || function () {
        return { matches: false, media: '', addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
      };
      window.scrollTo = function () {};
      window.Element.prototype.scrollIntoView = function () {};
      window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(Date.now()); }, 0); };
      window.cancelAnimationFrame = function (id) { clearTimeout(id); };
    }
  });

  const window = dom.window;
  await new Promise((r) => {
    if (window.document.readyState === 'complete') return r();
    window.addEventListener('load', r);
    setTimeout(r, 2000);
  });
  // Settle async config + (on a token-unknown primary) the legacy probe.
  await new Promise((r) => setTimeout(r, 300));
  const sessionStorageData = {};
  const ss = window.sessionStorage;
  for (let i = 0; i < ss.length; i++) { const k = ss.key(i); sessionStorageData[k] = ss.getItem(k); }
  return { dom, window, document: window.document, errors, xhrCalls, sessionStorageData };
}

module.exports = { loadFlowForm, makeFlowCfg, tokenUnknownCfg };
