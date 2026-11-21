import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const circleManager = fs.readFileSync(path.join(root, 'circle-media-manager.js'), 'utf8');
const beautifyManager = fs.readFileSync(path.join(root, 'chat-beautify-manager.js'), 'utf8');

function slice(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `missing source boundary: ${startText}`);
  return source.slice(start, end);
}

// The IDB media manager exposes the shared ensureRefs() API required by
// profile-image upload, startup hydration and backup restore. It must count
// missing and invalid references rather than silently treating them as loaded.
{
  let objectUrlSequence = 0;
  const records = new Map([
    ['profile-one', { id: 'profile-one', blob: { size: 17, type: 'image/png' } }],
  ]);
  let delayedResolve;
  const context = {
    window: {},
    URL: {
      createObjectURL() { objectUrlSequence += 1; return `blob:phase36-${objectUrlSequence}`; },
      revokeObjectURL() {},
    },
    getMediaRecord(id) {
      if (id === 'profile-slow') return new Promise(resolve => { delayedResolve = resolve; });
      return Promise.resolve(records.get(id) || null);
    },
    console,
    Promise, Set, Map, Array, String, Number, Math, Date, Blob,
  };
  vm.createContext(context);
  vm.runInContext(circleManager, context, { filename: 'circle-media-manager.js' });
  const manager = context.window.__duoCircleMedia;
  assert.equal(typeof manager.ensureRefs, 'function', 'profile references require an exported media hydration API');
  assert.equal(manager.isDataMediaUrl('data:image/apng;base64,YWJj'), true, 'APNG upload format must be accepted end-to-end');
  assert.equal(manager.isDataMediaUrl('data:image/svg+xml;base64,PHN2Zz4='), true, 'SVG upload format must be accepted end-to-end');
  assert.equal(manager.isDataMediaUrl('data:image/bmp;base64,YWJj'), false, 'unsupported raster formats remain rejected');

  const result = await manager.ensureRefs(['idb-media:profile-one', 'idb-media:does-not-exist', 'not-a-media-ref']);
  assert.deepEqual({ loaded: result.loaded, missing: result.missing, stale: !!result.stale }, { loaded: 1, missing: 2, stale: false });
  assert.match(manager.resolve('idb-media:profile-one'), /^blob:phase36-/);
  assert.equal(manager.resolve('idb-media:does-not-exist'), '');

  const pending = manager.ensureRefs(['idb-media:profile-slow']);
  await Promise.resolve();
  manager.invalidate();
  delayedResolve({ id: 'profile-slow', blob: { size: 9, type: 'image/png' } });
  const stale = await pending;
  assert.equal(stale.stale, true, 'invalidation during an async hydration must not publish a stale object URL');
  assert.equal(manager.resolve('idb-media:profile-slow'), '');
}

// Startup hydration must rebuild Blob URLs for already-persisted references on
// every load, while still rendering healthy slots if one unrelated media row is
// missing and then surfacing the missing-record error.
{
  const profileRefs = slice(index, 'function collectProfileMediaIds(', 'window.__duoProfileMediaRefs=');
  const hydrate = slice(index, 'async function hydrateProfileMedia(){', 'async function migrateLegacyProfileMedia(');
  let ensureCalls = [];
  let applied = 0;
  const context = {
    state: { media: { 'avatar-me': 'idb-media:avatar-one', 'bg-chat': 'idb-media:bg-two' }, icons: { 'home-chat': 'idb-media:icon-three' } },
    window: { __duoCircleMedia: {
      makeRef: id => `idb-media:${id}`,
      async ensureRefs(refs) { ensureCalls = refs; return { loaded: 3, missing: 0 }; },
    } },
    applyProfileMediaToUi() { applied += 1; },
    Set, Object, Array, String, Promise, console,
  };
  vm.createContext(context);
  vm.runInContext(`${profileRefs}\n${hydrate}\nglobalThis.runHydrateProfileMedia=hydrateProfileMedia;`, context);
  const result = await context.runHydrateProfileMedia();
  assert.equal(result.loaded, 3);
  assert.deepEqual(Array.from(ensureCalls).sort(), ['idb-media:avatar-one', 'idb-media:bg-two', 'idb-media:icon-three']);
  assert.equal(applied, 1);

  context.window.__duoCircleMedia.ensureRefs = async () => ({ loaded: 2, missing: 1 });
  await assert.rejects(context.runHydrateProfileMedia(), /媒体回读失败/);
  assert.equal(applied, 2, 'healthy media slots are still applied before reporting a missing reference');
}

