/* Share Fenko's device-local theme preference across extension pages. */
(function () {
  "use strict";

  const api = globalThis.browser || globalThis.chrome;
  const KEY = "ui_theme";
  const SYSTEM = "system";
  const THEMES = [SYSTEM, "light", "dark"];
  const media = matchMedia("(prefers-color-scheme: dark)");
  const select = document.getElementById("theme");
  const status = document.getElementById("theme-status");
  let preference = SYSTEM;

  function apply(value) {
    preference = THEMES.includes(value) ? value : SYSTEM;
    document.documentElement.dataset.theme = preference === SYSTEM
      ? (media.matches ? "dark" : "light") : preference;

    if (select) {
      select.value = preference;
    }
  }

  media.addEventListener("change", () => apply(preference));
  apply(SYSTEM);

  if (!api?.storage) {
    return;
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[KEY]) {
      apply(changes[KEY].newValue);
    }
  });

  async function start() {
    try {
      const stored = await api.storage.local.get(KEY);
      apply(stored[KEY]);
    } catch (error) {
      if (status) {
        status.textContent = "Could not load the saved theme.";
      }
    }

    if (!select) {
      return;
    }

    select.disabled = false;
    select.addEventListener("change", async () => {
      const previous = preference;
      apply(select.value);

      try {
        await api.storage.local.set({ [KEY]: preference });
        status.textContent = "Theme saved on this device.";
      } catch (error) {
        apply(previous);
        status.textContent = "Could not save the theme. Try again.";
      }
    });
  }

  start();
})();
