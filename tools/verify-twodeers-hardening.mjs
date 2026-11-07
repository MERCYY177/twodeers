#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = JSON.parse(read('assets/builtin-stickers/manifest.json'));
assert.equal(manifest.version, 1);
assert.equal(manifest.totalCount, 352);
assert.equal(manifest.items.length, 352);
for (const item of manifest.items) {
  assert.ok(item.assetUrl.startsWith('assets/builtin-stickers/'), `unexpected sticker path: ${item.assetUrl}`);
  const asset = path.join(root, decodeURIComponent(item.assetUrl));
  assert.ok(fs.statSync(asset).isFile(), `missing sticker asset: ${item.assetUrl}`);
  assert.equal(fs.statSync(asset).size, item.size, `sticker size mismatch: ${item.assetUrl}`);
}

// Android system backup is disabled; both legacy backup and Android 12+ extraction
// / device-transfer rules explicitly exclude all app-owned storage domains.
const androidManifest = read('android-apps/app/src/main/AndroidManifest.xml');
assert.match(androidManifest, /android:allowBackup="false"/);
assert.match(androidManifest, /android:fullBackupContent="@xml\/backup_rules"/);
assert.match(androidManifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
assert.match(androidManifest, /android:enableOnBackInvokedCallback="true"/);
const oldRules = read('android-apps/app/src/main/res/xml/backup_rules.xml');
const newRules = read('android-apps/app/src/main/res/xml/data_extraction_rules.xml');
for (const domain of ['root', 'file', 'database', 'sharedpref', 'external']) {
  assert.ok(oldRules.includes(`<exclude domain="${domain}" path="."`));
  assert.ok(newRules.includes(`<exclude domain="${domain}" path="."`));
}
for (const domain of ['device_root', 'device_file', 'device_database', 'device_sharedpref']) {
  assert.ok(newRules.includes(`<exclude domain="${domain}" path="."`));
}
assert.match(newRules, /<cloud-backup>/);
assert.match(newRules, /<device-transfer>/);

const gradle = read('android-apps/app/build.gradle.kts');
assert.match(gradle, /verifyBuiltinStickers/);
assert.match(gradle, /URLDecoder\.decode/);
assert.doesNotMatch(gradle, /sticker-source|prepare-builtin-stickers\.py/);
assert.doesNotMatch(gradle, /\\\$\{/);

const activity = read('android-apps/app/src/main/java/com/mercyy/twodeers/MainActivity.java');
const backup = read('backup-v4.js');
assert.match(activity, /OnBackInvokedCallback/);
assert.match(activity, /registerOnBackInvokedCallback/);
assert.match(activity, /__duoHandleSystemBack/);
assert.match(activity, /backRequestPending/);
assert.match(backup, /function safePath\(path\)/);
assert.equal((backup.match(/function safePath\(path\)/g) || []).length, 1, 'ZIP path validator must have one authoritative definition');
assert.match(backup, /e\.path==='manifest\.json'/);
assert.match(backup, /diskStart!==0/);
assert.match(backup, /生成后的备份 ZIP 超过 1 GB/);
assert.equal((activity.match(/startActivityForResult\(intent, BACKUP_SAVE_REQUEST\)/g) || []).length, 1, 'SAF save picker should launch exactly once');
assert.match(read('settings-pages.js'), /window\.__duoHandleSystemBack=function/);

const index = read('index.html');
assert.doesNotMatch(index, /setInterval\(render,\s*700\)/);
assert.doesNotMatch(index, /setInterval\(\(\)=>\{if\(!window\.__duoCircleRestorePaused\)syncNotificationsFromPosts\(\);\},\s*1200\)/);
assert.match(index, /duo:notifications-changed/);
assert.match(index, /function validateBackupPayloadShape/);
assert.match(index, /function safeMediaUrl/);
assert.match(index, /escapeHtml\(time\)/);
assert.match(index, /Array\.from\(list\.querySelectorAll\('\[data-mid\]'\)\)\.find/);

// Exercise the actual URL/escaping helpers and chat message renderer.
const helpersStart = index.indexOf('function fallbackChar(');
const helpersEnd = index.indexOf('function getViewAssets()', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart);
const helperSandbox = {
  document: { baseURI: 'https://app.test/index.html' },
  location: { origin: 'https://app.test' },
  URL,
  state: { readReceiptStyle: 'text', media: {} },
  mediaUrlCache: new Map(),
  mediaLoadFailed: new Set(),
  uid: () => 'test-id',
};
vm.runInNewContext(index.slice(helpersStart, helpersEnd), helperSandbox);
assert.equal(helperSandbox.safeMediaUrl('javascript:alert(1)'), '');
assert.equal(helperSandbox.safeMediaUrl('data:text/html;base64,PHNjcmlwdD4='), '');
assert.equal(helperSandbox.safeMediaUrl('https://good.example/a.png'), 'https://good.example/a.png');
assert.equal(helperSandbox.safeMediaUrl('https://good.example/" onerror="alert(1)'), '');
assert.equal(helperSandbox.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');

const metaStart = index.indexOf('function metaHtml(time, read=false)');
const metaEnd = index.indexOf('function uid(', metaStart);
assert.ok(metaStart >= 0 && metaEnd > metaStart);
vm.runInNewContext(index.slice(metaStart, metaEnd), helperSandbox);
const escapedMeta = helperSandbox.metaHtml('" onmouseover="alert(1)', false);
assert.ok(!escapedMeta.includes('" onmouseover="'));
assert.ok(escapedMeta.includes('&quot; onmouseover=&quot;'));

const messageStart = index.indexOf('function buildMessageRow(msg){');
const messageEnd = index.indexOf('function renderChatHistory(', messageStart);
assert.ok(messageStart >= 0 && messageEnd > messageStart);
helperSandbox.document.createElement = () => ({ dataset: {}, appendChild() {}, set innerHTML(value) { this.html = value; } });
vm.runInNewContext(index.slice(messageStart, messageEnd), helperSandbox);
const maliciousText = '<svg onload=alert(1)>';
const row = helperSandbox.buildMessageRow({ id: 'm1', sender: 'me', type: 'text', text: maliciousText, time: maliciousText });
assert.ok(row.html.includes('&lt;svg onload=alert(1)&gt;'));
assert.ok(!row.html.includes('<svg onload=alert(1)>'));
const badMediaRow = helperSandbox.buildMessageRow({ id: 'm2', sender: 'me', type: 'image', url: '"><img src=x onerror=alert(1)>' });
assert.ok(!badMediaRow.html.includes('onerror=alert(1)'));

const validatorStart = index.indexOf('function validateBackupPayloadShape(payload){');
const validatorEnd = index.indexOf('async function applyBackupPayloadInternal(payload){', validatorStart);
assert.ok(validatorStart >= 0 && validatorEnd > validatorStart);
const legacySandbox = { window: {}, URL };
vm.runInNewContext(index.slice(validatorStart, validatorEnd), legacySandbox);
const validateLegacy = legacySandbox.validateBackupPayloadShape;
assert.equal(validateLegacy({ kind: 'chat', data: { chatHistory: [{ id: 'm1', text: 'hello' }], stickers: [], stickerFavorites: [] } }), undefined);
assert.equal(validateLegacy({ kind: 'chat', data: { chatHistory: [{ id: 'm2', time: '<b>plain text</b>' }], stickers: [], stickerFavorites: [] } }), undefined, 'HTML-looking plain text is allowed only because renderers escape it');
assert.throws(() => validateLegacy({ kind: 'chat', data: { chatHistory: [], stickers: [{ id: 's1', src: 'javascript:alert(1)' }] } }), /允许的媒体或网页地址/);
assert.throws(() => validateLegacy({ kind: 'chat', data: { chatHistory: [{ id: 'm3', url: '\"><img src=x onerror=alert(1)>' }] } }), /允许的媒体或网页地址/);
assert.throws(() => validateLegacy({ kind: 'chat', data: { chatHistory: 'not-an-array' } }), /必须是数组/);
assert.throws(() => validateLegacy({ kind: 'chat', data: JSON.parse('{"chatHistory":[],"__proto__":{"polluted":true}}') }), /禁止字段/);

// Exercise the V4 import validation helpers, including media URL context and read cap.
const v4HelpersStart = backup.indexOf('  function safePath(path){');
const v4HelpersEnd = backup.indexOf('  async function unzipStored(blob){', v4HelpersStart);
assert.ok(v4HelpersStart >= 0 && v4HelpersEnd > v4HelpersStart);
const v4HelpersSandbox = { window: {}, Blob, URL, TextEncoder, decodeURIComponent, Map, Set, Number, Object, Array, Error };
vm.runInNewContext('const MAX_JSON_MEMBER=128*1024*1024, MAX_MANIFEST=16*1024*1024; const enc=new TextEncoder();\n' + backup.slice(v4HelpersStart, v4HelpersEnd), v4HelpersSandbox);
await v4HelpersSandbox.validateV4Payloads('chat', new Map(), { chatHistory: [{ id: 'm2', text: 'normal' }], stickers: [], stickerFavorites: [] });
await v4HelpersSandbox.validateV4Payloads('chat', new Map(), { chatHistory: [{ id: 'm3', time: '<b>plain text</b>' }], stickers: [], stickerFavorites: [] });
await assert.rejects(() => v4HelpersSandbox.validateV4Payloads('chat', new Map(), { chatHistory: [], stickers: [{ id: 's2', src: 'javascript:alert(1)' }] }), /允许的媒体或网页地址/);
await assert.rejects(() => v4HelpersSandbox.validateV4Payloads('chat', new Map(), { chatHistory: [{ id: 'm4', url: '\"><img src=x onerror=alert(1)>' }], stickers: [] }), /允许的媒体或网页地址/);
await assert.rejects(() => v4HelpersSandbox.validateV4Payloads('chat', new Map(), JSON.parse('{"chatHistory":[],"__proto__":{"polluted":true}}')), /禁止字段/);
await assert.rejects(() => v4HelpersSandbox.readJsonMember(new Map([['large.json', { size: 128*1024*1024+1, blob: new Blob(['{}']) }]]), 'large.json'), /128 MB/);

// Run the real V4 ZIP parser against a valid synthetic archive and malformed manifests.
const parserSandbox = {
  window: {},
  document: { addEventListener() {}, getElementById() { return null; } },
  Blob, TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, ArrayBuffer,
  URL, Map, Set, Object, Number, Array, Date, Error, Math, Promise, console,
  decodeURIComponent,
};
vm.runInNewContext(backup, parserSandbox, { filename: 'backup-v4.js' });
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); crcTable[n] = c >>> 0; }
function crc32(buffer) { let c = 0xffffffff; for (const b of buffer) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return ((c ^ 0xffffffff) >>> 0); }
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
function buildStoredZip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8'), data = Buffer.from(file.data), crc = crc32(data);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    locals.push(local);
    const central = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]);
    centrals.push(central); offset += local.length;
  }
  const centralData = Buffer.concat(centrals);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralData.length), u32(offset), u16(0)]);
  return new Blob([...locals, centralData, eocd], { type: 'application/zip' });
}
function resourceMeta(name, data) {
  const b = Buffer.from(data);
  return { path: name, size: b.length, crc32: crc32(b).toString(16).padStart(8, '0'), sha256: crypto.createHash('sha256').update(b).digest('hex'), type: 'file', mimeType: 'application/json' };
}
const stateBytes = Buffer.from('{"kind":"chat"}');
const goodManifest = { format: 'twodeers-backup', formatVersion: 4, kind: 'chat', resourceCount: 1, totalResourceBytes: stateBytes.length, resources: [resourceMeta('state.json', stateBytes)] };
const goodZip = buildStoredZip([{ name: 'state.json', data: stateBytes }, { name: 'manifest.json', data: JSON.stringify(goodManifest) }]);
const parsedGood = await parserSandbox.window.__duoBackupV4.unzip(goodZip);
assert.equal(parsedGood.manifest.resourceCount, 1);
assert.equal(parsedGood.map.get('state.json').size, stateBytes.length);
const diskStartBytes = new Uint8Array(await goodZip.arrayBuffer());
const diskView = new DataView(diskStartBytes.buffer);
let centralSig = -1;
for (let i = 0; i < diskStartBytes.length - 4; i++) { if (diskView.getUint32(i, true) === 0x02014b50) { centralSig = i; break; } }
assert.ok(centralSig >= 0);
diskView.setUint16(centralSig + 34, 1, true);
await assert.rejects(() => parserSandbox.window.__duoBackupV4.unzip(new Blob([diskStartBytes])), /边界有效/);
const extraManifest = { ...goodManifest, resources: goodManifest.resources };
const extraZip = buildStoredZip([{ name: 'state.json', data: stateBytes }, { name: 'unlisted.json', data: '{}' }, { name: 'manifest.json', data: JSON.stringify(extraManifest) }]);
await assert.rejects(() => parserSandbox.window.__duoBackupV4.unzip(extraZip), /资源数量与 ZIP 内容不一致/);
const duplicateManifest = { ...goodManifest, resourceCount: 2, totalResourceBytes: stateBytes.length * 2, resources: [resourceMeta('state.json', stateBytes), resourceMeta('state.json', stateBytes)] };
const duplicateZip = buildStoredZip([{ name: 'state.json', data: stateBytes }, { name: 'other.json', data: '{}' }, { name: 'manifest.json', data: JSON.stringify(duplicateManifest) }]);
await assert.rejects(() => parserSandbox.window.__duoBackupV4.unzip(duplicateZip), /重复资源路径/);
const mismatchManifest = { ...goodManifest, resources: [resourceMeta('missing.json', stateBytes)] };
const mismatchZip = buildStoredZip([{ name: 'state.json', data: stateBytes }, { name: 'manifest.json', data: JSON.stringify(mismatchManifest) }]);
await assert.rejects(() => parserSandbox.window.__duoBackupV4.unzip(mismatchZip), /缺少资源|资源路径非法/);

