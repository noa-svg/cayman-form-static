// signer-sticky-token-key-harness.cjs (2026-08-21).
//
// LOCKS THE FIX for signer.html's dual-gateway sticky flag, which used to be
// stored under a BARE sessionStorage key ('lvp_signer_legacy') while all three
// sibling pages key theirs BY TOKEN (index.html lvp_idx_legacy_gw_v1_<token>,
// israel.html lvp_il_legacy_gw_v1_<token>, flow.html lvp_fl_legacy_gw_v1_<token>).
//
// The bare key scoped the pin to the TAB instead of to the signing session: a
// signer who completed a GAS-minted leg and then opened a DIFFERENT signer link
// that ju-service minted, in the same tab, inherited useLegacyGateway=true and
// posted save_signer_progress / record_signature to GAS - which does not own
// that process. Nothing re-probes once sticky, so it never self-corrected.
// Latent only while every Cayman process is still GAS-minted; live the moment
// Cayman minting flips to ju-service.
//
// The tests below prove BOTH halves, because token-keying must not weaken the
// property the stickiness exists for:
//   T1  same token, flag set  -> STILL pins to legacy (no engine split mid-flow)
//   T2  different token       -> does NOT inherit the pin (the defect)
//   T3  ?sign= token spelling -> pins identically to ?t= (signer.html reads both)
//   T4  stale BARE key        -> deliberately IGNORED, never read-migrated
//   T5  no token at all       -> never sticky, never reads storage
//   T6  the winning legacy probe WRITES the token-scoped key, not the bare one
//   T7  no bare-key literal survives anywhere in signer.html
//
// Both source slices are extracted from the LIVE signer.html by exact anchors,
// so a future edit that moves or renames the seam fails this harness loudly
// instead of leaving it testing a stale copy.
//
// Run: node test/signer-sticky-token-key-harness.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'signer.html'), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra)); }
}

// ---- slice 1: the boot block that derives TOKEN + the sticky key -----------
const B_START = "var JU_API = 'https://ju-api.legacyvpartners.com';";
const B_END = 'var GW = useLegacyGateway ? LEGACY_GATEWAY : JU_API;';
const bs = html.indexOf(B_START);
const be = html.indexOf(B_END);
if (bs < 0 || be < 0 || be < bs) {
  throw new Error('signer-sticky-token-key-harness: could not locate the gateway boot block (seam changed)');
}
const bootSrc = html.slice(bs, be + B_END.length);

