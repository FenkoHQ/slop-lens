/* Route page requests to a worker host outside the page's renderer. */
(function (root) {
  'use strict';
  const api = root.browser || root.chrome;
  const MAX_WAIT_MS = 30000;
  let creating = null;

  async function hostReady() {
    if (!api.offscreen) {
      return;
    }
    if (creating) {
      return creating;
    }
    creating = (async () => {
      if (await api.offscreen.hasDocument()) {
        return;
      }
      await api.offscreen.createDocument({ url: 'src/offscreen.html',
        reasons: ['WORKERS'], justification: 'Run local scoring in cancellable workers without blocking web pages.' });
    })();
    try {
      await creating;
    } finally {
      creating = null;
    }
  }

  async function cancelScore(key) {
    if (!api.offscreen) {
      return root.SlopLens.scoreTask({ key, cancel: true });
    }
    if (await api.offscreen.hasDocument()) {
      await api.runtime.sendMessage({ type: 'slop-lens/worker', key, cancel: true });
    }
  }
  root.SlopLens = Object.assign(root.SlopLens || {}, { cancelScore });

  api.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'slop-lens/score' || sender.id !== api.runtime.id) {
      return;
    }
    const deadline = Math.min(Number(message.deadline), Date.now() + MAX_WAIT_MS);
    const key = sender.tab ? `tab:${sender.tab.id}` : sender.url;
    (async () => {
      await hostReady();
      const request = { type: 'slop-lens/worker', key, text: message.text, deadline };
      return api.offscreen ? api.runtime.sendMessage(request) : root.SlopLens.scoreTask(request);
    })().then(reply, () => reply({ ok: false, error: 'Could not start the scoring worker.' }));
    return true;
  });
})(globalThis);
