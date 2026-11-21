import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const backupSource = read('backup-v4.js');
const fontSource = read('custom-font-manager.js');
const circleSource = read('circle-media-manager.js');
const index = read('index.html');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function backupSandbox(waitGate) {
  const window = {
    __duoBackupV4Installed: false,
    __duoExportInProgress: false,
    __duoRestoreInProgress: false,
    __duoCircleMedia: { waitForMigration: () => waitGate.promise },
  };
  const document = {
    addEventListener() {},
    getElementById() { return null; },
    createElement() { throw new Error('injected-overlay-failure'); },
    body: { appendChild() {} },
  };
  const sandbox = {
    window, document, Blob, TextEncoder, TextDecoder, Uint8Array, Uint32Array,
    DataView, ArrayBuffer, Map, Set, Object, Number, Array, Date, Error, Math,
    Promise, URL, decodeURIComponent, encodeURIComponent, JSON, console,
  };
  vm.runInNewContext(backupSource, sandbox, { filename: 'backup-v4.js' });
  return { sandbox, window, api: window.__duoBackupV4 };
}

// The V4 manifest must identify each logical media/font record exactly once,
// and the logical ID must agree with its canonical archive path.
{
  const gate = deferred();
  const { api } = backupSandbox(gate);
  const valid = {
    resources: [
      { type: 'media', id: 'circle-media_1', kind: 'circle-image', path: 'media/circle-media_1.blob' },
      { type: 'font', id: 'font_1', format: 'woff2', path: 'fonts/font_1.woff2' },
    ],
  };
  const identities = api.validateManifestResourceIdentities(valid);
  assert.deepEqual(Array.from(identities.mediaIds), ['circle-media_1']);
  assert.deepEqual(Array.from(identities.fontIds), ['font_1']);
  assert.throws(() => api.validateManifestResourceIdentities({ resources: [
    { type: 'media', id: 'same-id', kind: 'chat-image', path: 'media/same-id.blob' },
    { type: 'media', id: 'same-id', kind: 'circle-image', path: 'media/same-id-copy.blob' },
  ] }), /重复媒体 ID/);
  assert.throws(() => api.validateManifestResourceIdentities({ resources: [
    { type: 'media', id: 'safe', kind: 'chat-image', path: 'media/other.blob' },
  ] }), /路径与 ID 不匹配/);
  assert.throws(() => api.validateManifestResourceIdentities({ resources: [
    { type: 'font', id: 'same-font', format: 'woff2', path: 'fonts/same-font.woff2' },
    { type: 'font', id: 'same-font', format: 'woff2', path: 'fonts/same-font-copy.woff2' },
  ] }), /重复字体 ID/);
  assert.throws(() => api.validateManifestResourceIdentities({ resources: [
    { type: 'font', id: 'font-unsafe', format: 'exe', path: 'fonts/font-unsafe.exe' },
  ] }), /字体格式无效/);

  const map = new Map([['fonts/font_1.woff2', { size: 12 }]]);
  const fontManifest = { resources: [{ type: 'font', id: 'font_1', format: 'woff2', path: 'fonts/font_1.woff2', size: 12 }], fontsCurrentId: 'font_1' };
  const fontMetadata = { currentFontId: 'font_1', fonts: [{ id: 'font_1', format: 'woff2', path: 'fonts/font_1.woff2', size: 12 }] };
  assert.equal(api.validateFontLibraryManifest(fontMetadata, fontManifest, map), true);
  assert.throws(() => api.validateFontLibraryManifest({ ...fontMetadata, fonts: [fontMetadata.fonts[0], fontMetadata.fonts[0]] }, fontManifest, map), /ID 无效或重复/);
  assert.throws(() => api.validateFontLibraryManifest(fontMetadata, { ...fontManifest, fontsCurrentId: null }, map), /当前字体与字体库文件不一致/);
  assert.throws(() => api.validateFontLibraryManifest({ currentFontId: 'missing', fonts: fontMetadata.fonts }, fontManifest, map), /当前字体 ID 不存在/);
  assert.throws(() => api.validateFontLibraryManifest({ currentFontId: 'font_1', fonts: [{ ...fontMetadata.fonts[0], size: 13 }] }, fontManifest, map), /元数据与 ZIP 资源不匹配/);
  assert.throws(() => api.validateFontLibraryManifest(fontMetadata, { resources: [], fontsCurrentId: 'font_1' }, map), /元数据与 ZIP 资源不匹配/);
}

// V4 export and restore acquire the shared global lock synchronously, before
// waiting for a Circle migration promise. This is the race the previous
// implementation had: two callers could both pass the guard during the wait.
{
  const gate = deferred();
  const { api, window } = backupSandbox(gate);
  const first = api.build('chat');
  assert.equal(window.__duoExportInProgress, true, 'export lock must be acquired before the first await');
  await assert.rejects(api.build('chat'), /已有备份导出或恢复任务/);
  await assert.rejects(api.restore(new Blob(['not-a-zip'])), /已有备份导出或恢复任务/);
  gate.resolve();
  await assert.rejects(first, /injected-overlay-failure/);
  assert.equal(window.__duoExportInProgress, false, 'export lock must release on setup failure');

  const restoreGate = deferred();
  const second = backupSandbox(restoreGate);
  const restore = second.api.restore(new Blob(['not-a-zip']));
  assert.equal(second.window.__duoRestoreInProgress, true, 'restore lock must be acquired before waiting for migration');
  await assert.rejects(second.api.restore(new Blob(['not-a-zip'])), /已有备份导出或恢复任务/);
  await assert.rejects(second.api.build('chat'), /已有备份导出或恢复任务/);
  restoreGate.resolve();
  await assert.rejects(restore, /injected-overlay-failure/);
  assert.equal(second.window.__duoRestoreInProgress, false, 'restore lock must release on setup failure');
}

