import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const coordinator = read('runtime-coordinator.js');
const mailbox = read('mailbox-manager.js');
const index = read('index.html');

function sliceBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `missing source boundary: ${startText} -> ${endText}`);
  return source.slice(start, end);
}

// Execute the exact production revision-marker function with a deterministic
// quota failure. It must permanently close the write gate and notify loaded tabs.
{
  const marker = sliceBetween(coordinator, '  function markDataChanged() {', '  function canResumeWithoutReload()');
  const sent = [];
  let blocked = false;
  let blockedReason = '';
  const global = { localStorage: { getItem() { return '7'; }, setItem() { const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error; } } };
  const channel = { postMessage(message) { sent.push(message); } };
  const context = { global, channel, writable: true, permanentlyBlocked: false, revisionReliable: true, revisionAtRelease: '7', lastOwnRevision: '7', Date, Error, setBlocked(reason) { blocked = true; blockedReason = reason.message; }, console };
  vm.createContext(context);
  vm.runInContext(`${marker}\nglobalThis.runMark=markDataChanged;`, context);
  assert.equal(context.runMark(), false);
  assert.equal(context.revisionReliable, false);
  assert.equal(context.revisionAtRelease, null);
  assert.equal(blocked, true);
  assert.match(blockedReason, /业务数据可能已经写入/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'revision-unreliable');
  assert.match(sent[0].message, /重新加载/);
}

// Exact mailbox timer callback: hidden and readonly pages must return before
// planning cards, consuming recency state or attempting a localStorage write.
{
  const processDue = sliceBetween(mailbox, '  function processDue(){', '  function syncSettings(){');
  for (const scenario of [
    { hidden: true, writable: true, label: 'hidden' },
    { hidden: false, writable: false, label: 'readonly' },
    { hidden: false, writable: true, paused: true, label: 'paused' },
  ]) {
    const counts = { choose: 0, persist: 0, toast: 0 };
    const context = {
      tasksPaused: !!scenario.paused,
      document: { hidden: scenario.hidden },
      window: { __duoRuntimeCoordinator: { isWritable: () => scenario.writable } },
      Date: { now() { throw new Error('work must not be planned in gated state'); } },
      box: { pending: [], items: [], settings: {}, usageOutbox: [], recentCardKeys: [] },
      clone: value => JSON.parse(JSON.stringify(value)),
      chooseChatCards() { counts.choose++; return []; }, persist() { counts.persist++; return true; },
      showToast() { counts.toast++; },
    };
    vm.createContext(context);
    vm.runInContext(`${processDue}\nglobalThis.runProcessDue=processDue;`, context);
    context.runProcessDue();
    assert.deepEqual(counts, { choose: 0, persist: 0, toast: 0 }, `${scenario.label} mailbox timer must not touch state`);
  }
}

// Exact Circle timer wrapper: only a visible, unpaused, writable page may run
// processPending. The production source installs the wrapper for both initial
// and interval callbacks.
{
  const timer = sliceBetween(index, 'const processPendingWhenWritable=()=>{', 'setTimeout(processPendingWhenWritable,0);');
  let processed = 0;
  const context = { document: { hidden: true }, window: { __duoCircleRestorePaused: false, __duoRuntimeCoordinator: { isWritable: () => true } }, processPending() { processed++; } };
  vm.createContext(context);
  vm.runInContext(`${timer}\nglobalThis.runCircleTimer=processPendingWhenWritable;`, context);
  context.runCircleTimer();
  assert.equal(processed, 0, 'hidden Circle tab must not process pending interactions');
  context.document.hidden = false;
  context.window.__duoCircleRestorePaused = true;
  context.runCircleTimer();
  assert.equal(processed, 0, 'restore-paused Circle tab must not process pending interactions');
  context.window.__duoCircleRestorePaused = false;
  context.window.__duoRuntimeCoordinator.isWritable = () => false;
  context.runCircleTimer();
  assert.equal(processed, 0, 'readonly Circle tab must not process pending interactions');
  context.window.__duoRuntimeCoordinator.isWritable = () => true;
  context.runCircleTimer();
  assert.equal(processed, 1, 'visible writable Circle tab may process pending interactions');
}

// Regression contract for cross-tab propagation and reload-before-takeover.
assert.match(coordinator, /channel\.onmessage\s*=\s*function\s*\(event\)/);
assert.match(coordinator, /message\.type\s*!==\s*'revision-unreliable'/);
assert.match(coordinator, /if \(actuallyHeld\) \{ revisionReliable = false; revisionAtRelease = null; \}/);
assert.match(coordinator, /if \(!kept\) \{ leaseLostWhileMutation = true; revisionReliable = false;/);

console.log('PASS: revision-marker quota failure fences the current page and broadcasts to loaded tabs; hidden/readonly mailbox and Circle timers perform no writes.');
