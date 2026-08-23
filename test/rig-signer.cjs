/**
 * rig-signer.cjs (2026-08-23) - jsdom boot rig for the SIGNER page
 * (../signer.html), the third sibling of rig-flow.cjs / rig-israel.cjs.
 *
 * signer.html had no full-boot rig: every existing signer harness extracts a
 * function out of the file with brace-counting and drives it in isolation.
 * That is fine for a single function's own logic, but it cannot answer the
 * questions the doc-ready gate and the lawyer-payload build actually raise,
 * which are about what the REAL page does end to end: did a signature POST
 * leave this page, and what was in it. So this rig boots the real file.
 *
 * What it stubs, and why each stub is honest:
 *   - XMLHttpRequest. signer.html uses it for BOTH the ?api=signerform boot
 *     fetch and every POST. The stub answers signerform from opts.ctx and
 *     records every other send in xhrCalls, so "did a record_signature POST
 *     leave the page" is directly observable. A POST settles 200 {ok:true}.
 *   - <script src>. jsdom under runScripts:'dangerously' does not fetch
 *     external scripts, so validation-rules.js and doc-sanitize.js are
 *     inlined verbatim, exactly as rig-flow.cjs does.
 *   - canvas 2d context. jsdom has no canvas backend. getImageData returns a
 *     fully-inked buffer so the page's own canvasHasInk() blank-signature
 *     backstop reads a typed/drawn signature as real ink; it is not bypassed.
 *
 * Nothing about the gates under test is stubbed: renderDynamic, the doc
 * renderer, doSignSubmit_ and every gate inside it run as shipped.
 *
 * Usage:
 *   const { loadSignerPage, makeSignerCtx } = require('./rig-signer.cjs');
 *   const rig = await loadSignerPage({ ctx: makeSignerCtx({ docs: [...] }) });
 *   rig.document / rig.window / rig.xhrCalls / rig.errors
 *   await rig.signTyped('Test Signer');   // put a real signature on the pad
 *   await rig.attachFile('[data-stamp-upload]');
 *   rig.click('#done'); await rig.settle();
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', 'signer.html');
const RULES_PATH = path.join(__dirname, '..', 'validation-rules.js');
const SANITIZE_PATH = path.join(__dirname, '..', 'doc-sanitize.js');

// The ok:true signerform envelope. Defaults are the simplest real shape: an
// Israeli-lane signer with one rendered document and no editable fields.
function makeSignerCtx(over) {
  return Object.assign({
    ok: true,
    lane: 'israeli',
    role: 'cp1',
    signerName: 'Test Signer',
    lockedContext: {},
    editableFields: { fields: [] },
    docs: [{ title: 'Subscription agreement', html: '<p>Body text</p>' }],
    savedData: null
  }, over || {});
}

function inline(html, tag, file, label) {
  if (html.indexOf(tag) === -1) throw new Error('rig-signer: ' + label + ' script tag not found (boot contract changed)');
  return html.replace(tag, '<script>\n' + fs.readFileSync(file, 'utf8') + '\n</script>');
}

async function loadSignerPage(opts) {
  opts = opts || {};
  const token = opts.token || 'SIGNTOKEN';
  const ctx = opts.ctx || makeSignerCtx();
  let html = fs.readFileSync(HTML_PATH, 'utf8');
  html = inline(html, '<script src="validation-rules.js"></script>', RULES_PATH, 'validation-rules.js');
  html = inline(html, '<script src="doc-sanitize.js"></script>', SANITIZE_PATH, 'doc-sanitize.js');

  const vc = new VirtualConsole();
  const errors = [];
  const logs = [];
  // Keep the STACK, not just the message: a bare "x is not a function" from
  // inside a 2000-line page is unactionable, and a rig that hides where the
  // throw came from is how a boot break gets mistaken for a test failure.
  vc.on('jsdomError', (e) => {
    const d = e && e.detail;
    errors.push(String((d && d.stack) || (e && e.stack) || (e && e.message) || e));
  });
  vc.on('error', (...a) => logs.push('error ' + a.join(' ')));
  vc.on('log', (...a) => logs.push(a.join(' ')));

  const xhrCalls = [];

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://sign.legacyvpartners.com/signer.html?t=' + encodeURIComponent(token),
    virtualConsole: vc,
    beforeParse(window) {
      function XHRStub() { this.readyState = 0; this.status = 0; this.responseText = ''; this.timeout = 0; }
      XHRStub.prototype.open = function (method, url) { this._method = method; this._url = String(url); };
      XHRStub.prototype.setRequestHeader = function () {};
      XHRStub.prototype.addEventListener = function () {};
      XHRStub.prototype.abort = function () {};
      XHRStub.prototype.send = function (body) {
        const self = this;
        xhrCalls.push({ url: self._url, method: self._method, body: body || null });
        // ASYNC on purpose. signer.html calls loadSignerForm() from the middle
        // of its own top-level script, and several page-level `var`s the render
        // path needs (CP_ID_SLOTS, for one) are only assigned FURTHER DOWN that
        // same script. A synchronously-settling stub renders before those exist
        // and throws where a real browser never would, i.e. it would invent a
        // failure. A macrotask hop reproduces the real ordering.
        function settle(status, text) {
          setTimeout(function () {
            self.status = status; self.responseText = text; self.readyState = 4;
            if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
          }, 0);
        }
        if (self._url.indexOf('api=signerform') !== -1) {
          if (opts.signerformXhr) {
            const r = opts.signerformXhr(self._url);
            if (r && r.network) { setTimeout(function () { if (self.onerror) self.onerror(); }, 0); return; }
            if (r && r.timeout) { setTimeout(function () { if (self.ontimeout) self.ontimeout(); }, 0); return; }
            if (r) { settle(r.status, JSON.stringify(r.body)); return; }
          }
          settle(200, JSON.stringify(ctx));
          return;
        }
        // Stale-tab self-fetch: serve the page source back with a matching
        // build tag so the guard never fires mid-test.
        if (self._url.indexOf('nocache=') !== -1) { settle(200, html); return; }
        settle(200, JSON.stringify({ ok: true }));
      };
      window.XMLHttpRequest = XHRStub;

      // A fully-opaque image buffer: canvasHasInk() counts alpha bytes, so the
      // page's real blank-signature backstop passes only because the test
      // actually put a signature on the pad (renderTypedName / draw events).
      window.HTMLCanvasElement.prototype.getContext = function () {
        return {
          fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
          save() {}, restore() {}, scale() {}, setTransform() {}, fillText() {}, translate() {},
          measureText() { return { width: 10 }; },
          getImageData(x, y, w, h) {
            const n = Math.max(1, (w || 1) * (h || 1)) * 4;
            const d = new Uint8ClampedArray(n);
            for (let i = 3; i < n; i += 4) d[i] = 255;
            return { data: d };
          },
          putImageData() {}, drawImage() {}, closePath() {}, arc() {},
          fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', font: '', textAlign: '', textBaseline: ''
        };
      };
      window.HTMLCanvasElement.prototype.toDataURL = function () {
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
      };
      // getBoundingClientRect: jsdom reports 0x0 for everything, and the pad's
      // own size()/refit logic keys off width. Give every element a real box.
      window.Element.prototype.getBoundingClientRect = function () {
        return { width: 320, height: 160, top: 0, left: 0, right: 320, bottom: 160, x: 0, y: 0 };
      };
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
  const settle = (ms) => new Promise((r) => setTimeout(r, ms || 150));
  await settle(200);

  const document = window.document;
  function q(sel) { return document.querySelector(sel); }
  function click(sel) {
    const el = typeof sel === 'string' ? q(sel) : sel;
    if (!el) throw new Error('rig-signer: nothing matches ' + sel);
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    return el;
  }
  // Put a REAL signature on the pad through the page's own Type mode: click the
  // mode button, type a name, fire input. renderTypedName then sets the page's
  // own dirty/points state exactly as it does for a live signer.
  async function signTyped(name) {
    click('[data-sig-mode="type"]');
    const inp = q('#sig-typed-input');
    if (!inp) throw new Error('rig-signer: #sig-typed-input missing');
    inp.value = name || 'Test Signer';
    inp.dispatchEvent(new window.Event('input', { bubbles: true }));
    await settle(50);
  }
  // Attach a file to an upload input the way a picker would, then wait for the
  // page's FileReader to finish reading it to base64.
  async function attachFile(sel, fileName) {
    const inp = q(sel);
    if (!inp) throw new Error('rig-signer: no upload input matches ' + sel);
    const f = new window.File([new Uint8Array([1, 2, 3, 4])], fileName || 'stamp.png', { type: 'image/png' });
    Object.defineProperty(inp, 'files', { value: [f], configurable: true });
    inp.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle(200);
  }
  function setField(name, value) {
    const el = document.querySelector('#signer-form [name="' + name + '"]');
    if (!el) throw new Error('rig-signer: no editable field named ' + name);
    if (el.type === 'checkbox') { el.checked = !!value; }
    else el.value = value;
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
    return el;
  }
  function posts() {
    return xhrCalls.filter((c) => c.body && String(c.body).indexOf('record_signature') !== -1);
  }

  return { dom, window, document, errors, logs, xhrCalls, q, click, settle, signTyped, attachFile, setField, posts };
}

module.exports = { loadSignerPage, makeSignerCtx };