// All three streaming JSON backup scopes must include profile media Blob
// records according to their contract; a reference without a corresponding
// mediaFiles entry is not a portable backup.
{
  const references = slice(index, 'function collectProfileMediaIds(', 'function latestPersistedMediaReferences(){');
  const currentMediaIds = slice(index, 'function getCurrentMediaIds(){', 'async function* backupJsonParts(kind){');
  const backupParts = slice(index, 'async function* backupJsonParts(kind){', 'let legacyExportInProgress=false;');
  const records = new Map();
  const allIds = [
    'chat-media', 'sticker-media', 'avatar-me', 'avatar-other', 'chat-bg', 'home-cover', 'custom-icon',
    'circle-avatar', 'circle-cover', 'circle-post',
  ];
  for (const id of allIds) {
    const bytes = new Uint8Array([65, 66, 67]);
    records.set(id, {
      id, kind: 'image', mimeType: 'image/png', name: `${id}.png`, size: bytes.length, createdAt: 1,
      blob: { size: bytes.length, type: 'image/png', slice() { return { arrayBuffer: async () => bytes.buffer }; } },
    });
  }
  const h = { migrationOrder: [] };
  const circleState = {
    myAvatar: 'idb-media:circle-avatar', myCover: 'idb-media:circle-cover',
    posts: [{ id: 'post-1', media: [{ src: 'idb-media:circle-post', type: 'image' }] }],
  };
  const state = {
    chatHistory: [{ id: 'm1', mediaId: 'chat-media' }],
    stickers: [{ id: 's1', mediaId: 'sticker-media' }],
    media: {
      'avatar-me': 'idb-media:avatar-me', 'avatar-other': 'idb-media:avatar-other',
      'bg-chat': 'idb-media:chat-bg', 'home-cover': 'idb-media:home-cover',
    },
    icons: { 'home-chat': 'idb-media:custom-icon' },
    bubbleColors: {}, appearanceColors: {}, typing: {}, offline: {}, callSettings: {}, incomingCallSettings: {},
    cardPhrases: [],
  };
  const context = {
    state,
    window: {
      __duoMailbox: { getReferencedMediaIds: () => new Set() },
      __duoCircleMedia: {
        getIds: () => new Set(['circle-avatar', 'circle-cover', 'circle-post']),
        collectIdsFromState(_circle, options = {}) {
          return options.profileOnly ? new Set(['circle-avatar', 'circle-cover']) : new Set(['circle-avatar', 'circle-cover', 'circle-post']);
        },
        async migrateLegacy() { h.migrationOrder.push('circle'); },
      },
    },
    async migrateLegacyProfileMedia() { h.migrationOrder.push('profile'); },
    getCircleState: () => circleState,
    getMediaRecord: async id => records.get(id) || null,
    btoa, console,
    Date, JSON, Object, Array, String, Number, Math, Set, Map, Promise,
  };
  vm.createContext(context);
  vm.runInContext(`${references}\n${currentMediaIds}\n${backupParts}\nglobalThis.runBackupParts=backupJsonParts;`, context);
  async function readBackup(kind) {
    let json = '';
    for await (const part of context.runBackupParts(kind)) json += part;
    return JSON.parse(json);
  }
  const chat = await readBackup('chat');
  assert.deepEqual(chat.data.mediaFiles.map(item => item.id).sort(), ['avatar-me', 'avatar-other', 'chat-bg', 'chat-media', 'sticker-media'].sort());
  assert.equal(chat.data.media['avatar-me'], 'idb-media:avatar-me');
  assert.equal(chat.data.mediaFiles.some(item => item.id === 'home-cover' || item.id === 'custom-icon' || item.id.startsWith('circle-')), false);
  assert.deepEqual(h.migrationOrder, ['profile']);

  h.migrationOrder.length = 0;
  const param = await readBackup('param');
  assert.deepEqual(param.data.mediaFiles.map(item => item.id).sort(), ['avatar-me', 'avatar-other', 'chat-bg', 'home-cover', 'custom-icon', 'circle-avatar', 'circle-cover'].sort());
  assert.equal(param.data.icons['home-chat'], 'idb-media:custom-icon');
  assert.deepEqual(h.migrationOrder, ['profile', 'circle']);

  h.migrationOrder.length = 0;
  const all = await readBackup('all');
  assert.deepEqual(all.data.mediaFiles.map(item => item.id).sort(), allIds.sort());
  assert.equal(all.data.circleState.posts[0].media[0].src, 'idb-media:circle-post');
  assert.deepEqual(h.migrationOrder, ['profile', 'circle']);
}