// The legacy JSON entry points must use the same process-wide lock and acquire
// it before their first asynchronous migration/read. Circle-only payloads must
// go through CircleMediaManager.importBackup rather than direct setCircleState.
{
  const legacyBuildStart = index.indexOf('async function buildBackup(kind){');
  const legacyBuildLock = index.indexOf('legacyExportInProgress=true;window.__duoExportInProgress=true', legacyBuildStart);
  const legacyBuildWait = index.indexOf('await window.__duoCircleMedia?.waitForMigration?.()', legacyBuildStart);
  assert.ok(legacyBuildStart >= 0 && legacyBuildLock > legacyBuildStart && legacyBuildWait > legacyBuildLock, 'legacy export must lock before awaiting migration');

  const legacyRestoreStart = index.indexOf('async function applyBackupPayload(payload){');
  const legacyRestoreLock = index.indexOf('legacyRestoreInProgress=true;window.__duoRestoreInProgress=true', legacyRestoreStart);
  const legacyRestoreWait = index.indexOf('await window.__duoCircleMedia?.waitForMigration?.()', legacyRestoreStart);
  assert.ok(legacyRestoreStart >= 0 && legacyRestoreLock > legacyRestoreStart && legacyRestoreWait > legacyRestoreLock, 'legacy restore must lock before awaiting migration');
  assert.match(index, /if\(payload\?\.format==='twodeers-circle-backup'\)[\s\S]*?window\.__duoCircleMedia\.importBackup\(payload\)/);
  assert.match(index, /Legacy Circle-only state uses the same transaction and media rollback path/);
  const legacyRestoreEnd = index.indexOf('\nasync function downloadBackup(kind){', legacyRestoreStart);
  const legacyRestoreSource = index.slice(legacyRestoreStart, legacyRestoreEnd);
  const legacyJournalAt = legacyRestoreSource.indexOf('await coordinator.saveRecoveryJournal(journal)');
  const legacyApplyAt = legacyRestoreSource.indexOf('await applyBackupPayloadInternal(payload)');
  const legacyCommitAt = legacyRestoreSource.indexOf('await coordinator.markRecoveryCommitted()');
  const legacyCleanupAt = legacyRestoreSource.indexOf('cleanupReplacedMediaReferences(oldMediaReferences)');
  assert.ok(legacyJournalAt >= 0 && legacyJournalAt < legacyApplyAt, 'legacy JSON and Circle imports must persist a crash journal before any module writes');
  assert.ok(legacyApplyAt < legacyCommitAt && legacyCommitAt < legacyCleanupAt, 'legacy restore must commit only after module writes/read-back, before post-commit garbage collection');
  assert.match(legacyRestoreSource, /重复媒体 ID，已在写入前拒绝恢复/);
  assert.match(legacyRestoreSource, /setRecoveryBlocked\?\.\(/, 'incomplete legacy rollback must close the write gate and preserve the prepared journal');
  assert.match(backupSource, /journal\.kind/);
  assert.match(circleSource, /if\(\(window\.__duoRestoreInProgress&&!options\.allowRestore\)\|\|\(window\.__duoExportInProgress&&!options\.allowExport\)\)/);
  assert.match(circleSource, /async function importBackup\(payload\)/);
}

// After a successful restore, old media must be collected across the entire
// app, not only from Circle. Shared IDs still referenced by another module are
// retained; cleanup failures are reported but never turn a committed restore
// into a false rollback.
{
  const helperStart = index.indexOf('async function cleanupReplacedMediaReferences(previousIds){');
  const helperEnd = index.indexOf('\nfunction releaseChatMediaUrl(', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = index.slice(helperStart, helperEnd);
  const active = new Set(['shared-with-mailbox', 'still-used-by-circle']);
  const deleted = [], warnings = [];
  const harness = `
    const console={warn(...args){globalThis.warnings.push(args)}};
    globalThis.warnings=[];
    function latestPersistedMediaReferences(){return new Set(globalThis.active)}
    async function deleteIfUnreferenced(id){if(globalThis.active.has(id))return false;if(id==='cleanup-failure')throw new Error('IDB temporarily unavailable');globalThis.deleted.push(id);return true}
    ${helper}
    globalThis.run=cleanupReplacedMediaReferences;
  `;
  const context = { active, deleted, warnings };
  vm.runInNewContext(harness, context, { filename: 'cross-module-media-gc.js' });
  const result = await context.run(new Set(['old-chat-media', 'shared-with-mailbox', 'old-circle-media', 'cleanup-failure']));
  assert.equal(result.checked, 3);
  assert.equal(result.deleted, 2);
  assert.deepEqual(Array.from(context.deleted).sort(), ['old-chat-media', 'old-circle-media']);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].id, 'cleanup-failure');
  assert.equal(context.warnings.length, 1);
}