function fakeStorage(seed) {
  const map = Object.assign({}, seed || {});
  const reads = [], writes = [];
  return {
    reads, writes, map,
    getItem: (k) => { reads.push(k); return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem: (k, v) => { writes.push(k); map[k] = String(v); },
    removeItem: (k) => { delete map[k]; }
  };
}

// Runs the REAL boot block against a synthetic query string + storage.
function boot(search, seed) {
  const store = fakeStorage(seed);
  const env = new Function(
    'location', 'sessionStorage', 'URLSearchParams',
    bootSrc + '; return { TOKEN: TOKEN, signerStickKey: signerStickKey,' +
    ' useLegacyGateway: useLegacyGateway, GW: GW, JU_API: JU_API, LEGACY_GATEWAY: LEGACY_GATEWAY };'
  )({ search: search }, store, URLSearchParams);
  env.store = store;
  return env;
}

const A = 'TOKEN_AAA';
const B = 'TOKEN_BBB';
const keyFor = (t) => 'lvp_signer_legacy_gw_v1_' + t;

// ---- T1: within ONE token's session the pin still holds --------------------
(function () {
  const e = boot('?t=' + A, { [keyFor(A)]: '1' });
  ok('T1 same token stays pinned to legacy', e.useLegacyGateway === true);
  ok('T1 same token GW is the legacy gateway', e.GW === e.LEGACY_GATEWAY, e.GW);
})();

// ---- T2: a DIFFERENT token does not inherit the pin (the defect) -----------
(function () {
  const e = boot('?t=' + B, { [keyFor(A)]: '1' });
  ok('T2 different token is NOT pinned', e.useLegacyGateway === false);
  ok('T2 different token GW is the ju-service primary', e.GW === e.JU_API, e.GW);
  ok('T2 the key it consulted was its own token key',
    e.store.reads.length === 1 && e.store.reads[0] === keyFor(B), JSON.stringify(e.store.reads));
})();

// ---- T3: ?sign= is the same token, same pin --------------------------------
(function () {
  const e = boot('?sign=' + A, { [keyFor(A)]: '1' });
  ok('T3 ?sign= resolves the token', e.TOKEN === A, e.TOKEN);
  ok('T3 ?sign= pins identically to ?t=', e.useLegacyGateway === true && e.GW === e.LEGACY_GATEWAY);
})();

// ---- T4: the OLD bare key is ignored, not read-migrated --------------------
// Deliberate: a bare entry carries no record of WHICH token set it, so honoring
// it IS the bug. Cost of ignoring is one extra legacy probe on the genuinely
// GAS-owned token - the ordinary cold-boot path, already proven safe.
(function () {
  const e = boot('?t=' + B, { lvp_signer_legacy: '1' });
  ok('T4 stale bare key does not pin a new token', e.useLegacyGateway === false);
  ok('T4 stale bare key is never even read', e.store.reads.indexOf('lvp_signer_legacy') === -1,
    JSON.stringify(e.store.reads));
  // ...and it is not resurrected for the token it may genuinely have belonged to.
  const e2 = boot('?t=' + A, { lvp_signer_legacy: '1' });
  ok('T4 bare key does not pin ANY token', e2.useLegacyGateway === false);
})();

// ---- T5: a tokenless load never touches storage ----------------------------
(function () {
  const e = boot('', { lvp_signer_legacy: '1', [keyFor(A)]: '1' });
  ok('T5 no token -> not sticky', e.useLegacyGateway === false);
  ok('T5 no token -> zero storage reads', e.store.reads.length === 0, JSON.stringify(e.store.reads));
  ok('T5 no token -> GW is the primary', e.GW === e.JU_API);
})();

// ---- slice 2: the loader, to prove the WRITE side of the seam --------------
const L_START = 'var signerformRetriesLeft_ = 2;';
const L_END = "document.getElementById('retry-btn').onclick = loadSignerForm;";
const ls = html.indexOf(L_START);
const le = html.indexOf(L_END);
if (ls < 0 || le < 0 || le < ls) {
  throw new Error('signer-sticky-token-key-harness: could not locate loadSignerForm block');
}
const loadSrc = html.slice(ls, le);

// ---- T6: a winning legacy probe writes the TOKEN-SCOPED key ----------------
(function () {
  const xhrs = [];
  function XHRStub() {
    const self = this;
    self.open = function (m, u) { self.url = u; };
    self.send = function () { xhrs.push(self); };
  }
  const store = fakeStorage({});
  const env = new Function(
    'XMLHttpRequest', 'setTimeout', 'window', 'GW', 'TOKEN', 'LEGACY_GATEWAY',
    'useLegacyGateway', 'signerStickKey', 'sessionStorage',
    'show', 'applyLang', 'setLaneFromCtx_', 'renderSignerForm',
    loadSrc + '; return { loadSignerForm: loadSignerForm };'
  )(
    XHRStub, () => {}, { console: { log: () => {} } },
    'https://ju-api.legacyvpartners.com', A, 'https://legacy.invalid/exec',
    false, keyFor(A), store,
    () => {}, () => {}, () => {}, () => {}
  );

  env.loadSignerForm();
  ok('T6 primary attempt fired', xhrs.length === 1);
  // ju-service does not own this token: HTTP 200, signature-vocabulary reason.
  xhrs[0].readyState = 4;
  xhrs[0].status = 200;
  xhrs[0].responseText = JSON.stringify({ ok: false, reason: 'invalid_sig' });
  xhrs[0].onreadystatechange();
  ok('T6 legacy probe fired', xhrs.length === 2 && String(xhrs[1].url).indexOf('https://legacy.invalid/exec') === 0,
    xhrs.length === 2 ? xhrs[1].url : String(xhrs.length));
  // Legacy owns it.
  xhrs[1].readyState = 4;
  xhrs[1].status = 200;
  xhrs[1].responseText = JSON.stringify({ ok: true, lane: 'israeli' });
  xhrs[1].onreadystatechange();
  ok('T6 stickiness written under the token-scoped key',
    store.map[keyFor(A)] === '1', JSON.stringify(store.map));
  ok('T6 the bare key is NOT written',
    !Object.prototype.hasOwnProperty.call(store.map, 'lvp_signer_legacy'), JSON.stringify(store.writes));
})();

// ---- T7: no bare-key literal survives in the page --------------------------
(function () {
  const bare = /'lvp_signer_legacy'/.test(html) || /"lvp_signer_legacy"/.test(html);
  ok('T7 no bare sticky-key literal left in signer.html', !bare);
  ok('T7 the token-scoped key prefix is present',
    html.indexOf("'lvp_signer_legacy_gw_v1_' + TOKEN") !== -1);
})();

console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
