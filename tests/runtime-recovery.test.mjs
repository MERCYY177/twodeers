import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'runtime-coordinator.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const backup = fs.readFileSync(path.join(root, 'backup-v4.js'), 'utf8');
const circleMedia = fs.readFileSync(path.join(root, 'circle-media-manager.js'), 'utf8');
const mailbox = fs.readFileSync(path.join(root, 'mailbox-manager.js'), 'utf8');
const stickerLibrary = fs.readFileSync(path.join(root, 'sticker-library.js'), 'utf8');
const fontPanel = fs.readFileSync(path.join(root, 'font-panel.js'), 'utf8');
const fontManager = fs.readFileSync(path.join(root, 'custom-font-manager.js'), 'utf8');
const cardSystem = fs.readFileSync(path.join(root, 'card-system.js'), 'utf8');
const beautify = fs.readFileSync(path.join(root, 'chat-beautify-manager.js'), 'utf8');

class FakeObjectStoreNames {
  constructor(stores) { this.stores = stores; }
  contains(name) { return this.stores.has(name); }
}
class FakeDb {
  constructor(name, supportsStrictDurability = true, corruptCommittedReadback = false) { this.name = name; this.supportsStrictDurability = supportsStrictDurability; this.corruptCommittedReadback = corruptCommittedReadback; this.transactions = []; this.stores = new Map(); this.objectStoreNames = new FakeObjectStoreNames(this.stores); }
  createObjectStore(name, options = {}) {
    const store = { keyPath: options.keyPath || 'id', data: new Map() };
    this.stores.set(name, store);
    return store;
  }
  transaction(storeName, mode, options = {}) {
    const thisDb = this;
    const store = this.stores.get(storeName);
    if (!store) throw new Error('missing object store ' + storeName);
    const actualDurability = options?.durability === 'strict' && !this.supportsStrictDurability ? 'default' : (options?.durability || 'default');
    const tx = { mode, durability: actualDurability, error: null, oncomplete: null, onerror: null, onabort: null, abort() { tx.aborted = true; setTimeout(() => tx.onabort?.(), 0); } };
    this.transactions.push({ storeName, mode, requestedDurability: options?.durability || null, actualDurability });
    tx.objectStore = name => {
      const actual = this.stores.get(name);
      return {
        get(key) {
          const request = { result: undefined, onsuccess: null, onerror: null };
          queueMicrotask(() => { const stored = actual.data.get(key); request.result = thisDb.name === 'twodeers-recovery-journal-v1' && thisDb.corruptCommittedReadback && stored?.phase === 'committed' ? { ...stored, phase: 'prepared' } : stored; request.onsuccess?.({ target: request }); });
          return request;
        },
        put(value) {
          if (mode !== 'readwrite') throw new Error('readonly transaction');
          actual.data.set(value[actual.keyPath], value);
          return { onsuccess: null, onerror: null };
        },
        delete(key) {
          if (mode !== 'readwrite') throw new Error('readonly transaction');
          actual.data.delete(key);
        },
      };
    };
    setTimeout(() => { if (!tx.aborted) tx.oncomplete?.(); }, 0);
    return tx;
  }
}
class FakeIndexedDB {
  constructor({ supportsStrictDurability = true, corruptCommittedReadback = false } = {}) { this.dbs = new Map(); this.supportsStrictDurability = supportsStrictDurability; this.corruptCommittedReadback = corruptCommittedReadback; }
  open(name, version = 1) {
    const request = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
    setTimeout(() => {
      let db = this.dbs.get(name);
      const isNew = !db;
      if (!db) { db = new FakeDb(name, this.supportsStrictDurability, this.corruptCommittedReadback); this.dbs.set(name, db); }
      request.result = db;
      if (isNew) request.onupgradeneeded?.({ target: request });
      request.onsuccess?.({ target: request });
    }, 0);
    return request;
  }
}

