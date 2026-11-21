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
  const signatureEnd = source.indexOf('){', start);
  const open = signatureEnd >= 0 ? signatureEnd + 1 : source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function: ${signature}`);
}

const functions = [
  extractFunction(index, 'function closeMediaPreview(){'),
  extractFunction(index, 'function openMediaPreview(file,kind){'),
  extractFunction(index, 'async function sendPendingMedia(){')
];

function createPreviewHarness({ commit } = {}) {
  const nodes = new Map();
  for (const id of ['mediaPreviewModal', 'mediaPreviewTitle', 'mediaPreviewContent', 'mediaPreviewSend']) {
    nodes.set(id, { textContent: '', innerHTML: '', disabled: false, classList: { add() {}, remove() {} } });
  }
  const ctx = {
    nodes, urls: { created: [], revoked: [] }, toasts: [], replies: [],
    commit: commit || (async (blob, kind, name, extras, stillCurrent) => {
      assert.equal(kind, 'video'); assert.equal(stillCurrent(), true);
      return { id: 'video-message-1', mediaId: 'video-media-1', type: kind, mediaMime: blob.type, mediaSize: blob.size, mediaName: name };
    })
  };
  const source = `
    const nodes=globalThis.nodes;
    const URL={createObjectURL(file){const u='blob:video-preview-'+(globalThis.urls.created.length+1);globalThis.urls.created.push({url:u,file});return u;},revokeObjectURL(u){globalThis.urls.revoked.push(u);}};
    function $(s){return nodes.get(s.slice(1));}
    function safeMediaUrl(v){return v;}
    function escapeAttr(v){return String(v).replace(/&/g,'&amp;').replace(/\"/g,'&quot;').replace(/</g,'&lt;');}
    function showToast(v){globalThis.toasts.push(String(v));}
    function triggerReply(v){globalThis.replies.push(v);}
    let pendingChatMedia=null;
    const commitChatMediaBlob=globalThis.commit;
    ${functions.join('\n')}
    globalThis.open=openMediaPreview;globalThis.send=sendPendingMedia;globalThis.close=closeMediaPreview;globalThis.getPending=()=>pendingChatMedia;
  `;
  vm.runInNewContext(source, ctx, { filename: 'video-media-paths-real-source.js' });
  return ctx;
}

// The actual preview function rejects empty and oversized videos before allocating an object URL.
{
  const h = createPreviewHarness();
  const empty = { name: 'empty.webm', type: 'video/webm', size: 0 };
  assert.equal(h.open(empty, 'video'), false);
  assert.equal(h.urls.created.length, 0);
  assert.match(h.toasts.at(-1), /为空/);
  assert.equal(h.open({ name:'large.webm', type:'video/webm', size:300*1024*1024+1 }, 'video'), false);
  assert.equal(h.urls.created.length, 0, 'oversized video must be rejected before object URL allocation');
  const unsupported = { name: 'x.bin', type: 'application/octet-stream', size: 10 };
  assert.equal(h.open(unsupported, 'audio'), false);
  assert.equal(h.open(unsupported, 'video'), false, 'video preview must reject a non-video MIME type');
  assert.equal(h.urls.created.length, 0);
  const genericVideo = { name: 'phone-export.mp4', type: 'application/octet-stream', size: 10 };
  assert.equal(h.open(genericVideo, 'video'), true, 'known video extension may proceed when the platform reports a generic MIME type');
  h.close();
}

// A normal video is previewed, committed as a video message with exact metadata, and its preview URL is released.
{
  let committed = null;
  const h = createPreviewHarness({ commit: async (blob, kind, name, extras, current) => {
    assert.equal(current(), true);
    committed = { blob, kind, name, extras };
    return { id: 'video-message-1', type: kind, mediaId: 'video-media-1' };
  }});
  const video = { name: 'clip.webm', type: 'video/webm', size: 1300 };
  assert.equal(h.open(video, 'video'), true);
  assert.match(h.nodes.get('mediaPreviewContent').innerHTML, /<video controls/);
  assert.equal(h.nodes.get('mediaPreviewTitle').textContent, '发送视频');
  assert.equal(await h.send(), true);
  assert.equal(committed.blob, video);
  assert.equal(committed.kind, 'video');
  assert.equal(committed.name, 'clip.webm');
  assert.equal(h.getPending(), null);
  assert.deepEqual(h.urls.revoked, ['blob:video-preview-1']);
  assert.equal(h.replies.length, 1);
}

// Closing the preview during an asynchronous IndexedDB commit invalidates the transaction token.
{
  let finishCommit;
  const h = createPreviewHarness({ commit: async (_blob, _kind, _name, _extras, current) => {
    await new Promise(resolve => { finishCommit = resolve; });
    if (!current()) throw new Error('媒体发送已取消');
    return { id: 'should-not-commit' };
  }});
  assert.equal(h.open({ name: 'race.webm', type: 'video/webm', size: 800 }, 'video'), true);
  const sending = h.send();
  h.close();
  finishCommit();
  assert.equal(await sending, false);
  assert.equal(h.getPending(), null);
  assert.equal(h.replies.length, 0);
  assert.deepEqual(h.urls.revoked, ['blob:video-preview-1']);
}

// The actual media commit function must preserve video MIME/name/size and clean an orphan if backup starts mid-write.
const commitFunction = extractFunction(index, "async function commitChatMediaBlob(blob,kind,name='',messageExtras={},isStillCurrent=()=>true){");
function createCommitHarness({ beginExport = false } = {}) {
  const sandbox = {};
  const body = `
    const state={offline:{lastChatAt:10},chatHistory:[]};
    const window={__duoRestoreInProgress:false,__duoExportInProgress:false,__duoRuntimeCoordinator:{assertWritable(){},isWritable(){return true;}}};
    const mediaUrlCache=new Map(); const revoked=[]; const deleted=[]; let sequence=0;
    const URL={createObjectURL(blob){return 'blob:chat-'+blob.type+'-'+(++sequence);},revokeObjectURL(url){revoked.push(url);}};
    async function putMediaBlob(blob,kind,name){ const id='media-'+(++sequence); if(${beginExport})window.__duoExportInProgress=true; return id; }
    function appendChatMessage(message){const item={...message,id:'message-'+state.chatHistory.length};state.chatHistory.push(item);return item;}
    function releaseChatMediaUrl(id,url){if(mediaUrlCache.get(id)===url)mediaUrlCache.delete(id);URL.revokeObjectURL(url);}
    async function deleteIfUnreferenced(id){deleted.push(id);return true;}
    function formatHM(){return '12:00';}
    function save(){return true;}
    ${commitFunction}
    globalThis.commit=commitChatMediaBlob;
    globalThis.snapshot=()=>({history:state.chatHistory, lastChatAt:state.offline.lastChatAt, cache:[...mediaUrlCache],revoked,deleted});
  `;
  vm.runInNewContext(body, sandbox);
  return sandbox;
}
{
  const h = createCommitHarness();
  const blob = new Blob([new Uint8Array([1,2,3,4])], { type: 'video/webm' });
  const message = await h.commit(blob, 'video', 'clip.webm', { durationSec: 2 });
  const result = JSON.parse(JSON.stringify(h.snapshot()));
  assert.equal(message.type, 'video');
  assert.equal(message.mediaMime, 'video/webm');
  assert.equal(message.mediaName, 'clip.webm');
  assert.equal(message.mediaSize, 4);
  assert.equal(message.durationSec, 2);
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].type, 'video');
}
{
  const h = createCommitHarness({ beginExport: true });
  const blob = new Blob([new Uint8Array([9,8,7])], { type: 'video/webm' });
  await assert.rejects(() => h.commit(blob, 'video', 'during-export.webm'), /媒体发送已取消/);
  const result = JSON.parse(JSON.stringify(h.snapshot()));
  assert.equal(result.history.length, 0);
  assert.deepEqual(result.cache, []);
  assert.deepEqual(result.deleted, ['media-1']);
}

console.log('PASS: video preview rejects empty/unsupported inputs, sends video with preserved MIME/name/size metadata, releases preview URLs, cancels stale preview commits, and rolls back if backup starts mid-write.');
