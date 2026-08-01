/**
 * doc-sanitize.js - shared security pass for the server-rendered subscription-
 * pack HTML previewed on index.html, israel.html, and signer.html (2026-08-02,
 * CTO review finding #2).
 *
 * Each of those three pages independently builds its own doc-preview DOM from
 * a Google-Docs-export HTML blob the ju-cayman backend returns, and each has
 * its OWN, genuinely different geometry/chrome-scrubbing logic tailored to
 * its own card layout - that display logic stays where it is, unchanged.
 *
 * What none of the three did: strip event-handler attributes (onerror=,
 * onload=, onclick=, ...) or neutralize javascript:/data: URLs. A <script>
 * tag inserted via innerHTML never executes (browser spec), so that vector
 * was already closed; an <img onerror="..."> or an <a href="javascript:...">
 * is not - those DO fire once parsed into the live DOM. This function is the
 * one shared security pass; call it AFTER each page's own display-oriented
 * processing, on the already-built container element, right before it goes
 * on screen.
 *
 * Trust boundary: this defends the LP/signer's browser against whatever the
 * backend's Docs-export merge produces, not against the backend itself - the
 * real fix for a compromised or malformed backend response is server-side
 * escaping of LP-entered free text before it's merged into the template.
 * This is defense in depth, not a replacement for that.
 */
(function (global) {
  'use strict';
  var DANGEROUS_TAGS = ['script', 'iframe', 'object', 'embed', 'link[rel="import"]'];
  var URL_ATTRS = ['href', 'src', 'action', 'formaction', 'xlink:href'];

  function isDangerousUrl(v) {
    var s = String(v || '').trim().toLowerCase();
    return s.indexOf('javascript:') === 0 || s.indexOf('vbscript:') === 0 || s.indexOf('data:text/html') === 0;
  }

  function lvpSanitizeDocHtml_(container) {
    if (!container || !container.querySelectorAll) return container;
    DANGEROUS_TAGS.forEach(function (sel) {
      var els = container.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) { if (els[i].parentNode) els[i].parentNode.removeChild(els[i]); }
    });
    var all = container.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) {
      var el = all[j];
      // getAttributeNames + removeAttribute (not a live loop over .attributes,
      // which reindexes as you remove and would skip entries).
      var names = el.getAttributeNames ? el.getAttributeNames() : [];
      for (var k = 0; k < names.length; k++) {
        var name = names[k];
        if (/^on/i.test(name)) { el.removeAttribute(name); continue; }
        if (URL_ATTRS.indexOf(name.toLowerCase()) !== -1 && isDangerousUrl(el.getAttribute(name))) {
          el.removeAttribute(name);
        }
      }
    }
    return container;
  }

  global.lvpSanitizeDocHtml_ = lvpSanitizeDocHtml_;
})(typeof window !== 'undefined' ? window : globalThis);
