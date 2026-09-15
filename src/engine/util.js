/**
 * Shared helpers for the slop-guard JS port.
 *
 * Python and JavaScript disagree on a few primitives that the original
 * analyzer leans on (banker's rounding, Unicode `\w`, whitespace `split()`).
 * Everything here exists to make those disagreements go away.
 */
(function (root) {
  "use strict";

  const ASCII_ONLY_RE = /^[\x00-\x7F]*$/;
  const WHITESPACE_RUN_RE = /\s+/;

  // Python's `\w` is Unicode-aware; JS `\w` is ASCII-only.
  const WORD_TOKEN_RE = /[\p{L}\p{N}_]+/gu;
  const EDGE_WORD_STRIP_RE = /^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu;
  const LETTER_RE = /\p{L}/u;
  const UPPER_RE = /\p{Lu}/u;

  /** Round half to even, matching Python's built-in round(). */
  function pyRound(value) {
    const floor = Math.floor(value);
    const diff = value - floor;

    if (diff > 0.5) {
      return floor + 1;
    }
    if (diff < 0.5) {
      return floor;
    }

    return floor % 2 === 0 ? floor : floor + 1;
  }

  /** Round to `digits` decimals using Python's half-to-even rule. */
  function pyRoundTo(value, digits) {
    const scale = Math.pow(10, digits);
    return pyRound(value * scale) / scale;
  }

  /** Format like Python's f"{value:.Nf}". */
  function fmtFixed(value, digits) {
    return pyRoundTo(value, digits).toFixed(digits);
  }

  /** Format like Python's f"{value:.0%}". */
  function fmtPercent0(value) {
    return `${pyRound(value * 100)}%`;
  }

  /** Equivalent of Python's str.split() with no separator. */
  function splitWs(text) {
    const trimmed = text.trim();
    if (!trimmed) {
      return [];
    }

    return trimmed.split(WHITESPACE_RUN_RE);
  }

  function wordCount(text) {
    return splitWs(text).length;
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isAscii(text) {
    return ASCII_ONLY_RE.test(text);
  }

  function isLetter(char) {
    return LETTER_RE.test(char);
  }

  function isUpper(char) {
    return UPPER_RE.test(char);
  }

  function isSpace(char) {
    return /\s/.test(char);
  }

  /** Collect every match of a global regex as {text, start, end, groups}. */
  function findAll(pattern, text) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    const hits = [];
    let match = re.exec(text);

    while (match !== null) {
      hits.push({
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
        groups: match.slice(1),
      });

      // Zero-length matches would otherwise spin forever.
      if (match[0].length === 0) {
        re.lastIndex += 1;
      }
      match = re.exec(text);
    }

    return hits;
  }

  /** Extract a text snippet centered on the matched span. */
  function contextAround(text, start, end, width) {
    const mid = Math.floor((start + end) / 2);
    const half = Math.floor(width / 2);
    const ctxStart = Math.max(0, mid - half);
    const ctxEnd = Math.min(text.length, mid + half);
    const snippet = text.slice(ctxStart, ctxEnd).replace(/\n/g, " ");
    const prefix = ctxStart > 0 ? "..." : "";
    const suffix = ctxEnd < text.length ? "..." : "";

    return `${prefix}${snippet}${suffix}`;
  }

  const api = {
    WORD_TOKEN_RE,
    EDGE_WORD_STRIP_RE,
    contextAround,
    escapeRegExp,
    findAll,
    fmtFixed,
    fmtPercent0,
    isAscii,
    isLetter,
    isSpace,
    isUpper,
    pyRound,
    pyRoundTo,
    splitWs,
    wordCount,
  };

  root.SlopGuard = Object.assign(root.SlopGuard || {}, { util: api });
})(typeof globalThis !== "undefined" ? globalThis : this);
