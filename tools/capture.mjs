/**
 * Capture the store screenshots and the promo video from the real UI.
 *
 * Drives headless Chromium over CDP rather than `--screenshot`, because the
 * PDF view needs real wall-clock time: virtual time fast-forwards page timers
 * but does not advance the pdf.js worker, so the shot lands mid-parse.
 *
 *     python3 tools/serve.py &
 *     node tools/capture.mjs shots
 *     node tools/capture.mjs video
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "http://127.0.0.1:8731/test/store-shot.html";
const PORT = 9340;
const WIDTH = 1280;
const HEIGHT = 800;

const SHOTS = [
  { name: "screenshot-1-saturated.png", query: "band=saturated", settle: 1800 },
  {
    name: "screenshot-2-signals.png",
    query:
      "band=moderate&open=1" +
      "&headline=Every signal,%3Cbr%3Eand the %3Cem%3Eexact%3C/em%3E words." +
      "&blurb=Grouped by rule, heaviest first. Click a line to jump to it on the page.",
    settle: 2400,
  },
  {
    name: "screenshot-3-clean.png",
    query:
      "page=clean&h=430" +
      "&headline=Human writing%3Cbr%3Ereads as %3Cem%3Eclean%3C/em%3E." +
      "&blurb=The score is a density of tells per thousand words, not a guess about the author.",
    settle: 1800,
  },
  {
    name: "screenshot-4-file.png",
    query:
      "view=file" +
      "&headline=Score a PDF,%3Cbr%3Ewithout %3Cem%3Euploading%3C/em%3E it." +
      "&blurb=Drop a PDF or text file in. It is parsed in the tab and never leaves your machine.",
    settle: 5000,
  },
  {
    name: "screenshot-5-settings.png",
    query:
      "view=settings" +
      "&headline=Your toolbar,%3Cbr%3Eyour %3Cem%3Erules%3C/em%3E." +
      "&blurb=Show the number, colour the icon, or neither. Scan on page load only if you ask for it.",
    settle: 2200,
  },
];

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;

  const ready = new Promise((resolveReady, rejectReady) => {
    socket.addEventListener("open", () => resolveReady());
    socket.addEventListener("error", rejectReady);
  });

  const listeners = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.method) {
      const handler = listeners.get(message.method);
      if (handler) {
        handler(message.params);
      }
      return;
    }

    const entry = pending.get(message.id);
    if (!entry) {
      return;
    }
    pending.delete(message.id);
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
  });

  return {
    ready,
    on: (method, handler) => listeners.set(method, handler),
    send(method, params) {
      const id = nextId;
      nextId += 1;
      socket.send(JSON.stringify({ id, method, params: params || {} }));

      return new Promise((resolveCall, rejectCall) =>
        pending.set(id, { resolve: resolveCall, reject: rejectCall })
      );
    },
    close: () => socket.close(),
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const profile = mkdtempSync(join(tmpdir(), "slop-lens-capture-"));
  const browser = spawn(
    process.env.CHROMIUM || "chromium",
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--force-device-scale-factor=1",
      `--window-size=${WIDTH},${HEIGHT}`,
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${PORT}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) {
        break;
      }
    } catch (error) {
      // not up yet
    }
    await wait(250);
  }

  return {
    browser,
    cleanup: async () => {
      browser.kill();
      await wait(400);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch (error) {
        // leave it to the system temp sweep
      }
    },
  };
}

async function openPage(url) {
  const target = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, {
      method: "PUT",
    })
  ).json();

  const client = connect(target.webSocketDebuggerUrl);
  await client.ready;
  await client.send("Page.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });

  return { client, targetId: target.id };
}

async function closePage(targetId) {
  await fetch(`http://127.0.0.1:${PORT}/json/close/${targetId}`);
}

async function shots() {
  const out = join(ROOT, "store");
  mkdirSync(out, { recursive: true });

  const { cleanup } = await launch();

  try {
    for (const shot of SHOTS) {
      const { client, targetId } = await openPage(`${BASE}?${shot.query}`);
      await wait(shot.settle);

      const { data } = await client.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(out, shot.name), Buffer.from(data, "base64"));
      console.log(`${shot.name}  (${Math.round(data.length * 0.75 / 1024)} KB)`);

      client.close();
      await closePage(targetId);
    }
  } finally {
    await cleanup();
  }
}

const FPS = 20;

/**
 * Render the promo frame by frame.
 *
 * The page exposes __promoSeek(seconds) and draws that exact state, so timing
 * comes from the frame index rather than from how fast the machine happens to
 * be. A screencast would instead emit frames only when something changed,
 * which compresses every still moment.
 */
async function video() {
  const frames = mkdtempSync(join(tmpdir(), "slop-lens-frames-"));
  const out = join(ROOT, "store");
  mkdirSync(out, { recursive: true });

  const { cleanup } = await launch();

  try {
    const { client, targetId } = await openPage("http://127.0.0.1:8731/test/promo.html");

    // Let the three embedded views finish rendering before the first frame.
    await wait(6000);

    const { result: durationResult } = await client.send("Runtime.evaluate", {
      expression: "window.__promoDuration",
      returnByValue: true,
    });
    const duration = durationResult.value || 22;
    const total = Math.round(duration * FPS);

    for (let index = 0; index < total; index += 1) {
      await client.send("Runtime.evaluate", {
        expression: `window.__promoSeek(${index / FPS})`,
        returnByValue: true,
      });

      const { data } = await client.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(
        join(frames, `frame-${String(index).padStart(5, "0")}.png`),
        Buffer.from(data, "base64")
      );

      if (index % 40 === 0) {
        console.log(`  frame ${index}/${total}`);
      }
    }

    client.close();
    await closePage(targetId);
    console.log(`captured ${total} frames`);

    encode(frames, out);
  } finally {
    await cleanup();
  }
}

/** Encode the frames to an MP4 for stores and a GIF for the README. */
function encode(frames, out) {
  const input = join(frames, "frame-%05d.png");

  const mp4 = join(out, "promo.mp4");
  spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", input,
     "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
     "-vf", "scale=1280:800", mp4],
    { stdio: "inherit" }
  );

  const palette = join(frames, "palette.png");
  const gif = join(out, "promo.gif");
  const gifFilters = `fps=12,scale=720:-1:flags=lanczos`;

  spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", input,
     "-vf", `${gifFilters},palettegen=stats_mode=diff`, palette],
    { stdio: "inherit" }
  );
  spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", input, "-i", palette,
     "-lavfi", `${gifFilters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`, gif],
    { stdio: "inherit" }
  );

  for (const file of [mp4, gif]) {
    console.log(`${file}  (${Math.round(statSync(file).size / 1024)} KB)`);
  }
}

const command = process.argv[2] || "shots";
const commands = { shots, video };

if (!commands[command]) {
  console.error(`unknown command: ${command}`);
  process.exit(1);
}

commands[command]().catch((error) => {
  console.error("capture failed:", error.message);
  process.exit(1);
});
