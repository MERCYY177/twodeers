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
  await page.locator('#stickerList [data-sticker-del]').first().click();
  await page.waitForFunction(async id =>
    state.stickers.length === 0 && !(await getMediaRecord(id)), orphanMediaId);
  assert.equal(await page.evaluate(async id => !!(await getMediaRecord(id)), orphanMediaId), false,
    'unreferenced deleted sticker media should be cleaned up');

  // The builtin entry remains usable after upload cleanup and still shows its honest placeholder.
  await page.locator('[data-duo-sticker-tab="builtin"]').click();
  assert.match(await page.locator('#stickerList').innerText(), /内置表情资源尚未迁入/);

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
