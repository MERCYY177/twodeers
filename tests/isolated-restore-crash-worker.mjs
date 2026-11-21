import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createValidSeed } from './isolated-application-fixtures.mjs';

const [mode, profile, baseUrl] = process.argv.slice(2);
if (!['seed-crash', 'verify-recovery'].includes(mode) || !profile || !baseUrl) throw new Error('worker args invalid');
const JOURNAL_DB = 'twodeers-recovery-journal-v1';
const JOURNAL_ID = 'v4-restore-active';

async function waitWritable(page) {
  await page.waitForFunction(() => !!window.__duoRuntimeCoordinator?.getStatus?.().ready, null, { timeout: 45_000 });
  await page.waitForFunction(() => window.__duoRuntimeCoordinator?.isWritable?.() === true && window.__duoRuntimeCoordinator?.getStatus?.().startupComplete === true, null, { timeout: 60_000 });
}

async function seedCrashState(page) {
  await page.goto(new URL('/__phase18_seed__', baseUrl).toString(), { waitUntil: 'domcontentloaded' });
  const seed = createValidSeed();
  await page.evaluate(async seed => {
    const png = Uint8Array.from(atob(seed.pngBase64), ch => ch.charCodeAt(0));
    const mediaRows = seed.media.map(item => ({ ...item, blob: new Blob([png], { type: 'image/png' }), size: png.byteLength }));
    const openDb = (name, version, store, keyPath = 'id') => new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = () => { const db=request.result; if(!db.objectStoreNames.contains(store))db.createObjectStore(store,{keyPath}); };
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('database blocked'));
    });
    const write = (db, store, rows, durability='strict') => new Promise((resolve,reject)=>{
      const tx=db.transaction(store,'readwrite',{durability});for(const row of rows)tx.objectStore(store).put(row);
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('transaction aborted'));
    });
    localStorage.clear();
    localStorage.setItem('__twodeers_runtime_revision_v1','0');
    localStorage.setItem('dual_space_app_clean_test_v1',JSON.stringify(seed.main));
    localStorage.setItem('dual_space_sticker_library_v1',JSON.stringify(seed.stickerLibrary));
    localStorage.setItem('twodeers_mailbox_letters_v1',JSON.stringify(seed.mailbox));
    localStorage.setItem('twodeers_card_system_v1',JSON.stringify(seed.cards));
    localStorage.setItem('moments_site_blank_v49_rebuild_baseline_same_layout',JSON.stringify(seed.circle));
    localStorage.setItem('moments_site_blank_v49_rebuild_baseline_same_layout_visitor_backup_step01b',JSON.stringify(seed.visitorBackup));
    const mediaDb=await openDb('dual_space_chat_media_v1',1,'media');await write(mediaDb,'media',mediaRows);mediaDb.close();
    return { mediaCount: mediaRows.length };
  }, seed);
}

const context = await chromium.launchPersistentContext(profile, {
  headless: true, viewport: { width: 1200, height: 900 }, acceptDownloads: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});
