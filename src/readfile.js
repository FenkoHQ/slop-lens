/**
 * Read a local file into analyzable text, entirely in the popup.
 *
 * The browser renders PDFs in a viewer extensions cannot reach, so the only
 * way to score one is for the reader to hand us the file. pdf.js is bundled
 * rather than fetched, so this path stays as offline as the rest.
 */
(function (root) {
  "use strict";

  const PDFJS_MODULE = "../vendor/pdfjs/pdf.min.mjs";
  const PDFJS_WORKER = "../vendor/pdfjs/pdf.worker.min.mjs";

  const TEXT_EXTENSIONS = /\.(txt|md|markdown|text|rst|org)$/i;
  const MAX_BYTES = 25 * 1024 * 1024;

  // Vertical jumps, as multiples of the glyph height. Above the first is a new
  // line; above the second the leading is wide enough to read as a new
  // paragraph rather than a wrapped line.
  const LINE_GAP_RATIO = 0.3;
  const PARAGRAPH_GAP_RATIO = 1.6;

  let pdfjs = null;

  async function loadPdfjs() {
    if (pdfjs !== null) {
      return pdfjs;
    }

    const module = await import(PDFJS_MODULE);
    // Resolving against the document keeps this working both as an extension
    // page and in the plain-http test harness.
    module.GlobalWorkerOptions.workerSrc = new URL(PDFJS_WORKER, document.baseURI).href;
    pdfjs = module;

    return pdfjs;
  }

  /**
   * Rebuild line and paragraph breaks from text-item geometry.
   *
   * A PDF has no paragraphs, only glyphs at coordinates. Without this the
   * whole document collapses into one line and every structural rule goes
   * blind, the same failure the pre-wrap handling fixes for social posts.
   */
  function itemsToText(items) {
    const out = [];
    let previousY = null;
    let previousHeight = 0;
    let pendingBreak = 0;

    for (const item of items) {
      if (typeof item.str !== "string") {
        continue;
      }

      // pdf.js marks line ends with empty items; they carry the break but no
      // text, and emitting for them would double-space every paragraph.
      if (item.str.length === 0) {
        if (item.hasEOL) {
          pendingBreak = Math.max(pendingBreak, 1);
        }
        continue;
      }

      const y = item.transform ? item.transform[5] : null;
      const height = item.height || previousHeight || 12;

      // hasEOL and the vertical gap describe the same transition, so take the
      // larger of the two rather than emitting a newline for each.
      if (previousY !== null && y !== null) {
        const gap = Math.abs(previousY - y);
        if (gap > height * PARAGRAPH_GAP_RATIO) {
          pendingBreak = 2;
        } else if (gap > height * LINE_GAP_RATIO) {
          pendingBreak = Math.max(pendingBreak, 1);
        }
      }

      if (pendingBreak > 0) {
        out.push("\n".repeat(pendingBreak));
        pendingBreak = 0;
      }

      out.push(item.str);
      if (item.hasEOL) {
        pendingBreak = 1;
      }

      if (y !== null) {
        previousY = y;
        previousHeight = height;
      }
    }

    return out.join("");
  }

  async function readPdf(buffer) {
    const lib = await loadPdfjs();
    const task = lib.getDocument({
      data: new Uint8Array(buffer),
      // Nothing here needs to render, and both of these reach the network.
      disableFontFace: true,
      isEvalSupported: false,
      useWorkerFetch: false,
      useSystemFonts: false,
    });

    const doc = await task.promise;
    const pages = [];

    try {
      for (let number = 1; number <= doc.numPages; number += 1) {
        const page = await doc.getPage(number);
        const content = await page.getTextContent();
        pages.push(itemsToText(content.items));
        page.cleanup();
      }
    } finally {
      // Teardown lives on the loading task, not the document proxy.
      await task.destroy();
    }

    return pages.join("\n\n");
  }

  /** Read one picked file into text, or throw something worth showing. */
  async function readFile(file) {
    if (file.size > MAX_BYTES) {
      throw new Error(`${file.name} is larger than 25 MB.`);
    }

    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (isPdf) {
      const text = await readPdf(await file.arrayBuffer());
      if (text.trim().length === 0) {
        throw new Error(
          `${file.name} has no extractable text. Scanned PDFs are images, not text.`
        );
      }

      return text;
    }

    if (file.type.startsWith("text/") || TEXT_EXTENSIONS.test(file.name)) {
      return file.text();
    }

    throw new Error(`${file.name} is not a PDF or a text file.`);
  }

  root.SlopLens = Object.assign(root.SlopLens || {}, { readFile });
})(typeof globalThis !== "undefined" ? globalThis : this);
