import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing function: ${signature}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function: ${signature}`);
}

const sendBatchMessages = extractFunction(index, 'async function sendBatchMessages(){');

function createHarness({ queue, deletedSticker = true, saveResult = true } = {}) {
  const sandbox = {};
  const source = `
    const window = { __duoRestoreInProgress:false, __duoExportInProgress:false };
    const state = { offline:{ lastChatAt:1000 }, chatHistory:[], cardUsageOutbox:[] };
    let batchSending = false;
    let batchMessages = [];
    let isBatchMode = true;
    const mediaUrlCache = new Map();
    const revokedUrls = [];
    const createdUrls = [];
    const persistedMedia = new Set();
    const deletedMedia = [];
    const toastMessages = [];
    const replies = [];
    let nextMessageId = 0;
    let nextMediaId = 0;
    let nextUsageId = 0;
    let saveResult = ${JSON.stringify(saveResult)};
    let stickerLibrary = ${JSON.stringify(deletedSticker
      ? { version:1, revision:2, items:[], tombstones:[{id:'stale-sticker', deletedAt:2, revision:2}], favorites:[] }
      : { version:1, revision:1, items:[{id:'stale-sticker', mediaId:'sticker-media', mimeType:'image/png', name:'sticker'}], tombstones:[], favorites:[] })};
    function readStickerLibraryStore(){ return stickerLibrary; }
    function isStickerSendable(id){ return stickerLibrary.items.some(item=>item.id===id) && !stickerLibrary.tombstones.some(item=>item.id===id); }
    async function getMediaRecord(id){ return id==='sticker-media' ? { id, blob:{ type:'image/png', size:10 } } : null; }
    async function putMediaBlob(file, kind, name){ const id='batch-media-'+(++nextMediaId); persistedMedia.add(id); return id; }
    async function deleteIfUnreferenced(id){ deletedMedia.push(id); persistedMedia.delete(id); return true; }
    const URL = { createObjectURL(blob){ const url='blob:batch-'+(createdUrls.length+1); createdUrls.push(url); return url; }, revokeObjectURL(url){ revokedUrls.push(url); } };
    function appendChatMessage(message, shouldSave=true, usageEvents=[]){ const row={...message, id:message.id||('message-'+(++nextMessageId))}; state.chatHistory.push(row); for(const event of usageEvents||[])state.cardUsageOutbox.push({...event,eventId:event.eventId||('usage-'+(++nextUsageId)),messageId:row.id,sourceId:row.id}); return row; }
    function releaseBatchPreview(item){ if(item?.previewUrl){ URL.revokeObjectURL(item.previewUrl); item.previewUrl=''; } }
    function renderBatchPreview(){ }
    function updateBatchControls(){ }
    function renderChatHistory(){ }
    function scrollChatToBottom(){ }
    function flushChatCardUsageOutbox(){ }
    function triggerReply(row, ids){ replies.push({ row, ids }); }
    function formatHM(){ return '12:34'; }
    function showToast(message){ toastMessages.push(String(message)); }
    function save(){ return saveResult; }
    function $(selector){ return { classList:{ remove(){} }, querySelectorAll(){ return []; } }; }
    ${sendBatchMessages}
    globalThis.setQueue = value => { batchMessages=value; };
    globalThis.send = sendBatchMessages;
    globalThis.snapshot = () => ({
      batchSending, batchCount:batchMessages.length, isBatchMode,
      history:state.chatHistory.map(item=>({...item})), lastChatAt:state.offline.lastChatAt,
      cardUsageOutbox:state.cardUsageOutbox.slice(),
      persistedMedia:[...persistedMedia], deletedMedia:deletedMedia.slice(),
      createdUrls:createdUrls.slice(), revokedUrls:revokedUrls.slice(),
      mediaUrlCache:[...mediaUrlCache.entries()], toastMessages:toastMessages.slice(),
      replyCount:replies.length
    });
  `;
  vm.runInNewContext(source, sandbox, { filename: 'media-send-paths-real-source.js' });
  sandbox.setQueue(queue || []);
  return sandbox;
}

// A sticker can be deleted after it has entered a batch queue. The sender must
// re-read the authoritative library, reject the stale item, and roll back the
// text and image already staged earlier in the same batch.
{
  const sandbox = createHarness({ queue: [
    { id:'batch-text', text:'must roll back', usageEvents:[{eventId:'usage-batch-1', textSnapshot:'must roll back'}] },
    { id:'batch-image', file:{ name:'batch.png', type:'image/png', size:42 } },
    { id:'batch-sticker', stickerId:'stale-sticker', mediaId:'sticker-media', mimeType:'image/png', name:'deleted sticker', previewUrl:'blob:sticker-preview' }
  ], deletedSticker:true });

  assert.equal(await sandbox.send(), false, 'batch send must fail closed when a queued sticker was deleted');
  const result = JSON.parse(JSON.stringify(sandbox.snapshot()));
  assert.equal(result.history.length, 0, 'messages inserted earlier in the batch must all be rolled back');
  assert.equal(result.lastChatAt, 1000, 'failed batch must not advance lastChatAt');
  assert.equal(result.cardUsageOutbox.length, 0, 'batch usage events must be rolled back');
  assert.deepEqual(result.persistedMedia, [], 'new image media must be removed when the batch fails later');
  assert.deepEqual(result.mediaUrlCache, [], 'the new chat object URL must be removed from the live cache on rollback');
  assert.deepEqual(result.deletedMedia, ['batch-media-1']);
  assert.deepEqual(result.revokedUrls, ['blob:batch-1'], 'the queued sticker preview must remain alive because the failed queue is retained for review');
  assert.equal(result.batchCount, 3, 'failed queue remains available for user review/removal');
  assert.equal(result.isBatchMode, true);
  assert.equal(result.batchSending, false, 'send lock must always be released');
  assert.match(result.toastMessages.at(-1), /批量发送失败/);
}

// A normal mixed text+image batch commits atomically and retains its media.
{
  const sandbox = createHarness({ queue: [
    { id:'batch-text', text:'batch commit text', usageEvents:[] },
    { id:'batch-image', file:{ name:'batch.png', type:'image/png', size:42 } }
  ], deletedSticker:false });
  assert.equal(await sandbox.send(), true);
  const result = JSON.parse(JSON.stringify(sandbox.snapshot()));
  assert.equal(result.history.length, 2);
  assert.deepEqual(result.history.map(item=>item.type), ['text', 'image']);
  assert.equal(result.history[0].text, 'batch commit text');
  assert.equal(result.history[1].mediaId, 'batch-media-1');
  assert.deepEqual(result.persistedMedia, ['batch-media-1']);
  assert.deepEqual(result.deletedMedia, []);
  assert.equal(result.batchCount, 0);
  assert.equal(result.isBatchMode, false);
  assert.equal(result.lastChatAt > 1000, true);
  assert.equal(result.replyCount, 1);
}

// A persistence failure after all messages have been staged must also undo
// the entire batch, including media, timestamps and queued usage outbox rows.
{
  const sandbox = createHarness({ queue: [
    { id:'batch-text', text:'save must fail', usageEvents:[{eventId:'usage-batch-2', textSnapshot:'save must fail'}] },
    { id:'batch-image', file:{ name:'save-fail.png', type:'image/png', size:88 } }
  ], deletedSticker:false, saveResult:false });
  assert.equal(await sandbox.send(), false);
  const result = JSON.parse(JSON.stringify(sandbox.snapshot()));
  assert.equal(result.history.length, 0);
  assert.equal(result.lastChatAt, 1000);
  assert.deepEqual(result.persistedMedia, []);
  assert.deepEqual(result.mediaUrlCache, []);
  assert.deepEqual(result.cardUsageOutbox, []);
  assert.deepEqual(result.deletedMedia, ['batch-media-1']);
  assert.deepEqual(result.revokedUrls, ['blob:batch-1']);
  assert.equal(result.batchCount, 2, 'failed persistence keeps the queue for review');
  assert.equal(result.batchSending, false);
  assert.match(result.toastMessages.at(-1), /批量发送失败/);
}

console.log('PASS: real batch-send function revalidates deleted stickers at commit time, rolls back earlier text/image messages and media, commits mixed text+image batches atomically, and releases locks after persistence failure.');
