import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
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
    backupVersion: window.__duoBackupV4.version
  }));
  assert.equal(baseline.circleApi, true, 'Circle Shadow DOM API should be available');
  assert.equal(baseline.twoColumns, 2, 'the original two-column emoji panel must remain');
  const stickerPanel = await page.locator('#emojiPanel').innerText();
  assert.match(stickerPanel, /常用 Emoji/);
  assert.match(stickerPanel, /我的上传/);
  assert.match(stickerPanel, /收藏/);
  assert.doesNotMatch(stickerPanel, /内置表情/);
  assert.equal(await page.locator('#duoStickerTabs [data-duo-sticker-tab="builtin"]').count(), 0);
  assert.equal(await page.locator('.duo-sticker-notice').count(), 0);
  assert.equal(baseline.tabs, 2, 'only uploads and favorites tabs should be mounted');
  assert.equal(baseline.backupVersion, 4);

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

  await page.locator('#emojiBtn').click();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+a8AAAAASUVORK5CYII=', 'base64');
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  await page.locator('#stickerUploader').setInputFiles([
    { name: 'smoke.png', mimeType: 'image/png', buffer: png },
    { name: 'smoke.gif', mimeType: 'image/gif', buffer: gif }
  ]);
  await page.waitForFunction(() => document.querySelectorAll('#stickerList [data-sticker-send]').length === 2);
  const uploaded = await page.evaluate(() => state.stickers.map(s => ({ id:s.id, mediaId:s.mediaId, mimeType:s.mimeType })));
  assert.equal(uploaded.length, 2);
  assert.ok(uploaded.some(x => x.mimeType === 'image/png'));
  assert.ok(uploaded.some(x => x.mimeType === 'image/gif'));
  await page.waitForFunction(() => [...document.querySelectorAll('#stickerList img')].every(img => img.complete && img.naturalWidth > 0));
  await page.locator('#stickerList [data-duo-sticker-fav]').first().click();
  await page.locator('[data-duo-sticker-tab="favorites"]').click();
  assert.equal(await page.locator('#stickerList [data-sticker-send]').count(), 1, 'favorite tab should show only the saved upload');
  const favoritesBeforeReload = await page.evaluate(() => state.stickerFavorites.length);
  assert.equal(favoritesBeforeReload, 1);
  await page.locator('#stickerList [data-duo-sticker-fav]').click();
  assert.equal(await page.locator('#stickerList [data-sticker-send]').count(), 0, 'unfavoriting should empty the favorites list');
  assert.match(await page.locator('#stickerList').innerText(), /还没有收藏表情包/);
  await page.locator('[data-duo-sticker-tab="uploads"]').click();
  await page.locator('#stickerList [data-duo-sticker-fav]').first().click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('#duoStickerTabs'));
  await page.locator('#emojiBtn').click();
  await page.locator('[data-duo-sticker-tab="favorites"]').click();
  assert.equal(await page.locator('#stickerList [data-sticker-send]').count(), 1, 'favorite should survive reload');
  await page.locator('[data-duo-sticker-tab="uploads"]').click();
  await page.locator('#stickerList [data-sticker-send]').first().click();
  await page.waitForFunction(() => state.chatHistory.some(message => message.mediaId), { timeout: 5000 });
  const sentMediaId = await page.evaluate(() => state.chatHistory.find(message => message.mediaId).mediaId);
  await page.locator('#emojiBtn').click();
  await page.locator('[data-duo-sticker-tab="uploads"]').click();
  await page.locator('#stickerList [data-sticker-del]').first().click();
  await page.waitForFunction(() => state.stickers.length === 1 && state.stickerFavorites.length === 0);
  const protectedMedia = await page.evaluate(async id => !!(await getMediaRecord(id)), sentMediaId);
  assert.equal(protectedMedia, true, 'deleting an uploaded sticker must not delete media still referenced by chat history');
  await page.locator('#stickerList [data-sticker-del]').click();
  await page.waitForFunction(() => state.stickers.length === 0);
  const orphanMedia = await page.evaluate(async id => !!(await getMediaRecord(id)), uploaded[1].mediaId);
  assert.equal(orphanMedia, false, 'unreferenced deleted sticker media should be cleaned up');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('#duoStickerTabs'));
  await page.locator('#emojiBtn').click();
  assert.match(await page.locator('#stickerList').innerText(), /还没有表情包/);
  assert.equal(await page.locator('[data-duo-sticker-tab="favorites"]').count(), 1);
  assert.equal(await page.locator('[data-duo-sticker-tab="builtin"]').count(), 0);

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
    const archive = await window.__duoBackupV4.build('all');
    const parsed = await window.__duoBackupV4.unzip(archive);
    const media = parsed.manifest.resources.filter(item => item.type === 'media');
    const font = parsed.manifest.resources.filter(item => item.type === 'font');
    const before = state.chatHistory.length;
    const beforeCurrentFont = window.ChuanXunFontManager.getCurrentFontId();
    const mutated = JSON.parse(JSON.stringify(state.chatHistory));
    state.chatHistory = [];
    save();
    await window.__duoBackupV4.restore(archive);
    return {
      size: archive.size,
      resources: parsed.manifest.resources.length,
      media: media.length,
      fonts: font.length,
      before,
      after: state.chatHistory.length,
      fontBefore: beforeCurrentFont,
      fontAfter: window.ChuanXunFontManager.getCurrentFontId(),
      messageIdsMatch: state.chatHistory.map(x => x.id).join('|') === mutated.map(x => x.id).join('|')
    };
  });
  assert.ok(backupResult.size > 100);
  assert.ok(backupResult.media >= 1, 'all backup should contain the uploaded/sent sticker media');
  assert.ok(backupResult.after >= backupResult.before, 'V4 restore should restore the original chat');
  assert.equal(backupResult.messageIdsMatch, true);
  assert.equal(backupResult.fontAfter, backupResult.fontBefore);

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
    favoritePersistence: true,
    favoriteRemoval: true,
    pngAndGifUpload: true,
    referencedMediaProtection: true,
    twoTabOnly: true,
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
