/**
 * Settings page.
 *
 * Saves on change, no save button, and rewrites the toolbar for every open tab
 * straight away, so a switch visibly does something instead of quietly taking
 * effect at some later scan.
 */
(function () {
  "use strict";

  const api = globalThis.browser || globalThis.chrome;

  // A mid-scale example, enough to show both the colour and the number.
  const SAMPLE = { band: "heavy", slop: 69 };
  const SAVED_VISIBLE_MS = 2400;

  const fields = {
    badge: document.getElementById("badge"),
    tintIcon: document.getElementById("tintIcon"),
    autoScan: document.getElementById("autoScan"),
  };

  const AUTO_SCAN_ORIGINS = { origins: ["<all_urls>"] };

  const previewIcon = document.getElementById("preview-icon");
  const previewBadge = document.getElementById("preview-badge");
  const previewNote = document.getElementById("preview-note");
  const saved = document.getElementById("saved");
  const tryButton = document.getElementById("try-it");

  let savedTimer = null;

  function current() {
    return {
      badge: fields.badge.checked,
      tintIcon: fields.tintIcon.checked,
      autoScan: fields.autoScan.checked,
    };
  }

  /**
   * Turning auto-scan on asks for the host permission it needs.
   *
   * `permissions.request` has to be the first thing the click does: an await
   * before it spends the user gesture and the browser then refuses the prompt.
   */
  async function onAutoScanChange() {
    if (fields.autoScan.checked) {
      let granted = false;

      try {
        granted = await api.permissions.request(AUTO_SCAN_ORIGINS);
      } catch (error) {
        granted = false;
      }

      if (!granted) {
        fields.autoScan.checked = false;
        await persist();
        flash("Auto-scan needs permission to read the pages you visit.", true);
        return;
      }
    } else {
      try {
        await api.permissions.remove(AUTO_SCAN_ORIGINS);
      } catch (error) {
        // Leaving the permission granted is harmless; the setting still gates it.
      }
    }

    await persist();
  }

  function renderPreview() {
    const settings = current();

    previewIcon.src = settings.tintIcon
      ? `../icons/band/${SAMPLE.band}-32.png`
      : "../icons/icon-32.png";

    previewBadge.hidden = !settings.badge;
    previewBadge.textContent = String(SAMPLE.slop);
    previewBadge.style.background = window.SlopLens.indicator.BADGE_BG[SAMPLE.band];

    previewNote.textContent =
      settings.badge || settings.tintIcon
        ? `A page reading ${SAMPLE.slop}, ${SAMPLE.band}.`
        : "No toolbar indicator. Open the popup to see a reading.";
  }

  function flash(message, isError) {
    saved.textContent = message;
    saved.classList.toggle("bad", Boolean(isError));
    saved.classList.add("on");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => saved.classList.remove("on"), SAVED_VISIBLE_MS);
  }

  /**
   * Rewrite the toolbar for every open tab.
   *
   * Tabs scanned earlier in this browser session have a remembered reading, so
   * they get the new treatment immediately; the rest are simply cleared. Tab
   * ids are available without the `tabs` permission, and nothing else about
   * the tabs is read.
   */
  async function applyEverywhere(settings) {
    try {
      const [tabs, readings] = await Promise.all([
        api.tabs.query({}),
        window.SlopLens.settings.readings(),
      ]);

      const results = await Promise.all(
        tabs.map((tab) =>
          window.SlopLens.indicator.apply(tab.id, readings[tab.id] || null, settings)
        )
      );

      return results.flatMap((result) => result.failures);
    } catch (error) {
      return [error.message || String(error)];
    }
  }

  async function persist() {
    const settings = current();

    renderPreview();
    await window.SlopLens.settings.save(settings);

    const failures = await applyEverywhere(settings);
    if (failures.length > 0) {
      flash(`Saved, but the toolbar refused it: ${failures[0]}`, true);
      return;
    }

    flash(
      settings.badge || settings.tintIcon
        ? "Saved, and applied to open tabs."
        : "Saved. The toolbar indicator is off."
    );
  }

  /** Put a sample reading on this tab so the toolbar can be seen changing. */
  async function tryIt() {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      return;
    }

    await window.SlopLens.settings.rememberReading(tab.id, SAMPLE);
    const result = await window.SlopLens.indicator.apply(tab.id, SAMPLE, current());

    if (!result.ok) {
      flash(`The toolbar refused it: ${result.failures.join("; ")}`, true);
      return;
    }

    flash(
      `Sample reading ${SAMPLE.slop} is on this tab's toolbar button. ` +
        "Flip a switch above and watch it change."
    );
  }

  async function start() {
    const settings = await window.SlopLens.settings.load();

    for (const [name, input] of Object.entries(fields)) {
      input.checked = Boolean(settings[name]);
      input.addEventListener("change", name === "autoScan" ? onAutoScanChange : persist);
    }

    // The permission can be revoked from the browser's own settings, which
    // would leave this switch lying.
    try {
      if (fields.autoScan.checked && !(await api.permissions.contains(AUTO_SCAN_ORIGINS))) {
        fields.autoScan.checked = false;
        await window.SlopLens.settings.save(current());
      }
    } catch (error) {
      // An older browser without the permissions API simply cannot auto-scan.
    }

    tryButton.addEventListener("click", tryIt);
    renderPreview();
    offerAutoScan();
  }

  /**
   * First-run prompt, shown when install opens this page with `?welcome`.
   *
   * "Turn on" goes through the same path as the switch, so the permission
   * request stays the first await of the click.
   */
  function offerAutoScan() {
    const welcome = document.getElementById("welcome");
    if (!new URLSearchParams(location.search).has("welcome") || fields.autoScan.checked) {
      return;
    }

    welcome.hidden = false;

    document.getElementById("welcome-on").addEventListener("click", async () => {
      fields.autoScan.checked = true;
      await onAutoScanChange();
      welcome.hidden = fields.autoScan.checked;
    });

    document.getElementById("welcome-skip").addEventListener("click", () => {
      welcome.hidden = true;
    });
  }

  start();
})();
