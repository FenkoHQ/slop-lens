import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Worker } from 'node:worker_threads';

const workerCode = `
const { parentPort } = require('node:worker_threads');
const fs = require('node:fs');
const vm = require('node:vm');
global.importScripts = (...paths) => paths.forEach(path => vm.runInThisContext(fs.readFileSync('src/' + path, 'utf8')));
global.postMessage = value => parentPort.postMessage(value);
vm.runInThisContext(fs.readFileSync('src/scan-worker.js', 'utf8'));
parentPort.on('message', data => {
  // Force a slow rule regardless of the CI runner's CPU speed.
  if (data.length > 80000) {
    const stop = Date.now() + 4000;
    while (Date.now() < stop) {}
  }
  global.onmessage({ data });
});
`;
let live = 0;
class BrowserWorker {
  constructor() {
    live++;
    this.worker = new Worker(workerCode, { eval: true });
    this.worker.on('message', data => this.onmessage?.({ data }));
    this.worker.on('error', error => this.onerror?.(error));
  }
  postMessage(data) { this.worker.postMessage(data); }
  terminate() { live--; this.worker.terminate(); }
}
const context = vm.createContext({ Worker: BrowserWorker, setTimeout, clearTimeout, Date, console });
vm.runInContext(readFileSync('src/worker-host.js', 'utf8'), context);
const score = context.SlopLens.scoreTask;
const phrase = Array.from({ length: 4000 }, (_, i) => `word${i.toString(36)}`).join(' ');
const text = [phrase, phrase, phrase].join('\n\n');

test('slow scoring is terminated while the caller stays responsive, then explicit retry succeeds', async () => {
  let ticks = 0;
  const heartbeat = setInterval(() => ticks++, 20);
  const start = Date.now();
  const result = await score({ key: 'tab', text, deadline: start + 3000 });
  clearInterval(heartbeat);
  assert.equal(result.code, 'timeout');
  assert.ok(Date.now() - start < 3800);
  assert.ok(ticks > 50);
  assert.equal(live, 0);
  const retry = await score({ key: 'tab', text, deadline: Date.now() + 30000 });
  assert.equal(retry.ok, true);
  assert.equal(retry.analysis.word_count, 12000);
  assert.equal(live, 0);
});

test('a replacement cancels the previous worker and stale result', async () => {
  const old = score({ key: 'same', text, deadline: Date.now() + 30000 });
  const next = score({ key: 'same', text: 'A short plain sentence about a cat walking across the garden.', deadline: Date.now() + 3000 });
  assert.equal((await old).code, 'cancelled');
  assert.equal((await next).ok, true);
  assert.equal(live, 0);
});

test('cancellation terminates workers and oversized input never starts one', async () => {
  const running = score({ key: 'closed', text, deadline: Date.now() + 30000 });
  await score({ key: 'closed', cancel: true });
  assert.equal((await running).code, 'cancelled');
  assert.equal(live, 0);
  const oversized = await score({ key: 'large', text: 'x'.repeat(500001), deadline: Date.now() + 3000 });
  assert.equal(oversized.ok, false);
  assert.equal(live, 0);
});
