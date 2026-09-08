// upload-accept-allowlist-harness.cjs (2026-09-08)
//
// ONE invariant, asserted over EVERY file input signer.html can render:
//
//   for every MIME type listed in an input's accept="" attribute, picking a
//   file of that type must be ACCEPTED by the page's own runtime gate; and a
//   type outside that list must be REFUSED, visibly.
//
// Why this matters, concretely: the controlling-person / joint-holder ID
// uploader (renderIdUploads) shipped with accept="image/*,application/pdf"
// and NO runtime type check at all. The accept attribute is advisory - every
// OS picker offers an "all files" escape and a renamed extension defeats it
// regardless - so a .docx passed the client, the server's magic-byte sniff
// (apps/ju-service/src/domain/kyc.ts sniffUploadMime) rejected it as
// UPLOAD_TYPE_REJECTED, and the CP was recorded as SIGNED with no
// identification on file. Nobody found out until someone opened the KYC
// folder. The sibling gates on the same page (handleLawyerStamp, the paper
// scan) each had a hand-written check and were fine; the one without a check
// was the one that bit.
//
// So the harness does not test the fixed input. It tests the CLASS: it walks
// every [type=file] the page renders across every signer role, reads that
// input's own accept list, and drives a real change event through the REAL
// page for each type. Add another uploader with a missing or drifted gate and
// this goes red without anyone remembering to extend it.
//
// It boots the real signer.html in jsdom via rig-signer.cjs. Nothing about the
// gates is stubbed.
//
// Run: node test/upload-accept-allowlist-harness.cjs
'use strict';
const { loadSignerPage, makeSignerCtx } = require('./rig-signer.cjs');

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); } }

// Types no upload gate on this page may ever accept. sniffUploadMime returns
// '' for all of them, so the server would refuse the bytes; a client that
// takes them silently loses the document.
const MUST_REJECT = [
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'id.docx'],
  ['text/plain', 'notes.txt'],
  ['image/svg+xml', 'id.svg'],
  ['video/mp4', 'clip.mp4'],
  ['', 'id.unknownext'],
];

function attach(window, input, mime, name) {
  const f = new window.File([new Uint8Array([1, 2, 3, 4])], name, { type: mime });
  Object.defineProperty(input, 'files', { value: [f], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

// The visible error surface for a given input: the paper-scan control has its
// own #paper-err, everything else shares #err.
function errorTextFor(document, input) {
  const own = input.getAttribute('data-paper-upload') ? document.getElementById('paper-err') : document.getElementById('err');
  return own ? String(own.textContent || '').trim() : '';
}
function clearErrors(document) {
  ['err', 'paper-err'].forEach((id) => { const el = document.getElementById(id); if (el) el.textContent = ''; });
}

// Every signer shape that renders an uploader. cp1 renders the four ID slots;
// the lawyer renders the stamp, and the paper-scan control too once the server
// has sent printableDocs (signerform emits those only on that leg).
const SHAPES = [
  { label: 'cayman cp1 (ID slots)', ctx: makeSignerCtx({ lane: 'cayman', role: 'cp1' }) },
  { label: 'israeli subscriber2 (joint holder ID slots)', ctx: makeSignerCtx({ lane: 'israeli', role: 'subscriber2' }) },
  {
    label: 'israeli lawyer (stamp + paper scan)',
    ctx: makeSignerCtx({
      lane: 'israeli',
      role: 'lawyer',
      printableDocs: [{ key: 'israeli_ind_qual', title: 'Qualification', html: '<p>Body</p>' }],
    }),
  },
];

(async () => {
  let inputsSeen = 0;
  for (const shape of SHAPES) {
    const rig = await loadSignerPage({ ctx: shape.ctx });
    const { document, window } = rig;
    // The paper panel is collapsed until the attester opens it; its input is in
    // the DOM either way, which is what we walk.
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    ok(shape.label + ': renders at least one upload input', inputs.length > 0, { found: inputs.length });

    for (const input of inputs) {
      const id = input.getAttribute('id') || input.getAttribute('name') || '(anonymous)';
      const accept = String(input.getAttribute('accept') || '');
      inputsSeen++;

      // A file input with no accept list is itself the defect: it tells the
      // picker nothing and, historically on this page, meant no gate either.
      ok(shape.label + ' / ' + id + ': declares an accept list', accept.length > 0, { accept });
      // image/* (or any wildcard) is not an allowlist - it offers SVG, which the
      // server sniff refuses. Every entry must be a concrete type.
      const types = accept.split(',').map((s) => s.trim()).filter(Boolean);
      ok(shape.label + ' / ' + id + ': accept lists concrete types, no wildcard',
        types.length > 0 && types.every((t) => t.indexOf('*') === -1), { accept });

      // THE INVARIANT, forward direction: everything the input advertises is
      // actually taken by the runtime gate.
      for (const t of types) {
        clearErrors(document);
        attach(window, input, t, 'sample' + t.replace(/[^a-z0-9]/gi, ''));
        await rig.settle(30);
        ok(shape.label + ' / ' + id + ': accepts its own advertised type ' + t,
          errorTextFor(document, input) === '', { type: t, error: errorTextFor(document, input) });
      }

      // Reverse direction: a type outside the list is refused, and refused
      // VISIBLY. A silent drop is the failure this whole harness exists for.
      for (const [mime, name] of MUST_REJECT) {
        if (types.indexOf(mime) !== -1) continue;
        clearErrors(document);
        attach(window, input, mime, name);
        await rig.settle(30);
        ok(shape.label + ' / ' + id + ': refuses ' + (mime || '(empty type)') + ' with a visible message',
          errorTextFor(document, input) !== '', { mime, name });
      }
    }
    ok(shape.label + ': page booted without a script error', rig.errors.length === 0, rig.errors.slice(0, 2));
  }

  ok('walked every upload input across all signer shapes', inputsSeen >= 6, { inputsSeen });
  console.log(pass + ' pass, ' + fail + ' fail (' + inputsSeen + ' upload inputs walked)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack || e); process.exit(1); });
