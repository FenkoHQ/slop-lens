/* Scoring runs in a disposable worker so a deadline can interrupt any rule. */
importScripts('engine/util.js', 'engine/markdown.js', 'engine/document.js',
  'engine/ngrams.js', 'engine/scoring.js', 'engine/rules.js', 'engine/engine.js');

onmessage = ({ data }) => {
  try {
    postMessage({ ok: true, analysis: globalThis.SlopGuard.analyzeText(data) });
  } catch (error) {
    postMessage({ ok: false, error: error.message || 'Scoring failed.' });
  }
};
