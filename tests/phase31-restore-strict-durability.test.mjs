import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const fonts = fs.readFileSync(path.join(ROOT, 'custom-font-manager.js'), 'utf8');
const backup = fs.readFileSync(path.join(ROOT, 'backup-v4.js'), 'utf8');

function sliceBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `missing source boundary: ${startText} -> ${endText}`);
  return source.slice(start, end);
}

const mediaOpen = sliceBetween(index, 'function openMediaDB(){', 'function beginMediaReadwriteTransaction(');
const mediaWrites = sliceBetween(index, 'function beginMediaReadwriteTransaction(', 'async function getMediaRecord(');
const mediaRead = sliceBetween(index, 'async function getMediaRecord(', 'async function deleteMediaRecord(');
const mediaDelete = sliceBetween(index, 'async function deleteMediaRecord(', 'async function clearMediaDatabase(');
const fontRevisionHelper = sliceBetween(fonts, '  function markRevisionOrReject(', '  function openDatabase()');
const fontWrites = sliceBetween(fonts, '  function beginFontSnapshotTransaction(', '  function fontSnapshotSignature(');

function makeMediaHarness({ durability = 'strict', throwOnStrict = false } = {}) {
  const records = new Map();
  const calls = [];
  const counters = { aborts: 0, writes: 0, deletes: 0, mutationTokens: 0 };
  const db = {
    onversionchange: null,
    transaction(...args) {
      calls.push(args);
      if (args[2]?.durability === 'strict' && throwOnStrict) throw new Error('strict transaction options unsupported');
      const mode = args[1];
      const tx = {
        durability: args[2]?.durability === 'strict' ? durability : 'default',
        mode,
        oncomplete: null,
        onerror: null,
        onabort: null,
        abort() { counters.aborts++; queueMicrotask(() => this.onabort?.()); },
        objectStore() {
          return {
            put(row) {
              counters.writes++;
              records.set(row.id, row);
              queueMicrotask(() => tx.oncomplete?.());
              return {};
            },
            delete(id) {
              counters.deletes++;
              records.delete(id);
              queueMicrotask(() => tx.oncomplete?.());
              return {};
            },
            get(id) {
              const request = {};
              queueMicrotask(() => { request.result = records.get(id) || undefined; request.onsuccess?.(); });
              return request;
            },
          };
        },
      };
      return tx;
    },
  };
  const indexedDB = { open() { const request = { result: db, error: null }; queueMicrotask(() => request.onsuccess?.()); return request; } };
  const window = {
    indexedDB,
    __duoRuntimeCoordinator: {
      assertWritable() {},
      beginMutation() { counters.mutationTokens++; let done = false; return () => { if (!done) { done = true; counters.mutationTokens--; } }; },
      markDataChanged() { return true; },
      normalizeQuotaError(error) { return error; },
    },
    __duoCircleMedia: { release() {} },
  };
  const context = {
    window, indexedDB, Blob, Date, Promise, Map, Set, Error, Math,
    MEDIA_DB_NAME: 'dual_space_chat_media_v1', MEDIA_STORE_NAME: 'media',
    mediaDbPromise: null, mediaUrlCache: new Map(), mediaLoadFailed: new Set(),
    uid: () => 'media-fixture',
    URL: { revokeObjectURL() {} },
    console,
  };
  vm.createContext(context);
  vm.runInContext([mediaOpen, mediaWrites, mediaRead, mediaDelete].join('\n'), context, { filename: 'phase31-media-production-functions.js' });
  return { context, calls, counters, records };
}

// The media preflight asks for strict durability and aborts its empty probe
// transaction before any application data is touched.
{
  const h = makeMediaHarness();
  assert.equal(await h.context.assertMediaStrictDurability(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), ['media', 'readwrite', { durability: 'strict' }]);
  assert.equal(h.counters.aborts, 1);
  assert.equal(h.counters.writes, 0);
}

// An engine that silently downgrades the durability option must be rejected
// before the object store is touched.
{
  const h = makeMediaHarness({ durability: 'relaxed' });
  await assert.rejects(h.context.assertMediaStrictDurability(), /不支持严格持久化事务/);
  assert.equal(h.counters.aborts, 1);
  assert.equal(h.counters.writes, 0);
  assert.equal(h.records.size, 0);
}

// An engine that throws while creating a strict transaction also fails before
// PREPARED or any media mutation; the error explains the capability boundary.
{
  const h = makeMediaHarness({ throwOnStrict: true });
  await assert.rejects(h.context.assertMediaStrictDurability(), /无法建立严格持久化事务/);
  assert.equal(h.counters.writes, 0);
  assert.equal(h.records.size, 0);
}

