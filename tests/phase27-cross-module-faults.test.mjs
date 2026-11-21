import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function sliceBetween(startText, endText) {
  const start = index.indexOf(startText);
  const end = index.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `missing source boundary: ${startText} -> ${endText}`);
  return index.slice(start, end);
}

const openMediaDB = sliceBetween('function openMediaDB(){', 'async function putMediaBlob(');
const putMediaBlob = sliceBetween('async function putMediaBlob(', 'async function getMediaRecord(');
const getMediaRecord = sliceBetween('async function getMediaRecord(', 'async function deleteMediaRecord(');
const deleteMediaRecord = sliceBetween('async function deleteMediaRecord(', 'async function clearMediaDatabase(');
const deleteIfUnreferenced = sliceBetween('async function deleteIfUnreferenced(', 'async function cleanupReplacedMediaReferences(');
const releaseChatMediaUrl = sliceBetween('function releaseChatMediaUrl(', 'window.__duoMediaStorageDiagnostics=');
const commitChatMediaBlob = sliceBetween('async function commitChatMediaBlob(', 'async function loadMessageMedia(');

function makeHarness({ failDelete = false, startExportAfterMediaWrite = false } = {}) {
  const records = new Map();
  let blocked = false;
  let mutationTokens = 0;
  let revisionWrites = 0;
  let urlCreates = 0;
  let appendedMessages = 0;
  const state = { chatHistory: [], offline: { lastChatAt: 123456 } };
  const window = {
    __duoRestoreInProgress: false,
    __duoExportInProgress: false,
    __duoCircleMedia: { release() {} },
    __duoRuntimeCoordinator: {
      assertWritable() { if (blocked) throw new Error('blocked'); },
      beginMutation() { mutationTokens++; let ended = false; return () => { if (!ended) { ended = true; mutationTokens--; } }; },
      isWritable() { return !blocked; },
      markDataChanged() {
        revisionWrites++;
        if (startExportAfterMediaWrite && revisionWrites === 1) window.__duoExportInProgress = true;
        return true;
      },
      normalizeQuotaError(error) { return error; },
    },
  };
  const db = {
    onversionchange: null,
    transaction(_storeName, _mode) {
      const tx = {
        objectStore() {
          return {
            put(record) {
              records.set(record.id, record);
              queueMicrotask(() => tx.oncomplete?.());
            },
            delete(id) {
              if (failDelete) throw new Error('injected-idb-delete-failure');
              records.delete(id);
              queueMicrotask(() => tx.oncomplete?.());
            },
            get(id) {
              const request = {};
              queueMicrotask(() => { request.result = records.get(id) || undefined; request.onsuccess?.(); });
              return request;
            },
          };
        },
        oncomplete: null,
        onerror: null,
        onabort: null,
      };
      return tx;
    },
  };
  const indexedDB = {
    open() {
      const request = { result: db, error: null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  window.indexedDB = indexedDB;
  const URLApi = {
    createObjectURL() { urlCreates++; return `blob:fixture-${urlCreates}`; },
    revokeObjectURL() {},
  };
  const context = {
    window, indexedDB, state, Blob, Date, Promise, Map, Set, Error, Math, URL: URLApi,
    MEDIA_DB_NAME: 'dual_space_chat_media_v1', MEDIA_STORE_NAME: 'media',
    mediaDbPromise: null, mediaUrlCache: new Map(), mediaLoadFailed: new Set(),
    uid: () => 'media-fixture-1', formatHM: () => '12:34',
    appendChatMessage(message) { appendedMessages++; state.chatHistory.push(message); return message; },
    save() { return true; },
    latestPersistedMediaReferences() { return new Set(state.chatHistory.map(message => message.mediaId).filter(Boolean)); },
    console,
  };
  vm.createContext(context);
  vm.runInContext([
    openMediaDB, getMediaRecord, putMediaBlob, deleteMediaRecord,
    deleteIfUnreferenced, releaseChatMediaUrl, commitChatMediaBlob,
  ].join('\n'), context, { filename: 'phase27-real-media-production-functions.js' });
  return {
    context, records, state,
    status: () => ({ blocked, mutationTokens, revisionWrites, urlCreates, appendedMessages }),
    block() { blocked = true; },
  };
}

// IndexedDB commits but the cross-tab revision marker fails. The production
// function must delete the just-written media row and confirm absence before it
// rejects; the mutation lease must be released even though the page is blocked.
{
  const h = makeHarness();
  h.context.window.__duoRuntimeCoordinator.markDataChanged = () => { h.block(); return false; };
  await assert.rejects(h.context.putMediaBlob(new Blob(['fresh-image'], { type: 'image/png' }), 'chat-image', 'fresh.png'), error => {
    assert.equal(error.name, 'RevisionMarkerError');
    assert.equal(error.rollbackConfirmed, true);
    return true;
  });
  assert.equal(h.records.size, 0, 'confirmed revision-marker rollback must remove the committed media row');
  assert.equal(h.status().mutationTokens, 0, 'media mutation token must be released');
  assert.equal(h.status().revisionWrites, 0, 'the injected false result must not be counted as a successful revision write');
}

// When cleanup itself fails, the error must report uncertainty and must not
// claim rollback. This guards against a misleading success message with an
// actual orphan still present.
{
  const h = makeHarness({ failDelete: true });
  h.context.window.__duoRuntimeCoordinator.markDataChanged = () => { h.block(); return false; };
  await assert.rejects(h.context.putMediaBlob(new Blob(['fresh-image'], { type: 'image/png' }), 'chat-image', 'fresh.png'), error => {
    assert.equal(error.name, 'RevisionMarkerError');
    assert.equal(error.rollbackConfirmed, false);
    assert.match(error.message, /未能确认/);
    return true;
  });
  assert.equal(h.records.size, 1, 'failed deletion leaves the unresolved row visible for recovery');
  assert.equal(h.status().mutationTokens, 0);
}

// A backup starts after the Blob transaction but before chat message commit.
// The exact production commit helper must remove the unreferenced media and
// preserve the previous chat timestamp without creating a dangling message.
{
  const h = makeHarness({ startExportAfterMediaWrite: true });
  await assert.rejects(h.context.commitChatMediaBlob(new Blob(['chat-image'], { type: 'image/png' }), 'image', 'chat.png'), /取消或编辑权已失效/);
  assert.equal(h.records.size, 0, 'media written immediately before backup startup must be cleaned');
  assert.equal(h.state.chatHistory.length, 0, 'no chat message may be appended after export begins');
  assert.equal(h.state.offline.lastChatAt, 123456, 'failed media commit must preserve lastChatAt');
  assert.equal(h.status().urlCreates, 0, 'the object URL must not be created after the backup gate closes');
  assert.equal(h.status().appendedMessages, 0, 'the message append function must not run');
  assert.equal(h.status().mutationTokens, 0, 'all nested media mutation tokens must be released');
}

console.log('PASS: real media writer/commit helpers handle revision-marker failure, unconfirmed rollback, and backup-start races without silent orphan or dangling chat state.');
