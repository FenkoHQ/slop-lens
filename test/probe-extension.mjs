/**
 * Load the real unpacked extension in Chromium and exercise chrome.action.
 *
 * The harnesses stub chrome.action, so they cannot catch a call that the real
 * browser rejects. This drives a genuine browser over CDP instead.
 *
 *     node test/probe-extension.mjs
 */
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE_PORT = 8899;

const SLOP_PAGE = `<!doctype html><meta charset="utf-8"><title>t</title><article>
<h1>Unlocking the Future of Developer Productivity</h1>
<p>In today's fast-paced landscape, it's worth noting that teams must delve into a
holistic paradigm. This is not just about tooling, but also about culture.</p>
<p>Significantly, this is where things get interesting. Many believe the journey
matters more than the destination, and studies show that teams who embrace this
mindset thrive. It is a testament to a robust and comprehensive ecosystem.</p>
<p>Ultimately, it is our choices that define the systems we build.</p>
</article>`;

// The shape that broke auto-scan in the wild: load fires against an empty
// shell and the article arrives afterwards. `slow` arrives well past the point
// a single bounded wait would have given up at.
const deferredPage = (delayMs) =>
  `<!doctype html><meta charset="utf-8"><title>t</title><div id="app"></div>
<script>
setTimeout(() => {
  document.getElementById("app").innerHTML = ${JSON.stringify(SLOP_PAGE)};
}, ${delayMs});
</script>`;

// Never grows an article, so the toolbar must stay blank rather than guess.
const EMPTY_PAGE = `<!doctype html><meta charset="utf-8"><title>t</title><p>Hi.</p>`;

// No <article>, no <main>, and every paragraph wrapped in its own styled div,
// which is how plenty of real sites are built. Looking only at direct <p>
// children captures one fragment of this and scores that instead of the page.
const FRAGMENTED_PAGE = `<!doctype html><meta charset="utf-8"><title>t</title>
<div class="a"><div class="b"><div class="c">
${[
  "For a long time, connectivity sat quietly in the background of most operations and was rarely treated as a deciding factor in anything that mattered to the business.",
  "In today's fast-paced landscape, it's worth noting that teams must delve into a holistic paradigm before committing to any particular vendor or platform.",
  "Significantly, this is where things get interesting, because the constraints that shaped the old approach have quietly stopped applying to the new one.",
  "Many believe the journey matters more than the destination, and studies show that teams who embrace this mindset report better outcomes over a longer horizon.",
  "The practical implication is that a robust and comprehensive ecosystem is now a testament to careful planning rather than to raw spending power alone.",
  "Ultimately, it is our choices that define the systems we build, and the ones we choose not to build at all when the evidence points elsewhere.",
]
  .map((text) => `<div class="w"><p>${text}</p></div>`)
  .join("\n")}
</div></div></div>`;

/** Chromium derives an unpacked extension's id from its absolute path. */
/**
 * Wait for the extension's service worker to register, and take the id from
 * its URL.
 *
 * Deriving the id by hashing the absolute path reimplements a Chrome internal,
 * and more importantly it says nothing about whether the extension has
 * finished loading yet. Opening a page under the id too early lands on an
 * error page with no `chrome` object, which reads as "the extension is
 * broken". Waiting for the worker answers both questions at once.
 */
async function waitForExtension(port, tries = 120) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const worker = targets.find(
        (target) =>
          target.type === "service_worker" && target.url.endsWith("/src/background.js")
      );

      if (worker) {
        return { id: worker.url.split("/")[2], worker };
      }
    } catch (error) {
      // the browser is still coming up
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  throw new Error("the extension service worker never registered");
}

function chromiumBinary() {
  return process.env.CHROMIUM || "chromium";
}

/**
 * Stop a browser and everything it forked.
 *
 * `child.kill()` signals only the launcher, and Chromium's zygote and
 * renderers outlive it often enough that repeated runs leave a drift of
 * orphans. That is not just untidy: an orphan holding a devtools port is what
 * made a perfectly good extension look broken here. Spawning detached puts
 * the browser in its own process group, so the whole group goes at once.
 */