// V4 passes strict durability explicitly while ordinary chat/media uploads
// keep their legacy default transaction behavior.
{
  const h = makeMediaHarness();
  await h.context.putMediaBlob(new Blob(['ordinary'], { type: 'image/png' }), 'chat-image', 'ordinary.png', 'ordinary-id');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), ['media', 'readwrite']);
  await h.context.putMediaBlob(new Blob(['restore'], { type: 'image/png' }), 'chat-image', 'restore.png', 'restore-id', { durability: 'strict' });
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1])), ['media', 'readwrite', { durability: 'strict' }]);
  assert.equal(h.records.get('restore-id').blob.size, 7);
  assert.equal(h.counters.mutationTokens, 0);
}

// The same strict mode is available to rollback deletion; unsupported strict
// transactions never silently fall back to a relaxed write.
{
  const h = makeMediaHarness();
  h.records.set('delete-id', { id: 'delete-id', blob: new Blob(['x']), kind: 'image', size: 1 });
  assert.equal(await h.context.deleteMediaRecord('delete-id', null, { durability: 'strict' }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), ['media', 'readonly']);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1])), ['media', 'readwrite', { durability: 'strict' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[2])), ['media', 'readonly']);
  assert.equal(h.records.has('delete-id'), false);
}

// If the cross-tab revision marker fails after a media deletion commits, the
// production helper restores the exact previous media row and verifies it.
{
  const h = makeMediaHarness();
  const original = { id: 'marker-delete-id', blob: new Blob(['original-bytes']), kind: 'image', size: 15 };
  h.records.set(original.id, original);
  h.context.window.__duoRuntimeCoordinator.markDataChanged = () => false;
  await assert.rejects(h.context.deleteMediaRecord(original.id), error => {
    assert.equal(error.name, 'RevisionMarkerError');
    assert.equal(error.rollbackConfirmed, true);
    return true;
  });
  const restored = h.records.get(original.id);
  assert.ok(restored, 'deleted media must be restored after revision-marker failure');
  assert.equal(restored.blob.size, original.blob.size);
  assert.equal(h.counters.mutationTokens, 0);
}

function makeFontHarness({ durability = 'strict', throwOnStrict = false } = {}) {
  const calls = [];
  const writes = [];
  const counters = { aborts: 0, mutationTokens: 0, revisionMarks: 0 };
  const db = {
    transaction(...args) {
      calls.push(args);
      if (args[2]?.durability === 'strict' && throwOnStrict) throw new Error('strict font transaction unsupported');
      const tx = {
        durability: args[2]?.durability === 'strict' ? durability : 'default',
        oncomplete: null, onerror: null, onabort: null,
        abort() { counters.aborts++; queueMicrotask(() => this.onabort?.()); },
        objectStore(name) {
          return {
            clear() { writes.push({ store: name, action: 'clear' }); queueMicrotask(() => tx.oncomplete?.()); return {}; },
            put(value) { writes.push({ store: name, action: 'put', value }); queueMicrotask(() => tx.oncomplete?.()); return {}; },
          };
        },
      };
      return tx;
    },
  };
  const global = {
    __duoRuntimeCoordinator: {
      beginMutation() { counters.mutationTokens++; let done = false; return () => { if (!done) { done = true; counters.mutationTokens--; } }; },
      markDataChanged() { counters.revisionMarks++; return true; },
    },
  };
  const context = {
    global, FONT_STORE: 'fonts', META_STORE: 'meta', CURRENT_KEY: 'currentFontId',
    openDatabase: () => Promise.resolve(db),
    error: message => new Error(message),
    transactionDone(tx) { return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error || new Error('font tx error')); tx.onabort = () => reject(tx.error || new Error('font tx aborted')); }); },
    Promise, Set, Date, Error,
  };
  vm.createContext(context);
  vm.runInContext(fontRevisionHelper + '\n' + fontWrites, context, { filename: 'phase31-font-production-functions.js' });
  return { context, calls, writes, counters };
}

// Font preflight uses the same two-store strict transaction shape as the real
// snapshot writer, then aborts before clear/put operations are queued.
{
  const h = makeFontHarness();
  assert.equal(await h.context.assertImportDurability(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), [['fonts', 'meta'], 'readwrite', { durability: 'strict' }]);
  assert.equal(h.counters.aborts, 1);
  assert.equal(h.writes.length, 0);
}

