/**
 * Page-side controller: extract, analyze, and paint highlights.
 *
 * Injected on demand by the popup (activeTab), never on page load. Nothing
 * here touches the network and nothing is written to the page's DOM except a
 * pointer-events:none overlay layer that is removed on clear.
 */
(function (root) {
  "use strict";

  // Preserve cancellation state when the popup reinjects this controller.
  if (root.__slopLens) {
    return;
  }

  const LAYER_ID = "__slop-lens-overlay";
  const MIN_RECT_SIZE = 2;

  // The analyzer skips anything shorter than this anyway, so a selection below
  // it is almost certainly a stray drag rather than an intent to score.
  const MIN_SELECTION_WORDS = 10;

  // slop-guard refuses to score anything shorter, so neither do we.
  const MIN_SCORABLE_WORDS = 10;

  // How long to keep waiting for a client-rendered article to appear, how long
  // one wait may last, and how much DOM quiet counts as settled.
  const READY_TIMEOUT_MS = 3000;
  const SETTLE_MS = 2000;
  const QUIET_MS = 250;

  // Automatic scans have the same deadline as a normal popup scan.
  const WATCH_TIMEOUT_MS = 3000;
  const READING_MESSAGE = "slop-lens/reading";

  // Bumped on every new watch so an older loop stops when re-injected.
  let watchToken = 0;

  let lastScan = null;
  let scanToken = 0;
  let lastOutcome = null;
  let outcomeUrl = null;
  const LONG_TIMEOUT_MS = 30000;
  const MAX_TEXT_CHARS = 500000;
  const MAX_HIGHLIGHTS = 200;
  const MAX_RECTS = 500;
  const HIGHLIGHT_BUDGET_MS = 50;

  function timeoutResult() {
    return { ok: false, code: "timeout", error: "Scan stopped at the time limit. You can allow up to 30 seconds or select a smaller passage." };
  }

  async function scoreText(text, deadline) {
    if (text.length > MAX_TEXT_CHARS) {
      return { ok: false, error: "Too much text. Select a smaller passage." };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return timeoutResult();
    }
    const api = root.browser || root.chrome;
    let timer;
    try {
      return await Promise.race([
        api.runtime.sendMessage({ type: "slop-lens/score", text, deadline }),
        new Promise(resolve => { timer = setTimeout(() => resolve(timeoutResult()), remaining); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

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
      if (painted >= MAX_RECTS) {
        break;
      }
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
  async function scan(mode, deadline, token) {
    clearHighlights();

    const selected = selectionText();
    if (selected.length > MAX_TEXT_CHARS) {
      return { ok: false, error: "Too much selected text. Select a smaller passage." };
    }
    const selectionWords = countWords(selected);
    const wantsSelection =
      mode === "selection" ||
      (mode === "auto" && selectionWords >= MIN_SELECTION_WORDS);

    if (wantsSelection) {
      if (selectionWords === 0) {
        return { ok: false, error: "Nothing selected on the page.", hasSelection: false };
      }

      lastScan = null;
      const scored = await scoreText(selected, deadline);
      if (!scored?.ok) {
        return scored || timeoutResult();
      }
      return {
        ok: true,
        mode: "selection",
        title: document.title,
        url: location.href,
        hasSelection: true,
        selectionWords,
        highlightable: false,
        analysis: scored.analysis,
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

    const extracted = await root.SlopLens.extractBounded(document, deadline, () => token !== scanToken);
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

    const scored = await scoreText(extracted.markdown, deadline);
    if (token !== scanToken) {
      return { ok: false, code: "cancelled", error: "Scan replaced." };
    }
    if (!scored?.ok) {
      return scored || timeoutResult();
    }
    const analysis = scored.analysis;

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

    const paintDeadline = Date.now() + HIGHLIGHT_BUDGET_MS;
    lastScan.analysis.violations.slice(0, MAX_HIGHLIGHTS).forEach((violation, index) => {
      if (Date.now() >= paintDeadline) {
        return;
      }
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
    const deadline = Date.now() + Math.min(settings.timeoutMs || READY_TIMEOUT_MS, LONG_TIMEOUT_MS);
    const token = ++scanToken;
    const scanUrl = location.href;
    lastScan = null;
    try {
      let result = await scan(mode, deadline, token);
      while (!result.ok && result.retryable && Date.now() < deadline && token === scanToken) {
        await settled(Math.min(SETTLE_MS, Math.max(0, deadline - Date.now())));
        if (Date.now() >= deadline) {
          break;
        }
        result = await scan(mode, deadline, token);
      }
      if (token !== scanToken || location.href !== scanUrl) {
        lastScan = null;
        return { ok: false, code: "cancelled", error: "Scan replaced." };
      }
      lastOutcome = Date.now() >= deadline || result.code === "timeout" ? timeoutResult() : result;
    } catch (error) {
      if (token !== scanToken) {
        return { ok: false, code: "cancelled", error: "Scan replaced." };
      }
      lastOutcome = error.code === "timeout" ? timeoutResult() : { ok: false, error: error.message };
    }
    outcomeUrl = scanUrl;
    return lastOutcome;
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
   * Returns immediately; extraction stays here and scoring runs in a worker.
   * The result arrives by message before the scan deadline.
   */
  function watch(options) {
    const token = ++watchToken;
    scanWhenReady({ mode: "page", timeoutMs: WATCH_TIMEOUT_MS }).then(result => {
      if (token === watchToken && result.code !== "cancelled") {
        report(result);
      }
    });
    return true;
  }

  const api = root.browser || root.chrome;
  api?.runtime?.onMessage.addListener(message => {
    if (message?.type === "slop-lens/cancel") {
      scanToken += 1;
      watchToken += 1;
      lastScan = null;
      lastOutcome = null;
    }
  });

  root.__slopLens = {
    clearHighlights,
    focusViolation,
    highlightAll,
    scan: (mode) => scanWhenReady({ mode }),
    outcome: () => outcomeUrl === location.href && !selectionText().trim() ? lastOutcome : null,
    scanWhenReady,
    watch,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
