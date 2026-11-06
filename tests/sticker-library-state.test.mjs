import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function normalizeStickerLibrary(raw){');
const finish = html.indexOf('initializeStickerLibraryStore();', start) + 'initializeStickerLibraryStore();'.length;
assert.ok(start >= 0 && finish > start, 'sticker library state manager must exist');
const managerSource = html.slice(start, finish);
const saveStart = html.indexOf('function save(){try{const stickerLibrary=readStickerLibraryStore();');
const saveEnd = html.indexOf('\nfunction showToast', saveStart);
const saveSource = saveStart >= 0 && saveEnd > saveStart ? html.slice(saveStart, saveEnd) : null;
assert.ok(saveSource, 'save() must exist');

function makeTab(storage, initialItems = [], initialFavorites = []) {
  const state = { stickers: structuredClone(initialItems), stickerFavorites: [...initialFavorites], stickerTombstones: [], stickerLibraryRevision: 0 };
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); }
  };
  const sandbox = { state, localStorage, window: {}, Date, console, setTimeout, showToast() {}, STICKER_LIBRARY_STORAGE_KEY:'dual_space_sticker_library_v1', STORAGE_KEY:'dual_space_app_clean_test_v1' };
  vm.createContext(sandbox);
  vm.runInContext(managerSource + '\n' + saveSource + '\nthis.api={readStickerLibraryStore,applyImportedStickerLibrary,deleteStickerFromLibrary,setStickerFavorite,toggleStickerFavorite,replaceStickerFavorites,isStickerSendable,restoreStickerLibrarySnapshot};this.doSave=save;', sandbox);
  return sandbox;
}

const KEY = 'dual_space_sticker_library_v1';

test('a stale tab save cannot reintroduce an item deleted in another tab', () => {
  const storage = new Map();
  const initial = [{id:'stk-a',mediaId:'media-a',mimeType:'image/png',name:'a.png',size:1},{id:'stk-b',mediaId:'media-b',mimeType:'image/png',name:'b.png',size:1}];
  const tabA = makeTab(storage, initial);
  const tabB = makeTab(storage, initial);
  assert.equal(tabA.api.deleteStickerFromLibrary('stk-b').id, 'stk-b');
  const deleted = JSON.parse(storage.get(KEY));
  assert.equal(deleted.items.some(x=>x.id==='stk-b'), false);
  assert.equal(deleted.tombstones.some(x=>x.id==='stk-b'), true);
  // Simulate tab B retaining its old in-memory array and saving an unrelated setting.
  assert.equal(tabB.state.stickers.some(x=>x.id==='stk-b'), true);
  assert.equal(tabB.doSave(), true);
  assert.equal(tabB.state.stickers.some(x=>x.id==='stk-b'), false);
  assert.equal(JSON.parse(storage.get(KEY)).items.some(x=>x.id==='stk-b'), false);
});

test('an imported legacy backup cannot resurrect an item with a local tombstone', () => {
  const storage = new Map();
  const tab = makeTab(storage, [{id:'stk-deleted',mediaId:'media-1',mimeType:'image/png',name:'old.png',size:1}]);
  tab.api.deleteStickerFromLibrary('stk-deleted');
  tab.api.applyImportedStickerLibrary([{id:'stk-deleted',mediaId:'media-1',mimeType:'image/png',name:'old.png',size:1}], [], []);
  assert.equal(tab.state.stickers.some(x=>x.id==='stk-deleted'), false);
  assert.equal(tab.api.isStickerSendable('stk-deleted'), false);
});

test('deleting a favorite removes its favorite state and writes its tombstone in one commit', () => {
  const storage = new Map();
  const tab = makeTab(storage, [{id:'stk-fav',mediaId:'media-fav',mimeType:'image/png',name:'fav.png',size:1}], ['stk-fav']);
  tab.api.deleteStickerFromLibrary('stk-fav');
  const stored = JSON.parse(storage.get(KEY));
  assert.deepEqual(stored.favorites, []);
  assert.equal(stored.tombstones.some(x=>x.id==='stk-fav'), true);
  assert.equal(stored.items.some(x=>x.id==='stk-fav'), false);
});

