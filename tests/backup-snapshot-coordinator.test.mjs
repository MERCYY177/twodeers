import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../backup-snapshot-coordinator.js', import.meta.url), 'utf8');

function makeCoordinator() {
  const listeners = new Map();
  const document = {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); }
  };
  const window = {};
  const sandbox = { window, document, Promise, Map, Set, Array, Error, TypeError };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'backup-snapshot-coordinator.js' });
  return { api: window.BackupSnapshotCoordinator, listeners };
}

test('snapshot drains pending writes and exposes persisted revisions', async () => {
  const { api } = makeCoordinator();
  api.register('chat', { snapshot: () => ({ messages: ['latest'] }) });
  let resolveWrite;
  const pending = new Promise(resolve => { resolveWrite = resolve; });
  const tracked = api.trackWrite('chat', pending);
  const sessionPromise = api.beginSnapshot(['chat']);
  resolveWrite();
  await tracked;
  const session = await sessionPromise;
  assert.deepEqual(session.get('chat').messages, ['latest']);
  assert.equal(api.getRevision('chat'), 1);
  assert.equal(api.getPersistedRevision('chat'), 1);
  session.release();
  assert.equal(api.isActive(), false);
});

test('a mutation during snapshot invalidates the snapshot and release unlocks it', async () => {
  const { api, listeners } = makeCoordinator();
  api.register('chat', { snapshot: () => ({ version: 1 }) });
  const session = await api.beginSnapshot(['chat']);
  api.noteWrite('chat', true);
  assert.throws(() => session.assertUnchanged(), /发生变化/);
  const event = { preventDefaultCalled: false, stopPropagationCalled: false,
    preventDefault() { this.preventDefaultCalled = true; },
    stopPropagation() { this.stopPropagationCalled = true; },
    stopImmediatePropagation() {} };
  for (const fn of listeners.get('click') || []) fn(event);
  assert.equal(event.preventDefaultCalled, true);
  assert.equal(event.stopPropagationCalled, true);
  session.release();
  assert.equal(api.isActive(), false);
  assert.equal((listeners.get('click') || new Set()).size, 0);
});

test('snapshot acquisition failure releases the business event barrier', async () => {
  const { api, listeners } = makeCoordinator();
  api.register('font', { snapshot: async () => { throw new Error('font database unavailable'); } });
  await assert.rejects(() => api.beginSnapshot(['font']), /font database unavailable/);
  assert.equal(api.isActive(), false);
  assert.equal((listeners.get('click') || new Set()).size, 0);
});


test('an asynchronous write invalidates a snapshot at write start, not completion', async () => {
  const { api } = makeCoordinator();
  api.register('media', { snapshot: () => ({ ids: ['m1'] }) });
  const session = await api.beginSnapshot(['media']);
  let finish;
  const pending = api.trackWrite('media', new Promise(resolve => { finish = resolve; }));
  assert.throws(() => session.assertUnchanged(), /发生变化/);
  finish();
  await pending;
  assert.equal(api.getRevision('media'), api.getPersistedRevision('media'));
  session.release();
});

test('unpersisted revisions prevent a backup snapshot', async () => {
  const { api } = makeCoordinator();
  api.register('chat', { snapshot: () => ({}) });
  api.noteWrite('chat', false);
  await assert.rejects(() => api.beginSnapshot(['chat']), /尚未持久化/);
  assert.equal(api.isActive(), false);
});

test('snapshot waits for a multi-module restore operation before reading participants', async () => {
  const { api } = makeCoordinator();
  let value = 'before';
  api.register('chat', { snapshot: () => ({ value }) });
  let finishRestore;
  const restore = api.trackOperation(() => new Promise(resolve => {
    finishRestore = () => {
      value = 'restored';
      api.noteWrite('chat', true);
      resolve();
    };
  }));
  // trackOperation registers synchronously, then starts the callback in a microtask.
  await Promise.resolve();
  assert.equal(typeof finishRestore, 'function');
  assert.equal(api.getRevision('chat'), 0,
    'operation tracking alone must not claim that module data was written');
  const snapshotPromise = api.beginSnapshot(['chat']);
  finishRestore();
  await restore;
  const snapshot = await snapshotPromise;
  assert.equal(snapshot.get('chat').value, 'restored');
  assert.equal(snapshot.revision.chat, 1);
  assert.equal(snapshot.persistedRevision.chat, 1);
  snapshot.release();
});

test('restore operations cannot start after a snapshot barrier becomes active', async () => {
  const { api } = makeCoordinator();
  let value = 'stable';
  let workStarted = false;
  api.register('chat', { snapshot: () => ({ value }) });
  const snapshot = await api.beginSnapshot(['chat']);
  assert.throws(() => api.trackOperation(() => {
    workStarted = true;
    value = 'mutated';
    api.noteWrite('chat', true);
  }), /备份快照正在进行/);
  await Promise.resolve();
  assert.equal(workStarted, false, 'rejected restore callback must never execute');
  assert.equal(value, 'stable');
  assert.doesNotThrow(() => snapshot.assertUnchanged());
  snapshot.release();
});