// Exercise the real public V4 restore entry point against a valid stored ZIP.
// Faults occur after the Circle/mailbox/card/font stores are mutated, and one
// late UI fault occurs after the primary localStorage commit. Every case must
// restore all previous modules rather than leaving a partially imported state.
{
  const encoder = new TextEncoder();
  const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    return c >>> 0;
  });
  const crc32 = bytes => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const write16 = (view, offset, value) => view.setUint16(offset, value, true);
  const write32 = (view, offset, value) => view.setUint32(offset, value, true);
  function makeParamArchive() {
    const raw = [
      ['state.json', { type: 'state', value: { state: { chatHistory: [], stickers: [], appearanceSettings: { mode: 'dark', palette: 'cream' }, offline: {}, icons: {}, media: {} } } }],
      ['circle-state.json', { type: 'circle-state', value: { myName: 'imported', posts: [], dynamicCards: [], replyCards: [] } }],
      ['mailbox-data.json', { type: 'mailbox-data', value: { mailbox: { items: [], pending: [], settings: { restored: true } } } }],
      ['card-system.json', { type: 'card-system', value: { chatIds: [], chatTexts: [], momentsDynamicIds: [], momentsDynamicTexts: [], momentsReplyIds: [], momentsReplyTexts: [], appliedEventIds: [] } }],
      ['font-library.json', { type: 'font-library', value: { currentFontId: 'new-font', fonts: [{ id: 'new-font', name: 'Imported', fileName: 'new-font.woff2', format: 'woff2', mimeType: 'font/woff2', size: 5, createdAt: 2, path: 'fonts/new-font.woff2' }] } }],
      ['fonts/new-font.woff2', { type: 'font', id: 'new-font', format: 'woff2', bytes: encoder.encode('newft') }],
      ['media/restore-media.blob', { type: 'media', id: 'restore-media', kind: 'chat-image', name: 'imported-media', bytes: encoder.encode('incoming-media') }],
    ];
    const entries = raw.map(([name, info]) => {
      const bytes = info.bytes || encoder.encode(JSON.stringify(info.value));
      const baseMeta = { path: name, type: info.type, size: bytes.length, crc32: crc32(bytes).toString(16).padStart(8, '0'), sha256: createHash('sha256').update(bytes).digest('hex') };
      const meta = info.type === 'media' ? { ...baseMeta, id: info.id, kind: info.kind, name: info.name || 'imported-media', mimeType: 'image/png' }
        : info.type === 'font' ? { ...baseMeta, id: info.id, format: info.format, mimeType: 'font/woff2' }
        : { ...baseMeta, mimeType: 'application/json' };
      return { name, bytes, meta };
    });
    const total = entries.reduce((sum, item) => sum + item.bytes.length, 0);
    const manifest = encoder.encode(JSON.stringify({
      format: 'twodeers-backup', formatVersion: 4, kind: 'all', createdAt: '2026-11-14T00:00:00.000Z',
      resourceCount: entries.length, totalResourceBytes: total, hashAlgorithm: 'SHA-256', checksumAlgorithm: 'CRC-32',
      compression: 'store', fontsCurrentId: 'new-font', resources: entries.map(item => item.meta),
    }));
    entries.push({ name: 'manifest.json', bytes: manifest, meta: null });
    const locals = [], centrals = [];
    let offset = 0;
    for (const entry of entries) {
      const name = encoder.encode(entry.name), crc = crc32(entry.bytes);
      const local = new Uint8Array(30), localView = new DataView(local.buffer);
      write32(localView, 0, 0x04034b50); write16(localView, 4, 20); write16(localView, 6, 0x0800); write16(localView, 8, 0);
      write16(localView, 10, 0); write16(localView, 12, 0x21); write32(localView, 14, crc); write32(localView, 18, entry.bytes.length);
      write32(localView, 22, entry.bytes.length); write16(localView, 26, name.length); write16(localView, 28, 0);
      locals.push(local, name, entry.bytes);
      const central = new Uint8Array(46), centralView = new DataView(central.buffer);
      write32(centralView, 0, 0x02014b50); write16(centralView, 4, 20); write16(centralView, 6, 20); write16(centralView, 8, 0x0800);
      write16(centralView, 10, 0); write16(centralView, 12, 0); write16(centralView, 14, 0x21); write32(centralView, 16, crc);
      write32(centralView, 20, entry.bytes.length); write32(centralView, 24, entry.bytes.length); write16(centralView, 28, name.length);
      write16(centralView, 30, 0); write16(centralView, 32, 0); write16(centralView, 34, 0); write16(centralView, 36, 0);
      write32(centralView, 38, 0); write32(centralView, 42, offset);
      centrals.push(central, name);
      offset += local.length + name.length + entry.bytes.length;
    }
    const centralBytes = centrals.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22), endView = new DataView(end.buffer);
    write32(endView, 0, 0x06054b50); write16(endView, 4, 0); write16(endView, 6, 0); write16(endView, 8, entries.length);
    write16(endView, 10, entries.length); write32(endView, 12, centralBytes); write32(endView, 16, offset); write16(endView, 20, 0);
    return new Blob([...locals, ...centrals, end], { type: 'application/zip' });
  }
  const archive = makeParamArchive();

  function restoreFixture(fault) {
    const clone = value => JSON.parse(JSON.stringify(value));
    let circle = { myName: 'original', posts: [], dynamicCards: [], replyCards: [] };
    let mailbox = { mailbox: { items: [{ id: 'old-letter' }], pending: [], settings: { old: true } } };
    let cards = { chatIds: ['old-card'], chatTexts: ['old'], momentsDynamicIds: [], momentsDynamicTexts: [], momentsReplyIds: [], momentsReplyTexts: [], appliedEventIds: [] };
    let fonts = { currentFontId: null, fonts: [] };
    let stickers = { version: 1, revision: 1, items: [{ id: 'old-sticker', mediaId: 'old-sticker-media' }], favorites: ['old-sticker'], tombstones: [] };
    let circleFaultUsed = false, moduleFaultUsed = false, uiFaultUsed = false, storageFaultUsed = false;
    const initialState = { appearanceSettings: { mode: 'light', palette: 'sage' }, chatHistory: [{ id: 'old-message' }], stickers: [{ id: 'old-sticker' }], offline: {}, icons: {}, media: {} };
    const state = clone(initialState);
    let recoveryJournal = null, blockedReason = '', fontImportCount = 0, cardImportCount = 0, mediaCleanupCalls = 0;
    const strictCalls = [];
    const storage = new Map([['mainState', JSON.stringify(initialState)]]);
    const mediaRecords = new Map([['restore-media', { id: 'restore-media', blob: new Blob(['original-media'], { type: 'image/png' }), kind: 'chat-image', mimeType: 'image/png', name: 'original-media', size: 14, createdAt: 1 }]]);
    const hasFault = name => String(fault || '').split('+').includes(name);
    const localStorage = {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) {
        storage.set(key, String(value));
        if (hasFault('main-persist') && !storageFaultUsed && key === 'mainState' && JSON.parse(String(value)).appearanceSettings?.mode === 'dark') {
          storageFaultUsed = true;
          throw new Error('injected-main-persist-failure');
        }
      },
      removeItem(key) { storage.delete(key); },
    };
    const failAfterMutation = name => {
      if (hasFault(name) && !moduleFaultUsed) { moduleFaultUsed = true; throw new Error('injected-' + name + '-failure'); }
    };
    const window = {
      __duoBackupV4Installed: false, __duoRestoreInProgress: false, __duoExportInProgress: false,
      __duoMediaTransactions: {
        async assertStrictDurability() { strictCalls.push('media-preflight'); if (hasFault('media-strict-preflight')) throw new Error('injected-media-strict-preflight-failure'); return true; },
        beginStrictWrite(db, operation) { strictCalls.push('media-strict-write:' + operation); return db.transaction('media', 'readwrite', { durability: 'strict' }); },
      },
      __duoRuntimeCoordinator: {
        journalId: 'v4-restore-active', isWritable: () => !blockedReason, getStatus: () => ({ writable: !blockedReason, blocked: !!blockedReason }), assertWritable() {},
        async saveRecoveryJournal(record) { recoveryJournal = record; if (hasFault('journal-save-readback')) throw new Error('injected-journal-save-readback-failure'); },
        async readRecoveryJournal() { return recoveryJournal; },
        async markRecoveryCommitted() { if (!recoveryJournal) throw new Error('no journal'); recoveryJournal = { ...recoveryJournal, phase: 'committed', committedAt: Date.now() }; if (hasFault('commit-readback-uncertain')) { const error = new Error('injected-committed-marker-readback-failure'); error.journalCommitUncertain = true; throw error; } },
        async clearRecoveryJournal() { if (hasFault('journal-clear-rollback')) throw new Error('injected-journal-clear-failure'); recoveryJournal = null; },
        setRecoveryBlocked(reason) { blockedReason = typeof reason === 'string' ? reason : (reason?.message || String(reason)); },
      },
      __duoCircleApi: { validateState(value) { if (!Array.isArray(value.posts)) throw new Error('bad circle'); }, pauseTasks() {}, resumeTasks() {} },
      __duoCircleMedia: {
        waitForMigration: async () => {}, ensure: async () => ({ loaded: 0, missing: 0 }), invalidate() {},
        collectIdsFromState: () => new Set(), resolve: () => true, makeRef: id => 'idb-media:' + id,
      },
      __duoStickerState: {
        exportSnapshot: () => clone(stickers), applyImportedState(items, favorites, tombstones) { stickers = { items: clone(items || []), favorites: clone(favorites || []), tombstones: clone(tombstones || []) }; },
        restoreSnapshot(value) { stickers = clone(value); },
      },
      __duoStickerLibrary: { invalidate() {} },
      __duoMailbox: {
        pauseTasks() {}, resumeTasks() {}, exportData: () => clone(mailbox),
        validateData(value) { const source=value?.mailbox||value; if(!source||typeof source!=='object'||!Array.isArray(source.items)||!Array.isArray(source.pending)) throw new Error('信箱恢复快照结构无效'); return true; },
        importData(value) { if (hasFault('mailbox-recovery-false')) return false; mailbox = clone(value); failAfterMutation('mailbox'); return true; },
      },
      __duoCardSystem: {
        exportData: () => clone(cards),
        validateData(value) { if(!value||!Array.isArray(value.chatIds)||!Array.isArray(value.chatTexts)||value.chatIds.length!==value.chatTexts.length||new Set(value.chatIds).size!==value.chatIds.length) throw new Error('字卡恢复快照 ID/文本不一致'); return true; },
        importData(value) { cardImportCount++; if (hasFault('card-recovery-false')) return false; if (hasFault('card-rollback') && cardImportCount > 1) throw new Error('injected-card-rollback-failure'); cards = clone(value); failAfterMutation('card'); return true; },
      },
      ChuanXunFontManager: {
        exportData: () => clone(fonts),
        async assertImportDurability() { strictCalls.push('font-preflight'); if (hasFault('font-strict-preflight')) throw new Error('injected-font-strict-preflight-failure'); return true; },
        async validateData(value) { if(!value||!Array.isArray(value.fonts)||value.fonts.length>500) throw new Error('字体恢复快照结构无效'); const ids=new Set(value.fonts.map(item=>item?.id)); if(ids.size!==value.fonts.length||(value.currentFontId&&!ids.has(value.currentFontId))) throw new Error('字体恢复快照 ID 无效'); return true; },
        importData(value, options) { strictCalls.push({ type:'font-import', durability:options?.durability || 'default' }); fontImportCount++; if (hasFault('font-rollback') && fontImportCount > 1) throw new Error('injected-font-rollback-failure'); fonts = clone(value); failAfterMutation('font'); return true; },
        _fontSnapshotSignature(value) { return JSON.stringify({ currentFontId: value.currentFontId || null, fonts: (value.fonts || []).map(item => ({ id: item.id, size: item.size, format: item.format, fileName: item.fileName })).sort((a,b) => a.id.localeCompare(b.id)) }); },
      },
      DuoAppearance: { apply() {} },
    };
    const overlay = { style: {}, remove() {} };
    const document = { addEventListener() {}, getElementById() { return null; }, createElement() { return overlay; }, body: { appendChild() {} } };
    const context = {
      window, document, localStorage, state, STORAGE_KEY: 'mainState', Blob, TextEncoder, TextDecoder, Uint8Array, Uint32Array,
      DataView, ArrayBuffer, Map, Set, Object, Number, Array, Date, Error, Math, Promise, URL, JSON, console,
      mediaUrlCache: new Map(), mediaLoadFailed: new Set(), stickerObjectUrls: new Set(), mediaLoadGeneration: 0,
      callTimerHandle: null, MEDIA_STORE_NAME: 'media',
      latestPersistedMediaReferences() { return new Set(['restore-media']); }, cleanupReplacedMediaReferences: async () => { mediaCleanupCalls++; return { errors: [] }; },
      getCircleState() { return clone(circle); },
      setCircleState(value) { circle = clone(value); if (hasFault('circle') && !circleFaultUsed && value.myName === 'imported') { circleFaultUsed = true; throw new Error('injected-circle-failure'); } },
      normalizeIncomingCallSettings(value) { return value || {}; }, ensureChatState() { if (!Array.isArray(state.chatHistory)) state.chatHistory = []; },
      cancelPendingReplies() {}, clearIncomingRingTimer() {}, clearIncomingSchedule() {}, clearInterval() {},
      init() { if (hasFault('ui') && !uiFaultUsed && state.appearanceSettings?.mode === 'dark') { uiFaultUsed = true; throw new Error('injected-ui-failure'); } },
      renderStickerList() {}, loadMessageMedia() {}, showToast() {},
      openMediaDB: async () => ({ transaction(...args) { strictCalls.push({ type:'media-transaction', args }); const tx = { durability:args[2]?.durability || 'default', objectStore() { return { put(record) { if (hasFault('media-rollback') && record.name === 'original-media') throw new Error('injected-media-rollback-failure'); mediaRecords.set(record.id, record); }, delete(id) { mediaRecords.delete(id); } }; } }; Object.defineProperty(tx, 'oncomplete', { set(fn) { Promise.resolve().then(() => fn?.()); } }); return tx; } }),
      deleteMediaRecord: async id => { mediaRecords.delete(id); },
      getMediaRecord: async id => mediaRecords.get(id) || null,
      putMediaBlob: async (blob, kind, name, id, options) => { strictCalls.push({ type:'media-put', durability:options?.durability || 'default' }); mediaRecords.set(id, { id, blob, kind, mimeType: blob.type || 'application/octet-stream', name: name || '', size: blob.size || 0, createdAt: Date.now() }); },
    };
    vm.runInNewContext(backupSource, context, { filename: 'backup-v4-restore-integration.js' });
    return {
      api: window.__duoBackupV4, window, getStrictCalls() { return strictCalls.slice(); }, getRecoveryJournal() { return recoveryJournal; }, setRecoveryJournal(value) { recoveryJournal = value; }, isBlocked() { return !!blockedReason; }, getMediaCleanupCalls() { return mediaCleanupCalls; }, getMediaRecord(id) { return mediaRecords.get(id) || null; }, simulatePartialImport() {
        state.appearanceSettings = { mode: 'dark', palette: 'cream' }; state.chatHistory = [{ id: 'imported-message' }];
        circle = { myName: 'imported', posts: [], dynamicCards: [], replyCards: [] };
        mailbox = { mailbox: { items: [{ id: 'imported-letter' }], pending: [], settings: { restored: true } } };
        cards = { ...cards, chatTexts: ['imported-card'] }; fonts = { currentFontId: 'new-font', fonts: [] };
        stickers = { items: [{ id: 'new-sticker' }], favorites: [], tombstones: [] };
        storage.set('mainState', JSON.stringify(state));
      }, snapshot() {
        return {
          state: clone(state), storage: storage.get('mainState'), circle: clone(circle), mailbox: clone(mailbox),
          cards: clone(cards), fonts: clone(fonts), stickers: clone(stickers), media: [...mediaRecords.values()].map(item => ({ id: item.id, name: item.name, size: item.size, type: item.blob?.type })),
        };
      },
      original: {
        state: clone(initialState), storage: JSON.stringify(initialState), circle: { myName: 'original', posts: [], dynamicCards: [], replyCards: [] },
        mailbox: { mailbox: { items: [{ id: 'old-letter' }], pending: [], settings: { old: true } } },
        cards: { chatIds: ['old-card'], chatTexts: ['old'], momentsDynamicIds: [], momentsDynamicTexts: [], momentsReplyIds: [], momentsReplyTexts: [], appliedEventIds: [] },
        fonts: { currentFontId: null, fonts: [] }, stickers: { version: 1, revision: 1, items: [{ id: 'old-sticker', mediaId: 'old-sticker-media' }], favorites: ['old-sticker'], tombstones: [] },
      },
    };
  }

  // Both independent databases must acknowledge strict durability before PREPARED or any business write.
  for (const fault of ['media-strict-preflight', 'font-strict-preflight']) {
    const fixture = restoreFixture(fault);
    const before = fixture.snapshot();
    await assert.rejects(fixture.api.restore(archive), new RegExp('injected-' + fault + '-failure'));
    assert.deepEqual(fixture.snapshot(), before, `${fault}: strict durability preflight must happen before every business mutation`);
    assert.equal(fixture.getRecoveryJournal(), null, `${fault}: PREPARED must not be written when database durability cannot be confirmed`);
    assert.equal(fixture.getMediaRecord('restore-media')?.name, 'original-media', `${fault}: the old media record must remain untouched`);
    assert.equal(fixture.isBlocked(), false, `${fault}: with no PREPARED journal and no data mutation, the current page need not be recovery-locked`);
    assert.deepEqual(fixture.getStrictCalls().filter(item => typeof item === 'string'), fault === 'media-strict-preflight' ? ['media-preflight'] : ['media-preflight', 'font-preflight']);
  }

  const committed = restoreFixture(null);
  assert.equal(await committed.api.restore(archive), true);
  assert.equal(committed.snapshot().state.appearanceSettings.mode, 'dark');
  assert.equal(committed.snapshot().circle.myName, 'imported');
  assert.equal(committed.snapshot().mailbox.mailbox.settings.restored, true);
  assert.equal(committed.snapshot().cards.chatTexts.length, 0);
  assert.equal(committed.getRecoveryJournal(), null, 'successful restore must clear the durable recovery journal');
  assert.ok(committed.getStrictCalls().some(item => item.type === 'media-put' && item.durability === 'strict'), 'V4 media writes must pass strict durability');
  assert.ok(committed.getStrictCalls().some(item => item.type === 'font-import' && item.durability === 'strict'), 'V4 font import must pass strict durability');

  for (const fault of ['circle', 'mailbox', 'card', 'font', 'main-persist', 'ui']) {
    const fixture = restoreFixture(fault);
    await assert.rejects(fixture.api.restore(archive), new RegExp('injected-' + fault + '-failure'));
    const after = fixture.snapshot();
    for (const key of ['state', 'storage', 'circle', 'mailbox', 'cards', 'fonts', 'stickers']) {
      assert.deepEqual(after[key], fixture.original[key], `${fault} fault must roll ${key} back to the pre-restore snapshot`);
    }
    assert.equal(fixture.window.__duoRestoreInProgress, false, `${fault} failure must release the global restore lock`);
    assert.equal(fixture.getRecoveryJournal(), null, `${fault} failure with successful rollback must clear the prepared recovery journal`);
  }

  const crashed = restoreFixture(null);
  crashed.setRecoveryJournal({ id: 'v4-restore-active', formatVersion: 1, phase: 'prepared', createdAt: Date.now(), kind: 'all', oldState: JSON.stringify(crashed.original.state), oldStorage: crashed.original.storage, oldStickerLibrary: crashed.original.stickers, oldCircle: crashed.original.circle, oldFonts: crashed.original.fonts, oldMailbox: crashed.original.mailbox, oldCards: crashed.original.cards, oldMedia: [] });
  crashed.simulatePartialImport();
  const recovered = await crashed.api.recoverInterruptedRestore();
  assert.equal(recovered.recovered, true, 'startup recovery must roll back a durable prepared journal after abrupt termination');
  const afterCrashRecovery = crashed.snapshot();
  for (const key of ['state', 'storage', 'circle', 'mailbox', 'cards', 'fonts', 'stickers']) assert.deepEqual(afterCrashRecovery[key], crashed.original[key], `crash recovery must restore ${key}`);
  assert.equal(crashed.getRecoveryJournal(), null, 'successful startup rollback must clear the journal');

  // Invalid auxiliary snapshots must be rejected before the first rollback
  // write. Otherwise a bad font/mailbox/card snapshot could restore main state
  // and only then fail, leaving a partially recovered profile permanently locked.
  const invalidJournalCases = [
    ['font pointer', journal => { journal.oldFonts = { currentFontId: 'missing-font', fonts: [] }; }],
    ['mailbox arrays', journal => { journal.oldMailbox = { mailbox: { items: 'not-an-array', pending: [] } }; }],
    ['card ID alignment', journal => { journal.oldCards = { chatIds: ['same', 'same'], chatTexts: ['one', 'two'] }; }],
    ['sticker favorites', journal => { journal.oldStickerLibrary = { version: 1, revision: 1, items: [{ id: 'old-sticker', mediaId: 'old-media' }], tombstones: [], favorites: ['missing'] }; }],
    ['duplicate media IDs', journal => { journal.oldMedia = [['duplicate', null], ['duplicate', null]]; }],
  ];
  for (const [label, corrupt] of invalidJournalCases) {
    const fixture = restoreFixture(null);
    const journal = { id: 'v4-restore-active', formatVersion: 1, phase: 'prepared', createdAt: Date.now(), kind: 'all', oldState: JSON.stringify(fixture.original.state), oldStorage: fixture.original.storage, oldStickerLibrary: fixture.original.stickers, oldCircle: fixture.original.circle, oldFonts: fixture.original.fonts, oldMailbox: fixture.original.mailbox, oldCards: fixture.original.cards, oldMedia: [] };
    corrupt(journal);
    fixture.setRecoveryJournal(journal);
    fixture.simulatePartialImport();
    const beforePreflight = fixture.snapshot();
    await assert.rejects(fixture.api.recoverInterruptedRestore(), /恢复日志|字体|信箱|字卡/);
    assert.deepEqual(fixture.snapshot(), beforePreflight, `${label}: invalid journal must be rejected before mutating any restored module`);
    assert.equal(fixture.getRecoveryJournal()?.phase, 'prepared', `${label}: invalid journal must remain available for diagnosis`);
  }

  // Startup retry must also preflight every database before the first rollback write.
  for (const fault of ['media-strict-preflight', 'font-strict-preflight']) {
    const fixture = restoreFixture(fault);
    const oldMedia = fault === 'media-strict-preflight' ? [['restore-media', fixture.getMediaRecord('restore-media')]] : [];
    fixture.setRecoveryJournal({
      id: 'v4-restore-active', formatVersion: 1, phase: 'prepared', createdAt: Date.now(), kind: 'all',
      oldState: JSON.stringify(fixture.original.state), oldStorage: fixture.original.storage,
      oldStickerLibrary: fixture.original.stickers, oldCircle: fixture.original.circle,
      oldFonts: fixture.original.fonts, oldMailbox: fixture.original.mailbox, oldCards: fixture.original.cards, oldMedia,
    });
    fixture.simulatePartialImport();
    const beforeStartupPreflight = fixture.snapshot();
    await assert.rejects(fixture.api.recoverInterruptedRestore(), new RegExp('injected-' + fault + '-failure'));
    assert.deepEqual(fixture.snapshot(), beforeStartupPreflight, `${fault}: startup strict preflight must stop before any rollback mutation`);
    assert.equal(fixture.getRecoveryJournal()?.phase, 'prepared', `${fault}: startup must retain PREPARED so a compatible browser can retry`);
    assert.equal(fixture.isBlocked(), false, `${fault}: the isolated recovery helper rejects before mutation; the application startup catch owns the page-level fence`);
    const preflights = fixture.getStrictCalls().filter(item => typeof item === 'string');
    assert.deepEqual(preflights, fault === 'media-strict-preflight' ? ['media-preflight'] : ['font-preflight']);
  }

  const alreadyCommitted = restoreFixture(null);
  alreadyCommitted.setRecoveryJournal({ id: 'v4-restore-active', formatVersion: 1, phase: 'committed', createdAt: Date.now(), kind: 'all', oldState: JSON.stringify(alreadyCommitted.original.state), oldStorage: alreadyCommitted.original.storage, oldMedia: [] });
  const committedRecovery = await alreadyCommitted.api.recoverInterruptedRestore();
  assert.equal(committedRecovery.committedCleanup, true, 'a committed journal must be cleaned without rolling back the new state');
  assert.equal(alreadyCommitted.getRecoveryJournal(), null);

  // A journal write can commit and then fail its read-back verification. The
  // restore must not continue into destructive writes, and the current page
  // must be fenced because the PREPARED record may already be durable.
  const journalUncertain = restoreFixture('journal-save-readback');
  const beforeUncertainJournal = journalUncertain.snapshot();
  await assert.rejects(journalUncertain.api.restore(archive), /日志写入\/回读结果不确定/);
  assert.deepEqual(journalUncertain.snapshot(), beforeUncertainJournal, 'uncertain journal creation must stop before module mutation');
  assert.equal(journalUncertain.getRecoveryJournal()?.phase, 'prepared', 'a journal that may have committed must be retained');
  assert.equal(journalUncertain.isBlocked(), true, 'uncertain journal creation must lock the current page');

  // If the import fails and rollback itself cannot restore both media and font
  // snapshots, the PREPARED journal must remain and the page must be blocked.
  const combinedRollbackFailure = restoreFixture('ui+media-rollback+font-rollback');
  await assert.rejects(combinedRollbackFailure.api.restore(archive), /回滚未完全通过/);
  assert.equal(combinedRollbackFailure.getRecoveryJournal()?.phase, 'prepared');
  assert.equal(combinedRollbackFailure.isBlocked(), true, 'incomplete multi-store rollback must permanently close the current write gate');
  assert.equal(combinedRollbackFailure.getMediaRecord('restore-media')?.name, 'imported-media', 'failed media rollback must be visible as unresolved rather than falsely reported as restored');
  assert.equal(combinedRollbackFailure.snapshot().fonts?.fonts?.[0]?.id, 'new-font', 'failed font rollback must remain explicitly unresolved under the retained journal');

  // Even when all business stores roll back successfully, failure to clear the
  // PREPARED journal must prevent this page from accepting new writes. Otherwise
  // startup would replay the old snapshot over those later writes.
  const journalCleanupFailure = restoreFixture('ui+journal-clear-rollback');
  const rolledBackOriginal = journalCleanupFailure.original;
  await assert.rejects(journalCleanupFailure.api.restore(archive), /PREPARED 保护日志未能确认清理/);
  const afterCleanupFailure = journalCleanupFailure.snapshot();
  for (const key of ['state', 'storage', 'circle', 'mailbox', 'cards', 'stickers']) assert.deepEqual(afterCleanupFailure[key], rolledBackOriginal[key], `journal cleanup failure still rolls ${key} back`);
  assert.equal(journalCleanupFailure.getRecoveryJournal()?.phase, 'prepared');
  assert.equal(journalCleanupFailure.isBlocked(), true, 'a retained PREPARED journal after rollback must lock the page');

  // Once the strict COMMITTED write transaction completes, a failed read-back
  // makes the marker state ambiguous. The restore must fence the page rather
  // than run an opposite rollback which could conflict with a durable COMMITTED.
  const commitReadbackUncertain = restoreFixture('commit-readback-uncertain');
  await assert.rejects(commitReadbackUncertain.api.restore(archive), /COMMITTED 恢复标记的持久提交状态无法确认/);
  assert.equal(commitReadbackUncertain.getRecoveryJournal()?.phase, 'committed');
  assert.equal(commitReadbackUncertain.isBlocked(), true, 'uncertain COMMITTED read-back must permanently close the page write gate');
  assert.equal(commitReadbackUncertain.snapshot().state.appearanceSettings.mode, 'dark', 'ambiguous COMMITTED result must not trigger an opposite business rollback');
  assert.equal(commitReadbackUncertain.getMediaRecord('restore-media')?.name, 'imported-media', 'new media remains intact until COMMITTED status is resolved on startup');
  assert.equal(commitReadbackUncertain.getMediaCleanupCalls(), 0, 'old media garbage collection must not run while COMMITTED read-back is uncertain');

  // Startup recovery must reject an importer that silently reports false and
  // preserve the journal; outer startup code must not treat it as recovered.
  const recoveryImportRejected = restoreFixture('mailbox-recovery-false');
  recoveryImportRejected.setRecoveryJournal({ id: 'v4-restore-active', formatVersion: 1, phase: 'prepared', createdAt: Date.now(), kind: 'all', oldState: JSON.stringify(recoveryImportRejected.original.state), oldStorage: recoveryImportRejected.original.storage, oldStickerLibrary: recoveryImportRejected.original.stickers, oldCircle: recoveryImportRejected.original.circle, oldFonts: recoveryImportRejected.original.fonts, oldMailbox: recoveryImportRejected.original.mailbox, oldCards: recoveryImportRejected.original.cards, oldMedia: [['restore-media', null]] });
  recoveryImportRejected.simulatePartialImport();
  await assert.rejects(recoveryImportRejected.api.recoverInterruptedRestore(), /自动回滚未能完成/);
  assert.equal(recoveryImportRejected.getRecoveryJournal()?.phase, 'prepared');
  assert.equal(recoveryImportRejected.isBlocked(), true, 'a failed startup recovery attempt must explicitly lock its coordinator');
}

