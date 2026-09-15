/**
 * The toolbar reading: icon tint and badge.
 *
 * Shared by the popup, which writes a reading after a scan, and the settings
 * page, which rewrites every open tab the moment a switch changes.
 */
(function (root) {
  "use strict";

  const ICON_SIZES = [16, 32, 48, 128];

  // Fenko threat-severity scale (dark variants), bright enough to read on a
  // light or dark browser chrome.
  const BADGE_BG = {
    clean: "#3FB950",
    light: "#58A6FF",
    moderate: "#D29922",
    heavy: "#DB6D28",
    saturated: "#F85149",
  };

  const BADGE_TEXT = "#0D1117";

  function extensionApi() {
    return globalThis.browser || globalThis.chrome;
  }

  /**
   * Absolute extension URLs, never relative ones.
   *
   * A relative path here is resolved against the calling page, so "icons/x.png"
   * asked for from src/popup.html becomes src/icons/x.png, which does not
   * exist, and setIcon rejects.
   */
  function iconPaths(band) {
    const api = extensionApi();
    const path = {};

    for (const size of ICON_SIZES) {
      const file = band ? `icons/band/${band}-${size}.png` : `icons/icon-${size}.png`;
      path[size] = api && api.runtime && api.runtime.getURL ? api.runtime.getURL(file) : `/${file}`;
    }

    return path;
  }

  async function step(label, run, failures) {
    try {
      await run();
    } catch (error) {
      failures.push(`${label}: ${error && error.message ? error.message : error}`);
    }
  }

  /**
   * Write the toolbar state for one tab.
   *
   * Both halves are written every time, including when switched off, so a
   * reading left over from an earlier scan cannot linger. They are also
   * written independently: a failure to set the icon must not silently take
   * the badge down with it.
   *
   * Returns `{ok, failures}` rather than throwing, so the settings page can
   * report a problem while the popup can reasonably ignore a tab that closed
   * mid-write.
   */
  async function apply(tabId, reading, settings) {
    const api = extensionApi();
    const band = reading ? reading.band : null;
    const failures = [];

    const showBand = Boolean(settings.tintIcon && band);
    await step(
      "icon",
      () => api.action.setIcon({ tabId, path: iconPaths(showBand ? band : null) }),
      failures
    );

    const showBadge = Boolean(settings.badge && reading);
    await step(
      "badge",
      () => api.action.setBadgeText({ tabId, text: showBadge ? String(reading.slop) : "" }),
      failures
    );

    if (showBadge) {
      await step(
        "badge colour",
        () => api.action.setBadgeBackgroundColor({ tabId, color: BADGE_BG[band] }),
        failures
      );

      if (typeof api.action.setBadgeTextColor === "function") {
        await step(
          "badge text colour",
          () => api.action.setBadgeTextColor({ tabId, color: BADGE_TEXT }),
          failures
        );
      }
    }

    return { ok: failures.length === 0, failures };
  }

  root.SlopLens = Object.assign(root.SlopLens || {}, {
    indicator: { BADGE_BG, apply, iconPaths },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
