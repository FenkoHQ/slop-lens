/* One worker per caller; terminate it on completion, replacement or timeout. */
(function (root) {
  'use strict';
  const MAX_WAIT_MS = 30000;
  const MAX_TEXT_CHARS = 500000;
  const MAX_WORKERS = 4;
  const tasks = new Map();

  function scoreTask(request) {
    const { key, text, deadline } = request;
    if (request.cancel) {
      const targets = key === null ? [...tasks.values()] : [tasks.get(key)];
      for (const finish of targets) {
        finish?.({ ok: false, code: 'cancelled', error: 'Scan cancelled.' });
      }
      return Promise.resolve({ ok: true });
    }
    tasks.get(key)?.({ ok: false, code: 'cancelled', error: 'Scan replaced.' });
    const remaining = Math.min(MAX_WAIT_MS, deadline - Date.now());
    if (!Number.isFinite(remaining) || remaining <= 0) {
      return Promise.resolve({ ok: false, code: 'timeout', error: 'Scan time limit reached.' });
    }
    if (typeof text !== 'string' || text.length > MAX_TEXT_CHARS) {
      return Promise.resolve({ ok: false, error: 'Too much text. Select a smaller passage.' });
    }
    if (tasks.size >= MAX_WORKERS) {
      return Promise.resolve({ ok: false, error: 'Other scans are running. Try again shortly.' });
    }
    return new Promise((resolve) => {
      const api = root.browser || root.chrome;
      const worker = new Worker(api?.runtime ? api.runtime.getURL('src/scan-worker.js') : 'scan-worker.js');
      const finish = (result) => {
        if (tasks.get(key) !== finish) {
          return;
        }
        clearTimeout(timer);
        worker.terminate();
        tasks.delete(key);
        resolve(result);
      };
      const timer = setTimeout(() => finish({ ok: false, code: 'timeout',
        error: 'Scan time limit reached.' }), remaining);
      tasks.set(key, finish);
      worker.onmessage = ({ data }) => finish(data);
      worker.onerror = () => finish({ ok: false, error: 'Scoring worker failed.' });
      worker.postMessage(text);
    });
  }
  root.SlopLens = Object.assign(root.SlopLens || {}, { scoreTask });

  const api = root.browser || root.chrome;
  if (!api?.runtime) {
    return;
  }
  api.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'slop-lens/worker' || sender.id !== api.runtime.id || sender.tab) {
      return;
    }
    scoreTask(message).then(reply, () => reply({ ok: false, error: 'Scoring failed.' }));
    return true;
  });
})(globalThis);
