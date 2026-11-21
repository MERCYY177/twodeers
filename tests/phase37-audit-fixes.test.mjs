import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const circleSource = fs.readFileSync(path.join(root, 'circle-media-manager.js'), 'utf8');
const appearanceSource = fs.readFileSync(path.join(root, 'appearance-manager.js'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'android-apps/app/src/main/AndroidManifest.xml'), 'utf8');
const activity = fs.readFileSync(path.join(root, 'android-apps/app/src/main/java/com/mercyy/twodeers/MainActivity.java'), 'utf8');

function be32(value) { return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]; }
function le32(value) { return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]; }
function chunk(type, data = []) { return [...be32(data.length), ...Buffer.from(type, 'ascii'), ...data, 0, 0, 0, 0]; }
function png({ animated = false } = {}) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const ihdr = chunk('IHDR', [...be32(1), ...be32(1), 8, 6, 0, 0, 0]);
  const actl = animated ? chunk('acTL', [...be32(2), ...be32(0)]) : [];
  return new Blob([new Uint8Array([...signature, ...ihdr, ...actl, ...chunk('IDAT', [0]), ...chunk('IEND')])], { type: 'image/png' });
}
function webp({ animated = false } = {}) {
  const body = animated
    ? [...Buffer.from('WEBP', 'ascii'), ...Buffer.from('ANIM', 'ascii'), ...le32(0), ...Buffer.from('ANMF', 'ascii'), ...le32(0)]
    : [...Buffer.from('WEBP', 'ascii'), ...Buffer.from('VP8 ', 'ascii'), ...le32(0)];
  return new Blob([new Uint8Array([...Buffer.from('RIFF', 'ascii'), ...le32(body.length + 4), ...body])], { type: 'image/webp' });
}

// The exact production media parser must identify animation/vector containers
// by their byte structure, not by a filename or MIME label alone.
{
  const context = { window: {}, URL, Blob, TextDecoder, Promise, Map, Set, Array, Object, String, Number, Math, Date, console };
  vm.createContext(context);
  vm.runInContext(circleSource, context, { filename: 'circle-media-manager.js' });
  const manager = context.window.__duoCircleMedia;
  assert.equal(await manager.getOriginalImageKind(png({ animated: true }), 'animated.png'), 'apng', 'APNG stored under .png extension and image/png MIME must be detected');
  assert.equal(await manager.getOriginalImageKind(png(), 'static.png'), '', 'ordinary PNG must continue through bounded raster compression');
  assert.equal(await manager.getOriginalImageKind(new Blob([Buffer.from('GIF89a')], { type: 'application/octet-stream' })), 'gif');
  assert.equal(await manager.getOriginalImageKind(webp({ animated: true })), 'webp-animated');
  assert.equal(await manager.getOriginalImageKind(webp()), 'webp', 'static WebP bytes must be preserved without animation misclassification');
  assert.equal(await manager.getOriginalImageKind(new Blob(['<?xml version="1.0"?>\n<!-- vector -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'], { type: 'image/svg+xml' })), 'svg');
  assert.equal(await manager.getOriginalImageKind(new Blob(['<!-- <svg> fake -->\n<html></html>'], { type: 'image/svg+xml' })), '', 'SVG hint alone must not classify unrelated markup as SVG');
  assert.equal(await manager.requiresOriginalImageBytes(png({ animated: true })), true);
  assert.equal(await manager.requiresOriginalImageBytes(new Blob(['<svg></svg>'])), true);
  assert.equal(await manager.isAnimatedImageBlob(new Blob(['<svg></svg>'])), false, 'vector preservation and animation detection are separate concepts');
}

