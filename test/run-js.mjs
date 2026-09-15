/**
 * Run the JS engine over test/samples.json and print one JSON blob per sample.
 *
 *   node test/run-js.mjs > /tmp/js.json
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const engineDir = join(here, "..", "src", "engine");

const ENGINE_FILES = [
  "util.js",
  "markdown.js",
  "document.js",
  "ngrams.js",
  "scoring.js",
  "rules.js",
  "engine.js",
];

for (const file of ENGINE_FILES) {
  const source = readFileSync(join(engineDir, file), "utf8");
  // Indirect eval keeps the scripts in the global scope, which is where they
  // attach `globalThis.SlopGuard`.
  (0, eval)(source);
}

const samples = JSON.parse(readFileSync(join(here, "samples.json"), "utf8"));
const out = {};

for (const sample of samples) {
  out[sample.name] = globalThis.SlopGuard.analyzeText(sample.text);
}

process.stdout.write(JSON.stringify(out, null, 2));
