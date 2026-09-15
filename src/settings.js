/**
 * Stored preferences.
 *
 * `storage.local` on purpose, never `storage.sync`: sync would ship settings
 * through the browser account, and nothing here is allowed to leave the
 * machine.
 */
(function (root) {
  "use strict";

  const KEY = "indicator";

  // Resolved per call rather than at load time, so script order cannot leave
  // this holding an undefined namespace.
  function extensionApi() {
    return globalThis.browser || globalThis.chrome;
  }

  const DEFAULTS = {
    // Show the slop reading on the toolbar badge, the way uBlock Origin shows
    // its block count.
    badge: true,
    // Tint the toolbar icon with the band colour.
    tintIcon: true,
    // Score every page as it finishes loading. Off unless the reader turns it
    // on and grants the host permission it needs.
    autoScan: false,
  };

  async function load() {
    try {
      const stored = await extensionApi().storage.local.get(KEY);
      return Object.assign({}, DEFAULTS, stored[KEY] || {});
    } catch (error) {
      return Object.assign({}, DEFAULTS);
    }
  }

  async function save(settings) {
    await extensionApi().storage.local.set({ [KEY]: Object.assign({}, DEFAULTS, settings) });
  }

  // Per-tab readings, so flipping a switch can rewrite tabs that were already
  // scanned instead of waiting for the next scan. `storage.session` is held in
  // memory and never written to disk, so this leaves no trace of what was
  // scanned once the browser closes.
  const READINGS_KEY = "readings";

  function sessionStore() {
    const api = extensionApi();
    return api && api.storage ? api.storage.session : null;
  }

  async function readings() {
    const store = sessionStore();
    if (store === null) {
      return {};
    }

    try {
      const stored = await store.get(READINGS_KEY);
      return stored[READINGS_KEY] || {};
    } catch (error) {
      return {};
    }
  }

  async function rememberReading(tabId, reading) {
    const store = sessionStore();
    if (store === null) {
      return;
    }

    try {
      const all = await readings();
      all[tabId] = reading;
      await store.set({ [READINGS_KEY]: all });
    } catch (error) {
      // Losing a remembered reading only costs immediacy, not correctness.
    }
  }

  async function forgetReading(tabId) {
    const store = sessionStore();
    if (store === null) {
      return;
    }

    try {
      const all = await readings();
      delete all[tabId];
      await store.set({ [READINGS_KEY]: all });
    } catch (error) {
      // A stale entry costs nothing; the area is discarded on browser close.
    }
  }

  root.SlopLens = Object.assign(root.SlopLens || {}, {
    settings: { DEFAULTS, forgetReading, load, readings, rememberReading, save },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
