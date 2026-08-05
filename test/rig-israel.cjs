/**
 * rig-israel.cjs - jsdom full-flow verification rig for the ISRAELI-lane
 * onboarding form (../israel.html). Counterpart of rig.cjs (which boots
 * index.html, the Cayman lane). Loads the REAL israel.html, inlines the REAL
 * validation-rules.js (jsdom does not fetch external scripts under
 * runScripts:'dangerously'), mocks the /exec gateway (fetch) and the
 * bank-registry.json XHR, stubs the canvas signature pad, and returns the
 * booted document plus a log of every gateway POST so walkthrough tests can
 * drive the form as a scripted user and assert the REAL engine's behavior.
 *
 * Usage:
 *   const { loadIsraelForm } = require('./rig-israel.cjs');
 *   const rig = await loadIsraelForm({ gatewayResponses: { submit: {...} } });
 *   rig.document / rig.window / rig.gatewayCalls / rig.errors
 *
 * israel.html boot facts this rig encodes (read 2026-07-18):
 *   - CFG bootstrap: window.ISRAEL_CFG is seeded synchronously from the URL,
 *     then an async fetch(gasUrl + '?api=config&t=...') merges the server cfg.
 *     cfg.flowType must be non-empty or the page flips .lvp-gate-mode
 *     (broken-link screen); cfg.completed:true flips .lvp-done-mode.
 *   - validation-rules.js is a separate <script src>; the live form needs it
 *     for window.LVPRules (checksum ID, dates, phone). Inlined here.
 *   - The bank/branch combobox lazy-loads bank-registry.json over XHR.
 *   - gateway(action, payload) POSTs to CFG.gatewayUrl + '?source=lp' with
 *     body {action, token, lane:'israeli', payload}. There is NO separate
 *     idempotency-key field: the token IS the server-side idempotency key
 *     (prod @506 replay dedupe), and gateway() requires res.ok === true.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', 'israel.html');
const RULES_PATH = path.join(__dirname, '..', 'validation-rules.js');
const GATEWAY_PATH = path.join(__dirname, '..', 'lvp-gateway.js');
const BANKS_PATH = path.join(__dirname, '..', 'bank-registry.json');
const SANITIZE_PATH = path.join(__dirname, '..', 'doc-sanitize.js');

// The genuine ?api=config success shape for a live israeli-lane resume token
// (mirrors client-honesty-harness.cjs G5 and the mono gateway's config).
function makeCfg(over) {
  return Object.assign({
    ok: true,
    token: 'TESTTOKEN',
    lane: 'israeli',
    flowType: 'cayman_onboarding',
    applicantType: 'individual',
    completed: false,
    prefill: {},
    resumePage: '',
    language: 'he',
    wire: null
  }, over || {});
}

// Default per-action gateway envelopes. A test overrides via opts.gatewayResponses
// (object action -> envelope, or action -> function(body) -> envelope).
const DEFAULT_GATEWAY = {
  save_page: { ok: true, stage: 'opened' },
  save_signer_progress: { ok: true, stage: 'opened' },
  render_preview: {
    ok: true,
    docs: [{ title: 'מסמכי הצטרפות', html: '<h1>הסכם הצטרפות לשותפות</h1><p>תצוגה מקדימה</p>' }]
  },
  submit: { ok: true, stage: 'submitted', detail: { signersPlanned: 1 } },
  record_signature: { ok: true, stage: 'all_signed', detail: { signerXofY: '1 of 1' } }
};

async function loadIsraelForm(opts) {
  opts = opts || {};
  const cfg = makeCfg(opts.cfg);
  const gatewayResponses = Object.assign({}, DEFAULT_GATEWAY, opts.gatewayResponses || {});
  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const rules = fs.readFileSync(RULES_PATH, 'utf8');
  const banksJson = fs.readFileSync(BANKS_PATH, 'utf8');

  // Inline the shared validation module: jsdom (runScripts:'dangerously') does
  // not fetch external <script src>, and without window.LVPRules the checksum /
  // date / phone gates silently degrade to server-only (validateField's R null
  // branch), which is NOT the production client behavior we are testing.
  const SRC_TAG = '<script src="validation-rules.js"></script>';
  if (html.indexOf(SRC_TAG) === -1) {
    throw new Error('rig-israel: validation-rules.js script tag not found in israel.html (boot contract changed)');
  }
  html = html.replace(SRC_TAG, '<script>\n' + rules + '\n</script>');
  // Same for the Batch D shared gateway transport (window.LVPGateway): the
  // live form's gateway() wrapper fails loud without it, which is NOT the
  // production happy path we are testing.
  const GW_TAG = '<script src="lvp-gateway.js"></script>';
  if (html.indexOf(GW_TAG) === -1) {
    throw new Error('rig-israel: lvp-gateway.js script tag not found in israel.html (boot contract changed)');
  }
  html = html.replace(GW_TAG, '<script>\n' + fs.readFileSync(GATEWAY_PATH, 'utf8') + '\n</script>');
  // Same for the shared doc-preview sanitizer (window.lvpSanitizeDocHtml_,
  // CTO review finding #2): without inlining this, the sign-preview code
  // path's typeof-guarded call silently no-ops under jsdom, and this rig's
  // F2 "sign-step doc preview" assertion would pass without ever actually
  // exercising the sanitizer.
  const SANITIZE_TAG = '<script src="doc-sanitize.js"></script>';
  if (html.indexOf(SANITIZE_TAG) === -1) {
    throw new Error('rig-israel: doc-sanitize.js script tag not found in israel.html (boot contract changed)');
  }
  html = html.replace(SANITIZE_TAG, '<script>\n' + fs.readFileSync(SANITIZE_PATH, 'utf8') + '\n</script>');

  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push(String((e && e.message) || e)));

  const gatewayCalls = [];   // every ?source=lp POST: { url, body (parsed) }
  const configCalls = [];    // every ?api=config fetch URL, in boot order

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://sign.legacyvpartners.com/israel.html?t=' + cfg.token,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = function (u, init) {
        const url = String(u);
        const jsonResp = (obj) => Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve(obj),
          text: () => Promise.resolve(JSON.stringify(obj))
        });
        if (url.indexOf('api=config') !== -1) {
          configCalls.push(url);
          // Pilot-fallback tests (2026-08-05): opts.configFetch(url, jsonResp)
          // lets a test answer the config boot PER GATEWAY HOST (primary vs
          // legacy), including non-2xx / rejected responses. Return a falsy
          // value to fall through to the default single-cfg answer.
          if (typeof opts.configFetch === 'function') {
            const custom = opts.configFetch(url, jsonResp);
            if (custom) return custom;
          }
          return jsonResp(cfg);
        }
        if (url.indexOf('source=lp') !== -1) {
          let body = null;
          try { body = JSON.parse(init && init.body || 'null'); } catch (e) {}
          gatewayCalls.push({ url: url, body: body });
          const action = body && body.action;
          let resp = gatewayResponses[action];
          if (typeof resp === 'function') resp = resp(body);
          if (!resp) resp = { ok: false, error: 'rig-israel: no mocked response for action ' + action };
          return jsonResp(resp);
        }
        // Stale-guard self-fetch (location.pathname) and anything else: serve
        // the page's own HTML so the build-tag compare finds the SAME tag.
        if (url.indexOf('israel.html') !== -1 || url === '/israel.html') {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve(html) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
      };

      // XHR stub: the bank/branch combobox loads bank-registry.json this way.
      function XHRStub() { this.readyState = 0; this.status = 0; this.responseText = ''; }
      XHRStub.prototype.open = function (m, url) { this._url = String(url); };
      XHRStub.prototype.setRequestHeader = function () {};
      XHRStub.prototype.send = function () {
        this.readyState = 4; this.status = 200;
        if (this._url && this._url.indexOf('bank-registry.json') !== -1) this.responseText = banksJson;
        else if (this._url && this._url.indexOf('api=config') !== -1) this.responseText = JSON.stringify(cfg);
        else this.responseText = '{}';
        if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
        if (typeof this.onload === 'function') this.onload();
      };
      XHRStub.prototype.addEventListener = function (ev, fn) { if (ev === 'load') this.onload = fn; };
      window.XMLHttpRequest = XHRStub;

      // Canvas stub for the inline signature pad (initSigPad).
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

      // Google Places stub (address search binds Autocomplete when a key exists;
      // israel.html also has a geocode fallback that must not explode).
      window.google = {
        maps: {
          places: {
            Autocomplete: function () { this.addListener = function () {}; this.getPlace = function () { return {}; }; },
            AutocompleteService: function () {}, PlacesService: function () {}
          },
          Geocoder: function () { this.geocode = function (q, cb) { cb([], 'ZERO_RESULTS'); }; },
          event: { addListener() {}, clearInstanceListeners() {} }
        }
      };
      window.matchMedia = window.matchMedia || function () {
        return { matches: false, media: '', addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
      };
      window.scrollTo = function () {};
      // jsdom has no scrollIntoView; validatePage's jump-to-first-error calls it
      // (try/catch'd variant AND bare fallback), so without this the whole click
      // handler dies before renderErrorSummary paints.
      window.Element.prototype.scrollIntoView = function () {};
      window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(Date.now()); }, 0); };
      window.cancelAnimationFrame = function (id) { clearTimeout(id); };
    }
  });

  const window = dom.window;
  await new Promise((r) => {
    if (window.document.readyState === 'complete') return r();
    window.addEventListener('load', r);
    setTimeout(r, 2000); // safety
  });
  // Settle the async ?api=config fetch + the deferred __israelOnCfgUpdate chain.
  await new Promise((r) => setTimeout(r, 250));
  return { dom, window, document: window.document, errors, gatewayCalls, configCalls, cfg };
}

// ---- scripted-user helpers (drive the REAL rendered state) -------------------

function fire(el, type) {
  el.dispatchEvent(new (el.ownerDocument.defaultView.Event)(type, { bubbles: true }));
}
function setVal(input, v) { input.value = v; fire(input, 'input'); fire(input, 'change'); }
function setField(document, name, v) {
  const el = document.querySelector('[name="' + name.replace(/(["\\\]\[])/g, '\\$1') + '"]');
  if (!el) throw new Error('setField: no field named ' + name);
  if (el.tagName === 'SELECT') { el.value = v; fire(el, 'change'); fire(el, 'input'); }
  else setVal(el, v);
  return el;
}
function checkRadio(document, name, value) {
  const sel = 'input[name="' + name.replace(/(["\\\]\[])/g, '\\$1') + '"][value="' + value + '"]';
  const el = document.querySelector(sel);
  if (!el) throw new Error('checkRadio: no radio ' + name + '=' + value);
  el.checked = true; fire(el, 'change'); fire(el, 'input');
  return el;
}
function checkBox(document, name, on) {
  const el = document.querySelector('input[name="' + name.replace(/(["\\\]\[])/g, '\\$1') + '"]');
  if (!el) throw new Error('checkBox: no checkbox ' + name);
  el.checked = on !== false; fire(el, 'change'); fire(el, 'input');
  return el;
}
function currentPage(document) {
  const p = document.querySelector('.lvp-page:not([hidden])');
  return p ? p.getAttribute('data-page') : null;
}
function currentPageEl(document) { return document.querySelector('.lvp-page:not([hidden])'); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clickNext(document) {
  document.querySelector('[data-action="next"]').click();
  await sleep(30);
  return currentPage(document);
}
// Draw a signature on the REAL pad: mousedown + enough mousemoves to clear the
// MIN_POINTS(8) gate in initSigPad, so its updateSigState captures sigPadPng.
async function drawSignature(window) {
  const document = window.document;
  const canvas = document.getElementById('sig-pad');
  if (!canvas) throw new Error('drawSignature: #sig-pad not found');
  const mouse = (type, x, y) => canvas.dispatchEvent(new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  mouse('mousedown', 20, 40);
  for (let i = 1; i <= 12; i++) mouse('mousemove', 20 + i * 8, 40 + (i % 3) * 5);
  window.dispatchEvent(new window.MouseEvent('mouseup', {}));
  await sleep(20);
}

module.exports = {
  loadIsraelForm, makeCfg,
  fire, setVal, setField, checkRadio, checkBox,
  currentPage, currentPageEl, clickNext, drawSignature, sleep
};