// Legacy profile-image migration is transactional across every media/icon slot:
// repeated Data URLs are deduplicated, and save/readback failures keep the old
// storage snapshot while reclaiming only the newly created, unreferenced rows.
{
  const profileRefs = slice(index, 'function collectProfileMediaIds(', 'window.__duoProfileMediaRefs=');
  const migration = slice(index, 'async function migrateLegacyProfileMedia(', 'async function storeProfileImageDataUrl(');
  function buildMigrationHarness({ saveResult = true, hydration = { loaded: 2, missing: 0 }, corruptReadback = false } = {}) {
    const original = {
      media: { 'avatar-me': 'data:image/png;base64,QUJD', 'avatar-other': 'data:image/png;base64,REVG', 'bg-chat': 'data:image/png;base64,QUJD' },
      icons: { 'home-chat': 'data:image/png;base64,QUJD', 'home-space': '' },
    };
    const h = {
      state: structuredClone(original), persisted: JSON.stringify(original), puts: [], deleted: [], released: [], ensured: [], applied: 0,
      saveCalls: 0, mutations: 0, ended: 0, readbackCorrupted: false,
    };
    const manager = {
      isDataMediaUrl: value => typeof value === 'string' && value.startsWith('data:image/'),
      makeRef: id => `idb-media:${id}`,
      ensureRefs: async refs => { h.ensured.push([...refs]); return hydration; },
      release: id => h.released.push(id),
    };
    const context = {
      state: h.state,
      STORAGE_KEY: 'twodeers-main-state',
      window: { __duoCircleMedia: manager },
      localStorage: {
        getItem() {
          if (corruptReadback && h.saveCalls && !h.readbackCorrupted) {
            h.readbackCorrupted = true;
            return JSON.stringify({ media: {}, icons: {} });
          }
          return h.persisted;
        },
        setItem(_key, value) { h.persisted = value; },
        removeItem() { h.persisted = null; },
      },
      putMediaBlob: async (blob, kind, name) => {
        const id = `profile-created-${h.puts.length + 1}`;
        h.puts.push({ id, size: blob.size, kind, name });
        return id;
      },
      dataUrlToBlob: async value => new Blob([value], { type: 'image/png' }),
      save() {
        h.saveCalls += 1;
        if (saveResult === false) return false;
        h.persisted = JSON.stringify(context.state);
        return true;
      },
      applyProfileMediaToUi() { h.applied += 1; },
      deleteIfUnreferenced: async id => { h.deleted.push(id); return true; },
      console,
      Promise, Object, JSON, Set, Map, Array, String, Number, Math, Date, Blob,
    };
    context.window.__duoRuntimeCoordinator = {
      assertWritable() {},
      beginMutation() { h.mutations += 1; return () => { h.ended += 1; }; },
    };
    vm.createContext(context);
    vm.runInContext(`${profileRefs}\n${migration}\nglobalThis.runMigrateProfileMedia=migrateLegacyProfileMedia;`, context);
    return { context, h };
  }

  const success = buildMigrationHarness();
  const migrated = await success.context.runMigrateProfileMedia();
  assert.equal(migrated.migrated, 2, 'distinct old Data URLs should create exactly two media rows');
  assert.equal(success.h.puts.length, 2, 'reused avatar/background/icon data must be deduplicated');
  assert.equal(success.context.state.media['avatar-me'], success.context.state.media['bg-chat']);
  assert.equal(success.context.state.media['avatar-me'], success.context.state.icons['home-chat']);
  assert.notEqual(success.context.state.media['avatar-me'], success.context.state.media['avatar-other']);
  assert.equal(JSON.parse(success.h.persisted).icons['home-chat'], success.context.state.icons['home-chat']);
  assert.equal(success.h.applied, 1);
  assert.equal(success.h.mutations, 1);
  assert.equal(success.h.ended, 1);

  const saveFailure = buildMigrationHarness({ saveResult: false });
  await assert.rejects(saveFailure.context.runMigrateProfileMedia(), /主状态保存失败/);
  assert.deepEqual(JSON.parse(JSON.stringify(saveFailure.context.state)), {
    media: { 'avatar-me': 'data:image/png;base64,QUJD', 'avatar-other': 'data:image/png;base64,REVG', 'bg-chat': 'data:image/png;base64,QUJD' },
    icons: { 'home-chat': 'data:image/png;base64,QUJD', 'home-space': '' },
  });
  assert.deepEqual(saveFailure.h.deleted.sort(), ['profile-created-1', 'profile-created-2']);
  assert.deepEqual(saveFailure.h.released.sort(), ['profile-created-1', 'profile-created-2']);

  const readbackFailure = buildMigrationHarness({ hydration: { loaded: 1, missing: 1 } });
  await assert.rejects(readbackFailure.context.runMigrateProfileMedia(), /媒体回读失败/);
  assert.deepEqual(JSON.parse(JSON.stringify(readbackFailure.context.state)), {
    media: { 'avatar-me': 'data:image/png;base64,QUJD', 'avatar-other': 'data:image/png;base64,REVG', 'bg-chat': 'data:image/png;base64,QUJD' },
    icons: { 'home-chat': 'data:image/png;base64,QUJD', 'home-space': '' },
  });
  assert.equal(readbackFailure.h.saveCalls, 0, 'media readback must complete before changing persisted state');
  assert.equal(readbackFailure.h.deleted.length, 2);

  const stateReadbackFailure = buildMigrationHarness({ corruptReadback: true });
  await assert.rejects(stateReadbackFailure.context.runMigrateProfileMedia(), /状态回读不一致/);
  assert.equal(stateReadbackFailure.h.persisted, JSON.stringify({
    media: { 'avatar-me': 'data:image/png;base64,QUJD', 'avatar-other': 'data:image/png;base64,REVG', 'bg-chat': 'data:image/png;base64,QUJD' },
    icons: { 'home-chat': 'data:image/png;base64,QUJD', 'home-space': '' },
  }), 'a post-save readback mismatch must restore the exact old main-state JSON');
  assert.deepEqual(stateReadbackFailure.h.deleted.sort(), ['profile-created-1', 'profile-created-2']);
}

