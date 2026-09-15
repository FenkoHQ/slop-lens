/**
 * Precomputed text views that the rules read during a forward pass.
 *
 * Every projection is lazy and cached, because a rule typically touches two or
 * three of them and recomputing the token scan per rule is the hot path.
 */
(function (root) {
  "use strict";

  const { EDGE_WORD_STRIP_RE, WORD_TOKEN_RE, splitWs, wordCount } = root.SlopGuard.util;
  const { markdownCodeView } = root.SlopGuard;

  const SENTENCE_SPLIT_RE = /[.!?]["'”’)\]]*(?:\s|$)/;
  const BULLET_LINE_RE = /^\s*[-*]\s|^\s*\d+[.)]\s/;
  const BOLD_TERM_BULLET_LINE_RE = /^\s*[-*]\s+\*\*|^\s*\d+[.)]\s+\*\*/;
  const TABLE_DELIMITER_CELL_RE = /^\s*:?-{3,}:?\s*$/;

  function splitSentences(text) {
    return text
      .split(SENTENCE_SPLIT_RE)
      .map((sentence) => (sentence === undefined ? "" : sentence.trim()))
      .filter((sentence) => sentence.length > 0);
  }

  /** Strip a leading and trailing "|" the way Python's str.strip("|") does. */
  function stripPipes(text) {
    return text.replace(/^\|+/, "").replace(/\|+$/, "");
  }

  function looksLikeTableRow(line) {
    const stripped = line.trim();
    if (!stripped.includes("|")) {
      return false;
    }

    const cells = stripPipes(stripped)
      .split("|")
      .map((cell) => cell.trim());

    return cells.length >= 2 && cells.some((cell) => cell.length > 0);
  }

  function isTableDelimiter(line) {
    const stripped = line.trim();
    if (!stripped.includes("|")) {
      return false;
    }

    const cells = stripPipes(stripped)
      .split("|")
      .map((cell) => cell.trim());

    return cells.length >= 2 && cells.every((cell) => TABLE_DELIMITER_CELL_RE.test(cell));
  }

  /** Collapse pipe tables to a "." so they read as one sentence boundary. */
  function replaceTablesWithSentenceBreaks(text) {
    const lines = text.split("\n");
    const out = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      const startsTable =
        index + 1 < lines.length && looksLikeTableRow(line) && isTableDelimiter(lines[index + 1]);

      if (!startsTable) {
        out.push(line);
        index += 1;
        continue;
      }

      out.push(".");
      index += 2;
      while (index < lines.length && looksLikeTableRow(lines[index])) {
        index += 1;
      }
    }

    return out.join("\n");
  }

  function matchAllTokens(text, pattern) {
    const re = new RegExp(pattern.source, pattern.flags);
    return text.match(re) || [];
  }

  /** Memoize a zero-argument getter on first access. */
  function lazy(target, name, compute) {
    let cached;
    let filled = false;

    Object.defineProperty(target, name, {
      get() {
        if (!filled) {
          cached = compute();
          filled = true;
        }
        return cached;
      },
    });
  }

  function analysisDocument(text) {
    const codeView = markdownCodeView(text);
    const doc = {
      text,
      lines: text.split("\n"),
      sentences: splitSentences(text),
      wordCount: wordCount(codeView.maskedText),
      markdownCodeView: codeView,
    };

    lazy(doc, "sentenceWordCounts", () => doc.sentences.map((s) => splitWs(s).length));

    lazy(doc, "sentenceAnalysisText", () =>
      replaceTablesWithSentenceBreaks(codeView.fencedTextForBreaks)
    );
    lazy(doc, "sentenceAnalysisSentences", () => splitSentences(doc.sentenceAnalysisText));
    lazy(doc, "sentenceAnalysisWordCounts", () =>
      doc.sentenceAnalysisSentences.map((s) => splitWs(s).length)
    );

    lazy(doc, "lowerText", () => text.toLowerCase());
    lazy(doc, "wordTokensLower", () => matchAllTokens(doc.lowerText, WORD_TOKEN_RE));
    lazy(doc, "wordTokenSetLower", () => new Set(doc.wordTokensLower));

    lazy(doc, "ngramTokensLower", () =>
      splitWs(text)
        .map((token) => token.replace(EDGE_WORD_STRIP_RE, "").toLowerCase())
        .filter((token) => token.length > 0)
    );

    lazy(doc, "nonEmptyLines", () => doc.lines.filter((line) => line.trim().length > 0));
    lazy(doc, "lineIsBullet", () => doc.lines.map((line) => BULLET_LINE_RE.test(line)));
    lazy(doc, "lineIsBoldTermBullet", () =>
      doc.lines.map((line) => BOLD_TERM_BULLET_LINE_RE.test(line))
    );
    lazy(doc, "lineIsBlockquote", () => doc.lines.map((line) => line.startsWith(">")));
    lazy(doc, "nonEmptyBulletCount", () =>
      doc.nonEmptyLines.filter((line) => BULLET_LINE_RE.test(line)).length
    );

    lazy(doc, "textWithoutCodeBlocks", () => codeView.textWithoutFencedCode);
    lazy(doc, "wordCountWithoutCodeBlocks", () => wordCount(doc.textWithoutCodeBlocks));

    lazy(doc, "maskedText", () => codeView.maskedText);
    lazy(doc, "lowerMaskedText", () => doc.maskedText.toLowerCase());
    lazy(doc, "maskedWordTokensLower", () => matchAllTokens(doc.lowerMaskedText, WORD_TOKEN_RE));
    lazy(doc, "maskedWordTokenSetLower", () => new Set(doc.maskedWordTokensLower));

    return doc;
  }

  root.SlopGuard = Object.assign(root.SlopGuard || {}, {
    analysisDocument,
    splitSentences,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
