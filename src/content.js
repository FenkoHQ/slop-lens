/**
 * Page-side controller: extract, analyze, and paint highlights.
 *
 * Injected on demand by the popup (activeTab), never on page load. Nothing
 * here touches the network and nothing is written to the page's DOM except a
 * pointer-events:none overlay layer that is removed on clear.
 */
(function (root) {
  "use strict";

  const LAYER_ID = "__slop-lens-overlay";
  const MIN_RECT_SIZE = 2;

  // The analyzer skips anything shorter than this anyway, so a selection below
  // it is almost certainly a stray drag rather than an intent to score.
  const MIN_SELECTION_WORDS = 10;

  // slop-guard refuses to score anything shorter, so neither do we.
  const MIN_SCORABLE_WORDS = 10;

  // How long to keep waiting for a client-rendered article to appear, how long
  // one wait may last, and how much DOM quiet counts as settled.
  const READY_TIMEOUT_MS = 10000;
  const SETTLE_MS = 2000;
  const QUIET_MS = 250;

  // A background watch keeps trying for far longer, because nobody is waiting
  // on it. Each pass wakes on a DOM change or after the interval, whichever
  // comes first.
  const WATCH_INTERVAL_MS = 3000;
  const WATCH_TIMEOUT_MS = 90000;
  const READING_MESSAGE = "slop-lens/reading";

  // Bumped on every new watch so an older loop stops when re-injected.
  let watchToken = 0;

  let lastScan = null;

  function overlayLayer(create) {
    let layer = document.getElementById(LAYER_ID);
    if (layer || !create) {
      return layer;
    }

    layer = document.createElement("div");
    layer.id = LAYER_ID;
    Object.assign(layer.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "0",
      height: "0",
      margin: "0",
      padding: "0",
      border: "0",
      zIndex: "2147483646",
      pointerEvents: "none",
    });
    document.body.appendChild(layer);

    return layer;
  }

  function clearHighlights() {
    const layer = overlayLayer(false);
    if (layer) {
      layer.remove();
    }
  }

  function paintRange(layer, range, tone) {
    const rects = range.getClientRects();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    let painted = 0;

    for (const rect of rects) {
      if (rect.width < MIN_RECT_SIZE || rect.height < MIN_RECT_SIZE) {
        continue;
      }

      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "absolute",
        left: `${rect.left + scrollX}px`,
        top: `${rect.top + scrollY}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        borderRadius: "2px",
        pointerEvents: "none",
        background: tone === "focus" ? "rgba(255, 145, 0, 0.45)" : "rgba(255, 196, 0, 0.28)",
        boxShadow: tone === "focus" ? "0 0 0 2px rgba(255, 120, 0, 0.9)" : "none",
      });
      layer.appendChild(box);
      painted += 1;
    }

    return painted;
  }

  /** Violations that fell back to the whole document are not worth painting. */
  function isPaintable(violation, textLength) {
    return !(violation.start === 0 && violation.end === textLength);
  }

  function selectionText() {
    const selection = window.getSelection();
    if (selection === null || selection.isCollapsed) {
      return "";
    }

    return String(selection);
  }

  function countWords(text) {
    const trimmed = text.trim();
    return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
  }

  /**
   * Score the page, or the selection.
   *
   * `mode` is "auto" when the popup opens: if the reader has already singled
   * out a passage, that is what they want scored, so it wins over the article.
   * Below the analyzer's own short-text floor a selection is treated as a
   * stray click and ignored.
   */
  function scan(mode) {
    clearHighlights();

    const selected = selectionText();
    const selectionWords = countWords(selected);
    const wantsSelection =
      mode === "selection" ||
      (mode === "auto" && selectionWords >= MIN_SELECTION_WORDS);

    if (wantsSelection) {
      if (selectionWords === 0) {
        return { ok: false, error: "Nothing selected on the page.", hasSelection: false };
      }

      lastScan = null;
      return {
        ok: true,
        mode: "selection",
        title: document.title,
        url: location.href,
        hasSelection: true,
        selectionWords,
        highlightable: false,
        analysis: root.SlopGuard.analyzeText(selected),
      };
    }

    // A PDF tab's DOM holds no text: the browser renders the document inside
    // its own viewer, which extensions are not allowed to read. Say that,
    // rather than suggesting a selection that cannot work either.
    if (document.contentType === "application/pdf") {
      return {
        ok: false,
        error:
          "This is a PDF. The browser renders it in a built-in viewer that extensions cannot read, so there is no text to score.",
        hasSelection: false,
      };
    }

    const extracted = root.SlopLens.extract(document);
    if (extracted.markdown.trim().length === 0) {
      return {
        ok: false,
        // Client-rendered pages reach "complete" with an empty article, so
        // this particular failure is worth waiting out.
        retryable: true,
        error: "No readable article text found. Select the text you want scored and try again.",
        hasSelection: selectionWords > 0,
      };
    }

    const analysis = root.SlopGuard.analyzeText(extracted.markdown);

    // Below the analyzer's own floor there is nothing to judge, and a score of
    // "clean" would be a guess dressed as a verdict. Keep watching instead:
    // the article may still be on its way.
    if (analysis.word_count < MIN_SCORABLE_WORDS) {
      return {
        ok: false,
        retryable: true,
        error: "Not enough text on this page to score.",
        hasSelection: selectionWords > 0,
      };
    }

    lastScan = { extracted, analysis };

    return {
      ok: true,
      mode: "page",
      title: document.title,
      url: location.href,
      hasSelection: selectionWords > 0,
      selectionWords,
      highlightable: true,
      rootTag: extracted.rootElement.tagName.toLowerCase(),
      analysis,
    };
  }

  function rangeFor(index) {
    if (lastScan === null) {
      return null;
    }

    const violation = lastScan.analysis.violations[index];
    if (violation === undefined || !isPaintable(violation, lastScan.extracted.markdown.length)) {
      return null;
    }

    return root.SlopLens.rangeForSpan(
      lastScan.extracted.map,
      violation.start,
      violation.end,
      lastScan.extracted.offsetShift
    );
  }

  function highlightAll() {
    clearHighlights();
    if (lastScan === null) {
      return { painted: 0 };
    }

    const layer = overlayLayer(true);
    const textLength = lastScan.extracted.markdown.length;
    let painted = 0;

    lastScan.analysis.violations.forEach((violation, index) => {
      if (!isPaintable(violation, textLength)) {
        return;
      }

      const range = rangeFor(index);
      if (range !== null) {
        painted += paintRange(layer, range, "normal") > 0 ? 1 : 0;
      }
    });

    return { painted };
  }

  function focusViolation(index) {
    const range = rangeFor(index);
    if (range === null) {
      return { ok: false };
    }

    highlightAll();
    paintRange(overlayLayer(true), range, "focus");

    const rect = range.getBoundingClientRect();
    window.scrollTo({
      top: rect.top + window.scrollY - window.innerHeight / 3,
      behavior: "smooth",
    });

    return { ok: true };
  }

  /** Resolve once the DOM stops changing, or after `timeoutMs`. */
  function settled(timeoutMs) {
    return new Promise((resolve) => {
      let quietTimer = null;
      let finished = false;

      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        observer.disconnect();
        clearTimeout(quietTimer);
        clearTimeout(capTimer);
        resolve();
      };

      const observer = new MutationObserver(() => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, QUIET_MS);
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      const capTimer = setTimeout(finish, timeoutMs);
    });
  }

  /**
   * Scan, waiting for the article to appear if it is not there yet.
   *
   * A single-page app reaches load with an empty shell, so scanning on the
   * load event alone finds nothing. This retries while the DOM is still
   * producing content, up to a budget, and gives up cleanly after that.
   */
  async function scanWhenReady(options) {
    const settings = options || {};
    const mode = settings.mode || "auto";
    const deadline = Date.now() + (settings.timeoutMs || READY_TIMEOUT_MS);

    let result = scan(mode);

    while (!result.ok && result.retryable && Date.now() < deadline) {
      await settled(Math.min(SETTLE_MS, Math.max(0, deadline - Date.now())));
      result = scan(mode);
    }

    return result;
  }

  function report(result) {
    const api = globalThis.browser || globalThis.chrome;

    try {
      api.runtime.sendMessage({
        type: READING_MESSAGE,
        ok: Boolean(result && result.ok),
        mode: (result && result.mode) || null,
        analysis: result && result.ok ? result.analysis : null,
      });
    } catch (error) {
      // The worker is gone or the extension was reloaded. Nothing to do.
    }
  }

  /**
   * Keep scanning until the page yields an article, then report it.
   *
   * Runs page-side on purpose: a background service worker is torn down after
   * a few seconds idle, so it cannot hold a long retry loop, while this script
   * lives exactly as long as the page it is watching. Returns immediately; the
   * result arrives as a message.
   */
  function watch(options) {
    const settings = options || {};
    const mode = settings.mode || "page";
    const deadline = Date.now() + (settings.timeoutMs || WATCH_TIMEOUT_MS);
    const token = watchToken + 1;
    watchToken = token;

    (async () => {
      let result = scan(mode);

      while (!result.ok && result.retryable && Date.now() < deadline) {
        await settled(WATCH_INTERVAL_MS);

        // A newer watch took over, or the page navigated under us.
        if (token !== watchToken) {
          return;
        }

        result = scan(mode);
      }

      report(result);
    })();

    return true;
  }

  root.__slopLens = {
    clearHighlights,
    focusViolation,
    highlightAll,
    scan,
    scanWhenReady,
    watch,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