function makeEnvironment(indexedDB) {
  const handlers = new Map();
  const intervalHandlers = new Map();
  let nextIntervalId = 0;
  const document = {
    visibilityState: 'visible', body: null,
    addEventListener(type, fn) { const rows = handlers.get('doc:' + type) || []; rows.push(fn); handlers.set('doc:' + type, rows); },
  };
  const windowHandlers = new Map();
  const fakeWindow = {
    indexedDB,
    navigator: { storage: { estimate: async () => ({ usage: 850, quota: 1000 }) } },
    document,
    location: { reload() {} },
    dispatchEvent() {},
    addEventListener(type, fn) { const rows = windowHandlers.get(type) || []; rows.push(fn); windowHandlers.set(type, rows); },
  };
  const sandbox = {
    window: fakeWindow, document, navigator: fakeWindow.navigator, indexedDB,
    setTimeout(fn, delay = 0) { return delay === 0 ? setTimeout(fn, 0) : { inertTimer: true }; }, clearTimeout() {},
    setInterval(fn, delay = 0) { const id = ++nextIntervalId; intervalHandlers.set(id, { fn, delay }); return id; },
    clearInterval(id) { intervalHandlers.delete(id); },
    queueMicrotask, Promise, Date, Math, Error, String, Number, Object, Array, Set, Map,
    Blob, CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    console,
  };
  vm.runInNewContext(source, sandbox, { filename: 'runtime-coordinator.js' });
  return {
    api: fakeWindow.__duoRuntimeCoordinator,
    window: fakeWindow,
    trigger(type) { for (const fn of windowHandlers.get(type) || []) fn(); },
    triggerDocument(type, event) { for (const fn of handlers.get('doc:' + type) || []) fn(event); },
    tickIntervals() { for (const [id, entry] of [...intervalHandlers]) entry.fn(id); },
    activeIntervals() { return intervalHandlers.size; },
    document,
    getJournalTransactions() { return indexedDB.dbs.get('twodeers-recovery-journal-v1')?.transactions || []; },
  };
}

