/* Cooperative, optimistic read-only snapshot barrier for backup exports. */
(function (global) {
  'use strict';
  if (global.BackupSnapshotCoordinator) return;

  const participants = new Map();
  const revision = new Map();
  const persistedRevision = new Map();
  const pending = new Set();
  let active = false;
  let generation = 0;
  const guardedEvents = ['click', 'change', 'input', 'submit', 'keydown', 'pointerdown', 'touchstart', 'compositionstart'];

  function revisionOf(name) { return revision.get(name) || 0; }
  function persistedOf(name) { return persistedRevision.get(name) || 0; }
  function noteWrite(name, isPersisted) {
    const next = revisionOf(name) + 1;
    revision.set(name, next);
    if (isPersisted === true) persistedRevision.set(name, next);
    return next;
  }
  function trackWrite(name, promise) {
    // Advance revision before the asynchronous write begins so a write that starts
    // during a snapshot invalidates it even if the transaction has not completed yet.
    const writeRevision = noteWrite(name, false);
    const task = Promise.resolve(promise);
    let tracked;
    tracked = task.then(function (value) {
      persistedRevision.set(name, Math.max(persistedOf(name), writeRevision));
      return value;
    }, function (error) {
      throw error;
    }).finally(function () { pending.delete(tracked); });
    pending.add(tracked);
    return tracked;
  }
  function trackOperation(work) {
    // Reject an operation that tries to start after a snapshot barrier is active.
    // Accept a callback, not an already-running Promise, so the rejection happens
    // before any restore mutation can begin.
    if (active) throw new Error('备份快照正在进行，无法开始恢复操作');
    if (typeof work !== 'function') throw new TypeError('恢复操作必须以延迟执行的函数提供');
    // Track a multi-module restore for its full lifetime without pretending that
    // any particular module has been persisted. Its individual writes must still
    // advance their own revisions through noteWrite/trackWrite.
    const task = Promise.resolve().then(work);
    let tracked;
    tracked = task.finally(function () { pending.delete(tracked); });
    pending.add(tracked);
    return tracked;
  }

  function register(name, adapter) {
    if (!name || !adapter || typeof adapter.snapshot !== 'function') throw new TypeError('快照参与模块必须提供 snapshot');
    participants.set(name, adapter);
    if (!revision.has(name)) revision.set(name, 0);
    if (!persistedRevision.has(name)) persistedRevision.set(name, 0);
  }
  function guardEvent(event) {
    if (!active) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
  }
  async function drainPending() {
    while (pending.size) await Promise.all(Array.from(pending));
  }
  async function beginSnapshot(required) {
    if (active) throw new Error('已有备份快照正在进行');
    const names = Array.isArray(required) ? required.slice() : Array.from(participants.keys());
    for (const name of names) if (!participants.has(name)) throw new Error('备份快照模块未注册：' + name);
    active = true;
    const token = ++generation;
    guardedEvents.forEach(type => document.addEventListener(type, guardEvent, true));
    let released = false;
    const release = function () {
      if (released) return;
      released = true;
      if (token === generation) {
        active = false;
        guardedEvents.forEach(type => document.removeEventListener(type, guardEvent, true));
      }
    };
    try {
      await drainPending();
      for (const name of names) {
        if (revisionOf(name) !== persistedOf(name)) throw new Error('模块存在尚未持久化的写入，拒绝生成不完整备份：' + name);
      }
      const baseline = new Map(names.map(name => [name, revisionOf(name)]));
      const snapshots = new Map();
      for (const name of names) snapshots.set(name, await participants.get(name).snapshot());
      const assertUnchanged = function () {
        for (const name of names) {
          if (revisionOf(name) !== baseline.get(name) || persistedOf(name) !== baseline.get(name)) {
            throw new Error('快照期间模块发生变化，已取消本次备份以避免跨模块不一致：' + name);
          }
        }
      };
      assertUnchanged();
      return {
        generation: token,
        revision: Object.fromEntries(baseline),
        persistedRevision: Object.fromEntries(baseline),
        get: function (name) {
          if (!snapshots.has(name)) throw new Error('快照未包含模块：' + name);
          return snapshots.get(name);
        },
        assertUnchanged: assertUnchanged,
        release: release
      };
    } catch (error) {
      release();
      throw error;
    }
  }

  global.BackupSnapshotCoordinator = Object.freeze({
    register: register,
    noteWrite: noteWrite,
    trackWrite: trackWrite,
    trackOperation: trackOperation,
    beginSnapshot: beginSnapshot,
    getRevision: revisionOf,
    getPersistedRevision: persistedOf,
    isActive: function () { return active; }
  });
})(window);
