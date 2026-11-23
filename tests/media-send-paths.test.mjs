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
      else if (char === '\\\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function: ${signature}`);
}

const appMarker = "const STORAGE_KEY='dual_space_app_clean_test_v1';";
const appStart = index.indexOf(appMarker);
assert.ok(appStart >= 0, 'main application script marker must exist');
const app = index.slice(appStart);
const safeMediaUrl = extractFunction(app, 'function safeMediaUrl(value){');
const sendHandler = extractFunction(app, 'function handleChatSendButtonClick(){');
const keyHandler = extractFunction(app, 'function handleChatInputKeydown(event){');
const sendSticker = extractFunction(app, 'async function sendSticker(stickerId){');

// The ordinary send button and Enter key must use the single-message send path.
assert.match(index, /\$\('#sendBtn'\)\.addEventListener\('click',handleChatSendButtonClick\);/);
assert.match(sendHandler, /sendCurrentText\(\)/);
assert.doesNotMatch(sendHandler, /isBatchMode|batchMessages|addToBatch/);
assert.match(keyHandler, /sendCurrentText\(\)/);
assert.doesNotMatch(keyHandler, /isBatchMode|batchMessages|addToBatch/);

// A sticker click must go directly to a single send and re-check the current library.
assert.match(sendSticker, /isStickerSendable\(stickerId\)/);
assert.match(sendSticker, /appendChatMessage\(/);
assert.doesNotMatch(sendSticker, /queueForBatch|batchMessages|renderBatchPreview/);

// The chat composer no longer exposes or retains a batch-send feature.
for (const token of [
  'id="batchBtn"', 'id="batchPanel"', 'id="batchQueueList"', 'id="batchImageInput"',
  'function sendBatchMessages(', 'function toggleBatchMode(', 'let isBatchMode=',
  'let batchMessages=', 'queueForBatch'
]) assert.equal(index.includes(token), false, `obsolete composer feature remains: ${token}`);

// Focusing or clicking the input must not summon the long-text/clipboard/card bar.
// The underlying parameter card manager remains available and intact.
for (const token of ['id="inputHelper"', 'class="input-helper"', 'longTextBtn', 'clipboardBtn', 'phraseBtn']) {
  assert.equal(index.includes(token), false, `obsolete input quick bar remains: ${token}`);
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
  vm.runInNewContext(`${safeMediaUrl}\nglobalThis.checkMediaUrl = safeMediaUrl;`, sandbox);
  assert.equal(sandbox.checkMediaUrl('https://cdn.example.test/photo.webp'), 'https://cdn.example.test/photo.webp');
  assert.equal(sandbox.checkMediaUrl('/media/photo.webp'), '/media/photo.webp');
  assert.equal(sandbox.checkMediaUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.equal(sandbox.checkMediaUrl('data:text/html;base64,AAAA'), '');
  assert.equal(sandbox.checkMediaUrl('javascript:alert(1)'), '');
  assert.equal(sandbox.checkMediaUrl('idb-media:circle-asset-1'), 'blob:resolved-circle-media');
  assert.deepEqual(calls, ['idb-media:circle-asset-1']);
}

console.log('PASS: chat text and sticker sends use direct single-send paths; the shared media URL guard is available to the app; obsolete batch and auto-opening input helpers are removed without deleting card management.');