// Production profile-image writes must persist a Blob and prove read-back via
// the shared manager before replacing the prior Data URL/reference.
{
  const writer = slice(index, 'async function storeProfileImageDataUrl(', 'function blobToDataUrl(');
  let ensured = null;
  const deleted = [];
  const released = [];
  let ensureResult = { loaded: 1, missing: 0 };
  const context = {
    window: { __duoCircleMedia: {
      makeRef: id => `idb-media:${id}`,
      isDataMediaUrl: value => /^data:image\//.test(value),
      ensureRefs: async refs => { ensured = refs; return ensureResult; },
      resolve: ref => ensureResult.missing ? '' : `blob:resolved:${ref}`,
      release: id => released.push(id),
    } },
    dataUrlToBlob: async () => new Blob(['image-bytes'], { type: 'image/png' }),
    putMediaBlob: async () => 'new-profile-media',
    deleteIfUnreferenced: async id => { deleted.push(id); return true; },
    console,
    Promise, Blob,
  };
  vm.createContext(context);
  vm.runInContext(`${writer}\nglobalThis.runStoreProfileImage=storeProfileImageDataUrl;`, context);
  const stored = await context.runStoreProfileImage('data:image/png;base64,YWJj', 'avatar-me', 'avatar.png');
  assert.deepEqual({ id: stored.id, ref: stored.ref }, { id: 'new-profile-media', ref: 'idb-media:new-profile-media' });
  assert.deepEqual(Array.from(ensured), ['idb-media:new-profile-media']);

  ensureResult = { loaded: 0, missing: 1 };
  await assert.rejects(context.runStoreProfileImage('data:image/png;base64,YWJj', 'avatar-me', 'avatar.png'), /回读失败/);
  assert.ok(released.includes('new-profile-media'));
  assert.ok(deleted.includes('new-profile-media'));
}

