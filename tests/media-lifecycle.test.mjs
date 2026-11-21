import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mailbox = fs.readFileSync(path.join(root, 'mailbox-manager.js'), 'utf8');

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing function: ${signature}`);
  const closeParams = source.indexOf('){', start);
  const open = closeParams >= 0 ? closeParams + 1 : source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function: ${signature}`);
}

// A sticker preview URL belongs to the sticker panel. A sent message gets a
// distinct chat-owned URL, so deleting the preview cannot break chat history.
{
  const functionSource = extractFunction(index, 'async function sendSticker(stickerId)');
  const harness = `
    const sticker={id:'sticker-1',mediaId:'media-1',mimeType:'image/png',name:'图像'};
    const library={items:[sticker],tombstones:[]};
    const stickerObjectUrls=new Map([['sticker-1','blob:sticker-preview']]);
    const mediaUrlCache=new Map();
    const revoked=[];let nextUrl=0;let appended=[];let lastReply=null;
    const URL={createObjectURL(){return 'blob:chat-'+(++nextUrl)},revokeObjectURL(url){revoked.push(url)}};
    const window={__duoRestoreInProgress:false,__duoExportInProgress:false,__duoRuntimeCoordinator:{isWritable:()=>true}};
    const state={offline:{lastChatAt:123},chatHistory:[]};
    let nextMessageId=0;function uid(){return 'msg-id-'+(++nextMessageId)}
    let isBatchMode=false;
    function isStickerSendable(id){return id==='sticker-1'}
    function readStickerLibraryStore(){return library}
    async function ensureStickerMedia(){return {mediaId:'media-1',record:{blob:{type:'image/png',size:10}}}}
    function showToast(){}
    function renderStickerList(){}
    function formatHM(){return '12:34'}
    function appendChatMessage(message){message.id=message.id||('msg-'+(appended.length+1));appended.push(message);state.chatHistory.push(message);return message}
    function save(){return true}
    function releaseChatMediaUrl(id,url){if(mediaUrlCache.get(id)===url)mediaUrlCache.delete(id);URL.revokeObjectURL(url)}
    function closeStickerPanel(){}
    function triggerReply(node){lastReply=node}
    function $(selector){return {selector}}
    ${functionSource}
    globalThis.send=sendSticker;
    globalThis.snapshot=()=>({stickerUrl:stickerObjectUrls.get('sticker-1'),chatUrl:mediaUrlCache.get('media-1'),revoked:revoked.slice(),appended:appended.slice(),lastReply,lastChatAt:state.offline.lastChatAt,historyCount:state.chatHistory.length});
    globalThis.revokeStickerPreview=()=>URL.revokeObjectURL(stickerObjectUrls.get('sticker-1'));
  `;
  const sandbox = {};
  vm.runInNewContext(harness, sandbox, { filename: 'media-sticker-url-owner.js' });
  assert.equal(await sandbox.send('sticker-1'), true);
  let snapshot = sandbox.snapshot();
  assert.equal(snapshot.stickerUrl, 'blob:sticker-preview');
  assert.equal(snapshot.chatUrl, 'blob:chat-1');
  assert.notEqual(snapshot.stickerUrl, snapshot.chatUrl);
  sandbox.revokeStickerPreview();
  snapshot = sandbox.snapshot();
  assert.deepEqual(Array.from(snapshot.revoked), ['blob:sticker-preview']);
  assert.equal(snapshot.chatUrl, 'blob:chat-1', 'revoking sticker preview must not revoke the sent message URL');
  assert.equal(snapshot.appended.length, 1);
  assert.equal(snapshot.lastReply.selector.includes('msg-id-1'), true);

  const failureHarness=harness.replace("function appendChatMessage(message){message.id=message.id||('msg-'+(appended.length+1));appended.push(message);state.chatHistory.push(message);return message}","function appendChatMessage(message){state.chatHistory.push(message);return null}");
  const failureSandbox={};vm.runInNewContext(failureHarness,failureSandbox,{filename:'media-sticker-rollback.js'});
  assert.equal(await failureSandbox.send('sticker-1'),false);
  const failureSnapshot=failureSandbox.snapshot();
  assert.equal(failureSnapshot.chatUrl,undefined,'failed send must release only the new chat URL');
  assert.equal(failureSnapshot.historyCount,0);
  assert.equal(failureSnapshot.lastChatAt,123);
  assert.deepEqual(Array.from(failureSnapshot.revoked),['blob:chat-1']);

  const existingUrlHarness=harness.replace("const mediaUrlCache=new Map();", "const mediaUrlCache=new Map([['media-1','blob:existing-history-url']]);").replace("function appendChatMessage(message){message.id=message.id||('msg-'+(appended.length+1));appended.push(message);state.chatHistory.push(message);return message}", "function appendChatMessage(message){return null}");
  const existingUrlSandbox={};vm.runInNewContext(existingUrlHarness,existingUrlSandbox,{filename:'media-sticker-existing-chat-url.js'});
  assert.equal(await existingUrlSandbox.send('sticker-1'),false);
  const existingUrlSnapshot=existingUrlSandbox.snapshot();
  assert.equal(existingUrlSnapshot.chatUrl,'blob:existing-history-url','a failed second send must not revoke a URL still used by older messages');
  assert.deepEqual(Array.from(existingUrlSnapshot.revoked),[]);
}

