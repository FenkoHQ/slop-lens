/**
 * Markdown code-span detection and the derived text views rules consume.
 *
 * One scan of the source produces three projections:
 *   maskedText            - code replaced by spaces, same length as the input
 *   textWithoutFencedCode - fenced blocks deleted
 *   fencedTextForBreaks   - fenced blocks replaced by "\n.\n" so sentence
 *                           splitting still sees a boundary there
 */
(function (root) {
  "use strict";

  function lineStartIndex(text, index) {
    return text.lastIndexOf("\n", index - 1) + 1;
  }

  function backtickRunLength(text, index) {
    let end = index;
    while (end < text.length && text[end] === "`") {
      end += 1;
    }

    return end - index;
  }

  function looksLikeFenceOpener(text, index, backtickCount) {
    if (backtickCount < 3) {
      return false;
    }

    const indent = text.slice(lineStartIndex(text, index), index);
    return indent.length <= 3 && indent.trim() === "";
  }

  function findFencedBlockEnd(text, openerStart, backtickCount) {
    let cursor = text.indexOf("\n", openerStart);
    if (cursor < 0) {
      return text.length;
    }
    cursor += 1;

    while (cursor < text.length) {
      let lineEnd = text.indexOf("\n", cursor);
      if (lineEnd < 0) {
        lineEnd = text.length;
      }

      const line = text.slice(cursor, lineEnd);
      const stripped = line.replace(/^ +/, "");
      const indent = line.length - stripped.length;
      const fenceWidth = stripped ? backtickRunLength(stripped, 0) : 0;

      const isCloser =
        indent <= 3 &&
        fenceWidth >= backtickCount &&
        stripped.startsWith("`".repeat(backtickCount)) &&
        stripped.slice(fenceWidth).trim() === "";

      if (isCloser) {
        return lineEnd === text.length ? lineEnd : lineEnd + 1;
      }

      cursor = lineEnd + 1;
    }

    return text.length;
  }

  function findInlineSpanEnd(text, openerStart, backtickCount) {
    let cursor = openerStart + backtickCount;
    const lineEnd = text.indexOf("\n", cursor);
    const limit = lineEnd < 0 ? text.length : lineEnd;

    while (cursor < limit) {
      if (text[cursor] !== "`") {
        cursor += 1;
        continue;
      }

      const candidateWidth = backtickRunLength(text, cursor);
      if (candidateWidth === backtickCount) {
        return cursor + backtickCount;
      }
      cursor += candidateWidth;
    }

    return null;
  }

  function replaceSpans(text, spans, replacement) {
    if (spans.length === 0) {
      return text;
    }

    const pieces = [];
    let cursor = 0;

    for (const [start, end] of spans) {
      pieces.push(text.slice(cursor, start));
      pieces.push(replacement);
      cursor = end;
    }
    pieces.push(text.slice(cursor));

    return pieces.join("");
  }

  function maskSpansPreservingNewlines(text, spans) {
    if (spans.length === 0) {
      return text;
    }

    const pieces = [];
    let cursor = 0;

    for (const [start, end] of spans) {
      pieces.push(text.slice(cursor, start));
      pieces.push(text.slice(start, end).replace(/[^\n]/g, " "));
      cursor = end;
    }
    pieces.push(text.slice(cursor));

    return pieces.join("");
  }

  function markdownCodeView(text) {
    const allSpans = [];
    const fencedSpans = [];
    let cursor = 0;

    while (cursor < text.length) {
      if (text[cursor] !== "`") {
        cursor += 1;
        continue;
      }

      const backtickCount = backtickRunLength(text, cursor);

      if (looksLikeFenceOpener(text, cursor, backtickCount)) {
        const blockEnd = findFencedBlockEnd(text, cursor, backtickCount);
        fencedSpans.push([cursor, blockEnd]);
        allSpans.push([cursor, blockEnd]);
        cursor = blockEnd;
        continue;
      }

      const inlineEnd = findInlineSpanEnd(text, cursor, backtickCount);
      if (inlineEnd !== null) {
        allSpans.push([cursor, inlineEnd]);
        cursor = inlineEnd;
        continue;
      }

      cursor += backtickCount;
    }

    return {
      allSpans,
      fencedSpans,
      maskedText: maskSpansPreservingNewlines(text, allSpans),
      textWithoutFencedCode: replaceSpans(text, fencedSpans, ""),
      fencedTextForBreaks: replaceSpans(text, fencedSpans, "\n.\n"),
    };
  }

  root.SlopGuard = Object.assign(root.SlopGuard || {}, { markdownCodeView });
})(typeof globalThis !== "undefined" ? globalThis : this);