// Reference collection must cover every state.media image slot and all custom
// home icons, deduplicate IDs, and reject malformed IDs.
{
  const fn = slice(index, 'function collectProfileMediaIds(', 'window.__duoProfileMediaRefs=');
  const context = { Set, Object, Array, String, window: {} };
  vm.createContext(context);
  vm.runInContext(`${fn}\nglobalThis.runCollectProfileRefs=collectProfileMediaIds;`, context);
  const refs = context.runCollectProfileRefs({
    media: { 'avatar-me': 'idb-media:shared', 'avatar-other': 'idb-media:other', 'bg-chat': 'idb-media:shared', 'home-cover': 'data:image/png;base64,YWJj' },
    icons: { 'home-chat': 'idb-media:icon-1', 'home-space': 'idb-media:invalid id' },
  });
  assert.deepEqual([...refs].sort(), ['icon-1', 'other', 'shared']);
}

// Beautify actions are transactional: a failed main-state save restores the
// prior selection and CSS class and never displays a success toast.
{
  const classList = () => {
    const values = new Set();
    return {
      add: value => values.add(value),
      remove: value => values.delete(value),
      contains: value => values.has(value),
      values,
    };
  };
  const chatList = { classList: classList() };
  const chatPage = { classList: classList() };
  const toasts = [];
  let saveResult = false;
  const preset = (id, name) => ({ id, name, category: '测试', css: `.msg-row.me .bubble{display:block}.msg-row.other .bubble{display:block}${'x'.repeat(400)}` });
  const context = {
    window: { DuoChatBeautifyPresets: [preset('preset-a', '方案 A'), preset('preset-b', '方案 B'), preset('ink-minimal', '简洁墨色')] },
    document: { readyState: 'loading', addEventListener() {}, querySelector(selector) { return selector === '#chatList' ? chatList : selector === '#chatPage' ? chatPage : null; } },
    state: { chatBeautifyPresetId: 'preset-b' },
    save() { return saveResult; },
    showToast(message) { toasts.push(message); },
    console,
  };
  vm.createContext(context);
  vm.runInContext(beautifyManager, context, { filename: 'chat-beautify-manager.js' });
  const api = context.window.DuoChatBeautify;
  assert.equal(api.apply('preset-a'), false);
  assert.equal(context.state.chatBeautifyPresetId, 'preset-b');
  assert.equal(chatList.classList.contains('duo-chat-beautify--preset-b'), true);
  assert.equal(chatList.classList.contains('duo-chat-beautify--preset-a'), false);
  assert.match(toasts.at(-1), /保存失败/);
  assert.doesNotMatch(toasts.join('\n'), /已应用聊天美化：方案 A/);

  saveResult = true;
  assert.equal(api.apply('preset-a'), true);
  assert.equal(context.state.chatBeautifyPresetId, 'preset-a');
  assert.equal(chatPage.classList.contains('duo-chat-beautify--preset-a'), true);
  saveResult = false;
  assert.equal(api.reset(), false);
  assert.equal(context.state.chatBeautifyPresetId, 'preset-a', 'failed reset must preserve previous preset');
  assert.equal(chatList.classList.contains('duo-chat-beautify--preset-a'), true);
  saveResult = true;
  assert.equal(api.reset(), true);
  assert.equal(context.state.chatBeautifyPresetId, '', 'successful reset persists default style');

  const legacyContext = {
    window: { DuoChatBeautifyPresets: [preset('ink-minimal', '简洁墨色')] },
    document: { readyState: 'loading', addEventListener() {}, querySelector(selector) { return selector === '#chatList' ? chatList : selector === '#chatPage' ? chatPage : null; } },
    state: { chatBeautifyPresetId: 'carbon-glass' },
    save() { return false; }, console: { warn() {} },
  };
  vm.createContext(legacyContext);
  vm.runInContext(beautifyManager, legacyContext, { filename: 'chat-beautify-manager-legacy.js' });
  assert.equal(legacyContext.window.DuoChatBeautify.getCurrent(), '', 'failed legacy migration must not claim the new preset is stored');
  assert.equal(legacyContext.state.chatBeautifyPresetId, 'carbon-glass');
}