// Two independent document contexts share one IndexedDB lock database.
// Exactly one is writable; the other stays read-only even after the first exits
// until it explicitly reloads, preventing stale in-memory state from writing.
{
  const idb = new FakeIndexedDB();
  const first = makeEnvironment(idb);
  const firstReady = await first.api.ready;
  assert.equal(firstReady.writable, true, 'first visible tab should acquire the writer lease');
  assert.equal(first.api.isWritable(), false, 'lease ownership alone must not expose editing before startup recovery and migrations finish');
  assert.equal(first.api.getStatus().startupComplete, false);
  first.api.completeStartup();
  assert.equal(first.api.isWritable(), true);

  const second = makeEnvironment(idb);
  const secondReady = await second.api.ready;
  assert.equal(secondReady.writable, false, 'second tab must be read-only while the first owns the lease');
  assert.equal(second.api.isWritable(), false);
  const shadowButton = { nodeType: 1, matches(selector) { return selector.includes('button'); }, closest() { return null; } };
  const readonlySafeButton = { nodeType: 1, matches(selector) { return selector.includes('data-duo-readonly-allowed') || selector.includes('button'); }, closest() { return null; } };
  const keyboardEvent = { key: 'Enter', target: { closest() { return null; } }, composedPath() { return [shadowButton]; }, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  second.triggerDocument('keydown', keyboardEvent);
  assert.equal(keyboardEvent.prevented, true, 'readonly keydown inside Circle Shadow DOM must be blocked through composedPath');
  assert.equal(keyboardEvent.stopped, true);
  const clickEvent = { target: { closest() { return null; } }, composedPath() { return [shadowButton]; }, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  second.triggerDocument('click', clickEvent);
  assert.equal(clickEvent.prevented, true, 'readonly click inside Circle Shadow DOM must be blocked through composedPath');
  const inputNode = { nodeType: 1, matches(selector) { return selector.includes('input'); } };
  const inputEvent = { target: { closest() { return null; } }, composedPath() { return [inputNode]; }, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  second.triggerDocument('input', inputEvent);
  assert.equal(inputEvent.prevented, true, 'readonly input event inside Shadow DOM must be blocked through composedPath');

  // A permanently blocked recovery state is also read-only. The old guard
  // accidentally treated permanentlyBlocked as a reason to bypass the UI gate.
  const blocked = makeEnvironment(new FakeIndexedDB());
  await blocked.api.ready;
  blocked.api.completeStartup();
  const domNodes = [];
  blocked.document.body = { dataset: {}, appendChild(node) { domNodes.push(node); } };
  blocked.document.createElement = tag => ({
    tagName: tag, dataset: {}, style: {}, children: [], handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
    appendChild(node) { this.children.push(node); },
    replaceChildren(...nodes) { this.children = nodes; },
    remove() { this.removed = true; },
  });
  blocked.document.querySelectorAll = () => [];
  let diagnosticsScrolled = false;
  let workbenchScrolled = false;
  blocked.document.getElementById = id => id === 'recoveryWorkbenchFile' ? { scrollIntoView() { workbenchScrolled = true; } } : id === 'storageDiagnosticsBtn' ? { scrollIntoView() { diagnosticsScrolled = true; } } : null;
  blocked.window.goto = id => { blocked.window.gotoTarget = id; };
  blocked.window.setTimeout = fn => { fn(); return 1; };
  blocked.api.setRecoveryBlocked(new Error('corrupted recovery journal'));
  const banner = domNodes.find(node => node.id === 'duoRuntimeReadonlyBanner');
  const diagnosticsEntry = banner?.children.find(node => node.textContent === '打开数据诊断');
  assert.ok(diagnosticsEntry, 'permanent storage lock must expose a direct diagnostics navigation entry');
  assert.equal(diagnosticsEntry.dataset.duoReadonlyAllowed, 'true');
  diagnosticsEntry.handlers.click();
  assert.equal(blocked.window.gotoTarget, 'settingsPage', 'diagnostics entry must open settings without normal writable navigation');
  assert.equal(workbenchScrolled, true, 'diagnostics entry must bring the read-only recovery workbench into view');
  assert.equal(diagnosticsScrolled, false, 'the workbench should be the primary direct target when present');
  assert.equal(blocked.api.isWritable(), false);
  assert.equal(blocked.api.getStatus().blocked, true);
  const blockedClick = { target: { closest() { return null; } }, composedPath() { return [shadowButton]; }, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  blocked.triggerDocument('click', blockedClick);
  assert.equal(blockedClick.prevented, true, 'permanently blocked recovery must also block clicks');
  const blockedKey = { key: 'Enter', target: { closest() { return null; } }, composedPath() { return [shadowButton]; }, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  blocked.triggerDocument('keydown', blockedKey);
  assert.equal(blockedKey.prevented, true, 'permanently blocked recovery must also block keyboard edits');
  const safeDiagnosticClick = { target: { closest() { return null; } }, composedPath() { return [readonlySafeButton]; }, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  blocked.triggerDocument('click', safeDiagnosticClick);
  assert.equal(safeDiagnosticClick.prevented, undefined, 'explicitly allowlisted read-only diagnostic buttons must remain usable while blocked');
  const safeDiagnosticKey = { key: 'Enter', target: { closest() { return null; } }, composedPath() { return [readonlySafeButton]; }, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  blocked.triggerDocument('keydown', safeDiagnosticKey);
  assert.equal(safeDiagnosticKey.prevented, undefined, 'keyboard activation of readonly-safe diagnostic buttons must remain available');

  first.trigger('pagehide');
  await new Promise(resolve => setTimeout(resolve, 5));
  second.triggerDocument('visibilitychange');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(second.api.isWritable(), false, 'a tab with an already-loaded snapshot must not silently become writable');
  assert.equal(second.api.getStatus().promotionAvailable, true, 'released writer lease should expose a safe reload-to-promote state');
}

// Hiding a page during an active async write closes the UI immediately but
// keeps the underlying IndexedDB lease until the final mutation token ends.
{
  const idb = new FakeIndexedDB();
  const first = makeEnvironment(idb);
  await first.api.ready;
  first.api.completeStartup();
  const finishMutation = first.api.beginMutation('long-running restore');
  first.document.visibilityState = 'hidden';
  first.trigger('pagehide');
  assert.equal(first.api.isWritable(), false, 'pagehide must immediately close the old page write gate');
  await new Promise(resolve => setTimeout(resolve, 5));
  const lockDb = idb.dbs.get('twodeers-runtime-coordinator-v1');
  const leaseRows = lockDb.stores.get('leases').data;
  assert.ok(leaseRows.has('twodeers-app-single-writer-v1'), 'the active mutation must retain the fallback lease while hidden');
  assert.ok(leaseRows.get('twodeers-app-single-writer-v1').expiresAt - Date.now() > 9 * 60 * 1000, 'pagehide must synchronously extend the active-mutation lease before background throttling');
  const finishNested = first.api.beginMutation('nested rollback during hidden transaction');
  const competingTab = makeEnvironment(idb);
  const competingReady = await competingTab.api.ready;
  assert.equal(competingReady.writable, false, 'another tab must not acquire ownership while an async mutation is still active');
  finishMutation();
  assert.ok(leaseRows.has('twodeers-app-single-writer-v1'), 'ending the outer token must not release a nested mutation lease');
  finishNested();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(leaseRows.has('twodeers-app-single-writer-v1'), false, 'the lease is released only after the final mutation completes');
  const successor = makeEnvironment(idb);
  const successorReady = await successor.api.ready;
  assert.equal(successorReady.writable, true, 'a fresh page can acquire the lease after the mutation has safely ended');
  successor.api.completeStartup();
}

// If the same page becomes visible before an active mutation ends, it remains
// read-only until that operation ends, then resumes without a second owner.
{
  const env = makeEnvironment(new FakeIndexedDB());
  await env.api.ready;
  env.api.completeStartup();
  const finishMutation = env.api.beginMutation('visible-again restore');
  env.document.visibilityState = 'hidden';
  env.trigger('pagehide');
  assert.equal(env.api.isWritable(), false);
  env.document.visibilityState = 'visible';
  env.triggerDocument('visibilitychange');
  assert.equal(env.api.isWritable(), false, 'a returning page must not resume in the middle of an active mutation');
  finishMutation();
  assert.equal(env.api.isWritable(), true, 'the original owner may resume after its operation completes and lease remains valid');
  const finishSecond = env.api.beginMutation('follow-up write');
  finishSecond();
}

// A tab returning after the fallback lease may have expired must lock its UI and
// revalidate the IDB owner before edits are enabled again.
{
  const env = makeEnvironment(new FakeIndexedDB());
  await env.api.ready;
  env.api.completeStartup();
  assert.equal(env.api.isWritable(), true);
  env.trigger('focus');
  assert.equal(env.api.isWritable(), false, 'fallback lease revalidation must close the write gate while ownership is checked');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(env.api.isWritable(), true, 'same tab can resume after it safely reacquires an unchanged lease');
}

// The fallback heartbeat must not interpret the interval handle passed by the
// browser as fallbackRenew(allowReadonly=true). When another tab takes ownership,
// the old tab must fail closed and must never overwrite the successor's lease.
{
  const idb = new FakeIndexedDB();
  const stale = makeEnvironment(idb);
  await stale.api.ready;
  stale.api.completeStartup();
  assert.equal(stale.api.isWritable(), true);
  assert.ok(stale.activeIntervals() > 0, 'fallback writer must register a lease heartbeat');
  const leaseRows = idb.dbs.get('twodeers-runtime-coordinator-v1').stores.get('leases').data;
  const key = 'twodeers-app-single-writer-v1';
  const successorLease = { ...leaseRows.get(key), ownerId: 'successor-tab', expiresAt: Date.now() + 60_000 };
  leaseRows.set(key, successorLease);
  stale.tickIntervals(); // Simulate browser timer callback receiving its numeric handle.
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(stale.api.isWritable(), false, 'a stale owner must close its write gate after the heartbeat detects ownership change');
  assert.equal(stale.api.getStatus().promotionAvailable, true, 'stale owner should require a fresh reload before promotion');
  assert.equal(leaseRows.get(key).ownerId, 'successor-tab', 'heartbeat must never replace the successor lease');
  assert.equal(stale.activeIntervals(), 0, 'lost ownership must stop the stale heartbeat');
  assert.throws(() => stale.api.beginMutation('stale-owner-write'), /只读|编辑权/);
}

// A storage parse/structure failure is recorded without embedding the raw
// private value in the issue log, locks the writer, and releases an idle lease.
{
  const idb = new FakeIndexedDB();
  const env = makeEnvironment(idb);
  await env.api.ready;
  env.api.completeStartup();
  const lockRows = idb.dbs.get('twodeers-runtime-coordinator-v1').stores.get('leases').data;
  assert.ok(lockRows.has('twodeers-app-single-writer-v1'));
  const issue = env.api.reportStorageDamage('dual_space_app_clean_test_v1', new SyntaxError('stored JSON is malformed'));
  assert.equal(issue.key, 'dual_space_app_clean_test_v1');
  assert.equal(env.api.getStatus().blocked, true);
  assert.equal(env.api.isWritable(), false);
  assert.equal(env.window.__duoStorageBootIssues.length, 1);
  assert.equal(JSON.stringify(env.window.__duoStorageBootIssues).includes('private-chat-message'), false);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(lockRows.has('twodeers-app-single-writer-v1'), false, 'a blocked idle page must not retain the write lease');
  assert.equal(env.activeIntervals(), 0);
}

// Durable restore journal round-trip includes structured-cloned Blob values.
{
  const env = makeEnvironment(new FakeIndexedDB());
  const ready = await env.api.ready;
  assert.equal(ready.writable, true);
  env.api.completeStartup();
  const blob = new Blob(['previous-font-binary'], { type: 'font/woff2' });
  const journal = {
    id: env.api.journalId, formatVersion: 1, phase: 'prepared', createdAt: Date.now(), kind: 'all',
    oldState: '{"chatHistory":[]}', oldStorage: '{"chatHistory":[]}',
    oldFonts: { currentFontId: 'old-font', fonts: [{ id: 'old-font', size: blob.size, blob }] },
    oldMedia: [['media-1', { id: 'media-1', blob: new Blob(['old-media']), kind: 'image', size: 8 }]],
    oldStorageEntries: [['twodeers_mailbox_drafts_v1', '{\"draft\":\"before reset\"}']],
  };
  await env.api.saveRecoveryJournal(journal);
  const loaded = await env.api.readRecoveryJournal();
  assert.equal(loaded.phase, 'prepared');
  assert.equal(loaded.oldFonts.fonts[0].blob.size, blob.size);
  assert.equal(loaded.oldStorageEntries[0][0], 'twodeers_mailbox_drafts_v1');
  assert.match(loaded.oldStorageEntries[0][1], /before reset/);
  assert.equal(await loaded.oldFonts.fonts[0].blob.text(), 'previous-font-binary');
  await env.api.markRecoveryCommitted();
  assert.equal((await env.api.readRecoveryJournal()).phase, 'committed');
  await env.api.clearRecoveryJournal();
  assert.equal(await env.api.readRecoveryJournal(), null);
  const journalWrites = env.getJournalTransactions().filter(item => item.mode === 'readwrite');
  assert.equal(journalWrites.length, 3, 'PREPARED, COMMITTED and journal deletion must each be a write transaction');
  assert.ok(journalWrites.every(item => item.requestedDurability === 'strict' && item.actualDurability === 'strict'), 'all recovery-journal write transactions must request and receive strict durability');
}

// An engine that silently ignores the strict durability option must fail closed
// before any PREPARED record or application mutation is written.
{
  const env = makeEnvironment(new FakeIndexedDB({ supportsStrictDurability: false }));
  await env.api.ready;
  env.api.completeStartup();
  const journal = { id: env.api.journalId, formatVersion: 1, phase: 'prepared', createdAt: Date.now(), kind: 'all', oldState: '{}', oldStorage: '{}', oldMedia: [] };
  await assert.rejects(env.api.saveRecoveryJournal(journal), /不支持严格持久化事务/);
  assert.equal(await env.api.readRecoveryJournal(), null, 'unsupported strict durability must not leave a false PREPARED commit');
  assert.equal(env.getJournalTransactions().filter(item => item.mode === 'readwrite').length, 1);
  assert.equal(env.api.isWritable(), true, 'a rejected restore attempt before any durable journal write need not permanently block unrelated writes');
}

// If the strict COMMITTED write completes but its verification read-back is
// inconsistent, the coordinator must label the result uncertain. The restore
// layer then fences the page instead of attempting an opposite rollback.
{
  const idb = new FakeIndexedDB({ corruptCommittedReadback: true });
  const env = makeEnvironment(idb);
  await env.api.ready;
  env.api.completeStartup();
  const journal = { id: env.api.journalId, formatVersion: 1, phase: 'prepared', createdAt: Date.now(), kind: 'all', oldState: '{}', oldStorage: '{}', oldMedia: [] };
  await env.api.saveRecoveryJournal(journal);
  await assert.rejects(env.api.markRecoveryCommitted(), error => error?.journalCommitUncertain === true);
  const durableRecord = idb.dbs.get('twodeers-recovery-journal-v1').stores.get('recovery').data.get(env.api.journalId);
  assert.equal(durableRecord.phase, 'committed', 'the fixture simulates a durable COMMITTED record with an inconsistent verification read');
  assert.equal(env.api.getStatus().writable, true, 'coordinator reports only journal uncertainty; restore layer is responsible for permanent write fencing');
}

// A durable prepared journal is only removed after the V4 importer has a
// confirmed in-memory rollback or a confirmed committed marker. Startup recovery
// is present and runs before Circle's legacy migration in the final bootstrap.
assert.match(backup, /await coordinator\.saveRecoveryJournal\(/);
assert.match(backup, /await coordinator\.markRecoveryCommitted\(\)/);
assert.match(backup, /async function recoverInterruptedRestore\(\)/);
assert.match(backup, /journal\.oldStorageEntries!==undefined/);
assert.match(backup, /twodeers_mailbox_drafts_v1/);
assert.match(backup, /phase==='committed'/);
assert.match(index, /await window\.__duoBackupV4\?\.recoverInterruptedRestore\?\.\(\)/);
assert.match(index, /await window\.__duoRuntimeCoordinator\?\.ready/);
assert.match(source, /revalidateFallbackLease/);
assert.match(source, /setInterval\(function \(\) \{ fallbackRenew\(false\); \}, HEARTBEAT_MS\)/, 'fallback heartbeat must explicitly avoid timer-handle argument coercion');
assert.match(source, /global\.addEventListener\('pageshow'/);
assert.match(source, /db\.transaction\(JOURNAL_STORE, 'readwrite', \{ durability: 'strict' \}\)/);
assert.match(source, /COMMITTED 恢复标记事务已完成，但回读内容不一致，提交状态不确定/);
assert.match(source, /恢复保护日志删除后回读仍然存在/);
assert.match(index, /window\.__duoRuntimeCoordinator\?\.completeStartup\?\.\(\)/, 'startup must not release UI/background writes until legacy migrations finish');
assert.match(source, /global\.__duoCircleRestorePaused = true/);
assert.match(source, /global\.__duoRuntimeStartupLocked = false/);
assert.match(mailbox, /tasksPaused=true/);


// Startup migrations that can touch persistent state must not race durable crash recovery.
const recoveryAt = index.indexOf('await window.__duoBackupV4?.recoverInterruptedRestore?.()');
const stickerStoreInitAt = index.indexOf('initializeStickerLibraryStore();', recoveryAt);
const fontRestoreAt = index.indexOf('await window.ChuanXunFontManager?.restoreCurrent?.({silent:true});', recoveryAt);
const startupCompleteAt = index.indexOf('window.__duoRuntimeCoordinator?.completeStartup?.();', recoveryAt);
const builtinStickerInitAt = index.indexOf('await window.__duoStickerLibrary?.initialize?.();', recoveryAt);
const cardReconcileAt = index.indexOf('window.__duoCardSystem?.reconcile?.();', recoveryAt);
assert.ok(recoveryAt >= 0 && stickerStoreInitAt > recoveryAt, 'sticker store materialization must follow crash recovery');
assert.ok(fontRestoreAt > recoveryAt && fontRestoreAt < startupCompleteAt, 'font application must follow recovery and precede releasing the startup barrier');
assert.ok(builtinStickerInitAt > fontRestoreAt && builtinStickerInitAt < startupCompleteAt, 'builtin catalogue registration must follow recovery and finish before startup opens');
assert.ok(cardReconcileAt > builtinStickerInitAt && cardReconcileAt < startupCompleteAt, 'card ID reconciliation must finish before startup opens');
assert.match(index, /window\.__duoStickerStoreReady=\(window\.__duoRuntimeCoordinator\?\.ready\|\|Promise\.resolve\(\{writable:true\}\)\)\.then\(access=>!!access\?\.writable\)/);
assert.doesNotMatch(stickerLibrary, /^\s*loadBuiltinStickerManifest\(\)\.catch/m, 'sticker manifest must not auto-register at module evaluation');
assert.match(stickerLibrary, /function initialize\(\)[\s\S]*loadBuiltinStickerManifest\(\)/);
assert.doesNotMatch(fontPanel, /api\.restoreCurrent\(\)/, 'font panel must not mutate a missing current-font pointer before recovery');
assert.match(cardSystem, /if\(!window\.__duoRuntimeCoordinator\|\|window\.__duoRuntimeCoordinator\.isWritable\?\.\(\)\)reconcileAll\(\)/);
assert.match(beautify, /function reconcileLegacyPreset\(\)/);
assert.match(source, /addEventListener\('keydown',[\s\S]*mutatingSurface/);
assert.doesNotMatch(source, /if \(isWritable\(\) \|\| permanentlyBlocked\) return;/, 'a permanently blocked recovery must not bypass the read-only UI gate');
assert.match(source, /diagnostics\.dataset\.duoReadonlyAllowed = 'true'/, 'permanent storage-damage banner must provide a readonly-allowed diagnostic entry');
assert.match(source, /global\.goto\('settingsPage'\)/, 'blocked users must be able to reach diagnostics without ordinary navigation');
assert.match(source, /storageDiagnosticsBtn/);
assert.match(source, /recoveryWorkbenchFile/, 'permanent lock banner should scroll directly to the read-only recovery workbench');
assert.match(source, /function findEventElement\(event, selector\)/);
assert.match(source, /event\.composedPath\(\)/);
assert.match(mailbox, /function initialize\(\)[\s\S]*Never remove the legacy draft key/);
assert.doesNotMatch(mailbox, /localStorage\.removeItem\(LEGACY_DRAFT_KEY\)/);
assert.match(index, /window\.__duoMailbox\?\.initialize\?\.\(\)/);


// Legacy JSON and standalone Circle restore share the durable crash journal.
const legacyRestoreStart = index.indexOf('async function applyBackupPayload(payload){');
const legacyRestoreEnd = index.indexOf('\nasync function downloadBackup(kind){', legacyRestoreStart);
const legacyRestoreCode = index.slice(legacyRestoreStart, legacyRestoreEnd);
assert.ok(legacyRestoreCode.indexOf('await coordinator.saveRecoveryJournal(journal)') < legacyRestoreCode.indexOf('await applyBackupPayloadInternal(payload)'), 'legacy JSON importer must persist rollback snapshots before modifying module state');
assert.ok(legacyRestoreCode.indexOf('await coordinator.markRecoveryCommitted()') > legacyRestoreCode.indexOf('await applyBackupPayloadInternal(payload)'), 'legacy JSON importer may mark committed only after import/readback');
assert.match(legacyRestoreCode, /重复媒体 ID，已在写入前拒绝恢复/);
assert.match(legacyRestoreCode, /setRecoveryBlocked\?\.\(/);

// Explicit reset is also destructive: preserve all module snapshots and the
// legacy mailbox draft key before deleting localStorage or IndexedDB records.
const resetStart = index.indexOf('async function resetWholeDuoSpace(){');
const resetEnd = index.indexOf("\n$('#clearChatBtn')", resetStart);
const resetCode = index.slice(resetStart, resetEnd);
assert.ok(resetCode.indexOf('await coordinator.saveRecoveryJournal(journal)') < resetCode.indexOf('localStorage.removeItem(key)'), 'reset must persist its recovery journal before deleting any key');
assert.match(resetCode, /oldStorageEntries:Array\.from\(oldStorage\.entries\(\)\)/);
assert.match(resetCode, /oldMedia:mediaSnapshot\.map/);
assert.ok(resetCode.indexOf('await coordinator.markRecoveryCommitted()') > resetCode.indexOf('await clearMediaDatabase()'), 'reset must commit only after media and font cleanup read-back');

// Storage diagnostics are conservative: the audit has a seven-day default grace
// period, compares against persisted references, and only cleans while writable.
assert.match(index, /async function auditMediaStorage\(options=\{\}\)/);
assert.match(index, /7\*24\*60\*60\*1000/);
assert.match(index, /latestPersistedMediaReferences\(\)/);
assert.match(index, /window\.__duoRuntimeCoordinator\?\.isWritable\?\.\(\)/);
assert.match(index, /health\.missingIds\.length/);
assert.match(index, /storage\?\.percent/);

// All multi-step write operations keep the lease through asynchronous work.
assert.match(source, /function beginMutation\(operation\)/);
assert.match(source, /activeMutations > 0 \? 10 \* 60 \* 1000 : LEASE_TTL/);
for (const label of ['生成 V4 备份', 'V4 备份恢复事务', '恢复上次中断的数据']) assert.ok(backup.includes("beginMutation?.('" + label + "')"), 'V4 operation must hold a mutation token: ' + label);
assert.match(backup, /endMutation\?\.\(\)/);
assert.ok(index.indexOf("if(legacyRestoreInProgress||window.__duoRestoreInProgress||window.__duoExportInProgress)") < index.indexOf("beginMutation?.('旧版备份恢复事务')"), 'legacy restore must reject duplicates before acquiring a mutation token');
assert.ok(index.indexOf("if(window.__duoRestoreInProgress||window.__duoExportInProgress)") < index.indexOf("beginMutation?.('重置双人空间事务')"), 'reset must reject duplicates before acquiring a mutation token');
assert.match(fontManager, /beginMutation\('写入字体数据库'\)/);
assert.match(fontManager, /beginFontMutation\('导入字体'\)/);
assert.match(fontManager, /beginFontMutation\('恢复字体库'\)/);
assert.match(index, /function circleTransaction\(label,operation\)\{[\s\S]*?beginMutation\?\.\('朋友圈：'/);
assert.match(index, /发布朋友圈动态及附件/);
assert.match(circleMedia, /beginMutation\?\.\('迁移朋友圈旧媒体'\)/);
assert.match(circleMedia, /beginMutation\?\.\('导入朋友圈媒体包'\)/);
assert.match(circleMedia, /beginMutation\?\.\('导出朋友圈媒体包'\)/);

const quota = envQuota();
assert.match(quota.message, /设备本地存储空间不足/);
assert.match(quota.message, /先导出备份/);
function envQuota() {
  // Use the exported normalizer from a lightweight coordinator environment.
  const env = makeEnvironment(new FakeIndexedDB());
  return env.api.normalizeQuotaError(Object.assign(new Error('disk full'), { name: 'QuotaExceededError' }), '写入媒体');
}

console.log('PASS: single-writer multi-tab lease; pre-startup write barrier; mutation-deferred lease release; same-tab resume after mutation; fallback-lease revalidation on resume; stale-owner heartbeat fencing; stale tabs require reload before takeover; durable V4 recovery journal round-trip with Blob snapshots; prepared/committed restore journal lifecycle; post-recovery font/sticker/mailbox/card migrations; Shadow DOM keyboard/input/click write gate including permanent recovery lock; conservative orphan-media audit and quota messaging.');
