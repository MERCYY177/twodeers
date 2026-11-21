import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createMissingMediaSeed, createValidSeed } from './isolated-application-fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.webm': 'video/webm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf'
};

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/__phase17_seed__') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end('<!doctype html><html><head><meta charset="utf-8"><title>Phase 17 isolated seed</title></head><body>isolated seed origin</body></html>');
        return;
      }
      const decoded = decodeURIComponent(url.pathname);
      let target = path.resolve(ROOT, '.' + decoded);
      if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      let info = await stat(target);
      if (info.isDirectory()) {
        target = path.join(target, 'index.html');
        info = await stat(target);
      }
      if (!info.isFile()) { response.writeHead(404).end('Not found'); return; }
      response.writeHead(200, {
        'content-type': mimeTypes[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'content-length': info.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'
      });
      createReadStream(target).pipe(response);
    } catch (error) {
      response.writeHead(error?.code === 'ENOENT' ? 404 : 500).end('Unable to serve file');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}/index.html` });
    });
  });
}

async function seedIsolatedOrigin(page, url, seed, fontBase64 = null) {
  const seedUrl = new URL('/__phase17_seed__', url).toString();
  await page.goto(seedUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.evaluate(async ({ seed, fontBase64 }) => {
    const openDb = (name, version, stores) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of stores) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: store === 'meta' ? 'key' : 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('seed IndexedDB open failed'));
      request.onblocked = () => reject(new Error('seed IndexedDB open blocked'));
    });
    const writeRows = (db, storeName, rows) => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const row of rows) store.put(row);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error('seed IndexedDB write failed')); tx.onabort = () => reject(tx.error || new Error('seed IndexedDB transaction aborted'));
    });
    localStorage.clear();
    localStorage.setItem('__twodeers_runtime_revision_v1', '0');
    localStorage.setItem('dual_space_app_clean_test_v1', JSON.stringify(seed.main));
    localStorage.setItem('dual_space_sticker_library_v1', JSON.stringify(seed.stickerLibrary));
    localStorage.setItem('twodeers_mailbox_letters_v1', JSON.stringify(seed.mailbox));
    localStorage.setItem('twodeers_card_system_v1', JSON.stringify(seed.cards));
    localStorage.setItem('moments_site_blank_v49_rebuild_baseline_same_layout', JSON.stringify(seed.circle));
    localStorage.setItem('moments_site_blank_v49_rebuild_baseline_same_layout_visitor_backup_step01b', JSON.stringify(seed.visitorBackup));

    const png = seed.pngBase64 ? Uint8Array.from(atob(seed.pngBase64), ch => ch.charCodeAt(0)) : null;
    const mediaRows = seed.media.map(row => ({ ...row, blob: png ? new Blob([png], { type: 'image/png' }) : null, size: png ? png.byteLength : 0 }));
    const mediaDb = await openDb('dual_space_chat_media_v1', 1, ['media']);
    await writeRows(mediaDb, 'media', mediaRows);
    mediaDb.close();

    if (fontBase64) {
      const fontBytes = Uint8Array.from(atob(fontBase64), ch => ch.charCodeAt(0));
      const fontDb = await openDb('chuanxun-local-font-library', 1, ['fonts', 'meta']);
      const fontBlob = new Blob([fontBytes], { type: 'font/ttf' });
      await writeRows(fontDb, 'fonts', [{ id: 'phase17_font', name: 'Phase 17 Runtime Test Font', fileName: 'phase17-runtime-test.ttf', format: 'ttf', mimeType: 'font/ttf', size: fontBlob.size, blob: fontBlob, createdAt: 1_794_000_000_000 }]);
      await writeRows(fontDb, 'meta', [{ key: 'currentFontId', value: 'phase17_font', updatedAt: 1_794_000_000_000 }]);
      fontDb.close();
    }
    return { origin: location.origin, localStorageKeys: Object.keys(localStorage).sort(), seededMediaCount: mediaRows.length, fontSeeded: !!fontBase64 };
  }, { seed, fontBase64 });
}

async function waitForWritableRuntime(page) {
  await page.waitForFunction(() => !!window.__duoRuntimeCoordinator?.getStatus?.().ready, null, { timeout: 45_000 });
  await page.waitForFunction(() => window.__duoRuntimeCoordinator?.isWritable?.() === true && window.__duoRuntimeCoordinator?.getStatus?.().startupComplete === true, null, { timeout: 60_000 });
}

function attachGuards(page, label) {
  page.on('pageerror', error => errors.push({ label, type: 'pageerror', message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error' && !/favicon\.ico|ERR_BLOCKED_BY_CLIENT/i.test(message.text())) errors.push({ label, type: 'console', message: message.text() });
  });
  page.on('request', request => {
    if (/^https?:\/\/(?!127\.0\.0\.1)/i.test(request.url())) errors.push({ label, type: 'external-request', url: request.url() });
  });
}

async function testValidRuntimeRehearsal(browser, baseUrl, fontBase64) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, permissions: ['microphone'] });
  const page = await context.newPage();
  attachGuards(page, 'valid-rehearsal');
  const seed = createValidSeed();
  const seeded = await seedIsolatedOrigin(page, baseUrl, seed, fontBase64);
  assert.match(seeded.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(seeded.seededMediaCount, 6);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForWritableRuntime(page);
  await page.evaluate(() => { window.goto('chatPage'); window.openStickerPanel(); });
  const uploadedStickerImage = page.locator('#stickerGrid [data-sticker-id="phase17-uploaded-sticker"] img');
  await uploadedStickerImage.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => { const img=document.querySelector('#stickerGrid [data-sticker-id="phase17-uploaded-sticker"] img'); return !!img && img.complete && img.naturalWidth===1; }, null, { timeout: 20_000 });

  await page.waitForFunction(() => { const img=document.querySelector('#chatList [data-mid="phase17-chat-image"] img'); return !!img && img.complete && img.naturalWidth===1; }, null, { timeout: 20_000 });

  const boot = await page.evaluate(async () => {
    const circle = window.__duoCircleApi?.exportState?.();
    const cards = window.__duoCardSystem?.getPoolItems?.('chat') || [];
    const dynamic = window.__duoCardSystem?.getPoolItems?.('moments-dynamic') || [];
    const replies = window.__duoCardSystem?.getPoolItems?.('moments-reply') || [];
    const mailbox = window.__duoMailbox?.exportData?.()?.mailbox;
    const fontRows = await window.ChuanXunFontManager?.listFonts?.();
    const circleEnsure = await window.__duoCircleMedia?.ensure?.(circle);
    const circleUrl = window.__duoCircleMedia?.resolve?.('idb-media:phase17-circle-post-media') || '';
    const circleAvatarUrl = window.__duoCircleMedia?.resolve?.(circle?.myAvatar || '') || '';
    const circleCoverUrl = window.__duoCircleMedia?.resolve?.(circle?.myCover || '') || '';
    const image = async (src) => {
      if (!src) return { decoded: false, width: 0, height: 0 };
      const value = new Image(); value.src = src;
      try { await value.decode(); return { decoded: true, width: value.naturalWidth, height: value.naturalHeight }; }
      catch (_) { return { decoded: false, width: value.naturalWidth, height: value.naturalHeight }; }
    };
    await window.renderStickerList?.();
    const stickerImage = document.querySelector('#stickerGrid [data-sticker-id="phase17-uploaded-sticker"] img');
    return {
      writable: window.__duoRuntimeCoordinator?.isWritable?.() === true,
      startupComplete: window.__duoRuntimeCoordinator?.getStatus?.().startupComplete === true,
      bootIssues: Array.isArray(window.__duoStorageBootIssues) ? window.__duoStorageBootIssues : [],
      chatRows: document.querySelectorAll('#chatList [data-mid]').length,
      chatTextVisible: document.querySelector('#chatList')?.textContent.includes('第十七阶段合成聊天消息') === true,
      chatImage: await image(document.querySelector('#chatList [data-mid="phase17-chat-image"] img')?.src || ''),
      cardIds: cards.map(item => item.id), cardTexts: cards.map(item => item.text),
      dynamicCardIds: dynamic.map(item => item.id), dynamicCardTexts: dynamic.map(item => item.text),
      replyCardIds: replies.map(item => item.id), replyCardTexts: replies.map(item => item.text),
      stickerSendable: window.__duoStickerState?.isSendable?.('phase17-uploaded-sticker') === true,
      stickerImage: await image(stickerImage?.src || ''),
      mailboxTitle: mailbox?.items?.[0]?.title || '',
      mailboxMediaIds: [...(window.__duoMailbox?.getReferencedMediaIds?.() || [])],
      circlePostText: circle?.posts?.[0]?.text || '',
      circleMediaMissing: circleEnsure?.missing ?? -1,
      circleImage: await image(circleUrl), circleAvatarImage: await image(circleAvatarUrl), circleCoverImage: await image(circleCoverUrl),
      fontCount: Array.isArray(fontRows) ? fontRows.length : -1,
      currentFontId: window.ChuanXunFontManager?.getCurrentFontId?.() || null,
      fontLoaded: document.fonts.check('16px "ChuanXunLocalFont_phase17_font"'),
      chatMediaPresent: !!(await window.getMediaRecord?.('phase17-chat-media'))?.blob
    };
  });

  assert.equal(boot.writable, true, 'isolated origin should own the writer lease');
  assert.equal(boot.startupComplete, true, 'full application startup should complete');
  assert.equal(boot.bootIssues.length, 0, 'valid synthetic seed should not trigger storage damage protection');
  assert.ok(boot.chatRows >= 2, 'chat messages should render from seeded application state');
  assert.equal(boot.chatTextVisible, true);
  assert.equal(boot.chatImage.decoded, true, 'chat image should decode from the isolated media store');
  assert.deepEqual(boot.cardIds, ['phase17-chat-card-id']);
  assert.deepEqual(boot.cardTexts, ['隔离演练主字卡']);
  assert.deepEqual(boot.dynamicCardIds, ['phase17-circle-dynamic-card-id']);
  assert.deepEqual(boot.dynamicCardTexts, ['隔离演练动态字卡']);
  assert.deepEqual(boot.replyCardIds, ['phase17-circle-reply-card-id']);
  assert.deepEqual(boot.replyCardTexts, ['隔离演练回复字卡']);
  assert.equal(boot.stickerSendable, true);
  assert.equal(boot.stickerImage.decoded, true, 'uploaded sticker should load from the isolated IndexedDB media record');
  assert.equal(boot.mailboxTitle, '隔离演练信件');
  assert.ok(boot.mailboxMediaIds.includes('phase17-mail-media'));
  assert.equal(boot.circlePostText, '第十七阶段合成朋友圈动态');
  assert.equal(boot.circleMediaMissing, 0, 'Circle media references should all resolve');
  assert.equal(boot.circleImage.decoded, true);
  assert.equal(boot.circleAvatarImage.decoded, true);
  assert.equal(boot.circleCoverImage.decoded, true);
  assert.equal(boot.fontCount, 1);
  assert.equal(boot.currentFontId, 'phase17_font');
  assert.equal(boot.fontLoaded, true, 'custom FontFace should load in real Chromium');
  assert.equal(boot.chatMediaPresent, true);

  await uploadedStickerImage.click();
  await page.waitForFunction(() => { const stored=JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1') || '{}'); return stored.chatHistory?.some(item => item.type==='sticker' && item.mediaId==='phase17-sticker-media') === true; }, null, { timeout: 15_000 });

  // Exercise the mixed batch path that is easy to miss in unit-only coverage:
  // queue text + image + sticker, delete the sticker after queueing, then prove
  // the entire batch rolls back without deleting the already-sent history sticker.
  const beforeStaleBatch = await page.evaluate(async () => {
    const stored = JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1') || '{}');
    const db = await new Promise((resolve,reject)=>{const req=indexedDB.open('dual_space_chat_media_v1',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    const ids = await new Promise((resolve,reject)=>{const tx=db.transaction('media','readonly');const req=tx.objectStore('media').getAllKeys();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);}); db.close();
    return { historyCount:stored.chatHistory?.length||0, lastChatAt:stored.offline?.lastChatAt||0, mediaIds:ids.map(String).sort() };
  });
  await page.locator('#batchBtn').click();
  await page.locator('#chatInput').fill('第十七阶段批量回滚文本');
  await page.locator('#sendBtn').click();
  await page.locator('#batchImageInput').setInputFiles({ name:'phase17-batch.png', mimeType:'image/png', buffer:Buffer.from(seed.pngBase64,'base64') });
  await page.waitForFunction(() => document.querySelectorAll('#batchQueueList .batch-queue-item').length===2, null, { timeout:10_000 });
  await page.evaluate(() => window.openStickerPanel());
  await page.locator('#stickerGrid [data-sticker-id="phase17-uploaded-sticker"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#batchQueueList .batch-queue-item').length===3, null, { timeout:10_000 });

  // Use the actual picker long-press/delete interaction, not a direct state edit.
  await page.evaluate(() => window.openStickerPanel());
  const stickerItem = page.locator('#stickerGrid [data-sticker-id="phase17-uploaded-sticker"]');
  await stickerItem.scrollIntoViewIfNeeded();
  const stickerBox = await stickerItem.boundingBox();
  assert.ok(stickerBox, 'uploaded sticker must remain visible for deletion test');
  await page.mouse.move(stickerBox.x + stickerBox.width / 2, stickerBox.y + stickerBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.locator('#stickerGrid [data-sticker-delete="phase17-uploaded-sticker"]').waitFor({ state:'visible', timeout:5_000 });
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#stickerGrid [data-sticker-delete="phase17-uploaded-sticker"]').click();
  await page.waitForFunction(() => window.__duoStickerState?.isSendable?.('phase17-uploaded-sticker')===false, null, { timeout:10_000 });
  const queuedStickerState = await page.evaluate(() => ({
    libraryItemPresent:window.__duoStickerState?.exportSnapshot?.()?.items?.some(item=>item.id==='phase17-uploaded-sticker')===true,
    tombstoned:window.__duoStickerState?.exportSnapshot?.()?.tombstones?.some(item=>item.id==='phase17-uploaded-sticker')===true,
    oldHistoryMessage:JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.some(item=>item.type==='sticker'&&item.mediaId==='phase17-sticker-media')===true
  }));
  assert.equal(queuedStickerState.libraryItemPresent, false, 'deleted sticker must leave the authoritative library');
  assert.equal(queuedStickerState.tombstoned, true, 'deletion must persist a tombstone');
  assert.equal(queuedStickerState.oldHistoryMessage, true, 'already-sent sticker history must remain intact');

  await page.locator('#batchSendBtn').click();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('批量发送失败')===true, null, { timeout:15_000 });
  const staleBatchRollback = await page.evaluate(async () => {
    const stored = JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1') || '{}');
    const db = await new Promise((resolve,reject)=>{const req=indexedDB.open('dual_space_chat_media_v1',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    const rows = await new Promise((resolve,reject)=>{const tx=db.transaction('media','readonly');const req=tx.objectStore('media').getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);}); db.close();
    return { historyCount:stored.chatHistory?.length||0, lastChatAt:stored.offline?.lastChatAt||0, mediaIds:rows.map(row=>String(row.id)).sort(), queueCount:document.querySelectorAll('#batchQueueList .batch-queue-item').length };
  });
  assert.equal(staleBatchRollback.historyCount, beforeStaleBatch.historyCount, 'a deleted queued sticker must roll back preceding text and image messages');
  assert.equal(staleBatchRollback.lastChatAt, beforeStaleBatch.lastChatAt, 'failed batch must not advance the chat timestamp');
  assert.deepEqual(staleBatchRollback.mediaIds, beforeStaleBatch.mediaIds, 'failed batch image Blob must be removed while old history media is retained');
  assert.equal(staleBatchRollback.queueCount, 3, 'failed batch stays available for user review');

  // Remove only the now-invalid queue row, then prove the remaining text+image
  // batch can commit and survive reload.
  await page.locator('#batchQueueList [data-batch-remove="2"]').click();
  await page.locator('#batchSendBtn').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.some(item=>item.text==='第十七阶段批量回滚文本')===true, null, { timeout:15_000 });
  const committedBatch = await page.evaluate(() => {
    const stored=JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}');
    return { textPresent:stored.chatHistory?.some(item=>item.type==='text'&&item.text==='第十七阶段批量回滚文本')===true, image:stored.chatHistory?.find(item=>item.type==='image'&&item.mediaName==='phase17-batch.png')||null };
  });
  assert.equal(committedBatch.textPresent, true);
  assert.ok(committedBatch.image?.mediaId, 'mixed batch should commit its image media reference');

  // Exercise direct image selection, preview, send and persistence separately
  // from the seeded-image render path and the batch-image path.
  await page.locator('#chatImageUploader').setInputFiles({ name:'phase17-direct-upload.png', mimeType:'image/png', buffer:Buffer.from(seed.pngBase64,'base64') });
  await page.waitForFunction(() => document.querySelector('#mediaPreviewModal')?.classList.contains('show')===true, null, { timeout:10_000 });
  await page.locator('#mediaPreviewSend').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.some(item=>item.type==='image'&&item.mediaName==='phase17-direct-upload.png')===true, null, { timeout:15_000 });

  // Exercise a real video file through picker -> metadata preview -> send -> playback.
  const videoFixture = path.join(ROOT, 'tests/fixtures/phase23-video.webm');
  await page.locator('#chatVideoUploader').setInputFiles(videoFixture);
  await page.waitForFunction(() => {
    const video=document.querySelector('#mediaPreviewContent video');
    return document.querySelector('#mediaPreviewModal')?.classList.contains('show')===true && !!video && video.readyState>=1 && video.videoWidth===32;
  }, null, { timeout:20_000 });
  await page.locator('#mediaPreviewSend').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.some(item=>item.type==='video'&&item.mediaName==='phase23-video.webm')===true, null, { timeout:20_000 });
  await page.waitForFunction(() => {
    const message=JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.find(item=>item.type==='video'&&item.mediaName==='phase23-video.webm');
    const row=[...document.querySelectorAll('#chatList [data-mid]')].find(item=>item.dataset.mid===String(message?.id||''));
    const video=row?.querySelector('video.message-video');
    return !!video && video.readyState>=1 && video.videoWidth===32 && video.duration>0;
  }, null, { timeout:20_000 });
  const videoPlayback = await page.evaluate(async () => {
    const message=JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.find(item=>item.type==='video'&&item.mediaName==='phase23-video.webm');
    const row=[...document.querySelectorAll('#chatList [data-mid]')].find(item=>item.dataset.mid===String(message?.id||''));
    const video=row?.querySelector('video.message-video');
    if(!video)return {ready:false,played:false};
    video.muted=true;try{await video.play();await new Promise(resolve=>{if(video.currentTime>0.1)return resolve();video.addEventListener('timeupdate',resolve,{once:true});setTimeout(resolve,1000);});}catch(_){}
    const played=video.currentTime>0.05;video.pause();
    return {ready:video.readyState>=1,width:video.videoWidth,height:video.videoHeight,duration:video.duration,played};
  });
  assert.equal(videoPlayback.ready,true);
  assert.equal(videoPlayback.width,32);
  assert.equal(videoPlayback.height,32);
  assert.equal(videoPlayback.played,true,'the uploaded video should advance during playback, not merely have metadata');

  // Exercise actual fake-microphone MediaRecorder. Backup must refuse to snapshot
  // while a capture is active; cancellation must not create a partial audio row.
  await page.locator('#voiceToggleBtn').click();
  const audioCountBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.filter(item=>item.type==='audio').length||0);
  const holdBox=await page.locator('#holdTalk').boundingBox();assert.ok(holdBox,'hold-to-talk control should be visible in voice mode');
  await page.mouse.move(holdBox.x+holdBox.width/2,holdBox.y+holdBox.height/2);await page.mouse.down();
  await page.waitForFunction(() => document.querySelector('#inputShell')?.classList.contains('recording')===true, null, {timeout:15_000});
  await page.waitForTimeout(650);
  const backupDuringRecording = await page.evaluate(async () => {try{await window.__duoBackupV4.build('all');return 'unexpected-success';}catch(error){return String(error?.message||error);}});
  assert.match(backupDuringRecording,/语音录制/,'backup must refuse to snapshot while a microphone recorder is active');
  await page.mouse.up();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.some(item=>item.type==='audio')===true, null, {timeout:20_000});
  await page.waitForFunction(() => {const audio=document.querySelector('#chatList .audio-bubble audio');return !!audio&&audio.readyState>=1&&Number.isFinite(audio.duration)&&audio.duration>0;},null,{timeout:20_000});
  const audioPlayback = await page.evaluate(async () => {const audio=document.querySelector('#chatList .audio-bubble audio');if(!audio)return {ready:false,played:false};audio.muted=true;try{await audio.play();await new Promise(resolve=>{if(audio.currentTime>0.03)return resolve();audio.addEventListener('timeupdate',resolve,{once:true});setTimeout(resolve,1000);});}catch(_){}const played=audio.currentTime>0.02;audio.pause();return {ready:audio.readyState>=1,duration:audio.duration,played};});
  assert.equal(audioPlayback.ready,true);
  assert.equal(audioPlayback.played,true,'recorded audio should advance during playback');

  // A second recording cancelled explicitly must never add a history row.
  const beforeCancelledAudio = await page.evaluate(() => JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.filter(item=>item.type==='audio').length||0);
  const holdBox2=await page.locator('#holdTalk').boundingBox();await page.mouse.move(holdBox2.x+holdBox2.width/2,holdBox2.y+holdBox2.height/2);await page.mouse.down();
  await page.waitForFunction(() => document.querySelector('#inputShell')?.classList.contains('recording')===true,null,{timeout:15_000});
  await page.waitForTimeout(120);await page.locator('#voiceCancelBtn').evaluate(node=>node.click());await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#inputShell')?.classList.contains('recording')!==true,null,{timeout:10_000});
  await page.waitForTimeout(250);
  const afterCancelledAudio=await page.evaluate(()=>JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.filter(item=>item.type==='audio').length||0);
  assert.equal(afterCancelledAudio,beforeCancelledAudio,'cancelled recording must not be persisted as a partial audio message');

  await page.evaluate(() => window.goto('circlePage'));
  await page.waitForFunction(() => !!window.__duoCircleRoot?.querySelector('#feed .post-media img'), null, { timeout: 20_000 });
  const circleDomImage = await page.evaluate(async () => {
    const img = window.__duoCircleRoot.querySelector('#feed .post-media img');
    try { await img.decode(); } catch (_) {}
    return { complete: img.complete, width: img.naturalWidth, alt: img.alt };
  });
  assert.equal(circleDomImage.complete, true);
  assert.equal(circleDomImage.width, 1, 'Circle post image should decode from IndexedDB-backed object URL');

  await page.evaluate(() => { window.goto('mailPage'); window.__duoMailbox.render(); });
  await page.locator('[data-mail-open="phase17-letter"]').click();
  await page.waitForFunction(() => !!document.querySelector('#mailReadImages img'), null, { timeout: 20_000 });
  const mailDomImage = await page.evaluate(async () => {
    const img = document.querySelector('#mailReadImages img');
    try { await img.decode(); } catch (_) {}
    return { complete: img.complete, width: img.naturalWidth, title: document.querySelector('#mailReadTitle')?.textContent || '' };
  });
  assert.equal(mailDomImage.title, '隔离演练信件');
  assert.equal(mailDomImage.complete, true);
  assert.equal(mailDomImage.width, 1, 'mail attachment should decode from the shared media database');

  // Create a new outgoing letter through the actual compose UI, persist a new attachment,
  // reopen it, then delete the letter while the same media ID remains referenced by chat.
  await page.locator('#mailReadClose').click();
  await page.locator('#mailComposeBtn').click();
  await page.locator('#mailComposeTitle').fill('第二十四阶段新寄出信件');
  await page.locator('#mailComposeContent').fill('附件共享引用保护演练');
  await page.locator('#mailImageInput').setInputFiles({ name:'phase24-letter-attachment.png', mimeType:'image/png', buffer:Buffer.from(seed.pngBase64,'base64') });
  await page.waitForFunction(() => {const img=document.querySelector('#mailComposeImagesPreview img');return !!img&&img.complete&&img.naturalWidth===1;},null,{timeout:15_000});
  await page.locator('#mailComposeSend').click();
  await page.waitForFunction(() => window.__duoMailbox?.exportData?.()?.mailbox?.items?.some(item=>item.title==='第二十四阶段新寄出信件')===true,null,{timeout:15_000});
  const sentLetterMeta=await page.evaluate(()=>{const letter=window.__duoMailbox.exportData().mailbox.items.find(item=>item.title==='第二十四阶段新寄出信件');return {id:letter?.id,mediaId:letter?.images?.[0]?.id||null};});
  assert.ok(sentLetterMeta.id&&sentLetterMeta.mediaId,'outgoing letter must persist its attachment ID');
  await page.locator(`[data-mail-open="${sentLetterMeta.id}"]`).click();
  await page.waitForFunction(() => {const img=document.querySelector('#mailReadImages img');return !!img&&img.complete&&img.naturalWidth===1;},null,{timeout:15_000});
  await page.evaluate(({mediaId})=>{
    const key='dual_space_app_clean_test_v1';const stored=JSON.parse(localStorage.getItem(key)||'{}');
    stored.chatHistory=Array.isArray(stored.chatHistory)?stored.chatHistory:[];
    stored.chatHistory.push({id:'phase24-shared-mail-attachment',type:'image',mediaId,mediaName:'shared-mail-attachment',time:Date.now()});
    localStorage.setItem(key,JSON.stringify(stored));
  },{mediaId:sentLetterMeta.mediaId});
  await page.locator('#mailDeleteBtn').click();
  await page.waitForFunction(id=>!window.__duoMailbox.exportData().mailbox.items.some(item=>item.id===id),sentLetterMeta.id,{timeout:15_000});
  const sharedMailMedia=await page.evaluate(async id=>!!(await window.getMediaRecord(id))?.blob,sentLetterMeta.mediaId);
  assert.equal(sharedMailMedia,true,'deleting a letter must not delete its attachment while chat still references the same media ID');
  // Verify scheduled auto-reply creation and cancellation when its outgoing source is deleted.
  await page.evaluate(()=>{const data=window.__duoMailbox.exportData().mailbox;data.settings.autoReply=true;data.settings.cardCountMin=1;data.settings.cardCountMax=1;window.__duoMailbox.importData({mailbox:data});});
  await page.locator('#mailComposeBtn').click();
  await page.locator('#mailComposeTitle').fill('第二十五阶段自动回信演练');
  await page.locator('#mailComposeContent').fill('触发自动回信的来源信件');
  await page.locator('#mailComposeSend').click();
  await page.waitForFunction(()=>window.__duoMailbox.exportData().mailbox.items.some(item=>item.title==='第二十五阶段自动回信演练'),null,{timeout:15_000});
  const autoReplySource=await page.evaluate(()=>{const data=window.__duoMailbox.exportData().mailbox;const letter=data.items.find(item=>item.title==='第二十五阶段自动回信演练');return {id:letter?.id,pending:data.pending.find(task=>task.sourceId===letter?.id)?.id};});
  assert.ok(autoReplySource.id&&autoReplySource.pending,'outgoing letter schedules one auto-reply task');
  await page.evaluate(id=>{const data=window.__duoMailbox.exportData().mailbox;const task=data.pending.find(item=>item.id===id);if(task)task.due=Date.now()-1;window.__duoMailbox.importData({mailbox:data});window.__duoMailbox.processDue();},autoReplySource.pending);
  await page.waitForFunction(id=>window.__duoMailbox.exportData().mailbox.items.some(item=>item.type==='incoming'&&item.replyToId===id),autoReplySource.id,{timeout:15_000});
  await page.locator('#mailComposeBtn').click();
  await page.locator('#mailComposeTitle').fill('第二十五阶段待取消回信来源');
  await page.locator('#mailComposeContent').fill('删除后不应该继续自动回信');
  await page.locator('#mailComposeSend').click();
  await page.waitForFunction(()=>window.__duoMailbox.exportData().mailbox.items.some(item=>item.title==='第二十五阶段待取消回信来源'),null,{timeout:15_000});
  const cancellableSource=await page.evaluate(()=>{const data=window.__duoMailbox.exportData().mailbox;const letter=data.items.find(item=>item.title==='第二十五阶段待取消回信来源');return {id:letter?.id,pending:data.pending.find(task=>task.sourceId===letter?.id)?.id};});
  assert.ok(cancellableSource.id&&cancellableSource.pending);
  await page.locator(`[data-mail-open="${cancellableSource.id}"]`).click();
  await page.locator('#mailDeleteBtn').click();
  await page.waitForFunction(({sourceId,taskId})=>{const data=window.__duoMailbox.exportData().mailbox;return !data.items.some(item=>item.id===sourceId)&&!data.pending.some(task=>task.id===taskId);},{sourceId:cancellableSource.id,taskId:cancellableSource.pending},{timeout:15_000});

  // Circle: choose a real PNG in the post composer, publish it, open the detail, and delete it.
  // The transaction should then remove only the media that has no remaining module references.
  await page.evaluate(() => window.goto('circlePage'));
  const circle=page.locator('#circleMount');
  await circle.locator('#cameraBtn').click();
  await circle.locator('#postMediaInput').setInputFiles({ name:'phase24-circle-post.png', mimeType:'image/png', buffer:Buffer.from(seed.pngBase64,'base64') });
  await page.waitForFunction(() => {const img=window.__duoCircleRoot?.querySelector('#mediaPreviewGrid img');return !!img&&img.complete&&img.naturalWidth===1;},null,{timeout:15_000});
  await circle.locator('#postInput').fill('第二十四阶段朋友圈主动发布');
  await circle.locator('#submitPostBtn').click();
  await page.waitForFunction(() => window.__duoCircleApi?.exportState?.()?.posts?.some(post=>post.text==='第二十四阶段朋友圈主动发布'&&post.media?.length===1)===true,null,{timeout:20_000});
  const newPostMeta=await page.evaluate(()=>{const post=window.__duoCircleApi.exportState().posts.find(item=>item.text==='第二十四阶段朋友圈主动发布');return {id:post?.id,src:post?.media?.[0]?.src||''};});
  assert.ok(newPostMeta.id&&newPostMeta.src.startsWith('idb-media:'),'published Circle media must use a durable IndexedDB reference');
  const newPostMediaId=newPostMeta.src.slice('idb-media:'.length);
  const publishedCircleMedia=await page.evaluate(async id=>!!(await window.getMediaRecord(id))?.blob,newPostMediaId);
  assert.equal(publishedCircleMedia,true);
  await circle.locator(`[data-open-viewer="${newPostMeta.id}"]`).click();
  await circle.locator('#viewerDetailBtn').click();
  // Edit the existing owned post, retain its ID/history, replace its media and
  // verify the removed old media is reclaimed only after the post commit.
  await circle.locator('#detailTopMenuBtn').click();
  await circle.locator('#editCurrentPostBtn').click();
  await circle.locator('#postInput').fill('第二十五阶段朋友圈动态编辑后内容');
  // Remove the old exclusive image, then select its replacement. The old Blob
  // must be reclaimed only after the post edit commits and global refs are scanned.
  await circle.locator('#mediaPreviewGrid [data-remove-media="0"]').click();
  await circle.locator('#postMediaInput').setInputFiles({ name:'phase25-circle-edited.png', mimeType:'image/png', buffer:Buffer.from(seed.pngBase64,'base64') });
  await page.waitForFunction(() => window.__duoCircleRoot?.querySelectorAll('#mediaPreviewGrid img').length===1,null,{timeout:15_000});
  await circle.locator('#submitPostBtn').click();
  await page.waitForFunction(({id})=>{const post=window.__duoCircleApi?.exportState?.()?.posts?.find(item=>item.id===id);return post?.text==='第二十五阶段朋友圈动态编辑后内容'&&post.media?.length===1;},{id:newPostMeta.id},{timeout:20_000});
  const editedPostMeta=await page.evaluate(id=>{const post=window.__duoCircleApi.exportState().posts.find(item=>item.id===id);return {id:post?.id,ts:post?.ts,srcs:post?.media?.map(item=>item.src)||[]};},newPostMeta.id);
  assert.equal(editedPostMeta.id,newPostMeta.id,'editing keeps the original post ID');
  assert.ok(editedPostMeta.srcs.every(src=>src.startsWith('idb-media:')),'edited post media must remain durable references');
  await page.waitForFunction(async id=>!(await window.getMediaRecord(id))?.blob,newPostMediaId,{timeout:15_000});
  const editedMediaId=editedPostMeta.srcs[0].slice('idb-media:'.length);
  assert.equal(!!(await page.evaluate(async id=>!!(await window.getMediaRecord(id))?.blob,editedMediaId)),true);
  await circle.locator(`[data-open-viewer="${newPostMeta.id}"]`).click();
  await circle.locator('#viewerDetailBtn').click();
  await circle.locator('#detailInlineDelete').click();
  await circle.locator('#confirmOkBtn').click();
  await page.waitForFunction(id=>!window.__duoCircleApi.exportState().posts.some(post=>post.id===id),newPostMeta.id,{timeout:15_000});
  await page.waitForFunction(async id=>!(await window.getMediaRecord(id))?.blob,editedMediaId,{timeout:15_000});

  // Save a new avatar and cover through the profile settings UI. Then remove the cover
  // while a synthetic chat reference still owns its media ID; global GC must preserve it.
  await circle.locator('#backBtn').click();
  await circle.locator('#myAvatarInput').setInputFiles({ name:'phase24-avatar.png', mimeType:'image/png', buffer:Buffer.from(seed.pngBase64,'base64') });
  await circle.locator('#myCoverInput').setInputFiles({ name:'phase24-cover.png', mimeType:'image/png', buffer:Buffer.from(seed.pngBase64,'base64') });
  await page.waitForFunction(() => !!window.__duoCircleRoot?.querySelector('#saveHint')?.textContent?.trim(),null,{timeout:15_000});
  await circle.locator('#saveSettingsBtn').click();
  await page.waitForFunction(() => {const s=window.__duoCircleApi?.exportState?.();return !!s?.myAvatar?.startsWith('idb-media:')&&!!s?.myCover?.startsWith('idb-media:');},null,{timeout:20_000});
  const profileMedia=await page.evaluate(async()=>{
    const state=window.__duoCircleApi.exportState();
    const decode=async ref=>{const src=window.__duoCircleMedia.resolve(ref);if(!src)return false;const img=new Image();img.src=src;try{await img.decode();return img.naturalWidth===1;}catch(_){return false;}};
    return {avatar:state.myAvatar,cover:state.myCover,avatarDecoded:await decode(state.myAvatar),coverDecoded:await decode(state.myCover)};
  });
  assert.ok(profileMedia.avatar.startsWith('idb-media:')&&profileMedia.cover.startsWith('idb-media:'));
  assert.equal(profileMedia.avatarDecoded,true);assert.equal(profileMedia.coverDecoded,true);
  const sharedCoverId=profileMedia.cover.slice('idb-media:'.length);
  const sharedAvatarId=profileMedia.avatar.slice('idb-media:'.length);
  await page.evaluate(id=>{const current=window.__duoCircleApi.exportState();current.otherAvatar='idb-media:'+id;window.__duoCircleApi.importState(current);},sharedAvatarId);
  await circle.locator('#clearMyAvatarBtn').click();
  await circle.locator('#saveSettingsBtn').click();
  await page.waitForFunction(id=>{const s=window.__duoCircleApi.exportState();return s.myAvatar===''&&s.otherAvatar==='idb-media:'+id;},sharedAvatarId,{timeout:15_000});
  const sharedProfileAvatarStillPresent=await page.evaluate(async id=>!!(await window.getMediaRecord(id))?.blob,sharedAvatarId);
  assert.equal(sharedProfileAvatarStillPresent,true,'clearing one profile avatar must preserve the same media still used by the other profile');
  await page.evaluate(id=>{const key='dual_space_app_clean_test_v1';const stored=JSON.parse(localStorage.getItem(key)||'{}');stored.chatHistory=Array.isArray(stored.chatHistory)?stored.chatHistory:[];stored.chatHistory.push({id:'phase24-shared-cover-reference',type:'image',mediaId:id,mediaName:'shared-cover',time:Date.now()});localStorage.setItem(key,JSON.stringify(stored));},sharedCoverId);
  await circle.locator('#clearCoverBtn').click();
  await circle.locator('#saveSettingsBtn').click();
  await page.waitForFunction(() => window.__duoCircleApi?.exportState?.()?.myCover==='',null,{timeout:15_000});
  const sharedCoverStillPresent=await page.evaluate(async id=>!!(await window.getMediaRecord(id))?.blob,sharedCoverId);
  assert.equal(sharedCoverStillPresent,true,'clearing a Circle cover must preserve its media while chat references it');

  await page.evaluate(() => window.goto('chatPage'));
  await page.locator('#chatInput').fill('第十七阶段隔离环境发送回归');
  await page.locator('#sendBtn').click();
  await page.waitForFunction(() => document.querySelector('#chatList')?.textContent.includes('第十七阶段隔离环境发送回归') === true, null, { timeout: 15_000 });
  const persistedMessage = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1') || '{}');
    return stored.chatHistory?.some(item => item.text === '第十七阶段隔离环境发送回归' && item.type === 'text') === true;
  });
  assert.equal(persistedMessage, true, 'real chat send should persist in the isolated origin');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForWritableRuntime(page);
  await page.waitForFunction(() => {
    const stored = JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1') || '{}');
    const rows = [...document.querySelectorAll('#chatList [data-mid]')];
    const decodes = ['phase17-batch.png','phase17-direct-upload.png'].map(name => {
      const message = stored.chatHistory?.find(item => item.type==='image' && item.mediaName===name);
      const row = rows.find(item => item.dataset.mid===String(message?.id || ''));
      const image = row?.querySelector('img');
      return !!image && image.complete && image.naturalWidth===1;
    });
    return decodes.every(Boolean);
  }, null, { timeout:20_000 });
  const afterReload = await page.evaluate(async () => ({
    chatPersisted: document.querySelector('#chatList')?.textContent.includes('第十七阶段隔离环境发送回归') === true,
    stickerMessagePersisted: JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1') || '{}').chatHistory?.some(item => item.type==='sticker' && item.mediaId==='phase17-sticker-media') === true,
    stickerSendable: window.__duoStickerState?.isSendable?.('phase17-uploaded-sticker') === true,
    oldStickerHistoryImageDecoded: await (async()=>{const row=JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.find(item=>item.type==='sticker'&&item.mediaId==='phase17-sticker-media');const node=[...document.querySelectorAll('#chatList [data-mid]')].find(item=>item.dataset.mid===String(row?.id||''))?.querySelector('img');if(!node)return false;try{await node.decode();return node.naturalWidth===1;}catch(_){return false;}})(),
    batchTextPersisted: JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.some(item=>item.type==='text'&&item.text==='第十七阶段批量回滚文本')===true,
    batchImagePersisted: JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.some(item=>item.type==='image'&&item.mediaName==='phase17-batch.png')===true,
    directImagePersisted: JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.some(item=>item.type==='image'&&item.mediaName==='phase17-direct-upload.png')===true,
    batchImageDecoded: await (async()=>{const rowData=JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.find(item=>item.type==='image'&&item.mediaName==='phase17-batch.png');const row=[...document.querySelectorAll('#chatList [data-mid]')].find(item=>item.dataset.mid===String(rowData?.id||''));const img=row?.querySelector('img');if(!img)return false;try{await img.decode();return img.naturalWidth===1;}catch(_){return false;}})(),
    directImageDecoded: await (async()=>{const rowData=JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.find(item=>item.type==='image'&&item.mediaName==='phase17-direct-upload.png');const row=[...document.querySelectorAll('#chatList [data-mid]')].find(item=>item.dataset.mid===String(rowData?.id||''));const img=row?.querySelector('img');if(!img)return false;try{await img.decode();return img.naturalWidth===1;}catch(_){return false;}})(),
    video: await (async()=>{const msg=JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.find(item=>item.type==='video'&&item.mediaName==='phase23-video.webm');const row=[...document.querySelectorAll('#chatList [data-mid]')].find(item=>item.dataset.mid===String(msg?.id||''));const node=row?.querySelector('video.message-video');if(!node)return {present:false,ready:false,played:false};node.muted=true;try{await node.play();await new Promise(resolve=>{if(node.currentTime>0.05)return resolve();node.addEventListener('timeupdate',resolve,{once:true});setTimeout(resolve,1000);});}catch(_){}const result={present:true,ready:node.readyState>=1,width:node.videoWidth,duration:node.duration,played:node.currentTime>0.02};node.pause();return result;})(),
    audio: await (async()=>{const msg=JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1')||'{}').chatHistory?.find(item=>item.type==='audio');const row=[...document.querySelectorAll('#chatList [data-mid]')].find(item=>item.dataset.mid===String(msg?.id||''));const node=row?.querySelector('audio');if(!node)return {present:false,ready:false,played:false};node.muted=true;try{await node.play();await new Promise(resolve=>{if(node.currentTime>0.02)return resolve();node.addEventListener('timeupdate',resolve,{once:true});setTimeout(resolve,1000);});}catch(_){}const result={present:true,ready:node.readyState>=1,duration:node.duration,played:node.currentTime>0.01};node.pause();return result;})(),
    cardText: window.__duoCardSystem?.getPoolItems?.('chat')?.[0]?.text || '',
    mailboxCount: window.__duoMailbox?.exportData?.()?.mailbox?.items?.length || 0,
    circlePostCount: window.__duoCircleApi?.exportState?.()?.posts?.length || 0,
    fontId: window.ChuanXunFontManager?.getCurrentFontId?.() || null,
    fontLoaded: document.fonts.check('16px "ChuanXunLocalFont_phase17_font"'),
    missingCircleMedia: (await window.__duoCircleMedia?.ensure?.())?.missing ?? -1,
    circleAvatarResolved: !!window.__duoCircleMedia?.resolve?.('idb-media:phase17-circle-avatar'),
    circleCoverResolved: !!window.__duoCircleMedia?.resolve?.('idb-media:phase17-circle-cover')
  }));
  assert.equal(afterReload.chatPersisted, true);
  assert.equal(afterReload.stickerMessagePersisted, true);
  assert.equal(afterReload.stickerSendable, false, 'deleted picker item must remain unavailable after reload');
  assert.equal(afterReload.oldStickerHistoryImageDecoded, true, 'deleting an uploaded sticker must not break its already-sent chat history');
  assert.equal(afterReload.batchTextPersisted, true);
  assert.equal(afterReload.batchImagePersisted, true);
  assert.equal(afterReload.directImagePersisted, true);
  assert.equal(afterReload.batchImageDecoded, true);
  assert.equal(afterReload.directImageDecoded, true);
  assert.equal(afterReload.video.present, true);assert.equal(afterReload.video.ready, true);assert.equal(afterReload.video.width, 32);assert.equal(afterReload.video.played, true);
  assert.equal(afterReload.audio.present, true);assert.equal(afterReload.audio.ready, true);assert.equal(afterReload.audio.played, true);
  assert.equal(afterReload.cardText, '隔离演练主字卡');
  assert.equal(afterReload.mailboxCount, 1);
  assert.equal(afterReload.circlePostCount, 1);
  assert.equal(afterReload.fontId, 'phase17_font');
  assert.equal(afterReload.fontLoaded, true);
  assert.equal(afterReload.missingCircleMedia, 0);
  assert.equal(afterReload.circleAvatarResolved, true);
  assert.equal(afterReload.circleCoverResolved, true);

  await context.close();
  return { origin: seeded.origin, boot, staleBatchRollback, committedBatch, videoPlayback, audioPlayback, backupDuringRecording, cancelledAudioCount:afterCancelledAudio, afterReload };
}

async function testMissingMediaFailsNonDestructively(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await context.newPage();
  attachGuards(page, 'missing-media');
  const seed = createMissingMediaSeed();
  const seeded = await seedIsolatedOrigin(page, baseUrl, seed, null);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForWritableRuntime(page);
  await page.waitForFunction(() => document.querySelector('#chatList')?.textContent.includes('媒体文件丢失') === true, null, { timeout: 20_000 });
  const result = await page.evaluate(async () => {
    const stored = JSON.parse(localStorage.getItem('dual_space_app_clean_test_v1') || '{}');
    const audit = await window.auditMediaStorage({ cleanup: true, graceMs: 7 * 24 * 60 * 60 * 1000 });
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dual_space_chat_media_v1', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction('media', 'readonly'); const request = tx.objectStore('media').getAll();
      request.onsuccess = () => resolve(request.result || []); request.onerror = () => reject(request.error);
    });
    db.close();
    return { mediaIdRetained: stored.chatHistory?.[0]?.mediaId === 'phase17-missing-media', missingIds: audit.missingIds || [], mediaRows: rows.length };
  });
  assert.equal(result.mediaIdRetained, true, 'missing media reference must not be silently removed from chat history');
  assert.ok(result.missingIds.includes('phase17-missing-media'));
  assert.equal(result.mediaRows, 0, 'health audit must not fabricate a replacement media record');
  await context.close();
  return { origin: seeded.origin, result };
}

async function findFontFixture() {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
  ];
  for (const candidate of candidates) {
    try { return await readFile(candidate); } catch {}
  }
  throw new Error('CI 环境缺少用于真实 FontFace 演练的 TTF 测试字体');
}

async function main() {
  const { server, url } = await startStaticServer();
  const font = await findFontFixture();
  const fontBase64 = font.toString('base64');
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
    const valid = await testValidRuntimeRehearsal(browser, url, fontBase64);
    const damaged = await testMissingMediaFailsNonDestructively(browser, url);
    assert.equal(errors.filter(item => item.type === 'pageerror').length, 0, JSON.stringify(errors.filter(item => item.type === 'pageerror'), null, 2));
    assert.equal(errors.filter(item => item.type === 'external-request').length, 0, 'isolated rehearsal must not contact external origins');
    console.log('PASS: fresh isolated Chromium origin booted the full Twodeers app from synthetic canonical localStorage/IndexedDB seed; chat send/reload, image and video upload/preview/playback, fake-microphone MediaRecorder commit/cancel/playback, stable-ID cards, uploaded sticker, outgoing mailbox attachment lifecycle and shared-media protection, Circle post publish/delete and avatar/cover replacement, custom FontFace, single-writer startup and non-destructive missing-media handling were exercised.');
    console.log(JSON.stringify({ validOrigin: valid.origin, validReload: valid.afterReload, missingMedia: damaged.result, pageErrors: errors.filter(item => item.type === 'pageerror').length, externalRequests: 0 }, null, 2));
  } finally {
    try { await browser?.close(); } catch {}
    await new Promise(resolve => server.close(resolve));
  }
}

await main();