// Strict font snapshot writes use one atomic transaction covering clear,
// every font record, and the selected-font metadata row.
{
  const h = makeFontHarness();
  await h.context.writeFontSnapshot({ currentFontId: 'font-next', fonts: [{ id: 'font-next', size: 4 }] }, { durability: 'strict' });
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), [['fonts', 'meta'], 'readwrite', { durability: 'strict' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes.map(item => [item.store, item.action]))), [['fonts', 'clear'], ['fonts', 'put'], ['meta', 'put']]);
  assert.equal(h.counters.revisionMarks, 1);
  assert.equal(h.counters.mutationTokens, 0);
}

// Font strict capability failures are fail-closed and must not degrade to the
// default transaction mode or queue the destructive clear operation.
{
  const h = makeFontHarness({ durability: 'relaxed' });
  await assert.rejects(h.context.writeFontSnapshot({ currentFontId: null, fonts: [] }, { durability: 'strict' }), /不支持严格持久化事务/);
  assert.equal(h.writes.length, 0);
  assert.equal(h.counters.aborts, 1);
  assert.equal(h.counters.mutationTokens, 0);
}

// The full V4 path preflights both separate databases before PREPARED and
// supplies strict durability to import, catch rollback, and startup recovery.
const restoreStart = backup.indexOf('  async function restoreV4Internal(blob){');
const restoreEnd = backup.indexOf('\n  async function recoverInterruptedRestore(){', restoreStart);
const restoreSource = backup.slice(restoreStart, restoreEnd);
const recoveryStart = restoreEnd;
const recoveryEnd = backup.indexOf('\n  let restoreInProgress=false;', recoveryStart);
const recoverySource = backup.slice(recoveryStart, recoveryEnd);
assert.ok(restoreSource.indexOf('await window.__duoMediaTransactions.assertStrictDurability()') < restoreSource.indexOf('await coordinator.saveRecoveryJournal(preparedJournal);'));
assert.ok(restoreSource.indexOf('await window.ChuanXunFontManager.assertImportDurability()') < restoreSource.indexOf('await coordinator.saveRecoveryJournal(preparedJournal);'));
assert.match(restoreSource, /putMediaBlob\(v\.blob,v\.meta\.kind\|\|'image',v\.meta\.name\|\|'',id,\{durability:'strict'\}\)/);
assert.match(restoreSource, /importData\(\{currentFontId:fm\.currentFontId,fonts:restored\},\{replace:true,durability:'strict'\}\)/);
assert.match(restoreSource, /beginStrictWrite\(db,'V4 媒体回滚'\)/);
assert.match(restoreSource, /importData\(oldFonts,\{replace:true,durability:'strict'\}\)/);
assert.ok(recoverySource.indexOf('await window.__duoMediaTransactions.assertStrictDurability()') < recoverySource.indexOf("const endMutation=coordinator.beginMutation?.('恢复上次中断的数据')"));
assert.ok(recoverySource.indexOf('await window.ChuanXunFontManager.assertImportDurability()') < recoverySource.indexOf("const endMutation=coordinator.beginMutation?.('恢复上次中断的数据')"));
assert.match(recoverySource, /putMediaBlob\(record\.blob,record\.kind\|\|'image',record\.name\|\|'',id,\{durability:'strict'\}\)/);
assert.match(recoverySource, /importData\(journal\.oldFonts,\{replace:true,durability:'strict'\}\)/);
const startupRecoveryCall = index.indexOf('await window.__duoBackupV4?.recoverInterruptedRestore?.()');
const startupRecoveryFence = index.indexOf('window.__duoRuntimeCoordinator?.setRecoveryBlocked?.(error)', startupRecoveryCall);
assert.ok(startupRecoveryCall >= 0 && startupRecoveryFence > startupRecoveryCall, 'the real startup caller must fence writes when strict preflight prevents a PREPARED retry');

// importData propagates strict mode to both its forward snapshot transaction
// and its internal rollback transaction, not just the first write.
const importStart = fonts.indexOf('  function importData(payload, options) {');
const importEnd = fonts.indexOf('\n\n\n  var api = {', importStart);
const importSource = fonts.slice(importStart, importEnd);
assert.match(importSource, /var writeOptions = options\.durability === 'strict' \? \{ durability: 'strict' \} : undefined/);
assert.match(importSource, /writeFontSnapshot\(nextSnapshot, writeOptions\)/);
assert.match(importSource, /writeFontSnapshot\(oldSnapshot, writeOptions\)/);

console.log('PASS: Phase 31 strict media/font durability preflight and writes; unsupported engines fail before PREPARED or destructive operations; V4 forward restore, rollback and startup recovery all use strict transactions while ordinary media writes retain default durability.');