// The restore transaction must mark each module as potentially changed before
// invoking its importer: a module may mutate its storage and then reject.
{
  const restoreStart = backupSource.indexOf('async function restoreV4Internal(blob)');
  const restoreEnd = backupSource.indexOf('\n  let restoreInProgress=false;', restoreStart);
  const restoreBody = backupSource.slice(restoreStart, restoreEnd);
  for (const [flag, call] of [
    ['circleWritten=true;', 'setCircleState('],
    ['mailboxWritten=true;', 'window.__duoMailbox.importData('],
    ['cardsWritten=true;', 'window.__duoCardSystem.importData('],
    ['fontsWritten=true;', 'window.ChuanXunFontManager.importData('],
  ]) {
    const flagAt = restoreBody.indexOf(flag);
    const callAt = restoreBody.indexOf(call);
    assert.ok(flagAt >= 0 && callAt > flagAt, `${flag} must precede ${call}`);
  }
  assert.match(restoreBody, /circleLoad\?\.stale\|\|circleLoad\?\.missing/);
  assert.match(restoreBody, /朋友圈媒体恢复后回读失败/);
  assert.match(restoreBody, /rollbackErrors/);
  assert.match(restoreBody, /cleanupReplacedMediaReferences\(oldMediaReferences\)/);
  assert.match(index, /cleanupReplacedMediaReferences\(oldMediaReferences\)/);
}