try {
  const page = await context.newPage();
  if (mode === 'seed-crash') {
    await seedCrashState(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitWritable(page);
    await page.evaluate(async () => {
      const storageKey = 'dual_space_app_clean_test_v1';
      const circleKey = 'moments_site_blank_v49_rebuild_baseline_same_layout';
      const oldStateText = localStorage.getItem(storageKey);
      const oldState = JSON.parse(oldStateText);
      const oldCircle = JSON.parse(localStorage.getItem(circleKey));
      const pngBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4z8DwHwAFAAH/VscvDQAAAABJRU5ErkJggg=='), ch => ch.charCodeAt(0));
      const oldMedia = await new Promise((resolve, reject) => {
        const request = indexedDB.open('dual_space_chat_media_v1', 1);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('media', 'readonly');
          const get = tx.objectStore('media').getAll();
          get.onsuccess = () => { const rows=get.result||[]; db.close(); resolve(rows); };
          get.onerror = () => reject(get.error);
        };
        request.onerror = () => reject(request.error);
      });
      const interruptedState = structuredClone(oldState);
      interruptedState.chatHistory = [...(interruptedState.chatHistory || []), { id: 'phase18-interrupted-message', sender: 'me', type: 'text', text: '不应保留的中断状态', time: '09:59', read: true }];
      localStorage.setItem(storageKey, JSON.stringify(interruptedState));
      const interruptedCircle = structuredClone(oldCircle);
      interruptedCircle.posts[0].text = '不应保留的中断朋友圈状态';
      localStorage.setItem(circleKey, JSON.stringify(interruptedCircle));
      const mediaDb = await new Promise((resolve, reject) => { const req=indexedDB.open('dual_space_chat_media_v1',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error); });
      await new Promise((resolve,reject)=>{
        const tx=mediaDb.transaction('media','readwrite',{durability:'strict'});
        const store=tx.objectStore('media');
        const get=store.get('phase17-chat-media');
        get.onsuccess=()=>{const row=get.result;store.put({...row,blob:new Blob([new Uint8Array([0,1,2,3])],{type:'image/png'}),size:4});};
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('media mutation aborted'));
      });
      mediaDb.close();
      const journal = {
        id: 'v4-restore-active', formatVersion: 1, phase: 'prepared', createdAt: Date.now(), kind: 'all',
        oldState: oldStateText, oldStorage: oldStateText, oldCircle,
        oldMedia: oldMedia.map(row => [row.id, row])
      };
      const journalDb = await new Promise((resolve,reject)=>{
        const request=indexedDB.open('twodeers-recovery-journal-v1',1);
        request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('recovery'))request.result.createObjectStore('recovery',{keyPath:'id'});};
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      });
      await new Promise((resolve,reject)=>{
        const tx=journalDb.transaction('recovery','readwrite',{durability:'strict'});
        tx.objectStore('recovery').put(journal);
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('journal transaction aborted'));
      });
      journalDb.close();
      await new Promise(resolve=>setTimeout(resolve, 750));
      return { journalCreated: true, oldMediaCount: oldMedia.length, corruptedState: true };
    });
    console.log('PHASE18_CRASH_READY');
    await new Promise(() => {});
  } else {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitWritable(page);
    const result = await page.evaluate(async () => {
      const state = JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1') || '{}');
      const circle = window.__duoCircleApi?.exportState?.();
      const media = await window.getMediaRecord?.('phase17-chat-media');
      const decoded = await new Promise(resolve => {
        const image = new Image(); image.onload=()=>resolve(image.naturalWidth===1);image.onerror=()=>resolve(false);
        image.src = media?.blob ? URL.createObjectURL(media.blob) : '';
      });
      const journal = await window.__duoRuntimeCoordinator?.readRecoveryJournal?.();
      return {
        writable: window.__duoRuntimeCoordinator?.isWritable?.() === true,
        mainRecovered: state.chatHistory?.some(item => item.id === 'phase18-interrupted-message') !== true && state.chatHistory?.some(item => item.text === '第十七阶段合成聊天消息') === true,
        circleRecovered: circle?.posts?.[0]?.text === '第十七阶段合成朋友圈动态',
        mediaRecovered: !!media?.blob && media.blob.size > 30 && decoded === true,
        journalCleared: journal === null,
        storageIssues: window.__duoStorageBootIssues || []
      };
    });
    assert.equal(result.writable, true, 'startup should release the writer only after journal recovery');
    assert.equal(result.mainRecovered, true, 'main localStorage must return to the journal snapshot');
    assert.equal(result.circleRecovered, true, 'Circle state must return to the journal snapshot');
    assert.equal(result.mediaRecovered, true, 'old media Blob must be restored and decode');
    assert.equal(result.journalCleared, true, 'PREPARED journal should be cleared after verified recovery');
    assert.equal(result.storageIssues.length, 0);
    console.log('PHASE18_CRASH_RECOVERY_PASS ' + JSON.stringify(result));
    await context.close();
  }
} finally {
  if (mode !== 'seed-crash') { try { await context.close(); } catch {} }
}
