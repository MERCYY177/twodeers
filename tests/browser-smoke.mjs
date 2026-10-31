import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));

try {
  await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    !!window.__duoBackupV4 &&
    !!window.ChuanXunFontManager &&
    !!document.getElementById('duoThemeMode') &&
    !!document.getElementById('duoFontPanel'),
    { timeout: 15000 }
  );

  const baseline = await page.evaluate(() => ({
    circleApi: !!window.__duoCircleApi?.validateState,
    twoColumns: document.querySelectorAll('#emojiPanel .emoji-panel-columns > .emoji-column').length,
    tabs: document.querySelectorAll('#duoStickerTabs [data-duo-sticker-tab]').length,
    backupVersion: window.__duoBackupV4.version,
    snapshotCoordinator: !!window.BackupSnapshotCoordinator,
    fileService: !!window.BackupFileService
  }));
  assert.equal(baseline.circleApi, true, 'Circle Shadow DOM API should be available');
  assert.equal(baseline.twoColumns, 2, 'the original two-column emoji panel must remain');
  assert.equal(baseline.tabs, 3, 'sticker categories should be mounted');
  assert.equal(baseline.backupVersion, 4);
  assert.equal(baseline.snapshotCoordinator, true, 'revisioned snapshot coordinator should be loaded');
  assert.equal(baseline.fileService, true, 'unified file service should be loaded');

  const fileServiceResult = await page.evaluate(async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    try {
      const foreignBlob = new frame.contentWindow.Blob(['cross-frame-backup'], { type: 'application/octet-stream' });
      const original = window.triggerDownloadBlob;
      let captured = null;
      window.triggerDownloadBlob = (name, blob) => { captured = { name, blob }; return true; };
      const result = await window.BackupFileService.save('cross-frame.bin', foreignBlob);
      window.triggerDownloadBlob = original;
      return { result, name: captured.name, sameRealm: captured.blob instanceof Blob, text: await captured.blob.text() };
    } finally { frame.remove(); }
  });
  assert.equal(fileServiceResult.result.status, 'handed-off');
  assert.equal(fileServiceResult.name, 'cross-frame.bin');
  assert.equal(fileServiceResult.sameRealm, true);
  assert.equal(fileServiceResult.text, 'cross-frame-backup');

  const [browserDownload, browserSaveResult] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(async () => window.BackupFileService.save(
      'browser-save-roundtrip.txt',
      new Blob(['backup-file-service-roundtrip'], { type: 'text/plain' })
    ))
  ]);
  assert.equal(browserSaveResult.status, 'handed-off');
  assert.equal(browserDownload.suggestedFilename(), 'browser-save-roundtrip.txt');
  const downloadedStream = await browserDownload.createReadStream();
  const downloadedParts = [];
  for await (const part of downloadedStream) downloadedParts.push(part);
  assert.equal(Buffer.concat(downloadedParts).toString('utf8'), 'backup-file-service-roundtrip',
    'browser download should be readable after the unified save service completes');

  await page.evaluate(() => {
    const p = document.getElementById('settingsPage');
    const card = document.getElementById('settingsParam');
    if (p) p.style.display = 'block';
    if (card) card.style.display = 'block';
  });
  await page.locator('#duoThemeMode').selectOption('dark');
  await page.locator('[data-duo-palette="ocean"]').click();
  const themeBeforeReload = await page.evaluate(() => ({
    mode: state.appearanceSettings.mode,
    palette: state.appearanceSettings.palette,
    resolved: document.documentElement.dataset.duoThemeResolved,
    circleBg: document.getElementById('circleMount').style.getPropertyValue('--bg')
  }));
  assert.equal(themeBeforeReload.mode, 'dark');
  assert.equal(themeBeforeReload.palette, 'ocean');
  assert.equal(themeBeforeReload.resolved, 'dark');
  assert.ok(themeBeforeReload.circleBg);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.duoThemeResolved === 'dark');
  const persistedTheme = await page.evaluate(() => state.appearanceSettings.palette);
  assert.equal(persistedTheme, 'ocean', 'theme choice should persist after reload');

  // Preserve and exercise all three existing sticker tabs; the builtin tab is an explicit
  // placeholder until its binary assets are migrated, not a source of fabricated images.
  assert.equal(await page.locator('#duoStickerTabs [data-duo-sticker-tab="uploads"]').count(), 1);
  assert.equal(await page.locator('#duoStickerTabs [data-duo-sticker-tab="favorites"]').count(), 1);
  assert.equal(await page.locator('#duoStickerTabs [data-duo-sticker-tab="builtin"]').count(), 1,
    'the builtin sticker entry must remain available');
  await page.evaluate(() => document.getElementById('emojiPanel').classList.add('show'));
  await page.locator('[data-duo-sticker-tab="builtin"]').click();
  assert.match(await page.locator('#stickerList').innerText(), /内置表情资源尚未迁入/);
  assert.match(await page.locator('#stickerList').innerText(), /没有写入伪造资源/);
  await page.locator('[data-duo-sticker-tab="uploads"]').click();

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+a8AAAAASUVORK5CYII=', 'base64');
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  await page.locator('#stickerUploader').setInputFiles([
    { name: 'smoke.png', mimeType: 'image/png', buffer: png },
    { name: 'smoke.gif', mimeType: 'image/gif', buffer: gif }
  ]);
  await page.waitForFunction(() => document.querySelectorAll('#stickerList [data-sticker-send]').length === 2);
  const uploaded = await page.evaluate(() => state.stickers.map(s => ({
    id: s.id, mediaId: s.mediaId, mimeType: s.mimeType
  })));
  assert.equal(uploaded.length, 2, 'both uploaded image files should create sticker records');
  assert.ok(uploaded.some(item => item.mimeType === 'image/png'), 'PNG upload should retain its MIME type');
  assert.ok(uploaded.some(item => item.mimeType === 'image/gif'), 'GIF upload should retain its MIME type');
  await page.waitForFunction(() => [...document.querySelectorAll('#stickerList img')]
    .every(img => img.complete && img.naturalWidth > 0), { timeout: 10000 });
  assert.equal(await page.locator('#stickerList img').count(), 2,
    'both PNG and GIF previews should be rendered as loaded images');

  // Favorite, unfavorite, and verify the empty-state rendering.
  await page.locator('#stickerList [data-duo-sticker-fav]').first().click();
  await page.locator('[data-duo-sticker-tab="favorites"]').click();
  assert.equal(await page.locator('#stickerList [data-sticker-send]').count(), 1,
    'favorites should contain only the selected uploaded sticker');
  assert.equal(await page.evaluate(() => state.stickerFavorites.length), 1);
  await page.locator('#stickerList [data-duo-sticker-fav]').click();
  assert.equal(await page.locator('#stickerList [data-sticker-send]').count(), 0,
    'unfavoriting should remove the sticker from favorites');
  assert.match(await page.locator('#stickerList').innerText(), /还没有收藏表情包/);

  // Re-favorite, reload, and verify persisted state in the favorites tab.
  await page.locator('[data-duo-sticker-tab="uploads"]').click();
  await page.locator('#stickerList [data-duo-sticker-fav]').first().click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('#duoStickerTabs'));
  await page.evaluate(() => document.getElementById('emojiPanel').classList.add('show'));
  assert.equal(await page.locator('#duoStickerTabs [data-duo-sticker-tab="builtin"]').count(), 1,
    'builtin tab must remain mounted after reload');
  await page.locator('[data-duo-sticker-tab="favorites"]').click();
  assert.equal(await page.locator('#stickerList [data-sticker-send]').count(), 1,
    'favorite should survive reload');
  assert.equal(await page.evaluate(() => state.stickerFavorites.length), 1);

  // Send the favorited sticker, then delete its upload entry. Chat history must retain
  // the media record because the message still references its mediaId.
  await page.locator('[data-duo-sticker-tab="uploads"]').click();
  await page.locator('#stickerList [data-sticker-send]').first().click();
  await page.waitForFunction(() => state.chatHistory.some(message => message.mediaId), { timeout: 5000 });
  const sentMediaId = await page.evaluate(() =>
    state.chatHistory.find(message => message.mediaId).mediaId);
  await page.evaluate(() => {
    const panel = document.getElementById('emojiPanel');
    panel.classList.add('show');
    panel.setAttribute('aria-hidden', 'false');
  });
  await page.locator('[data-duo-sticker-tab="uploads"]').click();
  await page.locator('#stickerList [data-sticker-del]').first().click();
  await page.waitForFunction(() => state.stickers.length === 1 && state.stickerFavorites.length === 0);
  assert.equal(await page.evaluate(async id => !!(await getMediaRecord(id)), sentMediaId), true,
    'deleting an uploaded sticker must preserve media still referenced by chat history');

  // The other upload has no chat reference; deleting it must remove its IndexedDB record.
  const orphanMediaId = uploaded.find(item => item.mediaId !== sentMediaId).mediaId;
  // Sending a sticker closes the panel. The browser smoke test is still on the
  // home page, so expand this app-level panel directly rather than clicking the
  // chat-only composer button in the hidden chatPage.
  await page.evaluate(() => {
    const panel = document.getElementById('emojiPanel');
    panel.classList.add('show');
    panel.setAttribute('aria-hidden', 'false');
  });
  await page.waitForFunction(() => {
    const panel = document.getElementById('emojiPanel');
    const button = document.querySelector('#stickerList [data-sticker-del]');
    return panel?.classList.contains('show') && button &&
      button.getClientRects().length > 0 &&
      getComputedStyle(button).visibility !== 'hidden';
  });
  await page.locator('#stickerList [data-sticker-del]').first().click();
  await page.waitForFunction(async id =>
    state.stickers.length === 0 && !(await getMediaRecord(id)), orphanMediaId);
  assert.equal(await page.evaluate(async id => !!(await getMediaRecord(id)), orphanMediaId), false,
    'unreferenced deleted sticker media should be cleaned up');

  // The builtin entry remains usable after upload cleanup and still shows its honest placeholder.
  await page.locator('[data-duo-sticker-tab="builtin"]').click();
  assert.match(await page.locator('#stickerList').innerText(), /内置表情资源尚未迁入/);

  // Exercise the real Circle save closure and its snapshot registration.
  const circleWriteResult = await page.evaluate(async () => {
    const api = window.__duoCircleApi;
    const coordinator = window.BackupSnapshotCoordinator;
    const originalState = api.exportState();
    const revisionBefore = coordinator.getRevision('circle');
    const candidate = {
      ...originalState,
      myName: 'snapshot-save-integration',
      posts: [...(originalState.posts || []), {
        id: 'snapshot-save-integration-post', author: 'me',
        text: 'circle-save-revision-check', ts: Date.now(), media: []
      }]
    };
    api.importState(candidate);
    const revisionAfterSave = coordinator.getRevision('circle');
    const persistedAfterSave = coordinator.getPersistedRevision('circle');
    const circleKey = Object.keys(localStorage).find(key => {
      try { return Array.isArray(JSON.parse(localStorage.getItem(key) || 'null')?.posts); }
      catch (_) { return false; }
    });
    const storedAfterSave = circleKey ? JSON.parse(localStorage.getItem(circleKey)) : null;

    const snapshot = await coordinator.beginSnapshot(['circle']);
    let snapshotInvalidated = false;
    try {
      api.importState({ ...api.exportState(), myName: 'snapshot-write-during-read' });
      try { snapshot.assertUnchanged(); }
      catch (error) { snapshotInvalidated = /发生变化/.test(error.message); }
    } finally { snapshot.release(); }

    const failureBaseline = api.exportState();
    const failureRevisionBefore = coordinator.getRevision('circle');
    const nativeSetItem = Storage.prototype.setItem;
    let failureRejected = false;
    try {
      Storage.prototype.setItem = function(key, value) {
        if (key === circleKey) throw new DOMException('simulated quota failure', 'QuotaExceededError');
        return nativeSetItem.call(this, key, value);
      };
      try {
        api.importState({ ...failureBaseline, myName: 'must-not-be-persisted' });
      } catch (error) {
        failureRejected = /保存失败/.test(error.message);
      }
    } finally { Storage.prototype.setItem = nativeSetItem; }
    const stateAfterFailure = api.exportState();
    const storageAfterFailure = circleKey ? JSON.parse(localStorage.getItem(circleKey)) : null;

    const timerBaseline = api.exportState();
    const timerRevisionBefore = coordinator.getRevision('circle');
    api.importState({
      ...timerBaseline,
      autoPost: 'on',
      dynamicCards: ['snapshot-timer-post'],
      postMin: 1,
      postMax: 1,
      nextOtherPostAt: Date.now() - 1000,
      pendingEvents: []
    });
    const timerRevisionAfterSchedule = coordinator.getRevision('circle');
    return {
      originalState,
      circleKeyFound: !!circleKey,
      revisionDelta: revisionAfterSave - revisionBefore,
      persistedAfterSaveMatches: persistedAfterSave === revisionAfterSave,
      persistedSnapshotMatches: storedAfterSave?.myName === candidate.myName,
      snapshotInvalidated,
      failureRejected,
      failureStateRolledBack: stateAfterFailure.myName === failureBaseline.myName,
      failureStorageRolledBack: storageAfterFailure?.myName === failureBaseline.myName,
      failureRevisionAdvanced: coordinator.getRevision('circle') > failureRevisionBefore,
      failureRollbackPersisted: coordinator.getRevision('circle') === coordinator.getPersistedRevision('circle'),
      timerRevisionBefore,
      timerRevisionAfterSchedule
    };
  });
  assert.equal(circleWriteResult.circleKeyFound, true, 'Circle localStorage record should be discoverable');
  assert.equal(circleWriteResult.revisionDelta, 1, 'one successful Circle save must create exactly one revision');
  assert.equal(circleWriteResult.persistedAfterSaveMatches, true, 'successful Circle save must advance persistedRevision');
  assert.equal(circleWriteResult.persistedSnapshotMatches, true, 'Circle save should persist the same state that was registered');
  assert.equal(circleWriteResult.snapshotInvalidated, true, 'a Circle write during an active snapshot must invalidate it');
  assert.equal(circleWriteResult.failureRejected, true, 'a failed Circle save must reject the import');
  assert.equal(circleWriteResult.failureStateRolledBack, true, 'failed Circle save must restore in-memory state');
  assert.equal(circleWriteResult.failureStorageRolledBack, true, 'failed Circle save must leave the old persisted state intact');
  assert.equal(circleWriteResult.failureRevisionAdvanced, true, 'failed Circle mutation must not remain invisible to the coordinator');
  assert.equal(circleWriteResult.failureRollbackPersisted, true, 'verified rollback should reconcile the Circle revision');

  await page.waitForFunction(() =>
    window.__duoCircleApi.exportState().posts.some(post => post.text === 'snapshot-timer-post'),
    null,
    { timeout: 10000 }
  );
  const circleTimerResult = await page.evaluate(({ originalState, timerRevisionAfterSchedule }) => {
    const coordinator = window.BackupSnapshotCoordinator;
    const state = window.__duoCircleApi.exportState();
    const revision = coordinator.getRevision('circle');
    const persisted = coordinator.getPersistedRevision('circle');
    window.__duoCircleApi.importState(originalState);
    return {
      timerPostCreated: state.posts.some(post => post.text === 'snapshot-timer-post'),
      timerRevisionAdvanced: revision > timerRevisionAfterSchedule,
      timerPersisted: revision === persisted
    };
  }, {
    originalState: circleWriteResult.originalState,
    timerRevisionAfterSchedule: circleWriteResult.timerRevisionAfterSchedule
  });
  assert.equal(circleTimerResult.timerPostCreated, true, 'periodic Circle auto-save should persist the scheduled post');
  assert.equal(circleTimerResult.timerPersisted, true, 'periodic Circle save should be recognized as persisted');
  assert.equal(circleTimerResult.timerRevisionAdvanced, true, 'periodic Circle save should advance the snapshot revision');

  const fontPath = process.env.TWODEERS_TEST_FONT || '';
  let fontTested = false;
  if (fontPath && existsSync(fontPath)) {
    await page.evaluate(() => window.ChuanXunFontManager.openSettings());
    await page.locator('#chuanxun-font-file').setInputFiles(fontPath);
    await page.waitForFunction(() => !!window.ChuanXunFontManager.getCurrentFontId(), { timeout: 20000 });
    fontTested = true;
    const customFontId = await page.evaluate(() => window.ChuanXunFontManager.getCurrentFontId());
    assert.ok(customFontId);
  }

  const backupResult = await page.evaluate(async () => {
    const backupWriteAudit = { localStorage: [], indexedDB: [] };
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    const originalTransaction = IDBDatabase.prototype.transaction;
    Storage.prototype.setItem = function(key, value) {
      backupWriteAudit.localStorage.push(String(key));
      return originalSetItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function(key) {
      backupWriteAudit.localStorage.push('remove:' + String(key));
      return originalRemoveItem.call(this, key);
    };
    IDBDatabase.prototype.transaction = function(stores, mode, options) {
      if (mode === 'readwrite' || mode === 'versionchange') backupWriteAudit.indexedDB.push(String(mode));
      return originalTransaction.call(this, stores, mode, options);
    };
    let archive;
    try {
      archive = await window.__duoBackupV4.build('all');
    } finally {
      Storage.prototype.setItem = originalSetItem;
      Storage.prototype.removeItem = originalRemoveItem;
      IDBDatabase.prototype.transaction = originalTransaction;
    }
    const parsed = await window.__duoBackupV4.unzip(archive);
    const media = parsed.manifest.resources.filter(item => item.type === 'media');
    const font = parsed.manifest.resources.filter(item => item.type === 'font');
    const before = state.chatHistory.length;
    const beforeCurrentFont = window.ChuanXunFontManager.getCurrentFontId();
    const originalFontData = await window.ChuanXunFontManager.exportData();
    const fontBinaryMatches = await Promise.all(originalFontData.fonts.map(async item => {
      const entry = font.find(resource => resource.id === item.id);
      if (!entry) return false;
      const archived = parsed.map.get(entry.path)?.blob;
      if (!archived || archived.size !== item.blob.size) return false;
      const [sourceHash, archivedHash] = await Promise.all([
        window.__duoBackupV4.inspect(item.blob),
        window.__duoBackupV4.inspect(archived)
      ]);
      return sourceHash.sha256 === archivedHash.sha256;
    }));
    const mutated = JSON.parse(JSON.stringify(state.chatHistory));
    state.chatHistory = [];
    save();
    if (originalFontData.fonts.length) await window.ChuanXunFontManager.importData({ currentFontId: null, fonts: [] }, { replace: true });
    await window.__duoBackupV4.restore(archive);
    const restoredFontData = await window.ChuanXunFontManager.exportData();
    const restoredFontBinaryMatches = await Promise.all(originalFontData.fonts.map(async item => {
      const restored = restoredFontData.fonts.find(candidate => candidate.id === item.id);
      if (!restored || restored.blob.size !== item.blob.size) return false;
      const [sourceHash, restoredHash] = await Promise.all([
        window.__duoBackupV4.inspect(item.blob),
        window.__duoBackupV4.inspect(restored.blob)
      ]);
      return sourceHash.sha256 === restoredHash.sha256;
    }));
    return {
      size: archive.size,
      resources: parsed.manifest.resources.length,
      media: media.length,
      fonts: font.length,
      before,
      after: state.chatHistory.length,
      fontBefore: beforeCurrentFont,
      fontAfter: window.ChuanXunFontManager.getCurrentFontId(),
      fontBinaryMatches: fontBinaryMatches.every(Boolean),
      restoredFontBinaryMatches: restoredFontBinaryMatches.every(Boolean),
      backupWriteAudit,
      messageIdsMatch: state.chatHistory.map(x => x.id).join('|') === mutated.map(x => x.id).join('|')
    };
  });
  assert.ok(backupResult.size > 100);
  assert.ok(backupResult.media >= 1, 'all backup should contain the uploaded/sent sticker media');
  assert.ok(backupResult.after >= backupResult.before, 'V4 restore should restore the original chat');
  assert.equal(backupResult.messageIdsMatch, true);
  assert.deepEqual(backupResult.backupWriteAudit, { localStorage: [], indexedDB: [] }, 'backup generation must not write to localStorage or any IndexedDB');
  assert.equal(fontTested, true, 'CI must exercise an actual custom font file');
  assert.ok(backupResult.fonts >= 1, 'font backup should include the imported test font');
  assert.equal(backupResult.fontAfter, backupResult.fontBefore);
  assert.equal(backupResult.fontBinaryMatches, true, 'font Blob bytes should be present unchanged in the ZIP');
  assert.equal(backupResult.restoredFontBinaryMatches, true, 'font Blob bytes should survive clearing and restoring the font database');

  const v4RollbackAndBarrierResult = await page.evaluate(async () => {
    const coordinator = window.BackupSnapshotCoordinator;
    const circleApi = window.__duoCircleApi;
    const fontManager = window.ChuanXunFontManager;
    const originalChat = JSON.parse(JSON.stringify(state));
    const originalCircle = circleApi.exportState();
    const tempMediaId = 'v4-restore-' + Date.now();
    await putMediaBlob(new Blob(['v4-restore-media'], { type: 'image/png' }), 'image', 'v4-restore.png', tempMediaId);
    state.chatHistory = [...(state.chatHistory || []), {
      id: 'v4-restore-message', type: 'image', mediaId: tempMediaId, mediaMime: 'image/png'
    }];
    if (save() === false) throw new Error('test setup could not persist V4 media reference');
    circleApi.importState({ ...originalCircle, myName: 'v4-archive-circle-state' });
    const archive = await window.__duoBackupV4.build('all');
    const parsedArchive = await window.__duoBackupV4.unzip(archive);
    const archiveHasMedia = parsedArchive.manifest.resources.some(item => item.type === 'media' && item.id === tempMediaId);
    const archiveChatHasFixture = JSON.parse(await parsedArchive.map.get('state.json').blob.text())
      .state.chatHistory.some(item => item.id === 'v4-restore-message');

    Object.keys(state).forEach(key => { if (!(key in originalChat)) delete state[key]; });
    Object.assign(state, originalChat);
    if (save() === false) throw new Error('test setup could not restore V4 baseline chat');
    circleApi.importState(originalCircle);
    await deleteMediaRecord(tempMediaId);
    const rollbackChat = JSON.stringify(state);
    const rollbackCircle = JSON.stringify(circleApi.exportState());
    const rollbackStorage = localStorage.getItem(STORAGE_KEY);
    const rollbackFonts = await fontManager.exportData();
    const originalImportData = fontManager.importData;
    let injectedFailure = false;
    let restoreRejected = false;
    fontManager.importData = async function(payload, options) {
      const result = await originalImportData.call(this, payload, options);
      if (!injectedFailure) {
        injectedFailure = true;
        throw new Error('injected V4 failure after font database write');
      }
      return result;
    };
    try {
      await window.__duoBackupV4.restore(archive);
    } catch (error) {
      restoreRejected = /injected V4 failure/.test(error.message);
    } finally {
      fontManager.importData = originalImportData;
    }
    const fontsAfterRollback = await fontManager.exportData();
    const fontIdsBefore = rollbackFonts.fonts.map(item => item.id).sort().join('|');
    const fontIdsAfter = fontsAfterRollback.fonts.map(item => item.id).sort().join('|');
    const fontHashesMatch = await Promise.all(rollbackFonts.fonts.map(async item => {
      const restored = fontsAfterRollback.fonts.find(candidate => candidate.id === item.id);
      if (!restored || restored.blob.size !== item.blob.size) return false;
      const [a, b] = await Promise.all([
        window.__duoBackupV4.inspect(item.blob),
        window.__duoBackupV4.inspect(restored.blob)
      ]);
      return a.sha256 === b.sha256;
    }));
    const afterRollback = {
      chatRestored: JSON.stringify(state) === rollbackChat,
      circleRestored: JSON.stringify(circleApi.exportState()) === rollbackCircle,
      storageRestored: localStorage.getItem(STORAGE_KEY) === rollbackStorage,
      mediaRestored: await getMediaRecord(tempMediaId) === null,
      fontsRestored: fontIdsBefore === fontIdsAfter && fontHashesMatch.every(Boolean) &&
        rollbackFonts.currentFontId === fontsAfterRollback.currentFontId,
      revisionsPersisted: ['chat', 'circle', 'media', 'fonts'].every(name =>
        coordinator.getRevision(name) === coordinator.getPersistedRevision(name))
    };
    const failureSnapshot = await coordinator.beginSnapshot(['chat', 'circle', 'media', 'fonts']);
    failureSnapshot.release();

    let releaseFontImport;
    let notifyFontImportStarted;
    const fontImportStarted = new Promise(resolve => { notifyFontImportStarted = resolve; });
    const fontImportGate = new Promise(resolve => { releaseFontImport = resolve; });
    let importBlocked = false;
    let snapshotResolved = false;
    let restoreSucceeded = false;
    fontManager.importData = async function(payload, options) {
      notifyFontImportStarted();
      await fontImportGate;
      return originalImportData.call(this, payload, options);
    };
    try {
      const restorePromise = window.__duoBackupV4.restore(archive);
      await fontImportStarted;
      const snapshotPromise = coordinator.beginSnapshot(['chat', 'circle', 'media', 'fonts']).then(snapshot => {
        snapshotResolved = true;
        return snapshot;
      });
      await new Promise(resolve => setTimeout(resolve, 0));
      importBlocked = !snapshotResolved;
      releaseFontImport();
      restoreSucceeded = await restorePromise;
      const snapshot = await snapshotPromise;
      const snapshotChat = snapshot.get('chat');
      const snapshotCircle = snapshot.get('circle');
      const snapshotMedia = snapshot.get('media');
      snapshot.assertUnchanged();
      const snapshotMatchesRestoredState =
        snapshotChat.chatHistory.some(item => item.id === 'v4-restore-message') &&
        snapshotCircle.myName === 'v4-archive-circle-state' &&
        snapshotMedia.includes(tempMediaId);
      snapshot.release();
      afterRollback.snapshotBarrierBlockedDuringRestore = importBlocked;
      afterRollback.snapshotCapturedOnlyRestoredState = snapshotMatchesRestoredState;
      afterRollback.concurrentRestoreSucceeded = restoreSucceeded;
    } finally {
      releaseFontImport?.();
      fontManager.importData = originalImportData;
    }

    Object.keys(state).forEach(key => { if (!(key in originalChat)) delete state[key]; });
    Object.assign(state, originalChat);
    if (save() === false) throw new Error('test cleanup could not restore original chat');
    circleApi.importState(originalCircle);
    await deleteMediaRecord(tempMediaId);
    return {
      archiveHasMedia,
      archiveChatHasFixture,
      restoreRejected,
      injectedFailure,
      ...afterRollback
    };
  });
  assert.equal(v4RollbackAndBarrierResult.archiveHasMedia, true, 'V4 fixture archive should contain the temporary media resource');
  assert.equal(v4RollbackAndBarrierResult.archiveChatHasFixture, true, 'V4 fixture archive should contain the media reference');
  assert.equal(v4RollbackAndBarrierResult.restoreRejected, true, 'injected V4 restore failure should be surfaced');
  assert.equal(v4RollbackAndBarrierResult.injectedFailure, true, 'failure must occur after the font database write');
  assert.equal(v4RollbackAndBarrierResult.chatRestored, true, 'V4 failure must restore in-memory chat state');
  assert.equal(v4RollbackAndBarrierResult.circleRestored, true, 'V4 failure must restore Circle state');
  assert.equal(v4RollbackAndBarrierResult.storageRestored, true, 'V4 failure must restore exact chat localStorage');
  assert.equal(v4RollbackAndBarrierResult.mediaRestored, true, 'V4 failure must delete media introduced by the failed restore');
  assert.equal(v4RollbackAndBarrierResult.fontsRestored, true, 'V4 failure must restore font records and selected font');
  assert.equal(v4RollbackAndBarrierResult.revisionsPersisted, true, 'V4 rollback must reconcile chat, Circle, media, and font revisions');
  assert.equal(v4RollbackAndBarrierResult.snapshotBarrierBlockedDuringRestore, true,
    'a snapshot started during V4 restore must wait for the entire restore operation');
  assert.equal(v4RollbackAndBarrierResult.snapshotCapturedOnlyRestoredState, true,
    'the waiting snapshot must capture the completed V4 restore, never an intermediate state');
  assert.equal(v4RollbackAndBarrierResult.concurrentRestoreSucceeded, true);


  if (fontTested) await page.evaluate(() => window.ChuanXunFontManager.restoreDefault());

  const v3Result = await page.evaluate(async () => {
    if (typeof buildBackup !== 'function' || typeof applyBackupPayload !== 'function') return false;
    const oldBlob = await buildBackup('param');
    const payload = JSON.parse(await oldBlob.text());
    if (payload.version !== 3) return false;
    await applyBackupPayload(payload);
    return true;
  });
  assert.equal(v3Result, true, 'legacy v3 JSON backup import path should remain available');

  const v3TransactionalResult = await page.evaluate(async () => {
    const coordinator = window.BackupSnapshotCoordinator;
    const circleApi = window.__duoCircleApi;
    const originalChat = JSON.parse(JSON.stringify(state));
    const originalCircle = circleApi.exportState();
    const tempMediaId = 'v3-restore-' + Date.now();
    await putMediaBlob(new Blob(['v3-restore-media'], { type: 'image/png' }), 'image', 'v3-restore.png', tempMediaId);
    state.chatHistory = [...(state.chatHistory || []), {
      id: 'v3-restore-message', type: 'image', mediaId: tempMediaId, mediaMime: 'image/png'
    }];
    if (save() === false) throw new Error('test setup could not persist V3 media reference');
    const payload = JSON.parse(await (await buildBackup('all')).text());
    const archiveHasMedia = payload.data.mediaFiles.some(item => item.id === tempMediaId);
    state.chatHistory = [];
    if (save() === false) throw new Error('test setup could not persist divergent chat state');
    circleApi.importState({ ...originalCircle, myName: 'before-v3-restore' });
    await deleteMediaRecord(tempMediaId);

    const beforeSuccess = {
      chat: coordinator.getRevision('chat'),
      circle: coordinator.getRevision('circle'),
      media: coordinator.getRevision('media')
    };
    await applyBackupPayload(payload);
    const successState = {
      chatRestored: state.chatHistory.some(item => item.id === 'v3-restore-message'),
      circleRestored: circleApi.exportState().myName === originalCircle.myName,
      mediaRestored: !!(await getMediaRecord(tempMediaId)),
      chatRevision: coordinator.getRevision('chat'),
      circleRevision: coordinator.getRevision('circle'),
      mediaRevision: coordinator.getRevision('media'),
      chatPersisted: coordinator.getPersistedRevision('chat'),
      circlePersisted: coordinator.getPersistedRevision('circle'),
      mediaPersisted: coordinator.getPersistedRevision('media')
    };

    Object.keys(state).forEach(key => { if (!(key in originalChat)) delete state[key]; });
    Object.assign(state, originalChat);
    if (save() === false) throw new Error('test setup could not restore original chat state');
    circleApi.importState(originalCircle);
    await deleteMediaRecord(tempMediaId);

    const rollbackChat = JSON.stringify(state);
    const rollbackCircle = JSON.stringify(circleApi.exportState());
    const rollbackStorage = localStorage.getItem(STORAGE_KEY);
    const invalidPayload = JSON.parse(JSON.stringify(payload));
    invalidPayload.data.state.chatHistory.push({
      id: 'v3-invalid-reference', type: 'image', mediaId: 'v3-media-that-is-not-in-the-archive'
    });
    let restoreRejected = false;
    try { await applyBackupPayload(invalidPayload); }
    catch (error) { restoreRejected = /缺少聊天媒体文件/.test(error.message); }
    const mediaAfterFailure = await getMediaRecord(tempMediaId);
    const chatAfterFailure = JSON.stringify(state);
    const circleAfterFailure = JSON.stringify(circleApi.exportState());
    const storageAfterFailure = localStorage.getItem(STORAGE_KEY);
    const failureRevisions = {
      chat: coordinator.getRevision('chat'),
      circle: coordinator.getRevision('circle'),
      media: coordinator.getRevision('media'),
      chatPersisted: coordinator.getPersistedRevision('chat'),
      circlePersisted: coordinator.getPersistedRevision('circle'),
      mediaPersisted: coordinator.getPersistedRevision('media')
    };
    const snapshot = await coordinator.beginSnapshot(['chat', 'circle', 'media']);
    snapshot.release();
    return {
      archiveHasMedia,
      ...successState,
      successChatRevisionAdvanced: successState.chatRevision > beforeSuccess.chat,
      successCircleRevisionAdvanced: successState.circleRevision > beforeSuccess.circle,
      successMediaRevisionAdvanced: successState.mediaRevision > beforeSuccess.media,
      successAllPersisted: successState.chatRevision === successState.chatPersisted &&
        successState.circleRevision === successState.circlePersisted &&
        successState.mediaRevision === successState.mediaPersisted,
      restoreRejected,
      failureChatRestored: chatAfterFailure === rollbackChat,
      failureCircleRestored: circleAfterFailure === rollbackCircle,
      failureStorageRestored: storageAfterFailure === rollbackStorage,
      failureMediaRestored: mediaAfterFailure === null,
      failureAllPersisted: failureRevisions.chat === failureRevisions.chatPersisted &&
        failureRevisions.circle === failureRevisions.circlePersisted &&
        failureRevisions.media === failureRevisions.mediaPersisted
    };
  });
  assert.equal(v3TransactionalResult.archiveHasMedia, true, 'V3 full backup should include the fixture media');
  assert.equal(v3TransactionalResult.chatRestored, true, 'V3 full restore should replace the divergent chat state');
  assert.equal(v3TransactionalResult.circleRestored, true, 'V3 full restore should restore the Circle state');
  assert.equal(v3TransactionalResult.mediaRestored, true, 'V3 full restore should restore referenced media bytes');
  assert.equal(v3TransactionalResult.successChatRevisionAdvanced, true);
  assert.equal(v3TransactionalResult.successCircleRevisionAdvanced, true);
  assert.equal(v3TransactionalResult.successMediaRevisionAdvanced, true);
  assert.equal(v3TransactionalResult.successAllPersisted, true, 'successful V3 restore must reconcile all participating revisions');
  assert.equal(v3TransactionalResult.restoreRejected, true, 'V3 restore with a missing referenced media item must fail');
  assert.equal(v3TransactionalResult.failureChatRestored, true, 'V3 failure must roll back in-memory chat state');
  assert.equal(v3TransactionalResult.failureCircleRestored, true, 'V3 failure must roll back Circle state');
  assert.equal(v3TransactionalResult.failureStorageRestored, true, 'V3 failure must restore the exact chat localStorage value');
  assert.equal(v3TransactionalResult.failureMediaRestored, true, 'V3 failure must remove media introduced by the failed restore');
  assert.equal(v3TransactionalResult.failureAllPersisted, true, 'V3 rollback must leave every module revision persisted');

  assert.deepEqual(pageErrors, [], 'page should not emit uncaught JavaScript errors');

  console.log(JSON.stringify({
    result: 'passed',
    themePersisted: true,
    twoColumnStickers: true,
    threeStickerTabsPreserved: true,
    builtinStickerPlaceholder: true,
    pngAndGifUploadAndLoad: true,
    favoriteToggleAndEmptyState: true,
    favoritePersistence: true,
    referencedMediaProtection: true,
    orphanMediaCleanup: true,
    mediaSentAndBackedUp: true,
    v4Restore: true,
    v3Import: v3Result,
    customFontImported: fontTested,
    v4Bytes: backupResult.size,
    mediaResources: backupResult.media,
    fontResources: backupResult.fonts
  }, null, 2));
} finally {
  await browser.close();
}
