import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const card = fs.readFileSync(path.join(root, 'card-system.js'), 'utf8');
const mailbox = fs.readFileSync(path.join(root, 'mailbox-manager.js'), 'utf8');
const fonts = fs.readFileSync(path.join(root, 'custom-font-manager.js'), 'utf8');
const circleMedia = fs.readFileSync(path.join(root, 'circle-media-manager.js'), 'utf8');
function slice(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `missing source boundary: ${startText}`);
  return source.slice(start, end);
}

// The legacy profile/background/icon upload path now rejects oversized inputs,
// preserves animation-capable source formats, and compresses ordinary raster images.
{
  const fn = slice(index, 'async function fileToDataURL(file){', 'function triggerDownload(');
  const readFiles = [];
  class FakeFileReader {
    readAsDataURL(file) { readFiles.push(file); this.result = `data:${file.type};base64,fixture`; queueMicrotask(() => this.onload?.()); }
  }
  let dimensions = null;
  let outputType = null;
  const canvas = {
    width: 0, height: 0,
    getContext() { return { drawImage() {} }; },
    toBlob(callback, type) { outputType = type; callback(new Blob(['compressed'], { type })); },
  };
  const context = {
    FileReader: FakeFileReader, Blob, Promise, Number, String, Math, TextDecoder,
    URL, Map, Set, Array, Object, Date, console,
    window: {},
    createImageBitmap: async () => ({ width: 4000, height: 2000, close() {} }),
    document: { createElement(name) { assert.equal(name, 'canvas'); return canvas; } },
  };
  vm.createContext(context);
  vm.runInContext(circleMedia, context, { filename: 'circle-media-manager.js' });
  vm.runInContext(`${fn}\nglobalThis.runUploadImage=fileToDataURL;`, context);

  const gif = new Blob(['GIF89a'], { type: 'image/gif' });
  Object.defineProperty(gif, 'name', { value: 'animated.gif' });
  assert.equal(await context.runUploadImage(gif), 'data:image/gif;base64,fixture');
  assert.equal(readFiles.at(-1).type, 'image/gif');
  assert.deepEqual(Buffer.from(await readFiles.at(-1).arrayBuffer()), Buffer.from(await gif.arrayBuffer()), 'GIF must remain byte-preserved instead of being flattened through canvas');
  const largeGifBytes = new Uint8Array(7 * 1024 * 1024);
  largeGifBytes.set(Buffer.from('GIF89a'));
  const tooLargeGif = new Blob([largeGifBytes], { type: 'image/gif' });
  Object.defineProperty(tooLargeGif, 'name', { value: 'too-large.gif' });
  await assert.rejects(context.runUploadImage(tooLargeGif), /超过 6 MB/);
  const photo = new Blob([new Uint8Array(4 * 1024 * 1024)], { type: 'image/jpeg' });
  Object.defineProperty(photo, 'name', { value: 'photo.jpg' });
  await context.runUploadImage(photo);
  assert.equal(canvas.width, 1920);
  assert.equal(canvas.height, 960);
  assert.equal(outputType, 'image/jpeg');
  const huge = new Blob([new Uint8Array(21 * 1024 * 1024)], { type: 'image/jpeg' });
  Object.defineProperty(huge, 'name', { value: 'huge.jpg' });
  await assert.rejects(context.runUploadImage(huge), /超过 20 MB/);
}

// Clearing a profile/icon image must restore both state and rendered UI when
// the main state save fails; it must not emit a success toast.
{
  const handler = slice(index, "$$('[data-clear]').forEach(btn=>btn.addEventListener('click',()=>{", "$('#homeCoverBtn').addEventListener('click'");
  const button = { dataset: { clear: 'avatar-me' }, listener: null, addEventListener(_name, callback) { this.listener = callback; } };
  const state = { icons: {}, media: { 'avatar-me': 'data:image/jpeg;base64,old' } };
  const rendered = [];
  const toasts = [];
  const context = {
    state,
    $$() { return [button]; },
    applyAvatar(key, value) { rendered.push([key, value]); },
    applyBackground() {}, applyIcon() {},
    save() { return false; },
    showToast(message) { toasts.push(message); },
  };
  vm.createContext(context);
  vm.runInContext(handler, context);
  button.listener();
  assert.equal(state.media['avatar-me'], 'data:image/jpeg;base64,old');
  assert.deepEqual(rendered.at(-1), ['avatar-me', 'data:image/jpeg;base64,old']);
  assert.match(toasts.at(-1), /清空失败/);
  assert.doesNotMatch(toasts.join('\n'), /已清空/);
}

// All module-local persistence paths must check a false revision marker and
// preserve the previous localStorage snapshot where rollback is possible.
assert.match(card, /markDataChanged\?\.\(\)===false/);
assert.match(mailbox, /markDataChanged\?\.\(\)===false/);
assert.match(fonts, /markRevisionOrReject\(coordinator, '字体快照写入'\)/);
assert.match(slice(fonts, '  function saveFontRecord(record) {', '  function importFont(file) {'), /beginFontSnapshotTransaction\(db, null, '字体快照写入'\)/);
// Execute the actual font-record writer to prove the user import path no longer
// references an undeclared `options` variable.
{
  const helper = slice(fonts, '  function markRevisionOrReject(', '  function openDatabase() {');
  const writer = slice(fonts, '  function saveFontRecord(record) {', '  function importFont(file) {');
  let transactionOptions = 'not-called';
  const tx = { objectStore() { return { put() {} }; } };
  const context = {
    global: { __duoRuntimeCoordinator: { assertWritable() {}, markDataChanged() { return true; } } },
    openDatabase: () => Promise.resolve({}),
    beginFontSnapshotTransaction(_db, options) { transactionOptions = options; return tx; },
    transactionDone: () => Promise.resolve(true),
    FONT_STORE: 'fonts', META_STORE: 'meta', CURRENT_KEY: 'currentFontId', Date,
    Promise,
  };
  vm.createContext(context);
  vm.runInContext(`${helper}\n${writer}\nglobalThis.runSaveFontRecord=saveFontRecord;`, context);
  await context.runSaveFontRecord({ id: 'font-fixture' });
  assert.equal(transactionOptions, null);
}
assert.match(index, /if\(coordinator\?\.markDataChanged\?\.\(\)===false\)/);
assert.match(index, /if\(save\(\)===false\)[\s\S]*清空失败/);

console.log('PASS: legacy image upload limits/compression, animation preservation, clear-operation rollback, and cross-module revision-marker failure handling.');