// Font import validates all IDs and binaries before replacement, verifies the
// new selection can actually be applied, then restores the old DB snapshot if
// the post-write FontFace/application step fails.
{
  const restoreStart = fontSource.indexOf('  function restoreCurrent(options) {');
  const restoreEnd = fontSource.indexOf('\n  function saveFontRecord(', restoreStart);
  const validationStart = fontSource.indexOf('  function validateFontData(payload, requireFontsArray) {');
  const signatureStart = fontSource.indexOf('  function fontSnapshotSignature(snapshot) {');
  const importStart = fontSource.indexOf('  function importData(payload, options) {');
  const apiStart = fontSource.indexOf('\n\n  var api = {', importStart);
  assert.ok(restoreStart >= 0 && restoreEnd > restoreStart && signatureStart >= 0 && validationStart > signatureStart && importStart > validationStart && apiStart > importStart);
  const strictRestore = fontSource.slice(restoreStart, restoreEnd).replace(/^  /gm, '');
  const signature = fontSource.slice(signatureStart, validationStart).replace(/^  /gm, '');
  const validationHelper = fontSource.slice(validationStart, importStart).replace(/^  /gm, '');
  const importData = fontSource.slice(importStart, apiStart).replace(/^  /gm, '');

  const missingFontHarness = `
    const CURRENT_KEY='current';
    const global={document:{documentElement:{classList:{contains(){return false}}}}};
    function error(message){return new Error(message)}
    function getMeta(){return Promise.resolve('missing-font')}
    function getFont(){return Promise.resolve(null)}
    function refreshUi(){}
    function restoreCssDefault(){}
    function setCurrentId(){return Promise.resolve()}
    ${strictRestore}
    globalThis.run=()=>restoreCurrent({throwOnError:true});
  `;
  const missingFont = {};
  vm.runInNewContext(missingFontHarness, missingFont, { filename: 'font-strict-current-restore.js' });
  await assert.rejects(missingFont.run(), /当前字体记录不存在/);

  const transactionHarness = `
    const MAX_FILE_SIZE=50*1024*1024;
    const MIME_BY_FORMAT={woff2:'font/woff2'};
    const global={document:{fonts:{delete(){}}}};
    let activeFontId='old-font', failReapplyOnce=false, rejectFontFaceValidation=false, writes=0, refreshes=0;
    let snapshot={currentFontId:'old-font',fonts:[{id:'old-font',name:'旧字体',fileName:'old.woff2',format:'woff2',size:5,blob:new Blob(['old!!']),createdAt:1}]};
    function error(message){return new Error(message)}
    function beginFontMutation(){return function(){}}
    function detectFormat(){return 'woff2'}
    function buildFontFace(record){return rejectFontFaceValidation?Promise.reject(error('模拟字体二进制解析失败')):Promise.resolve({face:{id:record.id}})}
    function exportData(){return Promise.resolve({currentFontId:snapshot.currentFontId,fonts:snapshot.fonts.map(item=>({...item}))})}
    function writeFontSnapshot(next){writes++;snapshot={currentFontId:next.currentFontId,fonts:next.fonts.map(item=>({...item}))};return Promise.resolve()}
    function restoreCurrent(options){if(options?.throwOnError&&failReapplyOnce){failReapplyOnce=false;return Promise.reject(error('模拟 FontFace 应用失败'))}return Promise.resolve(true)}
    function refreshUi(){refreshes++}
    ${signature}
    ${validationHelper}
    ${importData}
    globalThis.setFailure=()=>{failReapplyOnce=true;writes=0;refreshes=0};
    globalThis.rejectValidation=()=>{rejectFontFaceValidation=true};
    globalThis.allowValidation=()=>{rejectFontFaceValidation=false};
    globalThis.run=importData;
    globalThis.validate=validateData;
    globalThis.snapshot=()=>({currentFontId:snapshot.currentFontId,ids:snapshot.fonts.map(item=>item.id),writes,refreshes});
  `;
  const transaction = { Blob };
  vm.runInNewContext(transactionHarness, transaction, { filename: 'font-import-transaction.js' });
  const importedBlob = new Blob(['new-font-bytes']);
  const validFont = { id: 'new-font', name: '新字体', fileName: 'new.woff2', format: 'woff2', size: importedBlob.size, blob: importedBlob, createdAt: 2 };
  assert.equal(await transaction.validate({ currentFontId: 'new-font', fonts: [validFont] }), true, 'crash recovery font preflight must validate a complete snapshot without writing');
  assert.equal(transaction.snapshot().writes, 0, 'font preflight must not mutate the database');
  transaction.rejectValidation();
  await assert.rejects(transaction.validate({ currentFontId: 'new-font', fonts: [validFont] }), /字体二进制解析失败/, 'invalid font bytes must fail preflight before any other module is rolled back');
  assert.equal(transaction.snapshot().writes, 0, 'failed font preflight must remain read-only');
  transaction.allowValidation();
  await assert.rejects(transaction.validate({ currentFontId: 'missing-font', fonts: [validFont] }), /当前字体 ID 不存在/);
  await assert.rejects(transaction.validate({ currentFontId: null }), /缺少字体文件清单/);
  await assert.rejects(transaction.run({ currentFontId: 'new-font', fonts: [validFont, validFont] }, { replace: true }), /ID 无效或重复/);
  await assert.rejects(transaction.run({ currentFontId: 'not-in-list', fonts: [validFont] }, { replace: true }), /当前字体 ID 不存在/);
  transaction.setFailure();
  await assert.rejects(transaction.run({ currentFontId: 'new-font', fonts: [validFont] }, { replace: true }), /模拟 FontFace 应用失败/);
  const afterRollback = transaction.snapshot();
  assert.equal(afterRollback.currentFontId, 'old-font');
  assert.deepEqual(Array.from(afterRollback.ids), ['old-font']);
  assert.equal(afterRollback.writes, 2, 'failed FontFace reapply must write the imported snapshot then restore the old snapshot');
  await transaction.run({ currentFontId: 'new-font', fonts: [validFont] }, { replace: true });
  const afterSuccess = transaction.snapshot();
  assert.equal(afterSuccess.currentFontId, 'new-font');
  assert.deepEqual(Array.from(afterSuccess.ids), ['new-font']);
  assert.equal(afterSuccess.refreshes, 1);
  // Preserve legacy imports which historically omitted the optional fonts list.
  await transaction.run({ currentFontId: null }, { replace: true });
  assert.deepEqual(Array.from(transaction.snapshot().ids), [], 'legacy font imports without a fonts array must retain their previous empty-list behavior');
}

// Ensure the verifier itself owns this test so local and CI entry points use
// the same acceptance contract.
const verifier = read('tools/verify-twodeers-hardening.mjs');
assert.match(verifier, /tests\/phase28-restore-combined-failures\.test\.mjs/);
console.log('PASS: V4 media/font identity uniqueness and canonical paths; ZIP/font metadata alignment; export/restore lock acquisition before migration waits; shared legacy/V4 lock; Circle import transaction routing; module rollback flags; font selection strict restore and import rollback after FontFace failure; startup journal auxiliary-snapshot preflight rejects malformed fonts/mailbox/cards/stickers/media before any rollback write; full V4 ZIP restore fault-injection rollback across Circle/mailbox/cards/fonts/state/stickers; post-commit global media reachability cleanup; Phase 28 ambiguous PREPARED/COMMITTED markers, combined media/font rollback, journal-cleanup fencing and no-GC-before-commit confirmation; Phase 31 media/font strict-preflight refusal before PREPARED and startup rollback writes.');