test('send controls carry stable sticker IDs and send path revalidates the ID after async media read', () => {
  assert.match(html, /data-sticker-send-id=/);
  assert.match(html, /data-sticker-del-id=/);
  const send = html.match(/async function sendSticker\(stickerId\)\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(send, /isStickerSendable\(stickerId\)/);
  assert.match(send, /await getMediaRecord\(sticker\.mediaId\)/);
  assert.match(send, /const latest=readStickerLibraryStore\(\)/);
  assert.match(send, /latest\.tombstones\.some\(item=>item\.id===stickerId\)/);
});

test('V4 and legacy chat backups retain tombstones and restore merges rather than erases them', () => {
  const v4 = readFileSync(new URL('../backup-v4.js', import.meta.url), 'utf8');
  assert.match(v4, /stickerTombstones:stateSnapshot\.stickerTombstones\|\|\[\]/);
  assert.match(v4, /applyImportedState\?\.\(data\.stickers,data\.stickerFavorites,data\.stickerTombstones\)/);
  assert.match(html, /applyImportedStickerLibrary\(data\.stickers,data\.stickerFavorites,data\.stickerTombstones\)/);
});


test('favorite toggle reads the latest persisted library and is committed as one idempotent change', () => {
  const storage = new Map();
  const tabA = makeTab(storage, [{id:'stk-toggle',mediaId:'media-toggle',mimeType:'image/png',name:'toggle.png',size:1}]);
  const tabB = makeTab(storage, [{id:'stk-toggle',mediaId:'media-toggle',mimeType:'image/png',name:'toggle.png',size:1}]);
  assert.equal(tabA.api.toggleStickerFavorite('stk-toggle'), true);
  // Tab B still has its original view, but the toggle must operate on the committed library value.
  assert.equal(tabB.api.toggleStickerFavorite('stk-toggle'), false);
  const stored = JSON.parse(storage.get(KEY));
  assert.deepEqual(Array.from(stored.favorites), []);
  assert.equal(stored.revision, 2);
});

test('media cleanup checks both the latest main-state snapshot and the independent sticker library', async () => {
  const refSource = html.match(/function latestPersistedMediaReferences\(\)\{[\s\S]*?\n\}/)?.[0] || '';
  const cleanupSource = html.match(/async function deleteIfUnreferenced\(id\)\{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(refSource && cleanupSource);
  const storage = new Map([['dual_space_app_clean_test_v1', JSON.stringify({chatHistory:[{mediaId:'history-media'}],stickers:[]})],['twodeers_mailbox_letters_v1',JSON.stringify({items:[{images:[{id:'letter-image'}]}]})],['twodeers_mailbox_drafts_v1',JSON.stringify([{images:[{id:'draft-image'}]}])]]);
  const calls = [];
  const sandbox = {
    state:{chatHistory:[],stickers:[]},
    localStorage:{getItem:key=>storage.has(key)?storage.get(key):null},
    window:{__duoMailbox:{getReferencedMediaIds:()=>[]}},
    STICKER_LIBRARY_STORAGE_KEY:KEY,
    STORAGE_KEY:'dual_space_app_clean_test_v1',
    readStickerLibraryStore:()=>({items:[{id:'stk-live',mediaId:'live-media'}]}),
    referencedMediaIds:()=>new Set(),
    async openMediaDB(){calls.push('open');return {db:true};},
    async deleteMediaRecord(id,db){calls.push(['delete',id,db]);},
  };
  vm.createContext(sandbox);
  vm.runInContext(refSource+'\n'+cleanupSource+'\nthis.refs=latestPersistedMediaReferences;this.cleanup=deleteIfUnreferenced;',sandbox);
  assert.equal(sandbox.refs().has('history-media'),true);
  assert.equal(sandbox.refs().has('live-media'),true);
  assert.equal(sandbox.refs().has('letter-image'),true);
  assert.equal(sandbox.refs().has('draft-image'),true);
  assert.equal(await sandbox.cleanup('history-media'),false);
  assert.equal(await sandbox.cleanup('draft-image'),false);
  assert.equal(calls.some(item=>Array.isArray(item)&&item[0]==='delete'),false);
  storage.set('dual_space_app_clean_test_v1', JSON.stringify({chatHistory:[],stickers:[]}));
  assert.equal(await sandbox.cleanup('orphan-media'),true);
  assert.deepEqual(calls.at(-1).slice(0,2), ['delete','orphan-media']);
});

test('media deletion no longer swallows IndexedDB errors and verifies deletion by readback', () => {
  const fn = html.match(/async function deleteMediaRecord\(id,dbOverride=null\)\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /tx\.onerror=\(\)=>reject/);
  assert.match(fn, /tx\.onabort=\(\)=>reject/);
  assert.match(fn, /const remaining=await getMediaRecord\(id\)/);
  assert.match(fn, /if\(remaining\)throw new Error/);
  assert.doesNotMatch(fn, /catch\(e\)\{\}/);
});


test('legacy parameter backup favorite import updates the authoritative library instead of memory only', () => {
  const storage = new Map();
  const tab = makeTab(storage, [
    {id:'stk-param-a',mediaId:'media-param-a',mimeType:'image/png',name:'a.png',size:1},
    {id:'stk-param-b',mediaId:'media-param-b',mimeType:'image/png',name:'b.png',size:1}
  ]);
  assert.equal(tab.api.replaceStickerFavorites(['stk-param-b','missing']), true);
  assert.deepEqual(Array.from(JSON.parse(storage.get(KEY)).favorites), ['stk-param-b']);
  assert.deepEqual(Array.from(tab.state.stickerFavorites), ['stk-param-b']);
  assert.equal(tab.api.replaceStickerFavorites(['stk-param-b']), false, 'identical favorite imports must not create a new revision');
});


test('backup replacement tombstones locally active items omitted by the imported snapshot', () => {
  const storage = new Map();
  const tabA = makeTab(storage, [
    {id:'stk-keep',mediaId:'media-keep',mimeType:'image/png',name:'keep.png',size:1},
    {id:'stk-removed-by-restore',mediaId:'media-restore',mimeType:'image/png',name:'restore.png',size:1}
  ]);
  const tabB = makeTab(storage, [
    {id:'stk-keep',mediaId:'media-keep',mimeType:'image/png',name:'keep.png',size:1},
    {id:'stk-removed-by-restore',mediaId:'media-restore',mimeType:'image/png',name:'restore.png',size:1}
  ]);
  tabA.api.applyImportedStickerLibrary([{id:'stk-keep',mediaId:'media-keep',mimeType:'image/png',name:'keep.png',size:1}], [], []);
  assert.equal(tabA.state.stickers.some(x=>x.id==='stk-removed-by-restore'),false);
  assert.equal(tabB.doSave(),true);
  const latest=JSON.parse(storage.get(KEY));
  assert.equal(latest.items.some(x=>x.id==='stk-removed-by-restore'),false);
  assert.equal(latest.tombstones.some(x=>x.id==='stk-removed-by-restore'),true);
});