// Wake-lock acquisition can race with end/pagehide. A late request must release
// its newly granted lock rather than resurrecting a lock after the call ended.
{
  const functions = slice(index, 'async function requestWakeLock(){', 'function formatDuration(');
  const sentinel = {
    released: false,
    releaseCalls: 0,
    listeners: [],
    addEventListener(_type, callback) { this.listeners.push(callback); },
    async release() { this.releaseCalls += 1; this.released = true; for (const fn of this.listeners) fn(); },
  };
  const context = {
    state: { call: { active: true, phase: 'active' } },
    document: { visibilityState: 'visible' },
    requestCount: 0,
    Promise, console,
  };
  vm.createContext(context);
  vm.runInContext(`const navigator={wakeLock:{request(){globalThis.requestCount += 1; return new Promise(resolve => { globalThis.resolveRequest = resolve; });}}};\nlet wakeLock=null;let wakeLockRequestToken=0;\n${functions}\nglobalThis.runRequestWakeLock=requestWakeLock;globalThis.runReleaseWakeLock=releaseWakeLock;`, context);
  const pending = context.runRequestWakeLock();
  await Promise.resolve();
  assert.equal(context.requestCount, 1);
  await context.runReleaseWakeLock();
  context.resolveRequest(sentinel);
  assert.equal(await pending, false);
  assert.equal(sentinel.released, true);
  assert.equal(sentinel.releaseCalls, 1);

  context.state.call.active = false;
  assert.equal(await context.runRequestWakeLock(), false);
  assert.equal(context.requestCount, 1, 'inactive calls must not request a Wake Lock');
}

// Simulation UI must not expose an inert mute button as though real audio were active.
assert.match(index, /class="call-simulation-label"[^>]*aria-label="模拟通话，无真实音视频流"/);
assert.doesNotMatch(index, /id="callMuteBtn"/);
assert.match(index, /id="callHangBtn"[^>]*aria-label="挂断"/);

console.log('PASS: Phase 36 profile media manager API and APNG/SVG contract; profile-image persistence read-back and rollback; profile media reference reachability; chat beautify save rollback and legacy migration failure; Wake Lock race-safe release; simulated-call UI no longer advertises inert mute control.');
