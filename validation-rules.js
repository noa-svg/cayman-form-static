/* validation-rules.js - D1 shared validation module (2026-07-09).
 *
 * ONE source of the Israeli-lane FORMAT rules, loaded by the live forms (israel.html)
 * AND by the node contract harness (ju-cayman/test/validation-contract-harness.cjs).
 * The rule bodies are ported VERBATIM from the authoritative server validator
 * (ju-cayman/IsraeliValidation.js) so the client accepts exactly what the server
 * accepts: an LP never passes a client check only to hit an opaque server bounce, and
 * a value the server rejects is caught inline. Retires debt #2 (client/server drift).
 *
 * The server (GAS, no filesystem) keeps its own copy of these primitives; the harness
 * asserts THIS module and IsraeliValidation.js agree input-for-input, so the two copies
 * cannot silently diverge. validation-rules.json is the field->rule MAP; this file is
 * the rule IMPLEMENTATIONS.
 *
 * UMD: attaches window.LVPRules in the browser, exports in node. No dependencies.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LVPRules = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── primitives (verbatim ports of IsraeliValidation.js) ──────────────────────
  // 2026-08-09: period added, mirroring ju-cayman's IsraeliValidation.ts
  // ISRAELI_HE_RE_ fix (commit ea89a9a, Alex Glotzky). This module's own
  // header claims a contract harness keeps it in sync with the server - no
  // such harness exists yet (2026-08-09 duplication audit), which is exactly
  // how this copy drifted from the fix in the first place.
  var HE_RE       = /^[א-ת׳״\s'".\-]+$/;
  var EN_RE       = /^[A-Za-z\s'"\-]+$/;
  var DIGITS_RE   = /^\d+$/;
  // 2026-08-09: added, mirroring IsraeliValidation.ts's ISRAELI_ACCOUNT_RE_.
  // The il-account case below used to be DIGITS_RE (digits-only), which
  // reintroduces a DIFFERENT already-fixed incident (2026-07-18 parity
  // audit: digits-only wrongly rejected the legitimate nnnnnn/nn
  // sub-account notation) - this case was dead in practice (israel.html
  // keeps its own separate inline check, per the 2026-08-09 duplication
  // audit), but is the copy anyone would reach for as "the shared rule."
  var ACCOUNT_RE  = /^\d{4,13}(?:\/\d{1,3})?$/;
  var EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var IL_PHONE_RE = /^05\d-?\d{7}$/;
  var DMY_RE      = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  var ISO_RE      = /^(\d{4})-(\d{2})-(\d{2})/;
  var MIN_JOIN_AMOUNT_STRICT = 50000;

  function nameOk(v, re) {
    if (typeof v !== 'string') return false;
    var t = v.trim();
    return t.length >= 2 && t.length <= 120 && re.test(t);
  }

  function validId(id) {
    var s = String(id == null ? '' : id).trim();
    if (!/^\d{1,9}$/.test(s)) return false;
    s = ('00000000' + s).slice(-9);
    if (s === '000000000') return false;
    var sum = 0;
    for (var i = 0; i < 9; i++) {
      var digit = Number(s[i]) * ((i % 2) + 1);
      if (digit > 9) digit -= 9;
      sum += digit;
    }
    return sum % 10 === 0;
  }

  function validSsn(ssn) {
    var d = String(ssn == null ? '' : ssn).replace(/\D/g, '');
    if (d.length !== 9) return false;
    var area = d.slice(0, 3), group = d.slice(3, 5), serial = d.slice(5);
    if (area === '000' || area === '666' || Number(area) >= 900) return false;
    if (group === '00') return false;
    if (serial === '0000') return false;
    return true;
  }

  function validCompanyNumber(n) { return /^\d{9}$/.test(String(n == null ? '' : n).trim()); }

  function validOwnership(p) {
    var s = String(p == null ? '' : p).trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return false;
    var n = Number(s);
    return n >= 0.1 && n <= 100;
  }

  // Phone: the server sanitizes +972/00972 to a local 05x BEFORE the regex
  // (israeliSanPhone_), so mirror that here. A non-Israeli international number
  // (e.g. +1...) is NOT converted and therefore rejected, same as the server.
  function sanPhone(v) {
    var s = String(v == null ? '' : v).replace(/[\s\-()]/g, '');
    if (/^\+972/.test(s)) s = '0' + s.slice(4);
    else if (/^00972/.test(s)) s = '0' + s.slice(5);
    return s;
  }
  function validIlPhone(v) { return IL_PHONE_RE.test(sanPhone(v)); }

  function parseDate(v) {
    var s = String(v == null ? '' : v).trim();
    var d, y, mo, da;
    if ((d = s.match(DMY_RE))) { da = +d[1]; mo = +d[2]; y = +d[3]; }
    else if ((d = s.match(ISO_RE))) { y = +d[1]; mo = +d[2]; da = +d[3]; }
    else return null;
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    var dt = new Date(Date.UTC(y, mo - 1, da));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== da) return null;
    return dt;
  }
  function validDate(v) { return parseDate(v) !== null; }

  function isPast(v, ref) {
    var d = parseDate(v); if (!d) return false;
    return d.getTime() < (ref ? ref.getTime() : Date.now());
  }

  function minAge18(v, ref) {
    var d = parseDate(v); if (!d) return false;
    var r = ref || new Date();
    var eighteen = new Date(Date.UTC(r.getUTCFullYear() - 18, r.getUTCMonth(), r.getUTCDate()));
    return d.getTime() <= eighteen.getTime();
  }

  function within3Months(v, ref) {
    var d = parseDate(v); if (!d) return false;
    var r = ref || new Date();
    if (d.getTime() > r.getTime()) return false;
    var cutoff = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() - 3, r.getUTCDate()));
    return d.getTime() >= cutoff.getTime();
  }

  function firstBusinessDayNextMonth(ref) {
    var r = ref || new Date();
    var d = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 1));
    while (d.getUTCDay() === 5 || d.getUTCDay() === 6) d = new Date(d.getTime() + 24 * 3600 * 1000);
    return d;
  }
  function isFirstBusinessDayNextMonth(v, ref) {
    var d = parseDate(v); if (!d) return false;
    return d.getTime() === firstBusinessDayNextMonth(ref).getTime();
  }

  function amountGt50k(v) {
    var n = Number(String(v == null ? '' : v).replace(/[,\s]/g, ''));
    return isFinite(n) && n > MIN_JOIN_AMOUNT_STRICT;
  }

  // ── format dispatcher, keyed by the data-validate / spec rule names ──────────
  // Returns true if the (non-empty) value PASSES the format. Emptiness is the
  // caller's required-pass job (mirrors validateField / validateIsraeliInvestorFull_).
  function validateFormat(rule, value) {
    var v = String(value == null ? '' : value).trim();
    if (!v) return true;
    switch (rule) {
      case 'il-id':            return validId(v);
      case 'ssn':              return validSsn(v);
      case 'company-num':      return validCompanyNumber(v);
      case 'pct':              return validOwnership(v);
      case 'email':            return EMAIL_RE.test(v);
      case 'cell-il':          return validIlPhone(v);
      case 'il-account':       return ACCOUNT_RE.test(v);
      case 'gt50000':          return amountGt50k(v);
      case 'date':             return validDate(v);
      case 'date-past':        return validDate(v) && isPast(v);
      case 'date-past-18':     return validDate(v) && isPast(v) && minAge18(v);
      case 'within-3-months':  return within3Months(v);
      case 'first-business-day': return isFirstBusinessDayNextMonth(v);
      case 'hebrew-name':      return nameOk(v, HE_RE);
      case 'english-name':     return nameOk(v, EN_RE);
      default:                 return true;   // unknown rule = no format constraint
    }
  }

  return {
    HE_RE: HE_RE, EN_RE: EN_RE, DIGITS_RE: DIGITS_RE, EMAIL_RE: EMAIL_RE,
    IL_PHONE_RE: IL_PHONE_RE, ACCOUNT_RE: ACCOUNT_RE, MIN_JOIN_AMOUNT_STRICT: MIN_JOIN_AMOUNT_STRICT,
    nameOk: nameOk, validId: validId, validSsn: validSsn,
    validCompanyNumber: validCompanyNumber, validOwnership: validOwnership,
    sanPhone: sanPhone, validIlPhone: validIlPhone,
    parseDate: parseDate, validDate: validDate, isPast: isPast, minAge18: minAge18,
    within3Months: within3Months, firstBusinessDayNextMonth: firstBusinessDayNextMonth,
    isFirstBusinessDayNextMonth: isFirstBusinessDayNextMonth, amountGt50k: amountGt50k,
    validateFormat: validateFormat
  };
}));
