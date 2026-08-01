/**
 * rig.cjs - jsdom branch-behavior verification rig for the Cayman new-subscription
 * form (../index.html). Loads the REAL form, injects a branch CFG, stubs the
 * browser-only bits (fetch/XHR config, canvas signature pad, Google Places), and
 * returns the booted document so assertions read the REAL conditional engine and
 * the REAL validation, not a reimplementation.
 *
 * Usage: const { loadForm } = require('./rig.cjs');
 *        const { document, window, errors } = await loadForm({ cfg: { applicantType: 'entity' } });
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const HTML_PATH = path.join(__dirname, '..', 'index.html');

function makeCfg(over) {
  return Object.assign({
    applicantType: 'individual',
    token: 'TESTTOKEN',
    gatewayUrl: 'https://example.invalid/exec',
    language: 'en',
    prefill: {},
    countries: ['Israel', 'United States', 'Cayman Islands', 'United Kingdom', 'France'],
    wire: { bankName: 'Bank Leumi', branch: '001', account: '123456', iban: 'IL000000' },
    placesApiKey: ''
  }, over || {});
}

async function loadForm(opts) {
  opts = opts || {};
  const cfg = makeCfg(opts.cfg);
  let html = fs.readFileSync(HTML_PATH, 'utf8');
  // Inline the Batch D shared gateway transport (window.LVPGateway): jsdom
  // (runScripts:'dangerously') does not fetch external <script src>, and the
  // live form's gateway() wrapper fails loud without it, which is NOT the
  // production happy path the walkthrough tests drive.
  const GW_TAG = '<script src="lvp-gateway.js"></script>';
  if (html.indexOf(GW_TAG) === -1) {
    throw new Error('rig: lvp-gateway.js script tag not found in index.html (boot contract changed)');
  }
  html = html.replace(GW_TAG, '<script>\n' + fs.readFileSync(path.join(__dirname, '..', 'lvp-gateway.js'), 'utf8') + '\n</script>');
  // Same for the shared doc-preview sanitizer (window.lvpSanitizeDocHtml_,
  // CTO review finding #2) - without inlining this, buildDocBody_'s
  // typeof-guarded call silently no-ops under jsdom and the walkthrough
  // tests would pass without ever actually exercising the sanitizer.
  const SANITIZE_TAG = '<script src="doc-sanitize.js"></script>';
  if (html.indexOf(SANITIZE_TAG) === -1) {
    throw new Error('rig: doc-sanitize.js script tag not found in index.html (boot contract changed)');
  }
  html = html.replace(SANITIZE_TAG, '<script>\n' + fs.readFileSync(path.join(__dirname, '..', 'doc-sanitize.js'), 'utf8') + '\n</script>');
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push(String((e && e.message) || e)));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://sign.legacyvpartners.com/index.html?t=' + cfg.token,
    virtualConsole: vc,
    beforeParse(window) {
      window.CAYMAN_CFG = cfg;
      const cfgResp = () => ({
        ok: true,
        status: 200,
        json: () => Promise.resolve(cfg),
        text: () => Promise.resolve(JSON.stringify(cfg))
      });
      window.fetch = function (u) {
        const url = String(u);
        if (url.indexOf('api=config') !== -1) return Promise.resolve(cfgResp());
        // Gateway posts (save_page / upload_file / ...) get a genuine ok:true
        // envelope: the live gateway always sets a boolean ok, and the shared
        // transport's tightened ok !== true check correctly rejects a bare {}
        // (which the old ok === false gate let through as a fake success).
        if (url.indexOf('source=lp') !== -1) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, stage: 'opened' }), text: () => Promise.resolve('{"ok":true,"stage":"opened"}') });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
      };
      // Sync/async XHR stub (config bootstrap may use XHR)
      function XHRStub() { this.readyState = 0; this.status = 0; this.responseText = ''; }
      XHRStub.prototype.open = function (m, url) { this._url = String(url); };
      XHRStub.prototype.setRequestHeader = function () {};
      XHRStub.prototype.send = function () {
        this.readyState = 4; this.status = 200;
        this.responseText = (this._url && this._url.indexOf('api=config') !== -1) ? JSON.stringify(cfg) : '{}';
        if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
        if (typeof this.onload === 'function') this.onload();
      };
      XHRStub.prototype.addEventListener = function (ev, fn) { if (ev === 'load') this.onload = fn; };
      window.XMLHttpRequest = XHRStub;
      // canvas signature pad stub
      window.HTMLCanvasElement.prototype.getContext = function () {
        return {
          fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
          save() {}, restore() {}, scale() {}, setTransform() {}, fillText() {}, translate() {},
          measureText() { return { width: 10 }; }, getImageData() { return { data: [] }; },
          putImageData() {}, drawImage() {}, closePath() {}, arc() {},
          fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', font: '', textAlign: '', textBaseline: ''
        };
      };
      window.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,iVBORw0KGgo='; };
      // Google Places stub
      window.google = {
        maps: {
          places: {
            Autocomplete: function () { this.addListener = function () {}; this.getPlace = function () { return {}; }; },
            AutocompleteService: function () {}, PlacesService: function () {}
          },
          event: { addListener() {}, clearInstanceListeners() {} }
        }
      };
      window.matchMedia = window.matchMedia || function () {
        return { matches: false, media: '', addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
      };
      window.scrollTo = function () {};
      window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(Date.now()); }, 0); };
      window.cancelAnimationFrame = function (id) { clearTimeout(id); };
    }
  });

  const window = dom.window;
  await new Promise((r) => {
    if (window.document.readyState === 'complete') return r();
    window.addEventListener('load', r);
    setTimeout(r, 1500); // safety
  });
  await new Promise((r) => setTimeout(r, 80)); // settle async config + engine
  return { dom, window, document: window.document, errors };
}

// --- introspection helpers (the REAL rendered state) ---

// An element is effectively visible if neither it nor any ancestor has hidden.
function isVisible(el) {
  let n = el;
  while (n && n.nodeType === 1) {
    if (n.hasAttribute && n.hasAttribute('hidden')) return false;
    n = n.parentElement;
  }
  return true;
}

// Find the visible page section currently shown.
function visiblePages(document) {
  return Array.from(document.querySelectorAll('.lvp-page')).filter((p) => !p.hidden).map((p) => p.getAttribute('data-page'));
}

module.exports = { loadForm, makeCfg, isVisible, visiblePages };