// The actual fileToDataURL path must preserve APNG frame bytes and reject a
// mismatched declaration instead of silently flattening it to WebP/JPEG.
{
  const mediaContext = { window: {}, URL, Blob, TextDecoder, Promise, Map, Set, Array, Object, String, Number, Math, Date, console };
  vm.createContext(mediaContext);
  vm.runInContext(circleSource, mediaContext, { filename: 'circle-media-manager.js' });
  const reader = {
    result: null,
    onload: null,
    onerror: null,
    readAsDataURL(blob) {
      blob.arrayBuffer().then(buffer => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
        this.onload?.();
      }, error => this.onerror?.(error));
    },
  };
  const fileToDataURL = index.slice(index.indexOf('async function fileToDataURL(file){'), index.indexOf('\nfunction triggerDownload(', index.indexOf('async function fileToDataURL(file){')));
  const conversionContext = {
    window: mediaContext.window,
    FileReader: function FileReader() { return Object.create(reader); },
    createImageBitmap: async () => ({ width: 1, height: 1, close() {} }),
    document: { createElement: () => ({ width: 1, height: 1, getContext: () => ({ drawImage() {} }), toBlob: callback => callback(new Blob(['static-output'], { type: 'image/webp' })) }) },
    Promise, Error, Number, String, Math, console,
  };
  vm.createContext(conversionContext);
  vm.runInContext(`${fileToDataURL}\nglobalThis.convertImage=fileToDataURL;`, conversionContext);
  const apng = png({ animated: true });
  Object.defineProperty(apng, 'name', { value: 'loop.png' });
  const dataUrl = await conversionContext.convertImage(apng);
  assert.match(dataUrl, /^data:image\/png;base64,/);
  const convertedApngBytes=Buffer.from(dataUrl.split(',')[1], 'base64');
  assert.equal(convertedApngBytes.length, apng.size, 'APNG byte length must remain unchanged');
  assert.deepEqual(convertedApngBytes, Buffer.from(await apng.arrayBuffer()), 'APNG source frame bytes must remain byte-for-byte intact');
  const svg = new Blob(['<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0\"/></svg>'], { type: 'image/svg+xml' });
  Object.defineProperty(svg, 'name', { value: 'vector.svg' });
  const svgUrl=await conversionContext.convertImage(svg);
  assert.match(svgUrl, /^data:image\/svg\+xml;base64,/);
  assert.deepEqual(Buffer.from(svgUrl.split(',')[1], 'base64'), Buffer.from(await svg.arrayBuffer()), 'SVG source bytes must remain byte-for-byte intact');
  const invalid = new Blob(['not an SVG'], { type: 'image/svg+xml' });
  Object.defineProperty(invalid, 'name', { value: 'bad.svg' });
  await assert.rejects(conversionContext.convertImage(invalid), /文件头与扩展名/);
}

// Circle profile uploads and post media use the same preservation decision.
{
  assert.match(index, /requiresOriginalImageBytes\?\.\(file,file\.name\|\|''\)/, 'Circle profile avatar/cover must use byte-preservation classifier');
  assert.match(index, /buildMediaItem = async function\(file\)[\s\S]*?requiresOriginalImageBytes/, 'Circle post media must use byte-preservation classifier');
  assert.match(circleSource, /async function requiresOriginalImageBytes/);
}

// Read-only tab startup executes read-only media/font hydration before return,
// but does not execute legacy migrations or writer-only recovery tasks.
{
  const start = index.indexOf('if(!access?.writable){');
  const end = index.indexOf('\n    try{\n      await window.__duoStickerStoreReady;', start);
  assert.ok(start >= 0 && end > start, 'read-only startup branch must exist before writer startup');
  const branch = index.slice(start, end);
  const events = [];
  const context = {
    access: { writable: false },
    callTimerHandle: null,
    window: {
      __duoStickerStoreReady: Promise.resolve(),
      __duoMailbox: { initialize: () => events.push('mailbox-init'), pauseTasks: () => events.push('mailbox-pause') },
      __duoStickerLibrary: { initialize: async () => events.push('sticker-init') },
      __duoCircleApi: { pauseTasks: () => events.push('circle-pause') },
      __duoCircleMedia: { ensure: async () => { events.push('circle-hydrate'); return { loaded: 2, missing: 0 }; } },
      ChuanXunFontManager: { restoreCurrent: async options => { events.push(`font-restore:${options.silent}`); } },
    },
    initializeStickerLibraryStore: () => events.push('sticker-store-init'),
    hydrateProfileMedia: async () => events.push('profile-hydrate'),
    migrateLegacyProfileMedia: async () => events.push('profile-migrate'),
    clearIncomingRingTimer: () => events.push('ring-clear'),
    clearIncomingSchedule: () => events.push('schedule-clear'),
    console,
    Promise,
  };
  vm.createContext(context);
  await vm.runInContext(`(async function(){${branch}\n})()`, context);
  for (const expected of ['profile-hydrate', 'circle-hydrate', 'font-restore:true']) assert.ok(events.includes(expected), `read-only startup missing ${expected}`);
  assert.equal(events.includes('profile-migrate'), false, 'read-only tabs must not migrate or persist profile data');
  assert.equal(events.includes('circle-migrate'), false, 'read-only tabs must not invoke Circle legacy migration');
}

// Generic audited setting mutation helper restores both state and UI after a
// storage quota/revision-marker failure, and commits successful edits.
{
  const helper = index.slice(index.indexOf('function cloneSettingSnapshot('), index.indexOf('\nfunction syncReplyInputs(', index.indexOf('function cloneSettingSnapshot(')));
  const context = {
    state: { appearanceColors: { theme: '#112233', buttonBg: '#223344', buttonText: '#ffffff' }, customCSS: '.old{}' },
    showToast() {},
    console,
    JSON, Object, Map,
  };
  vm.createContext(context);
  vm.runInContext(`var saveResult=false; function save(){return saveResult;} ${helper}\nglobalThis.commit=commitAppearanceState;`, context);
  let ui = 'old';
  let ok = context.commit(['appearanceColors'], () => { context.state.appearanceColors.theme = '#abcdef'; }, () => { ui = context.state.appearanceColors.theme; });
  assert.equal(ok, false);
  assert.equal(context.state.appearanceColors.theme, '#112233');
  assert.equal(ui, '#112233', 'failed write must restore the rendered CSS/control value');
  context.saveResult = true;
  ok = context.commit(['customCSS'], () => { context.state.customCSS = '.new{}'; }, () => { ui = context.state.customCSS; });
  assert.equal(ok, true);
  assert.equal(context.state.customCSS, '.new{}');
}