async function shutdown(browser) {
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try {
      process.kill(-browser.pid, signal);
    } catch (error) {
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

/**
 * Read the port Chrome actually chose, from DevToolsActivePort in its profile.
 *
 * A fixed port means a leaked browser from an earlier run silently answers for
 * this one. That happened here: an orphan still holding 9333 served an
 * extension from a path that no longer existed, and the probe reported the
 * extension as broken. Letting Chrome pick, and reading the port back out of
 * the profile we created, makes attaching to someone else's browser
 * impossible and lets probes run concurrently.
 */
async function waitForPort(profile, tries = 120) {
  const portFile = join(profile, "DevToolsActivePort");

  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);

      if (response.ok) {
        return port;
      }
    } catch (error) {
      // the profile is not written yet, or the port is not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  throw new Error("Chromium devtools port never opened");
}

/** Minimal CDP client over the built-in WebSocket. */
function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;

  const ready = new Promise((resolveReady, rejectReady) => {
    socket.addEventListener("open", () => resolveReady());
    socket.addEventListener("error", (event) => rejectReady(event));
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) {
      return;
    }
    pending.delete(message.id);
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
  });

  return {
    ready,
    send(method, params) {
      const id = nextId;
      nextId += 1;
      socket.send(JSON.stringify({ id, method, params: params || {} }));

      return new Promise((resolveCall, rejectCall) => {
        pending.set(id, { resolve: resolveCall, reject: rejectCall });
      });
    },
    close: () => socket.close(),
  };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    return { thrown: result.exceptionDetails.exception?.description || "threw" };
  }

  return result.result.value;
}

