/**
 * board-grid-fits-harness.cjs (2026-09-10, defect q60)
 *
 * THE CLASS THIS PREVENTS: the operator board painting, clipping or hiding any
 * part of a money row at some viewport width.
 *
 * It has now been the same defect three times, and each fix made the next one.
 * The 2026-08-26 review's finding 19 was the grid overflowing the card at a
 * 1024 viewport, and its fix ADDED a max-width:1250px band. On 2026-09-10 the
 * same overflow was live at 601-800 (measured: 49 of 281 widths painting past
 * the card, worst 328px at 608), because a @media query cannot see the 210px
 * sidebar, the gutters or a docked record pane, so the width the CSS reasons
 * about is never the width the board has. The first attempt at THIS fix made
 * the card a horizontal scroller, which traded painted overflow for hidden
 * columns behind a macOS overlay scrollbar that draws nothing, names clipped
 * by a two-line clamp in a 120px track, and a popover that stopped following
 * its anchor.
 *
 * So the assertions here are about what the OPERATOR CAN SEE, and they are
 * measured, not read. Three things this file will not accept:
 *   - a pixel of a row painted outside the card
 *   - a name that is clipped, or that fills its clamp with no spare line
 *   - anything reachable only by scrolling inside the card
 *
 * WHY IT DRIVES A REAL BROWSER. The predecessor of this file asserted on
 * DECLARED CSS values parsed out of the stylesheet, and that is what let the
 * scroller version through: it declared only overflow-x:auto, so the harness
 * saw nothing about the vertical axis, while the CSS spec makes overflow-y
 * COMPUTE to auto whenever the other axis is not visible. The card had quietly
 * gained a vertical clip that no reading of the source could show. jsdom does
 * not help either: it does no layout, so it cannot tell a fitting grid from an
 * overflowing one. Every check below reads getComputedStyle or a measured rect
 * out of headless Chrome. If Chrome is not present this file FAILS rather than
 * skipping: an unrun check is not a passing one.
 *
 * The rows are rendered by console/index.html's OWN rowHtml, called in the
 * page, so the markup under test is the shipped markup rather than a copy of
 * it that can drift.
 *
 * Run: node test/board-grid-fits-harness.cjs
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PAGE = path.join(__dirname, '..', 'console', 'index.html');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('FAIL', label, extra === undefined ? '' : String(extra).slice(0, 400)); }
}

// ---------------------------------------------------------------- the browser
const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
function chromeBin() {
  for (const c of CHROME) if (fs.existsSync(c)) return c;
  const pw = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  if (fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw)) {
      for (const leaf of ['Chromium.app/Contents/MacOS/Chromium', 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing']) {
        const p = path.join(pw, d, 'chrome-mac', leaf);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

async function launch() {
  const bin = chromeBin();
  if (!bin) throw new Error('no Chrome/Chromium binary found. This harness measures real layout and cannot assert anything without one.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-grid-'));
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + dir,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--force-device-scale-factor=1', '--allow-file-access-from-files', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error('chrome did not report a debug url in 25s')), 25000);
    proc.stderr.on('data', (d) => { buf += d.toString(); const m = /ws:\/\/[^\s]+/.exec(buf); if (m) { clearTimeout(t); res(m[0]); } });
    proc.on('exit', (c) => { clearTimeout(t); rej(new Error('chrome exited ' + c)); });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('cdp socket failed')); });
  let id = 0; const waiting = new Map(); const loaded = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { const w = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? w.rej(new Error(msg.error.message)) : w.res(msg.result); }
    else if (msg.method === 'Page.loadEventFired') loaded.forEach((f) => f());
  };
  const raw = (method, params, sessionId) => new Promise((res, rej) => { const mid = ++id; waiting.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId })); });
  const { targetId } = await raw('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await raw('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => raw(m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable');
  return {
    async goto(url) { const done = new Promise((r) => loaded.push(r)); await S('Page.navigate', { url }); await done; },
    setSize: (width, height) => S('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }),
    async js(expr) {
      const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (r.exceptionDetails) throw new Error('page threw: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
      return r.result.value;
    },
    close() { try { ws.close(); } catch (e) {} try { proc.kill('SIGKILL'); } catch (e) {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} },
  };
}

// ---------------------------------------------------------------- the fixture
// SYNTHETIC names, never a real LP's. Lengths are what matter: 60 Latin
// characters and 44 Hebrew ones are the long tail this board actually carries
// (a partnership or fund-of-funds entity rather than a person), and they are
// the shapes every previous version of this defect clipped.
const HE = 'בדיקה עמק התכלת פאנד אוף פאנדס, שותפות מוגבלת';
const EN = 'Northwind Evergreen Diversified Holdings Limited Partnership';
const ROWS = JSON.stringify([
  { pid: 'p-aaaaaaaa-1', name: EN, he: HE, lane: 'israel', stage: 'needs_attention', amountNum: 12450000, ccy: 'ILS', age: '365d', nextActionPhrase: 'Waiting on the operator to countersign the subscription pack', attnWhy: 'Seal refused by the server' },
  { pid: 'p-bbbbbbbb-2', name: HE, he: '', lane: 'cayman', stage: 'signing', amountNum: 12450000, ccy: 'ILS', age: '12d', nextActionPhrase: 'Waiting on the investor' },
  { pid: 'p-cccccccc-3', name: EN, he: '', lane: 'cayman', stage: 'submitted', amountNum: 9800000, ccy: 'USD', age: '3d', nextActionPhrase: 'Waiting on the lawyer' },
]);

// Widths: both band boundaries either side, every width the two live incidents
// were measured at, and the phone. A dense 320-2560 sweep in 8px steps was run
// by hand on the day this landed (0 outside the card at all 281, in each of
// four shell states); this set is that sweep's edges, kept small enough to sit
// in a pre-push gate.
const WIDTHS = [320, 360, 375, 414, 480, 540, 600, 601, 608, 640, 700, 776, 800, 830, 896, 960, 1024, 1100, 1250, 1251, 1280, 1400, 1440, 1512, 1650, 1920, 2560];

const MEASURE = `(function(){
  var card = document.getElementById('board-card');
  var cs = getComputedStyle(card);
  var cr = card.getBoundingClientRect();
  var left = cr.left + (parseFloat(cs.borderLeftWidth)||0);
  var right = cr.right - (parseFloat(cs.borderRightWidth)||0);
  var worst = 0, worstWhat = '';
  var els = card.querySelectorAll('*');
  for (var i=0;i<els.length;i++){
    var e = els[i], s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    var b = e.getBoundingClientRect();
    if (!b.width && !b.height) continue;
    var over = Math.max(b.right - right, left - b.left, 0);
    if (over > worst) { worst = over; worstWhat = String(e.className || e.tagName); }
  }
  var clipped = [], tight = [];
  var names = card.querySelectorAll('.rn-name, .rhe');
  for (var j=0;j<names.length;j++){
    var n = names[j], ns = getComputedStyle(n);
    if (ns.display === 'none') continue;
    if (n.scrollHeight - n.clientHeight > 1) clipped.push(n.textContent.slice(0,20) + ' [' + n.clientHeight + ' of ' + n.scrollHeight + 'px]');
    var lh = parseFloat(ns.lineHeight), bound = parseInt(ns.webkitLineClamp, 10);
    if (lh && bound) { var used = Math.round(n.scrollHeight / lh); if (bound - used < 1) tight.push(n.textContent.slice(0,20) + ' uses ' + used + ' of ' + bound + ' clamp lines'); }
  }
  var moneyCut = [];
  var amts = card.querySelectorAll('.ramt');
  for (var k=0;k<amts.length;k++){ var a=amts[k]; if(getComputedStyle(a).display==='none')continue;
    if (a.scrollWidth - a.clientWidth > 1) moneyCut.push(a.textContent + ' [' + a.clientWidth + ' of ' + a.scrollWidth + 'px]'); }
  return {
    cardW: Math.round(cr.width),
    outside: Math.round(worst * 100) / 100, outsideWhat: worstWhat,
    overflowX: cs.overflowX, overflowY: cs.overflowY, containerType: cs.containerType,
    hiddenX: card.scrollWidth - card.clientWidth, hiddenY: card.scrollHeight - card.clientHeight,
    clipped: clipped, tight: tight, moneyCut: moneyCut
  };
})()`;

(async () => {
  const html = fs.readFileSync(PAGE, 'utf8');

  // ------------------------------------------------------- 1. source guards
  // Two things that are about INTENT rather than pixels, so they are read from
  // the source and named here: a future session must not answer a narrow board
  // by choosing another viewport number, and must not put the scroller back.
  // Walk the braces rather than regexing across them: which AT-RULE a
  // --board-cols declaration sits inside is the whole question, and a regex
  // that can run past a closing brace answers a different one.
  // Comments are stripped first, and that is not tidiness: the prose above the
  // base #list rule explains the @container bands, so a scan that can see
  // comment text reads that rule as sitting inside one.
  const css = (html.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  function bandsSetting(prop) {
    const found = { media: 0, container: 0, top: 0 };
    const stack = [];
    for (let i = 0; i < css.length; i++) {
      if (css[i] === '{') {
        const head = css.slice(Math.max(0, i - 200), i);
        const at = /@(media|container)[^{};]*$/.exec(head);
        stack.push(at ? at[1] : (stack.length ? stack[stack.length - 1] : null));
      } else if (css[i] === '}') stack.pop();
      else if (css.startsWith(prop, i)) {
        const inside = stack.filter(Boolean);
        if (inside.includes('media')) found.media++;
        else if (inside.includes('container')) found.container++;
        else found.top++;
      }
    }
    return found;
  }
  // Only count DECLARATIONS, so the prose above --board-cols does not.
  const bands = bandsSetting('--board-cols:');
  ok('no @media band sets --board-cols (the board is sized by its CONTAINER, not the viewport)',
    bands.media === 0,
    bands.media + ' @media block(s) still set --board-cols. A viewport number cannot see the sidebar or a docked pane; that is what finding 19 and q60 both were. Put the band in the @container query beside --board-cols instead.');
  ok('the board still redefines its columns in at most 2 container bands',
    bands.container > 0 && bands.container <= 2,
    bands.container + ' @container bands set --board-cols. More than two means a column set was added rather than a column let go.');

  const browser = await launch();
  try {
    await browser.setSize(1440, 900);
    await browser.goto('file://' + PAGE);
    await new Promise((r) => setTimeout(r, 700));

    const n = await browser.js(`(function(){
      if (typeof rowHtml !== 'function') return 0;
      var bhead='<div class="bhead"><span>Investor</span><span class="h-flow">Type</span><span class="h-amt">Amount</span><span>Status</span><span class="h-age">Age</span><span></span></div>';
      document.getElementById('list').innerHTML = bhead + ${ROWS}.map(function(r){return rowHtml(r);}).join('');
      // A fixed z-1000 overlay that sits ON the board without affecting its
      // layout. Hidden so the sweep never measures a row it has covered.
      var g = document.getElementById('login-screen'); if (g) g.style.display = 'none';
      return document.querySelectorAll('#list .row').length;
    })()`);
    ok("console/index.html's own rowHtml rendered the fixture rows", n === 3, n + ' rows. If rowHtml moved or was renamed, this harness is measuring nothing.');
    if (n !== 3) throw new Error('no rows to measure');

    // --------------------------------------------------- 2. computed, not declared
    const base = await browser.js(MEASURE);
    ok('#board-card is a SIZE CONTAINER, so every band is a question about the card and not the viewport',
      /inline-size/.test(base.containerType || ''),
      'computed container-type is "' + base.containerType + '"');
    // Read on BOTH axes and computed, deliberately. The scroller version
    // declared overflow-x alone; overflow-y computing to auto behind it is
    // exactly the kind of thing a source read cannot see.
    ok('#board-card does not clip or scroll HORIZONTALLY (computed overflow-x is visible)',
      base.overflowX === 'visible',
      'computed overflow-x is "' + base.overflowX + '". A scroll here hides money columns behind a macOS overlay scrollbar that draws nothing.');
    ok('#board-card does not clip or scroll VERTICALLY (computed overflow-y is visible)',
      base.overflowY === 'visible',
      'computed overflow-y is "' + base.overflowY + '". Note this can happen without anyone writing it: per spec overflow-y computes to auto whenever overflow-x is not visible.');

    // ------------------------------------------------------------ 3. the sweep
    for (const w of WIDTHS) {
      await browser.setSize(w, 900);
      await browser.js('document.body.offsetHeight');
      const m = await browser.js(MEASURE);
      const at = 'at a ' + w + 'px viewport (card ' + m.cardW + 'px)';
      ok('nothing paints outside the card ' + at, m.outside <= 0.5,
        m.outside + 'px of "' + m.outsideWhat + '" outside the card. Do NOT answer this with a breakpoint or a scroller: let a column go, or stack the row.');
      ok('no name is clipped ' + at, m.clipped.length === 0, m.clipped.join(' | '));
      ok('every name keeps a spare clamp line ' + at, m.tight.length === 0,
        m.tight.join(' | ') + ' - a clamp with no spare line is a clip waiting for a slightly longer name, which is what aa426b4 found.');
      ok('the amount is never ellipsised ' + at, m.moneyCut.length === 0,
        m.moneyCut.join(' | ') + ' - a truncated figure renders a DIFFERENT, smaller number.');
      ok('nothing in the card is reachable only by scrolling ' + at, m.hiddenX <= 0 && m.hiddenY <= 0,
        m.hiddenX + 'px horizontally and ' + m.hiddenY + 'px vertically out of view.');
    }

    // --------------------------------- 4. the same sweep with the record DOCKED
    // A docked pane is the case no @media query could ever see: a narrow board
    // at a wide viewport. It had its own --board-cols override and its own
    // clamp until this rework; both are gone, so this proves the general rule
    // covers what the special case used to.
    await browser.setSize(1440, 900);
    const undocked = await browser.js('Math.round(document.getElementById("board-card").getBoundingClientRect().width)');
    const docked = await browser.js(`(function(){var p=document.querySelector('.panel#drawer'); if(!p) return 0; p.classList.add('dock','on'); document.body.offsetHeight; return Math.round(document.getElementById('board-card').getBoundingClientRect().width);})()`);
    ok('the docked record pane really does narrow the board (otherwise the checks below prove nothing)',
      docked > 0 && docked < undocked - 100,
      'card went ' + undocked + 'px -> ' + docked + 'px at a 1440 viewport');
    for (const w of [1400, 1440, 1512, 1600, 1650, 1920]) {
      await browser.setSize(w, 900);
      await browser.js('document.body.offsetHeight');
      const m = await browser.js(MEASURE);
      const at = 'at a ' + w + 'px viewport with the record DOCKED (card ' + m.cardW + 'px)';
      ok('nothing paints outside the card ' + at, m.outside <= 0.5, m.outside + 'px of "' + m.outsideWhat + '" outside');
      ok('no name is clipped ' + at, m.clipped.length === 0, m.clipped.join(' | '));
      ok('every name keeps a spare clamp line ' + at, m.tight.length === 0, m.tight.join(' | '));
      ok('nothing is reachable only by scrolling ' + at, m.hiddenX <= 0 && m.hiddenY <= 0, m.hiddenX + ' / ' + m.hiddenY);
    }
  } finally {
    browser.close();
  }

  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL harness could not run:', e.message); console.log(`${pass} pass, ${fail + 1} fail`); process.exit(1); });
