import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const managerSource = fs.readFileSync(path.join(root, 'circle-media-manager.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const backupV4 = fs.readFileSync(path.join(root, 'backup-v4.js'), 'utf8');

const records = new Map();
const externalRefs = new Set();
let circleState = {
  myAvatar: 'data:image/png;base64,AAECAw==',
  otherAvatar: '',
  myCover: '',
  otherCover: '',
  posts: [
    { id: 'p1', media: [{ id: 'm1', type: 'image', src: 'data:image/png;base64,AAECAw==' }] },
    { id: 'p2', media: [{ id: 'm2', type: 'image', src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==' }] },
  ],
  dynamicCards: [],
  replyCards: [],
};
let idCounter = 0;
let importShouldFail = false;
let refreshCount = 0;
const revoked = [];
const fakeUrl = {
  createObjectURL(blob) { return `blob:circle-${++idCounter}-${blob.size}`; },
  revokeObjectURL(url) { revoked.push(url); },
};
class TestFileReader {
  async readAsDataURL(blob) {
    try {
      const bytes = Buffer.from(await blob.arrayBuffer());
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${bytes.toString('base64')}`;
      this.onload?.();
    } catch (error) {
      this.error = error;
      this.onerror?.();
    }
  }
}
const hostAttributes = new Map();
const circleHost = {
  style: { pointerEvents: '' },
  inert: false,
  getAttribute(name) { return hostAttributes.has(name) ? hostAttributes.get(name) : null; },
  setAttribute(name, value) { hostAttributes.set(name, String(value)); },
  removeAttribute(name) { hostAttributes.delete(name); },
};
const api = {
  exportState() { return structuredClone(circleState); },
  importState(next) {
    if (importShouldFail) return false;
    circleState = structuredClone(next);
    return true;
  },
  validateState(next) {
    if (!next || typeof next !== 'object' || !Array.isArray(next.posts)) throw new Error('invalid circle state');
    return true;
  },
  refreshMedia() { refreshCount++; },
};
let manager;
const sandbox = {
  window: { __duoCircleApi: api, __duoCircleRoot: { host: circleHost }, __duoRestoreInProgress: false, __duoExportInProgress: false },
  Blob,
  URL: fakeUrl,
  FileReader: TestFileReader,
  fetch: (...args) => fetch(...args),
  console: { warn() {}, error() {} },
  Date,
  Map,
  Set,
  Promise,
  JSON,
  Error,
  Math,
  getCircleState() { return structuredClone(circleState); },
  setCircleState(next) {
    if (api.importState(next) === false) throw new Error('circle import rejected');
    manager?.invalidate();
  },
  async putMediaBlob(blob, kind, name = '', fixedId = '') {
    const id = fixedId || `media-${++idCounter}`;
    records.set(id, { id, blob, kind, name, mimeType: blob.type, size: blob.size, createdAt: Date.now() });
    return id;
  },
  async getMediaRecord(id) { return records.get(id) || null; },
  async deleteIfUnreferenced(id) {
    const active = manager?.collectIdsFromState(circleState) || new Set();
    if (active.has(id) || externalRefs.has(id)) return false;
    return records.delete(id);
  },
};
vm.createContext(sandbox);
vm.runInContext(managerSource, sandbox, { filename: 'circle-media-manager.js' });
manager = sandbox.window.__duoCircleMedia;

// Stable IDs must be found in both profile fields and post media; param backups
// deliberately include profile-only references.
const markerState = {
  myAvatar: 'idb-media:avatar-1', myCover: 'idb-media:cover-1',
  posts: [{ media: [{ src: 'idb-media:post-1' }] }],
};
assert.deepEqual([...manager.collectIdsFromState(markerState)].sort(), ['avatar-1', 'cover-1', 'post-1']);
assert.equal(manager.parseRef('idb-media:../../chat'), '', 'media markers must reject path-like or untrusted IDs');
assert.throws(() => manager.makeRef('bad/id'), /媒体 ID 无效/);
assert.deepEqual([...manager.collectIdsFromState(markerState, { profileOnly: true })].sort(), ['avatar-1', 'cover-1']);

// Legacy Data URLs migrate to the existing shared media store. Identical
// payloads are deduplicated across profile/post references.
const migrationTask = manager.migrateLegacy();
assert.equal(circleHost.style.pointerEvents, 'none', 'migration must block interaction on the Shadow DOM host, not the ShadowRoot');
assert.equal(circleHost.getAttribute('aria-busy'), 'true');
assert.equal(circleHost.inert, true, 'migration must also block keyboard interaction while Circle state is being replaced');
const migrated = await migrationTask;
assert.equal(circleHost.style.pointerEvents, '', 'migration must restore the host interaction style');
assert.equal(circleHost.getAttribute('aria-busy'), null, 'migration must remove its temporary busy marker');
assert.equal(circleHost.inert, false, 'migration must restore the host inert state');
assert.equal(migrated.migrated, 2, 'duplicate PNG data URLs should produce one record; GIF should produce another');
assert.match(circleState.myAvatar, /^idb-media:/);
assert.equal(circleState.posts[0].media[0].src, circleState.myAvatar, 'identical Data URLs must share one media ID');
assert.match(circleState.posts[1].media[0].src, /^idb-media:/);
const migratedIds = manager.collectIdsFromState(circleState);
assert.equal(migratedIds.size, 2);
assert.equal(records.size, 2);
assert.ok(manager.resolve(circleState.myAvatar).startsWith('blob:'));
assert.ok(refreshCount > 0, 'successful migration must refresh rendered Circle media');

// If URL creation fails after the IndexedDB transaction commits, storeBlob must
// clean the new unreferenced record rather than leaking an orphan.
const originalCreateUrl = fakeUrl.createObjectURL;
const beforeUrlFailure = records.size;
fakeUrl.createObjectURL = () => { throw new Error('simulated object URL failure'); };
await assert.rejects(manager.storeBlob(new Blob(['orphan'], { type: 'image/png' }), 'image', 'orphan.png'), /object URL failure/);
assert.equal(records.size, beforeUrlFailure, 'object URL creation failure must clean its newly written media record');
fakeUrl.createObjectURL = originalCreateUrl;

// Concurrent callers must share the same full migration promise, including its
// UI-unlock finalizer, rather than receiving the inner storage promise only.
const originalFetch = sandbox.fetch;
let releaseMigrationFetch;
const migrationFetchGate = new Promise(resolve => { releaseMigrationFetch = resolve; });
sandbox.fetch = async (...args) => { await migrationFetchGate; return originalFetch(...args); };
circleState = { myAvatar: 'data:image/png;base64,BAUG', otherAvatar: '', myCover: '', otherCover: '', posts: [], dynamicCards: [], replyCards: [] };
manager.invalidate();
const migrationFirst = manager.migrateLegacy();
const migrationSecond = manager.migrateLegacy();
assert.equal(migrationFirst, migrationSecond, 'concurrent migration callers must await the same guarded task');
assert.equal(manager.waitForMigration(), migrationFirst, 'waitForMigration must include the UI unlock finalizer');
releaseMigrationFetch();
await migrationFirst;
sandbox.fetch = originalFetch;

// A failed state commit must roll back only the media records created by that
// migration and leave legacy Data URLs untouched.
const rollbackState = {
  myAvatar: 'data:image/png;base64,AQID',
  myCover: '', otherAvatar: '', otherCover: '',
  posts: [{ media: [] }], dynamicCards: [], replyCards: [],
};
circleState = structuredClone(rollbackState);
manager.invalidate();
importShouldFail = true;
const recordCountBefore = records.size;
await assert.rejects(manager.migrateLegacy(), /状态保存失败/);
assert.equal(circleState.myAvatar, rollbackState.myAvatar);
assert.equal(records.size, recordCountBefore, 'failed migration must remove newly created unreferenced records');
importShouldFail = false;

// Normal startup migration is suppressed during restore, but the restore path
// can explicitly opt into a controlled in-transaction migration.
circleState = {
  myAvatar: 'data:image/png;base64,BAUG', myCover: '', otherAvatar: '', otherCover: '',
  posts: [], dynamicCards: [], replyCards: [],
};
sandbox.window.__duoRestoreInProgress = true;
const suppressed = await manager.migrateLegacy();
assert.equal(suppressed.skipped, true);
assert.match(circleState.myAvatar, /^data:image\//);
const restoredMigration = await manager.migrateLegacy({ allowRestore: true });
assert.equal(restoredMigration.migrated, 1);
assert.match(circleState.myAvatar, /^idb-media:/);
sandbox.window.__duoRestoreInProgress = false;

// Export takes the same migration exclusion as restore. Normal background
// migration must skip while an export is active, while the export's own
// explicitly-authorized migration is allowed to finish under the global lock.
sandbox.window.__duoExportInProgress = true;
circleState = {
  myAvatar: 'data:image/png;base64,CAkK', otherAvatar: '', myCover: '', otherCover: '',
  posts: [], dynamicCards: [], replyCards: [],
};
const exportMigrationSuppressed = await manager.migrateLegacy();
assert.equal(exportMigrationSuppressed.skipped, true);
assert.match(circleState.myAvatar, /^data:image\//);
const exportMigration = await manager.migrateLegacy({ allowExport: true });
assert.equal(exportMigration.migrated, 1);
assert.match(circleState.myAvatar, /^idb-media:/);
sandbox.window.__duoExportInProgress = false;

// Export packages real bytes, not idb-media marker strings alone.
const rawAnimation = new Blob([new Uint8Array([71, 73, 70, 56, 57, 97, 0, 1])], { type: 'image/gif' });
const rawAnimationRef = await manager.storeBlob(rawAnimation, 'image', 'preserved.gif');
circleState = {
  myAvatar: 'idb-media:archive-avatar', myCover: '', otherAvatar: '', otherCover: '',
  posts: [{ media: [{ src: 'idb-media:archive-gif', type: 'image' }, { src: rawAnimationRef, type: 'image' }] }],
  dynamicCards: [], replyCards: [],
};
await sandbox.putMediaBlob(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }), 'circle-avatar', 'avatar', 'archive-avatar');
await sandbox.putMediaBlob(new Blob([new Uint8Array([71, 73, 70, 56, 57, 97])], { type: 'image/gif' }), 'circle-image', 'animated.gif', 'archive-gif');
const rawAnimationId = manager.parseRef(rawAnimationRef);
assert.deepEqual([...new Uint8Array(await (await sandbox.getMediaRecord(rawAnimationId)).blob.arrayBuffer())], [71,73,70,56,57,97,0,1], 'animated media store must preserve original bytes');
const bundle = await manager.exportBundle();
assert.equal(bundle.format, 'twodeers-circle-backup');
assert.equal(bundle.formatVersion, 1);
assert.equal(bundle.mediaFiles.length, 3);
assert.ok(bundle.mediaFiles.every(item => /^data:image\//.test(item.dataUrl)));
assert.equal(bundle.mediaFiles.find(item => item.id === 'archive-gif').mimeType, 'image/gif');

// Bundle import verifies every referenced file and restores the state only
// after its bytes have been staged in IndexedDB.
const importedCircle = {
  myAvatar: 'idb-media:imported-avatar', otherAvatar: '', myCover: '', otherCover: '',
  posts: [{ media: [{ src: 'idb-media:imported-post', type: 'image' }] }],
  dynamicCards: [], replyCards: [],
};
const importPayload = {
  format: 'twodeers-circle-backup', formatVersion: 1, circleState: importedCircle,
  mediaFiles: [
    { id: 'imported-avatar', kind: 'circle-avatar', name: 'avatar', size: 3, dataUrl: 'data:image/png;base64,AQID' },
    { id: 'imported-post', kind: 'circle-image', name: 'post', size: 6, dataUrl: 'data:image/gif;base64,R0lGODlh' },
  ],
};
assert.equal(await manager.importBundle(importPayload), true);
assert.equal(circleState.myAvatar, importedCircle.myAvatar);
assert.equal(records.get('imported-avatar').blob.size, 3);
assert.equal(records.get('imported-post').blob.type, 'image/gif');
await assert.rejects(manager.importBundle({
  format: 'twodeers-circle-backup', formatVersion: 1,
  circleState: importedCircle,
  mediaFiles: [{ id: 'malicious-shared-id', kind: 'chat-image', size: 3, dataUrl: 'data:image/png;base64,AQID' }],
}), /媒体条目无效/, 'a Circle package may not overwrite unrelated chat/mailbox media records');
await assert.rejects(manager.importBundle({
  format: 'twodeers-circle-backup', formatVersion: 1,
  circleState: importedCircle,
  mediaFiles: [],
}), /随包包含引用的媒体/, 'a portable bundle may not silently borrow same-ID media from the local installation');

// A failed media size check must restore both the prior Circle state and any
// pre-existing records overwritten by the attempted import.
const beforeFailedImport = structuredClone(circleState);
const priorRecord = records.get('imported-avatar');
await assert.rejects(manager.importBundle({
  format: 'twodeers-circle-backup', formatVersion: 1,
  circleState: { ...importedCircle, myAvatar: 'idb-media:imported-avatar' },
  mediaFiles: [{ id: 'imported-avatar', size: 99, dataUrl: 'data:image/png;base64,AQID' }],
}), /大小或总量不匹配/);
assert.deepEqual(circleState, beforeFailedImport);
assert.equal(records.get('imported-avatar').blob.size, priorRecord.blob.size);

// A database write that cannot be read back must roll back the imported Circle
// state and remove the newly written orphan rather than reporting success.
const beforeUnreadableImport = structuredClone(circleState);
const originalGetMediaRecord = sandbox.getMediaRecord;
const unreadableId = 'unreadable-circle-file';
const unreadablePayload = {
  format: 'twodeers-circle-backup', formatVersion: 1,
  circleState: { myAvatar: `idb-media:${unreadableId}`, otherAvatar: '', myCover: '', otherCover: '', posts: [], dynamicCards: [], replyCards: [] },
  mediaFiles: [{ id: unreadableId, kind: 'circle-avatar', name: 'unreadable', size: 3, dataUrl: 'data:image/png;base64,AQID' }],
};
sandbox.getMediaRecord = async id => {
  if(id === unreadableId && records.has(id)) throw new Error('simulated IndexedDB readback failure');
  return originalGetMediaRecord(id);
};
await assert.rejects(manager.importBundle(unreadablePayload), /写入后回读失败/);
assert.deepEqual(circleState, beforeUnreadableImport, 'failed media hydration must restore the old Circle state');
assert.equal(records.has(unreadableId), false, 'failed media hydration must remove the unreferenced imported file');
sandbox.getMediaRecord = originalGetMediaRecord;

// Concurrent UI refreshes must share one load generation without cancelling
// the first request or mistaking a blank URL for a successfully loaded file.
const overlapId = 'ensure-overlap';
records.set(overlapId, { id: overlapId, blob: new Blob(['ok'], { type: 'image/png' }), kind: 'circle-avatar', name: 'overlap' });
circleState = { myAvatar: `idb-media:${overlapId}`, otherAvatar: '', myCover: '', otherCover: '', posts: [], dynamicCards: [], replyCards: [] };
manager.invalidate();
let releaseRead;
const readGate = new Promise(resolve => { releaseRead = resolve; });
sandbox.getMediaRecord = async id => { await readGate; return originalGetMediaRecord(id); };
const ensureFirst = manager.ensure();
const ensureSecond = manager.ensure();
releaseRead();
await Promise.all([ensureFirst, ensureSecond]);
assert.match(manager.resolve(`idb-media:${overlapId}`), /^blob:/, 'parallel ensure calls must leave the referenced media resolved');
sandbox.getMediaRecord = originalGetMediaRecord;

// A transient first read failure must be retried by the next ensure call.
const retryId = 'ensure-retry';
records.set(retryId, { id: retryId, blob: new Blob(['retry'], { type: 'image/png' }), kind: 'circle-avatar', name: 'retry' });
circleState.myAvatar = `idb-media:${retryId}`;
manager.invalidate();
let failRetryOnce = true;
sandbox.getMediaRecord = async id => {
  if(id === retryId && failRetryOnce){failRetryOnce = false;throw new Error('simulated temporary IndexedDB failure');}
  return originalGetMediaRecord(id);
};
const firstRetry = await manager.ensure();
assert.equal(firstRetry.missing, 1, 'the first transient storage failure must be reported');
const secondRetry = await manager.ensure();
assert.equal(secondRetry.missing, 0, 'the next explicit ensure must retry rather than retain a permanent negative cache');
assert.match(manager.resolve(`idb-media:${retryId}`), /^blob:/);
sandbox.getMediaRecord = originalGetMediaRecord;

// Garbage collection must not delete media shared by chat/mailbox, while
// unreferenced Circle-only records can be removed after a successful replace.
externalRefs.add('shared-with-chat');
await sandbox.putMediaBlob(new Blob(['shared']), 'circle-image', 'shared', 'shared-with-chat');
const cleanup = await manager.cleanupReplaced(
  { myAvatar: 'idb-media:shared-with-chat', myCover: '', otherAvatar: '', otherCover: '', posts: [] },
  { myAvatar: '', myCover: '', otherAvatar: '', otherCover: '', posts: [] },
);
assert.equal(cleanup.deleted, 0);
assert.equal(records.has('shared-with-chat'), true, 'a Circle media ID still referenced by chat/mailbox must remain in IndexedDB');
assert.equal(externalRefs.has('shared-with-chat'), true);

// Reset helper must keep exactly the Circle-referenced records and refuse to
// proceed if any referenced file is already missing or an unrelated record remains.
const resetRecords = [
  { id: 'circle-a', blob: new Blob(['a']) },
  { id: 'circle-b', blob: new Blob(['b']) },
  { id: 'chat-x', blob: new Blob(['x']) },
];
const keep = manager.preserveCircleRecords(resetRecords, new Set(['circle-a', 'circle-b']));
assert.deepEqual(keep.map(item => item.id).sort(), ['circle-a', 'circle-b']);
assert.equal(manager.verifyPreservedCircleRecords(keep, new Set(['circle-a', 'circle-b'])), true);
assert.equal(manager.verifyPreservedCircleRecords([...keep, resetRecords[2]], new Set(['circle-a', 'circle-b'])), false);
assert.throws(() => manager.preserveCircleRecords(resetRecords, new Set(['circle-a', 'missing'])), /媒体记录不完整/);

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing function: ${signature}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function: ${signature}`);
}
const clearMediaFunction = extractFunction(index, 'async function clearMediaDatabase(){');
async function executeMediaReset(initialRecords, circleIds) {
  const store = new Map(initialRecords.map(item => [item.id, item]));
  const db = {
    transaction() {
      const tx = { objectStore() {
        return {
          getAll() { const req = {}; queueMicrotask(() => { req.result = [...store.values()]; req.onsuccess?.(); }); return req; },
          clear() { store.clear(); },
          put(item) { store.set(item.id, item); },
          delete(id) { store.delete(id); },
        };
      } };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  };
  const context = {
    openMediaDB: async () => db, MEDIA_STORE_NAME: 'media',
    window: { __duoCircleMedia: { getIds: () => new Set(circleIds), preserveCircleRecords: manager.preserveCircleRecords, verifyPreservedCircleRecords: manager.verifyPreservedCircleRecords, invalidate() {} } },
    builtinStickerMediaGeneration: 0, builtinStickerMediaJobs: new Map(),
    mediaUrlCache: new Map(), mediaLoadFailed: new Set(), stickerObjectUrls: new Map(),
    URL: fakeUrl,
  };
  vm.createContext(context);
  vm.runInContext(clearMediaFunction, context, { filename: 'clearMediaDatabase.js' });
  await context.clearMediaDatabase();
  return [...store.values()];
}
const resetKept = await executeMediaReset(resetRecords, new Set(['circle-a', 'circle-b']));
assert.deepEqual(resetKept.map(item => item.id).sort(), ['circle-a', 'circle-b'], 'actual reset function must retain Circle files and clear chat media');
await assert.rejects(executeMediaReset(resetRecords, new Set(['circle-a', 'missing'])), /重置后朋友圈媒体保留校验失败/);

// GIF/APNG/animated WebP need raw-Blob persistence. Static PNG remains on the
// established compressed path.
const gifBlob = new Blob(['GIF89a'], { type: 'image/gif' });
assert.equal(await manager.isAnimatedImageBlob(gifBlob), true);
// Supply structurally valid PNG chunks: APNG is a PNG container with an acTL
// chunk before IDAT, not merely the four ASCII letters at an arbitrary offset.
function makePngBlob(animated) {
  const be32 = value => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
  const chunk = (type, data = []) => [...be32(data.length), ...Buffer.from(type, 'ascii'), ...data, 0, 0, 0, 0];
  const bytes = [137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk('IHDR', [...be32(1), ...be32(1), 8, 6, 0, 0, 0]),
    ...(animated ? chunk('acTL', [...be32(2), ...be32(0)]) : []),
    ...chunk('IDAT', [0]), ...chunk('IEND')];
  return new Blob([new Uint8Array(bytes)], { type: 'image/png' });
}
assert.equal(await manager.isAnimatedImageBlob(makePngBlob(true)), true);
// Animated WebP is a RIFF/WEBP container with a real ANMF chunk.
const webpBody = [...Buffer.from('WEBP', 'ascii'), ...Buffer.from('ANMF', 'ascii'), 0, 0, 0, 0];
const webpBytes = new Uint8Array([...Buffer.from('RIFF', 'ascii'), webpBody.length & 255, 0, 0, 0, ...webpBody]);
assert.equal(await manager.isAnimatedImageBlob(new Blob([webpBytes], { type: 'image/webp' })), true);
assert.equal(await manager.isAnimatedImageBlob(makePngBlob(false)), false);
assert.equal(manager.isDataMediaUrl('data:video/quicktime;base64,AQID'), true, 'Circle media storage must accept existing QuickTime video Data URLs');

// Export and import paths must migrate before snapshotting and check the Circle
// media set in both legacy JSON and V4 archives; reset must not demand an empty DB.
const backupPartsStart = index.indexOf('async function* backupJsonParts(kind){');
const backupPartsEnd = index.indexOf('async function buildBackup(kind){', backupPartsStart);
assert.ok(backupPartsStart >= 0 && backupPartsEnd > backupPartsStart, 'backup generator boundaries must exist');
const backupPartsSource = index.slice(backupPartsStart, backupPartsEnd);
assert.ok(backupPartsSource.includes('await migrateLegacyProfileMedia({allowExport:true})'), 'profile images must migrate before backup snapshot');
assert.ok(backupPartsSource.includes("if(kind!=='chat')await window.__duoCircleMedia?.migrateLegacy?.({allowExport:true});"), 'Circle media must still migrate before backup snapshot');
assert.ok(backupPartsSource.indexOf('migrateLegacyProfileMedia') < backupPartsSource.indexOf('window.__duoCircleMedia?.migrateLegacy'), 'profile and Circle media migrations must both precede the snapshot');
assert.match(index, /verifyPreservedCircleRecords\?\.\(remainingMedia,circleMediaIds\)/);
assert.match(index, /async function buildBackup\(kind\)\{[\s\S]*?legacyExportInProgress=true;window\.__duoExportInProgress=true;[\s\S]*?migrateLegacy\?\.\(\{allowExport:true\}\)/);
assert.match(index, /朋友圈媒体恢复：/);
assert.match(index, /cleanupReplacedMediaReferences\(oldMediaReferences\)/);
assert.match(index, /cleanupReplaced\?\.\(attemptedCircle,oldCircle\)/, 'legacy restore rollback must still clean only newly introduced Circle references');
assert.match(index, /朋友圈媒体恢复后回读失败/);
assert.match(index, /朋友圈旧媒体回滚回读失败/);
assert.match(backupV4, /circleMediaIds=window\.__duoCircleMedia\?\.collectIdsFromState/);
assert.match(backupV4, /profileMediaIds=window\.__duoCircleMedia\?\.collectIdsFromState/);
assert.match(backupV4, /cleanupReplacedMediaReferences\(oldMediaReferences\)/);
assert.ok(backupV4.includes('video\\/[a-z0-9.+-]+'), 'V4 restore must accept legacy video MIME subtypes including QuickTime');
assert.ok(index.includes('video\\/[a-z0-9.+-]+'), 'legacy JSON restore and safe media rendering must accept QuickTime video MIME types');
assert.match(index, /if\(item\?\.blob instanceof Blob\)[\s\S]*?storeBlob\(item\.blob/);
assert.match(index, /if\(preserveOriginal\)tempAssetBlobs\.set\(key,\{blob:file,url:previewUrl\}\)/);
assert.match(index, /if\(preserveOriginal\)\{const src=URL\.createObjectURL\(file\);return \{id:/);

console.log('PASS: Circle DataURL-to-IndexedDB migration/dedup/rollback; raw GIF/APNG/WebP Blob preservation; Circle portable backup/import and failed-readback rollback integrity; Shadow DOM migration lock; concurrent hydration; shared-reference garbage collection; actual reset function keeps exactly Circle media; restore-time migration; raw animation byte preservation; JSON/V4 exports include migrated media and replaced media cleanup is post-commit.');
