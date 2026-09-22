/**
 * Background worker: scores a page when it finishes loading.
 *
 * Only runs when the reader has turned auto-scan on and granted the host
 * permission it needs. Without both, this listener does nothing at all, and
 * the extension stays click-to-scan.
 *
 * Loaded as a service worker in Chrome and as an event page in Firefox, which
 * is why the dependencies are pulled in two ways.
 */
if (typeof importScripts === "function" && !globalThis.SlopLens) {
  importScripts("settings.js", "indicator.js", "scan-service.js");
}

(function () {
  "use strict";

  const api = globalThis.browser || globalThis.chrome;

  const INJECT_FILES = [
    "src/extract.js",
    "src/content.js",
  ];

  const SCORE_MAX = 100;
  const SCANNABLE = /^https?:/;

  // A client-rendered page reaches "complete" with an empty shell, so the page
  // keeps watching for the article rather than giving up on the load event.
  const WATCH_TIMEOUT_MS = 3000;
  const READING_MESSAGE = "slop-lens/reading";
  const WELCOME_PAGE = "src/options.html?welcome";

  // One scan per tab at a time, and not twice for the same URL. onUpdated
  // fires repeatedly during a navigation and scanning is not free.
  const inFlight = new Set();
  const lastScanned = new Map();

  async function mayScan(tab) {
    if (!tab || !SCANNABLE.test(tab.url || "")) {
      return null;
    }

    const settings = await globalThis.SlopLens.settings.load();
    if (!settings.autoScan) {
      return null;
    }

    const granted = await api.permissions.contains({ origins: ["<all_urls>"] });
    return granted ? settings : null;
  }

  /**
   * Start a page-side watch and return.
   *
   * The page reports back by message after its bounded scan completes.
   */
  async function startWatch(tabId) {
    await api.scripting.executeScript({ target: { tabId }, files: INJECT_FILES });

    await api.scripting.executeScript({
      target: { tabId },
      // "page" rather than "auto": a selection left on the page is not a
      // verdict about the page, and nothing asked for it here.
      args: [{ mode: "page", timeoutMs: WATCH_TIMEOUT_MS }],
      func: (options) => globalThis.__slopLens.watch(options),
    });
  }

  /**
   * A reading arrived from a watched page.
   *
   * A failed scan clears the toolbar rather than leaving it blank-but-stale:
   * no number is better than the previous page's number.
   */
  async function onReading(tabId, message) {
    const settings = await globalThis.SlopLens.settings.load();
    if (!settings.autoScan) {
      return;
    }

    if (!message.ok || message.mode !== "page") {
      await globalThis.SlopLens.indicator.apply(tabId, null, settings);
      await globalThis.SlopLens.settings.forgetReading(tabId);
      return;
    }

    const reading = {
      band: message.analysis.band,
      slop: SCORE_MAX - message.analysis.score,
    };

    await globalThis.SlopLens.indicator.apply(tabId, reading, settings);
    await globalThis.SlopLens.settings.rememberReading(tabId, reading);
  }

  api.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.type !== READING_MESSAGE) {
      return;
    }
    // Only our own content script, running in a tab, may set a reading.
    if (sender.id !== api.runtime.id || !sender.tab) {
      return;
    }

    onReading(sender.tab.id, message);
  });

  /**
   * Both signals matter, and both must be allowed through.
   *
   * Chrome commits the URL before the page has loaded anything, so a watch
   * started on that event spends its budget waiting for the load itself. The
   * later "complete" therefore restarts the watch with a fresh budget rather
   * than being skipped as a duplicate; the page-side watch supersedes its own
   * predecessor, so restarting is cheap and cannot double-report.
   *
   * A bare `url` change also covers a single-page app moving between articles
   * without a load event, which would otherwise leave the previous page's
   * reading on the toolbar.
   */
  api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    const navigated = typeof changeInfo.url === "string";
    const loaded = changeInfo.status === "complete";
    if (!navigated && !loaded) {
      return;
    }
    if (navigated) {
      globalThis.SlopLens.cancelScore(`tab:${tabId}`).catch(() => {});
    }
    if (inFlight.has(tabId)) {
      return;
    }

    // One watch per URL per phase; onUpdated repeats itself otherwise.
    const url = tab.url || changeInfo.url || "";
    const phase = `${url}|${loaded ? "complete" : "url"}`;
    if (lastScanned.get(tabId) === phase) {
      return;
    }

    inFlight.add(tabId);

    try {
      const settings = await mayScan(tab);
      if (settings === null) {
        return;
      }

      // Clear first, always. Whatever is on the button describes the page
      // that was there before this navigation, and a wrong number is worse
      // than none while the new one is being worked out.
      await globalThis.SlopLens.indicator.apply(tabId, null, settings);

      lastScanned.set(tabId, phase);
      await startWatch(tabId);
    } catch (error) {
      // A page that blocks injection, or a tab that closed mid-scan. There is
      // no reader watching an automatic scan, so there is nobody to tell.
    } finally {
      inFlight.delete(tabId);
    }
  });

  // Revoking automatic scanning also stops work already running in a tab.
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.indicator && !changes.indicator.newValue?.autoScan) {
      globalThis.SlopLens.cancelScore(null).catch(() => {});
      api.tabs.query({}).then(tabs => {
        for (const tab of tabs) {
          api.tabs.sendMessage(tab.id, { type: "slop-lens/cancel" }).catch(() => {});
        }
      });
    }
  });

  // First install opens settings with the auto-scan prompt. The host
  // permission stays optional, so granting it has to come from a click there.
  api.runtime.onInstalled.addListener((details) => {
    if (details.reason !== api.runtime.OnInstalledReason.INSTALL) {
      return;
    }

    api.tabs.create({ url: api.runtime.getURL(WELCOME_PAGE) });
  });

  // A tab that closes no longer has a reading worth remembering.
  api.tabs.onRemoved.addListener((tabId) => {
    globalThis.SlopLens.cancelScore(`tab:${tabId}`).catch(() => {});
    lastScanned.delete(tabId);
    globalThis.SlopLens.settings.forgetReading(tabId);
  });
})();
