import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, 'missing function: ' + signature);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, 'unterminated function: ' + signature);
  return source.slice(start, end + 2);
}

const appMarker = "const STORAGE_KEY='dual_space_app_clean_test_v1';";
const appStart = index.indexOf(appMarker);
assert.ok(appStart >= 0, 'main application script marker must exist');
const app = index.slice(appStart);
const safeMediaUrl = extractFunction(app, 'function safeMediaUrl(value){');
const escapeHtml = extractFunction(app, 'function escapeHtml(str){');
const escapeAttr = extractFunction(app, 'function escapeAttr(value){');
const sendHandler = extractFunction(app, 'function handleChatSendButtonClick(){');
const keyHandler = extractFunction(app, 'function handleChatInputKeydown(event){');
const sendSticker = extractFunction(app, 'async function sendSticker(stickerId){');

// The ordinary send button and Enter key must use the single-message send path.
assert.ok(index.includes("$('#sendBtn').addEventListener('click',handleChatSendButtonClick);"));
assert.ok(sendHandler.includes('sendCurrentText()'));
assert.ok(!/isBatchMode|batchMessages|addToBatch/.test(sendHandler));
assert.ok(keyHandler.includes('sendCurrentText()'));
assert.ok(!/isBatchMode|batchMessages|addToBatch/.test(keyHandler));

// A sticker click must go directly to a single send and re-check the current library.
assert.ok(sendSticker.includes('isStickerSendable(stickerId)'));
assert.ok(sendSticker.includes('appendChatMessage('));
assert.ok(!/queueForBatch|batchMessages|renderBatchPreview/.test(sendSticker));

// The chat composer no longer exposes or retains a batch-send feature.
for (const token of [
  'id="batchBtn"', 'id="batchPanel"', 'id="batchQueueList"', 'id="batchImageInput"',
  'function sendBatchMessages(', 'function toggleBatchMode(', 'let isBatchMode=',
  'let batchMessages=', 'queueForBatch'
]) assert.equal(index.includes(token), false, 'obsolete composer feature remains: ' + token);

// Focusing or clicking the input must not summon the long-text/clipboard/card bar.
// The underlying parameter card manager remains available and intact.
for (const token of ['id="inputHelper"', 'class="input-helper"', 'longTextBtn', 'clipboardBtn', 'phraseBtn']) {
  assert.equal(index.includes(token), false, 'obsolete input quick bar remains: ' + token);
}
assert.equal(index.includes("addEventListener('focus',()=>$('#inputHelper')"), false);
assert.equal(index.includes("addEventListener('click',()=>$('#inputHelper')"), false);
assert.ok(index.includes('paramPhraseAddBtn'), 'parameter card management remains available');
assert.ok(index.includes('window.__duoCardSystem'), 'stable card-system integration remains available');

// Exercise the shared URL guard in the main application scope, not only in the
// Circle IIFE where it originally lived.
{
  const calls = [];
  const sandbox = {
    URL,
    document: { baseURI: 'https://app.example.test/index.html' },
    location: { origin: 'https://app.example.test' },
    window: { __duoCircleMedia: { resolve(value) { calls.push(value); return 'blob:resolved-circle-media'; } } }
  };
  vm.runInNewContext(safeMediaUrl + '\nglobalThis.checkMediaUrl = safeMediaUrl;', sandbox);
  assert.equal(sandbox.checkMediaUrl('https://cdn.example.test/photo.webp'), 'https://cdn.example.test/photo.webp');
  assert.equal(sandbox.checkMediaUrl('/media/photo.webp'), '/media/photo.webp');
  assert.equal(sandbox.checkMediaUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.equal(sandbox.checkMediaUrl('data:text/html;base64,AAAA'), '');
  assert.equal(sandbox.checkMediaUrl('javascript:alert(1)'), '');
  assert.equal(sandbox.checkMediaUrl('idb-media:circle-asset-1'), 'blob:resolved-circle-media');
  assert.deepEqual(calls, ['idb-media:circle-asset-1']);
}

{
  const sandbox = {};
  vm.runInNewContext(escapeHtml + '\n' + escapeAttr + '\nglobalThis.checkEscapeAttr = escapeAttr;', sandbox);
  assert.equal(sandbox.checkEscapeAttr('" onerror="x' + String.fromCharCode(96)), '&quot; onerror=&quot;x&#96;');
}

console.log('PASS: chat text and sticker sends use direct single-send paths; the shared media URL guard is available to the app; obsolete batch and auto-opening input helpers are removed without deleting card management.');