// Syntax-check all root JS modules and executable inline JS; parse Android XML.
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, entry.name)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${entry.name}: ${result.stderr}`);
  }
}
let scriptIndex = 0;
for (const match of index.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
  const attrs = match[1], body = match[2];
  if (/\bsrc\s*=/.test(attrs) || !body.trim()) continue;
  const type = attrs.match(/\btype\s*=\s*["']([^"']+)/i)?.[1]?.toLowerCase();
  if (type && !['text/javascript', 'application/javascript', 'module'].includes(type)) continue;
  new vm.Script(body, { filename: `index-inline-${scriptIndex++}.js` });
}
const xmlFiles = ['android-apps/app/src/main/AndroidManifest.xml', 'android-apps/app/src/main/res/xml/backup_rules.xml', 'android-apps/app/src/main/res/xml/data_extraction_rules.xml'];
for (const file of xmlFiles) {
  const result = spawnSync('python3', ['-c', 'import sys,xml.etree.ElementTree as E; E.parse(sys.argv[1])', path.join(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file}: ${result.stderr}`);
}

console.log(`PASS: 352 sticker assets; manual-only Android backup rules; Gradle source checks; Android 13+ and legacy Back hooks; single SAF save picker; legacy/V4 import URL validation; message text/metadata escaping; malformed V4 manifest rejection; 128 MB JSON cap; ${scriptIndex} inline scripts and root JS syntax; Android XML parsing.`);