async function main() {
  const checks = [];
  const profile = mkdtempSync(join(tmpdir(), "slop-lens-probe-"));

  const browser = spawn(
    chromiumBinary(),
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      `--load-extension=${ROOT}`,
      `--disable-extensions-except=${ROOT}`,
      "about:blank",
    ],
    { stdio: "ignore", detached: true }
  );

  try {
    const port = await waitForPort(profile);
    const { id } = await waitForExtension(port);

    const created = await fetch(
      `http://127.0.0.1:${port}/json/new?chrome-extension://${id}/src/options.html`,
      { method: "PUT" }
    );
    const target = await created.json();

    const client = connect(target.webSocketDebuggerUrl);
    await client.ready;
    await client.send("Runtime.enable");

    const context = await evaluate(
      client,
      `(async () => ({
         href: location.href,
         hasChrome: typeof chrome !== "undefined",
         hasAction: typeof chrome?.action?.setIcon === "function",
         hasSlopLens: typeof window.SlopLens?.indicator?.apply === "function",
         tabId: (await chrome.tabs.query({active: true, currentWindow: true}))[0]?.id,
       }))()`
    );

    console.log("extension id:", id);
    console.log("context:", JSON.stringify(context));

    if (!context || context.thrown || !context.hasAction) {
      throw new Error("extension did not load; cannot probe");
    }

    // Exercise the actual storage API and CSS on extension-owned pages.
    await client.send("Page.bringToFront");
    await client.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    const theme = await evaluate(client, `(async () => {
      const select = document.getElementById("theme");
      for (let n = 0; (select.disabled || document.documentElement.dataset.theme !== "dark") && n < 40; n++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const initial = document.documentElement.dataset.theme;
      select.value = "light";
      select.dispatchEvent(new Event("change"));
      await new Promise(resolve => setTimeout(resolve, 100));
      return { initial, stored: (await chrome.storage.local.get("ui_theme")).ui_theme,
        background: getComputedStyle(document.body).backgroundColor };
    })()`);
    checks.push(["theme: system follows the browser", theme?.initial === "dark"]);
    checks.push(["theme: selector saves locally and overrides the browser", theme?.stored === "light" && theme?.background === "rgb(255, 255, 255)"]);

    for (const name of ["file", "popup"]) {
      const response = await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${id}/src/${name}.html`, { method: "PUT" });
      const page = connect((await response.json()).webSocketDebuggerUrl);
      await page.ready;
      await page.send("Runtime.enable");
      await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
      await new Promise(resolve => setTimeout(resolve, 250));
      const savedTheme = await evaluate(page, `document.documentElement.dataset.theme`);
      checks.push([`theme: ${name} restores the saved preference`, savedTheme === "light"]);
      await evaluate(client, `chrome.storage.local.set({ ui_theme: "dark" })`);
      await new Promise(resolve => setTimeout(resolve, 100));
      const synced = await evaluate(page, `getComputedStyle(document.body).backgroundColor`);
      checks.push([`theme: ${name} follows changes from settings`, synced === "rgb(13, 17, 23)"]);
      await page.send("Page.captureScreenshot", { format: "png" }).then(result => {
        writeFileSync(`/tmp/slop-lens-${name}-dark.png`, Buffer.from(result.data, "base64"));
      });
      await evaluate(client, `chrome.storage.local.set({ ui_theme: "light" })`);
      page.close();
    }
    await client.send("Page.captureScreenshot", { format: "png" }).then(result => {
      writeFileSync("/tmp/slop-lens-options-light.png", Buffer.from(result.data, "base64"));
    });
    await client.send("Page.bringToFront");
    await evaluate(client, `chrome.storage.local.set({ ui_theme: "system" })`);
    await client.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
    await new Promise(resolve => setTimeout(resolve, 100));
    checks.push(["theme: system follows later device changes", await evaluate(client, `(async () => {
      for (let n = 0; n < 40; n++) {
        if (document.documentElement.dataset.theme === "light") {
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return { theme: document.documentElement.dataset.theme, matches: matchMedia("(prefers-color-scheme: dark)").matches };
    })()`) === true]);

    // The experiment: does a path relative to the calling page resolve?
    const relative = await evaluate(
      client,
      `(async () => {
         try {
           await chrome.action.setIcon({ tabId: ${context.tabId}, path: { 16: "icons/icon-16.png" } });
           return "accepted";
         } catch (error) { return "REJECTED: " + error.message; }
       })()`
    );
    console.log("relative path setIcon:", relative);
    checks.push([
      "a page-relative icon path is rejected by the browser",
      String(relative).startsWith("REJECTED"),
    ]);

    const absolute = await evaluate(
      client,
      `(async () => {
         try {
           await chrome.action.setIcon({ tabId: ${context.tabId}, path: { 16: chrome.runtime.getURL("icons/icon-16.png") } });
           return "accepted";
         } catch (error) { return "REJECTED: " + error.message; }
       })()`
    );
    console.log("getURL path setIcon:", absolute);
    checks.push(["runtime.getURL icon path is accepted", absolute === "accepted"]);

    // And the real code path, end to end.
    const applied = await evaluate(
      client,
      `(async () => {
         const settings = { badge: true, tintIcon: true };
         const result = await window.SlopLens.indicator.apply(${context.tabId}, { band: "heavy", slop: 69 }, settings);
         return {
           result,
           badgeText: await chrome.action.getBadgeText({ tabId: ${context.tabId} }),
           badgeColor: await chrome.action.getBadgeBackgroundColor({ tabId: ${context.tabId} }),
         };
       })()`
    );
    console.log("indicator.apply:", JSON.stringify(applied));
    checks.push(["indicator.apply reports no failures", applied?.result?.ok === true]);
    checks.push(["badge text is written", applied?.badgeText === "69"]);
    checks.push([
      "badge colour is the heavy band",
      JSON.stringify(applied?.badgeColor) === JSON.stringify([219, 109, 40, 255]),
    ]);

    client.close();

    // ---- first run -------------------------------------------------------
    // A fresh profile is a fresh install, which should open settings with the
    // auto-scan prompt showing.
    let welcome = null;
    for (let attempt = 0; attempt < 20 && !welcome; attempt += 1) {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      welcome = pages.find((t) => t.type === "page" && t.url.includes(`${id}/src/options.html?welcome`));
      if (!welcome) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    checks.push(["install opens settings with the welcome prompt", Boolean(welcome)]);

    if (welcome) {
      const welcomeClient = connect(welcome.webSocketDebuggerUrl);
      await welcomeClient.ready;
      await welcomeClient.send("Runtime.enable");

      const shown = await evaluate(
        welcomeClient,
        `new Promise((done) => setTimeout(() => {
           const card = document.getElementById("welcome");
           done(Boolean(card) && !card.hidden && Boolean(document.getElementById("welcome-on")));
         }, 500))`
      );
      checks.push(["the welcome prompt is visible with its button", shown === true]);
      welcomeClient.close();
    }

    // ---- the background worker -------------------------------------------
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const worker = targets.find((t) => t.type === "service_worker" && t.url.includes(id));
    checks.push(["the background service worker is registered", Boolean(worker)]);

    if (worker) {
      const swClient = connect(worker.webSocketDebuggerUrl);
      await swClient.ready;
      await swClient.send("Runtime.enable");

      const swContext = await evaluate(
        swClient,
        `(async () => ({
           hasDeps: typeof globalThis.SlopLens?.indicator?.apply === "function"
                 && typeof globalThis.SlopLens?.settings?.load === "function",
           listening: chrome.tabs.onUpdated.hasListeners(),
           autoScanDefault: (await globalThis.SlopLens.settings.load()).autoScan,
           hasPermission: await chrome.permissions.contains({ origins: ["<all_urls>"] }),
         }))()`
      );
      console.log("worker:", JSON.stringify(swContext));

      checks.push(["importScripts loaded settings and indicator", swContext?.hasDeps === true]);
      checks.push(["tabs.onUpdated has a listener", swContext?.listening === true]);
      checks.push(["auto-scan is off by default", swContext?.autoScanDefault === false]);
      checks.push([
        "the host permission is not granted by default",
        swContext?.hasPermission === false,
      ]);

      // A service worker has no DOM, which is exactly where setIcon tends to
      // break. Prove it works from there too.
      const swIcon = await evaluate(
        swClient,
        `(async () => {
           const tabs = await chrome.tabs.query({});
           const tabId = tabs[0]?.id;
           const result = await globalThis.SlopLens.indicator.apply(
             tabId, { band: "clean", slop: 4 }, { badge: true, tintIcon: true }
           );
           return { result, badgeText: await chrome.action.getBadgeText({ tabId }) };
         })()`
      );
      console.log("worker indicator.apply:", JSON.stringify(swIcon));
      checks.push([
        "the worker can set the icon and badge",
        swIcon?.result?.ok === true && swIcon?.badgeText === "4",
      ]);

      swClient.close();
    }
  } finally {
    await shutdown(browser);
    // Chromium is still unlinking its profile; losing a temp dir is not a
    // reason to fail the probe.
    await new Promise((r) => setTimeout(r, 500));
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch (error) {
      // leave it to the system temp sweep
    }
  }

  await probeAutoScan(checks);

  let failed = 0;
  for (const [label, passed] of checks) {
    console.log(`${passed ? "  ok  " : "  FAIL"}  ${label}`);
    failed += passed ? 0 : 1;
  }

  console.log(`\n${checks.length} checks, ${failed} failures`);
  if (failed > 0) {
    process.exit(1);
  }
}

/**
 * Auto-scan, end to end, with nobody clicking anything.
 *
 * Runs against a copy whose optional host permission is promoted to a granted
 * one, because a headless browser has no way to answer the permission prompt.
 * The background code under test is byte-identical.
 */
async function probeAutoScan(checks) {
  const staging = mkdtempSync(join(tmpdir(), "slop-lens-auto-"));
  const copy = join(staging, "extension");
  cpSync(ROOT, copy, {
    recursive: true,
    filter: (source) => !/\/(test|tools|store)$/.test(source),
  });

  const manifestPath = join(copy, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = manifest.optional_host_permissions;
  delete manifest.optional_host_permissions;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    const body =
      request.url === "/deferred"
        ? deferredPage(1500)
        : request.url === "/slow"
          ? deferredPage(14000)
          : request.url === "/empty"
            ? EMPTY_PAGE
            : request.url === "/fragmented"
              ? FRAGMENTED_PAGE
              : SLOP_PAGE;
    response.end(body);
  });
  await new Promise((ready) => server.listen(PAGE_PORT, "127.0.0.1", ready));

  const profile = mkdtempSync(join(tmpdir(), "slop-lens-auto-profile-"));
  const browser = spawn(
    chromiumBinary(),
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      `--load-extension=${copy}`,
      `--disable-extensions-except=${copy}`,
      "about:blank",
    ],
    { stdio: "ignore", detached: true }
  );

  try {
    const port = await waitForPort(profile);
    const { id, worker } = await waitForExtension(port);

    const client = connect(worker.webSocketDebuggerUrl);
    await client.ready;
    await client.send("Runtime.enable");

    const before = await evaluate(
      client,
      `(async () => {
         await globalThis.SlopLens.settings.save({ badge: true, tintIcon: true, autoScan: true });
         return globalThis.SlopLens.settings.load();
       })()`
    );
    checks.push(["auto-scan: the setting can be turned on", before?.autoScan === true]);

    for (const path of ["/", "/deferred", "/slow", "/empty", "/fragmented"]) {
      await fetch(
        `http://127.0.0.1:${port}/json/new?http://127.0.0.1:${PAGE_PORT}${path}`,
        { method: "PUT" }
      );
    }
    // Long enough for /slow to arrive at 14s and be picked up by the watch.
    await new Promise((r) => setTimeout(r, 24000));

    const observed = await evaluate(
      client,
      `(async () => {
         const tabs = await chrome.tabs.query({});
         const rows = [];
         for (const tab of tabs) {
           rows.push({ url: tab.url || "", badge: await chrome.action.getBadgeText({ tabId: tab.id }) });
         }
         return { rows, readings: await globalThis.SlopLens.settings.readings() };
       })()`
    );

    const rows = observed?.rows || [];
    const find = (suffix) => rows.find((row) => row.url.endsWith(suffix));
    const immediate = find(`:${PAGE_PORT}/`);
    const deferred = find("/deferred");
    const slow = find("/slow");
    const empty = find("/empty");

    for (const [label, row] of [
      ["immediate", immediate],
      ["deferred", deferred],
      ["slow", slow],
      ["empty", empty],
    ]) {
      console.log(`auto-scan ${label}:`, JSON.stringify(row));
    }

    const badged = (row) => Boolean(row && /^\d+$/.test(row.badge));

    checks.push(["auto-scan: a loaded page gets a badge with no interaction", badged(immediate)]);
    checks.push([
      "auto-scan: a client-rendered page is waited for, not given up on",
      badged(deferred),
    ]);
    checks.push([
      "auto-scan: an article arriving after the deadline is not scanned",
      Boolean(slow) && slow.badge === "",
    ]);
    checks.push([
      "auto-scan: a page with no article shows no number",
      Boolean(empty) && empty.badge === "",
    ]);
    checks.push([
      "auto-scan: the reading is remembered",
      Object.keys(observed?.readings || {}).length > 0,
    ]);

    // Extraction quality on a page with no semantic container.
    const fragmented = await evaluate(
      client,
      `(async () => {
         const tabs = await chrome.tabs.query({});
         const tab = tabs.find((t) => (t.url || "").endsWith("/fragmented"));
         if (!tab) return null;
         const [{ result }] = await chrome.scripting.executeScript({
           target: { tabId: tab.id },
           func: () => {
             const extracted = globalThis.SlopLens.extract(document);
             return {
               words: extracted.markdown.trim().split(/\s+/).length,
               bodyWords: document.body.textContent.trim().split(/\s+/).length,
               root: extracted.rootElement.tagName,
             };
           },
         });
         return result;
       })()`
    );
    console.log("fragmented extraction:", JSON.stringify(fragmented));

    checks.push([
      "extraction: a page with no semantic container still yields most of its prose",
      Boolean(fragmented && fragmented.words >= fragmented.bodyWords * 0.8),
    ]);

    // Repeated quoted prose reproduces the webmail freeze without account data.
    const heavy = await evaluate(client, `(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => (t.url || "").endsWith("/fragmented"));
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async () => {
          const line = Array.from({ length: 4000 }, (_, i) => "word" + i.toString(36)).join(" ");
          document.body.replaceChildren(document.createElement("article"));
          document.querySelector("article").textContent = [line, line, line].join("\\n\\n");
          let ticks = 0;
          const timer = setInterval(() => ticks++, 20);
          const start = Date.now();
          const scan = await globalThis.__slopLens.scanWhenReady({ mode: "page", timeoutMs: 3000 });
          clearInterval(timer);
          return { scan, elapsed: Date.now() - start, ticks };
        },
      });
      return { ...result, tabId: tab.id };
    })()`);
    console.log("bounded scan:", JSON.stringify(heavy));
    checks.push(["slow scan: stops at three seconds", heavy?.scan?.code === "timeout" && heavy.elapsed < 3800]);
    checks.push(["slow scan: page stays responsive", heavy?.ticks > 50]);

    const popupResponse = await fetch(
      `http://127.0.0.1:${port}/json/new?chrome-extension://${id}/src/popup.html`, { method: "PUT" });
    const popupClient = connect((await popupResponse.json()).webSocketDebuggerUrl);
    await popupClient.ready;
    await popupClient.send("Runtime.enable");
    await new Promise(resolve => setTimeout(resolve, 500));
    const retry = await evaluate(popupClient, `(async () => {
      chrome.tabs.query = async () => [{ id: ${heavy?.tabId} }];
      await globalThis.__slopLensPopup.run("page");
      const button = [...document.querySelectorAll("button")].find(b => b.textContent === "Try for up to 30 seconds");
      if (!button) return { offered: false, text: document.body.innerText };
      button.click();
      const deadline = Date.now() + 32000;
      while (Date.now() < deadline && document.querySelector("#view > .status")?.textContent === "Reading page…") {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return { offered: true, completed: !document.querySelector("#view > .status"), text: document.querySelector("#view").innerText.slice(0, 150) };
    })()`);
    console.log("long retry:", JSON.stringify(retry));
    checks.push(["popup: timeout offers an explicit longer scan", retry?.offered === true]);
    checks.push(["popup: longer scan completes", retry?.completed === true]);
    popupClient.close();

    client.close();
  } finally {
    await shutdown(browser);
    server.close();
    await new Promise((r) => setTimeout(r, 500));
    for (const path of [profile, staging]) {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch (error) {
        // leave it to the system temp sweep
      }
    }
  }
}

main().catch((error) => {
  console.error("probe failed:", error.message);
  process.exit(1);
});