// The separate theme manager follows the same commit-then-confirm rule for all
// palette/mode/background/bubble-style controls.
{
  const rootStyle = { setProperty() {}, removeProperty() {} };
  const styleNodes = new Map();
  const document = {
    readyState: 'loading',
    addEventListener() {},
    documentElement: { dataset: {}, style: rootStyle },
    body: { classList: { toggle() {} } },
    head: { appendChild(node) { styleNodes.set(node.id, node); node.parentNode = document.head; } },
    createElement(tag) { return { tagName: tag, id: '', textContent: '', parentNode: null }; },
    getElementById(id) { return styleNodes.get(id) || null; },
    querySelectorAll() { return []; },
  };
  const context = {
    window: {}, document,
    state: { appearanceSettings: { mode: 'light', palette: 'sage', background: 'soft', bubbleStyle: 'soft' }, appearanceColors: {} },
    normalizeHex: value => value,
    save() { return context.saveResult; },
    saveResult: false,
    showToast() {},
    console, JSON, Object, String,
  };
  vm.createContext(context);
  vm.runInContext(appearanceSource, context, { filename: 'appearance-manager.js' });
  assert.equal(typeof context.window.DuoAppearance.setSetting, 'function');
  assert.equal(context.window.DuoAppearance.setSetting('palette', 'ocean'), false);
  assert.equal(context.state.appearanceSettings.palette, 'sage');
  assert.equal(document.documentElement.dataset.duoPalette, 'sage', 'failed theme commit restores the actual rendered palette');
  context.saveResult = true;
  assert.equal(context.window.DuoAppearance.setSetting('palette', 'ocean'), true);
  assert.equal(context.state.appearanceSettings.palette, 'ocean');
  assert.equal(document.documentElement.dataset.duoPalette, 'ocean');
  assert.equal(context.window.DuoAppearance.setSetting('palette', 'not-a-palette'), false);
  assert.equal(context.state.appearanceSettings.palette, 'ocean');
}

// MainActivity requests only RECORD_AUDIO from the trusted asset origin, denies
// untrusted/mixed resource requests, validates the OS grant and closes pending
// WebView permissions if the activity is destroyed.
{
  assert.match(manifest, /<uses-permission android:name="android\.permission\.RECORD_AUDIO"\s*\/>/);
  assert.match(manifest, /<uses-feature android:name="android\.hardware\.microphone" android:required="false"\s*\/>/, 'microphone hardware must remain optional so text/chat features can install on devices without it');
  assert.match(activity, /onPermissionRequest\(PermissionRequest request\)/);
  assert.match(activity, /"https"\.equalsIgnoreCase\(origin\.getScheme\(\)\)/);
  assert.match(activity, /HOST\.equalsIgnoreCase\(origin\.getHost\(\)\)/);
  assert.match(activity, /port == -1 \|\| port == 443/, 'audio permission must reject non-standard trusted-host ports');
  assert.match(activity, /resources\.length != 1/);
  assert.match(activity, /PermissionRequest\.RESOURCE_AUDIO_CAPTURE\.equals\(resources\[0\]\)/);
  assert.match(activity, /requestPermissions\(new String\[\]\{Manifest\.permission\.RECORD_AUDIO\}/);
  assert.match(activity, /pendingWebPermissionRequest = null/);
  assert.match(activity, /denyPendingWebPermissionRequest\(\);/);
  assert.ok(activity.indexOf('denyPendingWebPermissionRequest();') > activity.indexOf('protected void onDestroy()'), 'destroy must deny any still-pending WebView permission');
}

// Ensure every audited appearance listener now routes through the transaction
// helper instead of mutating state and ignoring save() failure.
{
  const required = [
    "commitAppearanceState(['readReceiptStyle','showReadReceipt']",
    "commitAppearanceState(['typing']",
    "commitAppearanceState(['offline']",
    "commitAppearanceState(['avatarShape']",
    "commitAppearanceState(['bubbleShape']",
    "commitAppearanceState(['bubbleColors']",
    "commitAppearanceState(['appearanceColors']",
    "commitAppearanceState(['customCSS']",
    "commitAppearanceState(['replyWindow']",
  ];
  for (const fragment of required) assert.ok(index.includes(fragment), `missing transactional settings path: ${fragment}`);
  assert.match(index, /if\(save\(\)===false\)\{restore\(\)/, 'failed saves must restore prior data before returning');
}

console.log('Phase 37 audit-fix regressions passed: media signatures, APNG/SVG preservation, read-only hydration, appearance rollback and Android audio permission contracts.');
