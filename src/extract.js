/**
 * DOM -> Markdown extraction with a character-offset map back into the page.
 *
 * slop-guard was written for Markdown: half its rules look for bold headers,
 * bullet runs, blockquotes and fenced code. Feeding it `innerText` throws all
 * of that away, so the article is serialized back into Markdown first.
 *
 * Every run of non-whitespace characters that came from a text node is
 * recorded in `map`, which lets a violation offset be turned back into a DOM
 * Range for highlighting.
 */
(function (root) {
  "use strict";

  const MIN_ROOT_CHARS = 400;
  const MIN_CANDIDATE_SCORE = 200;

  // Readability-style fallback for pages with no semantic container: every
  // substantial paragraph credits its ancestors, with the credit decaying as
  // it climbs, and the best-scoring ancestor wins.
  const MIN_PARAGRAPH_CHARS = 25;
  const ANCESTOR_DEPTH = 5;
  const MAX_LINK_DENSITY = 0.5;

  // Most specific first: a schema.org body or a wiki parser output beats the
  // generic <main>, which on many sites also wraps the language picker and
  // category footer.
  const ROOT_SELECTORS = [
    '[itemprop="articleBody"]',
    ".mw-parser-output",
    "article",
    '[role="main"]',
    "main",
    ".post-content",
    ".entry-content",
    ".article-body",
    "#content",
  ];

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CANVAS", "IFRAME",
    "OBJECT", "EMBED", "VIDEO", "AUDIO", "NAV", "ASIDE", "FOOTER", "FORM",
    "BUTTON", "SELECT", "TEXTAREA", "INPUT", "DIALOG", "MENU",
  ]);

  const SKIP_ROLES = new Set([
    "navigation", "banner", "contentinfo", "complementary", "search", "menu",
    "menubar", "toolbar", "tablist", "dialog", "alert", "form",
  ]);

  // Chrome/furniture that sits inside the article body on common platforms.
  const SKIP_SELECTOR = [
    ".mw-editsection", ".mw-jump-link", ".navbox", ".catlinks", ".infobox",
    ".reference", ".reflist", ".noprint", ".sidebar", ".toc", "#toc",
    ".share", ".social", ".related", ".newsletter", "[data-nosnippet]",
  ].join(",");

  const HEADING_TAGS = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };

  const BLOCK_TAGS = new Set([
    "P", "DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FIGURE", "FIGCAPTION",
    "DL", "DT", "DD", "ADDRESS", "DETAILS", "SUMMARY", "TABLE", "TBODY",
    "THEAD", "CAPTION",
  ]);

  // ---------------------------------------------------------------------------
  // Builder
  // ---------------------------------------------------------------------------

  function createBuilder(check = () => {}) {
    const parts = [];
    const map = [];
    let length = 0;
    let lastChar = "";
    let pendingSpace = false;

    function push(text) {
      check();
      parts.push(text);
      length += text.length;
      lastChar = text[text.length - 1];
    }

    function flushSpace() {
      if (pendingSpace && length > 0 && lastChar !== "\n" && lastChar !== " ") {
        push(" ");
      }
      pendingSpace = false;
    }

    function trailingNewlines() {
      let count = 0;
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        for (let cursor = part.length - 1; cursor >= 0; cursor -= 1) {
          if (part[cursor] !== "\n") {
            return count;
          }
          count += 1;
        }
      }

      return count;
    }

    return {
      get length() {
        return length;
      },
      /** Inline markup ("**", "`", "- ") that has no source node. */
      inline(text) {
        if (!text) {
          return;
        }
        flushSpace();
        push(text);
      },
      /** Guarantee `count` newlines at the tail; no-op at the very start. */
      breakLines(count) {
        pendingSpace = false;
        if (length === 0) {
          return;
        }

        const needed = count - trailingNewlines();
        if (needed > 0) {
          push("\n".repeat(needed));
        }
      },
      /**
       * Whitespace-collapsed text from a DOM node, recorded in the map.
       *
       * `baseOffset` is where `value` starts inside `node`, so callers can
       * feed a slice and still get correct offsets back.
       */
      text(value, node, baseOffset) {
        const base = baseOffset || 0;
        const runRe = /\S+/g;
        let match = runRe.exec(value);
        let previousEnd = 0;

        while (match !== null) {
          if (match.index > previousEnd || (previousEnd === 0 && match.index > 0)) {
            pendingSpace = true;
          }
          flushSpace();

          const start = length;
          push(match[0]);
          map.push({ start, end: length, node, nodeStart: base + match.index });

          previousEnd = match.index + match[0].length;
          match = runRe.exec(value);
        }

        if (previousEnd > 0 && previousEnd < value.length) {
          pendingSpace = true;
        }
      },
      /** Raw text with no mapping, used for code blocks. */
      rawBlock(value) {
        pendingSpace = false;
        push(value);
      },
      get map() {
        return map;
      },
      mapEntry(entry) {
        map.push(entry);
      },
      result() {
        return { text: parts.join(""), map };
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Visibility and root selection
  // ---------------------------------------------------------------------------

  // Where CSS says newlines in a text node are content, not source indentation.
  const PRESERVED_WHITE_SPACE = new Set(["pre", "pre-wrap", "pre-line", "break-spaces"]);
  const NEWLINE_RUN_RE = /\n[^\S\n]*(?:\n[^\S\n]*)*/g;
  const whiteSpaceCache = new WeakMap();

  function preservesNewlines(element) {
    let cached = whiteSpaceCache.get(element);

    if (cached === undefined) {
      const view = element.ownerDocument.defaultView;
      cached = view
        ? PRESERVED_WHITE_SPACE.has(view.getComputedStyle(element).whiteSpace)
        : false;
      whiteSpaceCache.set(element, cached);
    }

    return cached;
  }

  /**
   * Emit text whose newlines carry meaning.
   *
   * LinkedIn, X and most in-app composers render an entire multi-line post as
   * a single text node under `white-space: pre-wrap`, with no <br> and no block
   * children. Collapsing that erases every paragraph and list boundary the
   * structural rules exist to find. Runs of spaces are still collapsed, since
   * they change nothing the analyzer measures.
   */
  function pushPreservedText(target, value, node) {
    NEWLINE_RUN_RE.lastIndex = 0;

    let last = 0;
    let match = NEWLINE_RUN_RE.exec(value);

    while (match !== null) {
      if (match.index > last) {
        target.text(value.slice(last, match.index), node, last);
      }

      const newlines = (match[0].match(/\n/g) || []).length;
      target.breakLines(newlines >= 2 ? 2 : 1);

      last = match.index + match[0].length;
      match = NEWLINE_RUN_RE.exec(value);
    }

    if (last < value.length) {
      target.text(value.slice(last), node, last);
    }
  }

  function isSkipped(element) {
    if (SKIP_TAGS.has(element.tagName)) {
      return true;
    }
    if (SKIP_ROLES.has(element.getAttribute("role"))) {
      return true;
    }

    return element.matches(SKIP_SELECTOR);
  }

  function isVisible(element) {
    if (element.hidden || element.getAttribute("aria-hidden") === "true") {
      return false;
    }
    if (typeof element.checkVisibility === "function") {
      return element.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true });
    }

    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function textLength(element) {
    return (element.textContent || "").trim().length;
  }

  /** Share of an element's text that sits inside links. Navigation is mostly links. */
  function linkDensity(element) {
    const total = textLength(element);
    if (total === 0) {
      return 1;
    }

    let linked = 0;
    for (const anchor of element.querySelectorAll("a")) {
      linked += textLength(anchor);
    }

    return linked / total;
  }

  /**
   * Prefer a semantic container, else score ancestors by the prose beneath them.
   *
   * Looking only at direct <p> children misses sites that wrap every few
   * paragraphs in their own styled div: one such article scored 154 words out
   * of 1494 before this credited ancestors too.
   */
  function pickRoot(doc, check) {
    for (const selector of ROOT_SELECTORS) {
      check();
      const element = doc.querySelector(selector);
      if (element && textLength(element) >= MIN_ROOT_CHARS) {
        return element;
      }
    }

    const scores = new Map();

    for (const block of doc.body.querySelectorAll("p, li, blockquote")) {
      check();
      const length = textLength(block);
      if (length < MIN_PARAGRAPH_CHARS) {
        continue;
      }

      let ancestor = block.parentElement;
      let depth = 0;

      while (ancestor && ancestor !== doc.body && depth < ANCESTOR_DEPTH) {
        scores.set(ancestor, (scores.get(ancestor) || 0) + length / (depth + 1));
        ancestor = ancestor.parentElement;
        depth += 1;
      }
    }

    let best = doc.body;
    let bestScore = 0;

    for (const [element, score] of scores) {
      check();
      if (score > bestScore && linkDensity(element) <= MAX_LINK_DENSITY) {
        best = element;
        bestScore = score;
      }
    }

    return bestScore >= MIN_CANDIDATE_SCORE ? best : doc.body;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  function codeFenceLanguage(element) {
    const code = element.querySelector("code");
    const className = (code && code.className) || element.className || "";
    const match = /language-([\w+#-]+)/.exec(className);

    return match ? match[1] : "";
  }

  /** Render a subtree into its own builder so it can be line-prefixed. */
  function renderIsolated(element, walkChildren, check) {
    const sub = createBuilder(check);
    walkChildren(element, sub);

    return sub.result();
  }

  /**
   * Prefix every non-blank line of an isolated render, shifting its map.
   *
   * Blank lines are dropped so a multi-paragraph blockquote counts as the
   * number of quoted lines a person would actually see, not twice that.
   */
  function prefixLines(rendered, prefix, builder, check) {
    const lines = rendered.text.split("\n");
    const lineStart = [];
    let cursor = 0;

    for (const line of lines) {
      lineStart.push(cursor);
      cursor += line.length + 1;
    }

    const base = builder.length;
    const shiftByLine = new Array(lines.length).fill(null);
    const outLines = [];
    let outCursor = 0;

    lines.forEach((line, index) => {
      if (line.trim() === "") {
        return;
      }

      shiftByLine[index] = base + outCursor + prefix.length - lineStart[index];
      outLines.push(prefix + line);
      outCursor += prefix.length + line.length + 1;
    });

    builder.rawBlock(outLines.join("\n"));

    for (const entry of rendered.map) {
      check();
      let lineIndex = 0;
      while (lineIndex + 1 < lineStart.length && lineStart[lineIndex + 1] <= entry.start) {
        lineIndex += 1;
      }

      const shift = shiftByLine[lineIndex];
      if (shift === null) {
        continue;
      }

      builder.mapEntry({
        start: entry.start + shift,
        end: entry.end + shift,
        node: entry.node,
        nodeStart: entry.nodeStart,
      });
    }
  }

  // Bound the DOM before synchronous serialization, yielding while counting it.
  const MAX_DOM_NODES = 12000;
  const MAX_DOM_CHARS = 500000;
  const DOM_BATCH_SIZE = 256;
  const SERIALIZE_SLICE_MS = 100;

  async function extractBounded(doc, deadline, cancelled) {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ALL);
    let nodes = 0;
    let chars = 0;
    while (walker.nextNode()) {
      nodes += 1;
      chars += walker.currentNode.nodeType === Node.TEXT_NODE
        ? walker.currentNode.nodeValue.length : 0;
      if (nodes > MAX_DOM_NODES || chars > MAX_DOM_CHARS) {
        throw new Error("This page is too large to scan safely. Select a smaller passage.");
      }
      if (nodes % DOM_BATCH_SIZE === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (cancelled() || Date.now() >= deadline) {
        throw Object.assign(new Error("Scan time limit reached."), { code: "timeout" });
      }
    }
    const stop = Math.min(deadline, Date.now() + SERIALIZE_SLICE_MS);
    return extract(doc, () => {
      if (Date.now() >= stop) {
        throw Object.assign(new Error("Page extraction took too long. Select a smaller passage."), { code: "timeout" });
      }
    });
  }

  function extract(doc, check = () => {}) {
    const rootElement = pickRoot(doc, check);
    const builder = createBuilder(check);

    function walkChildren(element, target) {
      for (const child of element.childNodes) {
        walk(child, target);
      }
    }

    function walkTable(table, target) {
      const rows = table.querySelectorAll("tr");
      if (rows.length === 0) {
        return;
      }

      target.breakLines(2);
      rows.forEach((row, rowIndex) => {
        check();
        const cells = row.querySelectorAll("th, td");
        if (cells.length === 0) {
          return;
        }

        target.breakLines(1);
        target.inline("| ");
        cells.forEach((cell, cellIndex) => {
          check();
          if (cellIndex > 0) {
            target.inline(" | ");
          }
          walkChildren(cell, target);
        });
        target.inline(" |");

        if (rowIndex === 0) {
          target.breakLines(1);
          target.inline(`|${" --- |".repeat(cells.length)}`);
        }
      });
      target.breakLines(2);
    }

    function walkList(list, target) {
      const ordered = list.tagName === "OL";
      let index = 0;

      target.breakLines(2);
      for (const child of list.children) {
        check();
        if (child.tagName !== "LI" || !isVisible(child)) {
          continue;
        }

        index += 1;
        target.breakLines(1);
        target.inline(ordered ? `${index}. ` : "- ");
        walkChildren(child, target);
      }
      target.breakLines(2);
    }

    function walk(node, target) {
      check();
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;

        if (parent !== null && node.nodeValue.includes("\n") && preservesNewlines(parent)) {
          pushPreservedText(target, node.nodeValue, node);
          return;
        }

        target.text(node.nodeValue, node);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      const tag = node.tagName;
      if (isSkipped(node) || !isVisible(node)) {
        return;
      }

      if (tag === "BR") {
        target.breakLines(1);
        return;
      }
      if (tag === "HR") {
        target.breakLines(2);
        target.inline("---");
        target.breakLines(2);
        return;
      }

      if (HEADING_TAGS[tag] !== undefined) {
        target.breakLines(2);
        target.inline(`${"#".repeat(HEADING_TAGS[tag])} `);
        walkChildren(node, target);
        target.breakLines(2);
        return;
      }

      if (tag === "STRONG" || tag === "B") {
        target.inline("**");
        walkChildren(node, target);
        target.inline("**");
        return;
      }

      // Underscores for italics so they can never collide with `**bold**`.
      if (tag === "EM" || tag === "I") {
        target.inline("_");
        walkChildren(node, target);
        target.inline("_");
        return;
      }

      if (tag === "PRE") {
        target.breakLines(2);
        target.inline("```" + codeFenceLanguage(node));
        target.breakLines(1);
        target.rawBlock((node.textContent || "").replace(/\n+$/, ""));
        target.breakLines(1);
        target.inline("```");
        target.breakLines(2);
        return;
      }

      if (tag === "CODE") {
        target.inline("`");
        walkChildren(node, target);
        target.inline("`");
        return;
      }

      if (tag === "BLOCKQUOTE") {
        target.breakLines(2);
        prefixLines(renderIsolated(node, walkChildren, check), "> ", target, check);
        target.breakLines(2);
        return;
      }

      if (tag === "UL" || tag === "OL") {
        walkList(node, target);
        return;
      }

      if (tag === "TABLE") {
        walkTable(node, target);
        return;
      }

      if (BLOCK_TAGS.has(tag)) {
        target.breakLines(2);
        walkChildren(node, target);
        target.breakLines(2);
        return;
      }

      walkChildren(node, target);
    }

    walk(rootElement, builder);

    const { text, map } = builder.result();
    map.sort((a, b) => a.start - b.start);

    // Offsets in `map` are pre-trim; callers add `offsetShift` to convert an
    // analyzer offset back into a builder offset.
    const offsetShift = text.length - text.replace(/^\s+/, "").length;

    return { markdown: text.trim(), map, offsetShift, rootElement };
  }

  /**
   * Turn a [start, end) markdown offset into a DOM Range.
   *
   * The offsets in `map` are pre-trim, so callers pass the trim delta.
   */
  function rangeForSpan(map, start, end, offsetShift) {
    const from = start + offsetShift;
    const to = end + offsetShift;

    let low = 0;
    let high = map.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (map[mid].end <= from) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    const first = map[low];
    if (first === undefined || first.start >= to) {
      return null;
    }

    let lastIndex = low;
    while (lastIndex + 1 < map.length && map[lastIndex + 1].start < to) {
      lastIndex += 1;
    }
    const last = map[lastIndex];

    const range = document.createRange();
    const startOffset = first.nodeStart + Math.max(0, from - first.start);
    const endOffset = last.nodeStart + Math.min(last.end - last.start, Math.max(1, to - last.start));

    try {
      range.setStart(first.node, Math.min(startOffset, first.node.length));
      range.setEnd(last.node, Math.min(endOffset, last.node.length));
    } catch (error) {
      return null;
    }

    return range;
  }

  root.SlopLens = Object.assign(root.SlopLens || {}, { extract, extractBounded, rangeForSpan });
})(typeof globalThis !== "undefined" ? globalThis : this);