// Mailbox garbage collection must call the global reachability-aware deleter;
// local mailbox references alone cannot establish that a shared IDB blob is dead.
{
  const cleanupSource = extractFunction(mailbox, 'async function cleanupUnreferencedImages(images)');
  const calls = [], revoked = [], toasts = [];
  let mailboxRefs=new Set(['same-id-still-used-by-another-letter']);
  const sandbox = {
    normalizeImages(items) { return items; },
    getReferencedMediaIds() { return mailboxRefs; },
    revokeImageUrl(id) { revoked.push(id); },
    async deleteIfUnreferenced(id) { calls.push(id); return false; },
    showToast(message) { toasts.push(message); },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(cleanupSource, sandbox);
  await sandbox.cleanupUnreferencedImages([{ id: 'same-id-still-used-by-another-letter' }]);
  assert.deepEqual(calls, ['same-id-still-used-by-another-letter']);
  assert.deepEqual(revoked, [], 'a second mailbox letter must retain the shared mailbox object URL');
  mailboxRefs=new Set();
  await sandbox.cleanupUnreferencedImages([{ id: 'chat-still-owns-this-media' }]);
  assert.deepEqual(Array.from(calls), ['same-id-still-used-by-another-letter','chat-still-owns-this-media']);
  assert.deepEqual(Array.from(revoked), ['chat-still-owns-this-media'], 'when no mailbox view remains, its URL can be revoked even if chat still owns the blob');
  assert.equal(mailbox.includes('await deleteMediaRecord(item.id)'), false, 'mailbox must not directly delete shared IDB records');
  assert.equal(mailbox.includes('await deleteMediaRecord(id)'), false, 'compose removal must not bypass global reachability');
  assert.equal(toasts.length, 0, 'a false return means another owner still references the blob, not a cleanup error');
}

// Shared chat-media commit owns its URL and rolls back the media record,
// message state, timestamp and object URL if the message is not committed.
{
  const helperSources = [
    extractFunction(index, 'function releaseChatMediaUrl(id,url)'),
    extractFunction(index, 'async function commitChatMediaBlob(blob,kind,name=\'\',messageExtras={},isStillCurrent=()=>true){'),
  ].join('\n');
  const harness = `
    const state={offline:{lastChatAt:123},chatHistory:[]};
    const mediaUrlCache=new Map();const revoked=[],deleted=[];
    let nextUrl=0,appendMode='ok',writeMode='ok',saveCalls=0;
    const URL={createObjectURL(){return 'blob:committed-'+(++nextUrl)},revokeObjectURL(url){revoked.push(url)}};
    const window={__duoRestoreInProgress:false,__duoExportInProgress:false,__duoRuntimeCoordinator:{isWritable:()=>true}};
    async function putMediaBlob(){if(writeMode==='fail')throw new Error('idb-write-failed');return 'new-media-id'}
    async function deleteIfUnreferenced(id){deleted.push(id);return true}
    function appendChatMessage(message){if(appendMode==='throw-after-push'){state.chatHistory.push(message);throw new Error('append-render-failed')}if(appendMode==='reject')return null;state.chatHistory.push(message);return message}
    function save(){saveCalls++;return true}
    function formatHM(){return '12:34'}
    ${helperSources}
    globalThis.commit=commitChatMediaBlob;
    globalThis.configure=(patch)=>Object.assign(globalThis,{...patch});
    globalThis.setModes=(append,write)=>{appendMode=append;writeMode=write};
    globalThis.snapshot=()=>({lastChatAt:state.offline.lastChatAt,chatHistory:state.chatHistory.slice(),cache:[...mediaUrlCache.entries()],revoked:revoked.slice(),deleted:deleted.slice(),saveCalls});
  `;
  const sandbox = {};
  vm.runInNewContext(harness, sandbox, { filename: 'media-commit-transaction.js' });
  const blob = { type: 'image/png', size: 42 };

  const committed = await sandbox.commit(blob, 'image', 'test.png');
  assert.equal(committed.mediaId, 'new-media-id');
  let snapshot = sandbox.snapshot();
  assert.equal(snapshot.chatHistory.length, 1);
  assert.equal(snapshot.cache[0][0], 'new-media-id');
  assert.equal(snapshot.lastChatAt > 123, true);

  sandbox.setModes('reject', 'ok');
  const rejectedSandbox = {};
  vm.runInNewContext(harness, rejectedSandbox, { filename: 'media-commit-reject.js' });
  rejectedSandbox.setModes('reject', 'ok');
  await assert.rejects(rejectedSandbox.commit(blob, 'image', 'reject.png'), /聊天记录未能提交/);
  snapshot = rejectedSandbox.snapshot();
  assert.equal(snapshot.chatHistory.length, 0);
  assert.equal(snapshot.lastChatAt, 123);
  assert.deepEqual(Array.from(snapshot.deleted), ['new-media-id']);
  assert.deepEqual(Array.from(snapshot.revoked), ['blob:committed-1']);

  const cancelledSandbox = {};
  vm.runInNewContext(harness, cancelledSandbox, { filename: 'media-commit-cancel.js' });
  await assert.rejects(cancelledSandbox.commit(blob, 'video', 'cancel.mp4', {}, () => false), /媒体发送已取消/);
  snapshot = cancelledSandbox.snapshot();
  assert.equal(snapshot.chatHistory.length, 0);
  assert.equal(snapshot.lastChatAt, 123);
  assert.deepEqual(Array.from(snapshot.deleted), ['new-media-id']);
  assert.deepEqual(Array.from(snapshot.cache), []);

  const writeFailureSandbox = {};
  vm.runInNewContext(harness, writeFailureSandbox, { filename: 'media-commit-write-failure.js' });
  writeFailureSandbox.setModes('ok', 'fail');
  await assert.rejects(writeFailureSandbox.commit(blob, 'audio', 'voice.webm'), /idb-write-failed/);
  snapshot = writeFailureSandbox.snapshot();
  assert.equal(snapshot.lastChatAt, 123);
  assert.equal(snapshot.cache.length, 0);
  assert.deepEqual(Array.from(snapshot.deleted), []);

  const throwAfterPushSandbox = {};
  vm.runInNewContext(harness, throwAfterPushSandbox, { filename: 'media-commit-dangling-message.js' });
  throwAfterPushSandbox.setModes('throw-after-push', 'ok');
  await assert.rejects(throwAfterPushSandbox.commit(blob, 'image', 'render-error.png'), /append-render-failed/);
  snapshot = throwAfterPushSandbox.snapshot();
  assert.equal(snapshot.chatHistory.length, 0, 'unexpected append exception must not leave a dangling message reference');
  assert.equal(snapshot.lastChatAt, 123);
  assert.deepEqual(Array.from(snapshot.deleted), ['new-media-id']);
  assert.equal(snapshot.saveCalls, 1, 'rollback must persist the removed dangling reference');
}

// Closing the media preview while IndexedDB is still writing cancels the
// pending send, revokes only the preview URL and removes the uncommitted blob.
{
  const helperSources = [
    extractFunction(index, 'function releaseChatMediaUrl(id,url)'),
    extractFunction(index, 'async function commitChatMediaBlob(blob,kind,name=\'\',messageExtras={},isStillCurrent=()=>true){'),
    extractFunction(index, 'function closeMediaPreview()'),
    extractFunction(index, 'async function sendPendingMedia()'),
  ].join('\n');
  let finishWrite;
  const revoked = [], deleted = [];
  const sandbox = {
    state: { offline: { lastChatAt: 456 }, chatHistory: [] },
    window: { __duoRestoreInProgress: false, __duoExportInProgress: false, __duoRuntimeCoordinator: { isWritable: () => true } },
    mediaUrlCache: new Map(),
    pendingChatMedia: { file: { type: 'image/png', size: 64, name: 'cancel.png' }, kind: 'image', previewUrl: 'blob:preview' },
    URL: { createObjectURL() { return 'blob:chat-should-not-exist'; }, revokeObjectURL(url) { revoked.push(url); } },
    putMediaBlob() { return new Promise(resolve => { finishWrite = () => resolve('cancelled-media'); }); },
    async deleteIfUnreferenced(id) { deleted.push(id); return true; },
    appendChatMessage(message) { sandbox.state.chatHistory.push(message); return message; },
    save() { return true; }, formatHM() { return '12:34'; },
    showToast() {}, triggerReply() {},
    $(selector) {
      if (selector === '#mediaPreviewSend') return { disabled: false };
      if (selector === '#mediaPreviewModal') return { classList: { remove() {} } };
      if (selector === '#mediaPreviewContent') return { innerHTML: '' };
      return { selector };
    },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(helperSources, sandbox);
  const sendPromise = sandbox.sendPendingMedia();
  await Promise.resolve(); // allow putMediaBlob to start and remain pending
  sandbox.closeMediaPreview();
  finishWrite();
  assert.equal(await sendPromise, false);
  assert.equal(sandbox.pendingChatMedia, null);
  assert.equal(sandbox.state.chatHistory.length, 0);
  assert.equal(sandbox.state.offline.lastChatAt, 456);
  assert.deepEqual(deleted, ['cancelled-media']);
  assert.deepEqual(revoked, ['blob:preview']);
}

// Failed IndexedDB open promises must be evicted so a later call can retry.
{
  const functionSource = extractFunction(index, 'function openMediaDB()');
  const sandbox = {};
  const db = { closeCalls: 0, close() { this.closeCalls++; } };
  let shouldFail = true, opens = 0;
  const indexedDB = {
    open() {
      opens++;
      const request = { error: new Error('temporary-open-failure') };
      queueMicrotask(() => {
        if (shouldFail) request.onerror?.();
        else { request.result = db; request.onsuccess?.(); }
      });
      return request;
    },
  };
  const context = {
    mediaDbPromise: null,
    MEDIA_DB_NAME: 'test',
    MEDIA_STORE_NAME: 'media',
    window: { indexedDB },
    indexedDB,
  };
  vm.createContext(context);
  vm.runInContext(functionSource, context);
  await assert.rejects(context.openMediaDB(), /temporary-open-failure/);
  await Promise.resolve();
  shouldFail = false;
  assert.equal(await context.openMediaDB(), db);
  assert.equal(opens, 2, 'a rejected first open must not poison all future media operations');
  db.onversionchange();
  assert.equal(db.closeCalls, 1);
  assert.equal(context.mediaDbPromise, null, 'version changes must invalidate the cached connection promise');
}

// The compression helper settles on asynchronous canvas errors, revokes its
// temporary URL, and keeps transparent formats on an alpha-capable encoding.
{
  const functionSource = extractFunction(index, 'function compressImage(file, max=900, quality=.82)');
  const revoked = [], created = [], encodedTypes = [];
  class FakeImage {
    constructor() { this.naturalWidth = 1200; this.naturalHeight = 600; }
    set src(value) { this._src = value; queueMicrotask(() => this.onload?.()); }
  }
  const document = {
    createElement(name) {
      assert.equal(name, 'canvas');
      return {
        width: 0, height: 0,
        getContext() { return { drawImage() {} }; },
        toDataURL(type) { encodedTypes.push(type); return `data:${type};base64,AA==`; },
      };
    },
  };
  const URL = {
    createObjectURL(file) { const url = 'blob:compress-' + created.length; created.push({ file, url }); return url; },
    revokeObjectURL(url) { revoked.push(url); },
  };
  const sandbox = { Image: FakeImage, document, URL };
  vm.createContext(sandbox);
  vm.runInContext(functionSource, sandbox);
  const png = { size: 100, type: 'image/png' };
  const result = await sandbox.compressImage(png);
  assert.match(result, /^data:image\/webp;/);
  assert.deepEqual(encodedTypes, ['image/webp']);
  assert.deepEqual(revoked, ['blob:compress-0']);

  const brokenSandbox = {
    Image: class extends FakeImage {},
    document: { createElement() { return { getContext() { return null; } }; } },
    URL,
  };
  vm.createContext(brokenSandbox);
  vm.runInContext(functionSource, brokenSandbox);
  await assert.rejects(brokenSandbox.compressImage({ size: 1, type: 'image/png' }), /画布不可用/);
  assert.equal(revoked.includes('blob:compress-1'), true, 'canvas failure must still revoke the temporary file URL');
  await assert.rejects(sandbox.compressImage({ size: 81 * 1024 * 1024, type: 'image/png' }), /80 MB/);
}

// A clear action or a later upload invalidates stale async image work.
{
  const sources = [
    extractFunction(index, 'function invalidateProfileAssetJob(key)'),
    extractFunction(index, 'async function handleImgInput(input, key)'),
  ].join('\n');
  const pending = [];
  const sandbox = {
    assetJobs: [], assetJobTokens: new Map(), assetsBusy: false,
    tempAssets: { myAvatar: null, dirty: false }, tempAssetBlobs: new Map(),
    window: { __duoCircleMedia: { async isAnimatedImageBlob() { return false; } } },
    releaseTempProfileAsset() {},
    compressImage() { return new Promise(resolve => pending.push(resolve)); },
    updateProfilePreview() {}, applyHeader() {}, showToast() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(sources, sandbox);
  const input = { files: [{ name: 'slow.png' }], value: 'selected' };
  const firstJob = sandbox.handleImgInput(input, 'myAvatar');
  await new Promise(resolve => setImmediate(resolve)); // wait for the asynchronous format probe before resolving compression
  assert.equal(input.value, '');
  sandbox.invalidateProfileAssetJob('myAvatar'); // user cleared the avatar while compression was in flight
  pending[0]('data:image/webp;base64,slow');
  await firstJob;
  assert.equal(sandbox.tempAssets.myAvatar, null, 'an older upload must not overwrite a later clear action');
  assert.equal(sandbox.assetJobs.length, 0);
  assert.equal(sandbox.assetsBusy, false);

  const latestInputA={files:[{name:'older.png'}],value:'old'};
  const latestInputB={files:[{name:'newer.png'}],value:'new'};
  const olderJob=sandbox.handleImgInput(latestInputA,'myAvatar');
  const newerJob=sandbox.handleImgInput(latestInputB,'myAvatar');
  await new Promise(resolve => setImmediate(resolve)); // both format probes settle, then compression callbacks become available
  pending[2]('data:image/webp;base64,newer');
  await newerJob;
  pending[1]('data:image/webp;base64,older');
  await olderJob;
  assert.equal(sandbox.tempAssets.myAvatar,'data:image/webp;base64,newer','the newest selected profile image must win even when the older decode finishes last');
}

console.log('PASS: independent sticker/chat object-URL ownership; mailbox global reachability GC; media-send commit/rollback/cancel; preview-close cancellation; IndexedDB open retry; image compression error settlement and alpha-safe encoding; stale profile-upload invalidation and newest-selection ordering.');
