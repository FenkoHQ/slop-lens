/**
 * Popup controller.
 *
 * Extracts text from the active tab, scores in a worker, and renders the report.
 * Manual scans use activeTab; auto-scan site access stays optional.
 */
(function () {
  "use strict";

  const api = globalThis.browser || globalThis.chrome;

  const INJECT_FILES = [
    "src/extract.js",
    "src/content.js",
  ];

  const SCORE_MAX = 100;
  const POPUP_READY_TIMEOUT_MS = 3000;
  const LONG_SCAN_TIMEOUT_MS = 30000;

  const view = document.getElementById("view");
  let activeTabId = null;
  let highlightOn = true;

  // ---------------------------------------------------------------------------
  // Chrome
  // ---------------------------------------------------------------------------

  function openFilePage() {
    api.tabs.create({ url: api.runtime.getURL("src/file.html") });
    window.close();
  }

  function showStatus(message, isError) {
    const status = document.createElement("p");
    status.className = isError ? "status error" : "status";
    status.textContent = message;

    view.replaceChildren(status);

    if (!isError) {
      return;
    }

    const actions = document.createElement("div");
    actions.className = "actions";

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Score a file instead";
    button.addEventListener("click", openFilePage);

    actions.appendChild(button);
    view.appendChild(actions);
  }

  async function activeTab() {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function callPage(tabId, fnName, arg) {
    const [{ result }] = await api.scripting.executeScript({
      target: { tabId },
      args: [fnName, arg === undefined ? null : arg],
      func: (name, payload) => globalThis.__slopLens[name](payload),
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Actions row
  // ---------------------------------------------------------------------------

  function scopeControl(scan) {
    const group = document.createElement("div");
    group.className = "segmented";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "What to score");

    for (const scope of ["page", "selection"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.scope = scope;
      button.textContent = scope === "page" ? "Page" : "Selection";
      button.setAttribute("aria-pressed", String(scope === scan.mode));
      button.disabled = scope === "selection" && !scan.hasSelection;
      button.title = button.disabled
        ? "Select text on the page to score just that"
        : `Score the ${scope}`;
      button.addEventListener("click", () => run(scope));

      group.appendChild(button);
    }

    return group;
  }

  function highlightToggle(scan) {
    const label = document.createElement("label");
    label.className = "switch";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = highlightOn && scan.highlightable;
    input.disabled = !scan.highlightable;

    const track = document.createElement("span");
    track.className = "track";
    track.appendChild(document.createElement("span")).className = "knob";

    const text = document.createElement("span");
    text.className = "switch-label";
    text.textContent = "Highlight";

    input.addEventListener("change", () => {
      highlightOn = input.checked;
      callPage(activeTabId, highlightOn ? "highlightAll" : "clearHighlights");
    });

    label.append(input, track, text);
    return label;
  }

  function actionsRow(scan) {
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(scopeControl(scan), highlightToggle(scan));

    return actions;
  }

  // ---------------------------------------------------------------------------
  // Entry
  // ---------------------------------------------------------------------------

  async function run(mode, timeoutMs = POPUP_READY_TIMEOUT_MS) {
    showStatus(mode === "selection" ? "Scoring selection…" : "Reading page…");

    try {
      const tab = await activeTab();
      activeTabId = tab.id;

      await api.scripting.executeScript({ target: { tabId: tab.id }, files: INJECT_FILES });
      // Opening a timed-out scan offers consent instead of restarting work.
      const previous = await callPage(tab.id, "outcome");
      const scan = mode !== "selection" && previous?.code === "timeout" && timeoutMs === POPUP_READY_TIMEOUT_MS
        ? previous : await callPage(tab.id, "scanWhenReady", {
        mode,
        timeoutMs,
      });

      if (!scan || !scan.ok) {
        showStatus((scan && scan.error) || "Scan failed.", true);
        if (scan?.code === "timeout") {
          const retry = document.createElement("button");
          retry.type = "button";
          retry.textContent = "Try for up to 30 seconds";
          retry.addEventListener("click", () => run(mode, LONG_SCAN_TIMEOUT_MS));
          view.querySelector(".actions").prepend(retry);
        }
        return;
      }

      view.replaceChildren(
        window.SlopLens.report.build(scan, {
          actions: actionsRow(scan),
          onJump: scan.highlightable
            ? (index) => callPage(activeTabId, "focusViolation", index)
            : null,
        })
      );

      // A selection score says nothing about the page, so it must not change
      // the toolbar reading for the tab.
      if (scan.mode === "page") {
        const reading = { band: scan.analysis.band, slop: SCORE_MAX - scan.analysis.score };
        const settings = await window.SlopLens.settings.load();

        await window.SlopLens.indicator.apply(tab.id, reading, settings);
        await window.SlopLens.settings.rememberReading(tab.id, reading);
      }

      if (highlightOn && scan.highlightable) {
        await callPage(tab.id, "highlightAll");
      }
    } catch (error) {
      showStatus(
        `Cannot scan this page. Browser pages, add-on stores and the PDF viewer are off limits to extensions. (${error.message})`,
        true
      );
    }
  }

  document.getElementById("score-file").addEventListener("click", openFilePage);

  document.getElementById("open-settings").addEventListener("click", () => {
    api.runtime.openOptionsPage();
    window.close();
  });

  // Exposed for the offline popup harness in test/.
  globalThis.__slopLensPopup = { run };

  // "auto": score whatever the reader has already selected, else the article.
  run("auto");
})();
