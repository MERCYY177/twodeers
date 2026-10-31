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

  const beautifyBefore = await page.evaluate(() => ({
    count: window.DuoChatBeautify.presets.length,
    selectedId: state.chatBeautifyPresetId || '',
    customCSS: state.customCSS || '',
    stylePresent: !!document.getElementById('duoChatBeautifyPresetStyles'),
    styleRules: document.getElementById('duoChatBeautifyPresetStyles')?.sheet?.cssRules?.length || 0,
    cards: document.querySelectorAll('#duoChatBeautifyPanel [data-preset-card]').length,
    cssPriority: (() => {
      const ids = [...document.head.querySelectorAll('style')].map(node => node.id);
      return ids.indexOf('duoChatBeautifyPresetStyles') >= 0 &&
        ids.lastIndexOf('customStyle') > ids.indexOf('duoChatBeautifyPresetStyles');
    })()
  }));
  assert.equal(beautifyBefore.count, 78, '78 CSS beautification designs should be loaded');
  assert.equal(beautifyBefore.count, beautifyBefore.cards, 'each preset must have a live CSS preview card');
  assert.equal(beautifyBefore.stylePresent, true, 'preset CSS must be injected into the real page');
  assert.ok(beautifyBefore.styleRules >= beautifyBefore.count * 8, 'browser must parse full preset stylesheets');
  assert.equal(beautifyBefore.cssPriority, true, 'user custom CSS must remain after built-in preset styles');
  const exposeBeautifySettings = () => page.evaluate(() => {
    if (typeof goto === 'function') goto('settingsPage');
    const panel = document.getElementById('settingsParam');
    if (panel) {
      panel.hidden = false;
      panel.classList.remove('hidden');
      panel.style.setProperty('display', 'block', 'important');
      panel.style.setProperty('visibility', 'visible', 'important');
    }
  });
  await exposeBeautifySettings();
  const testRows = await page.evaluate(() => {
    const chat = document.getElementById('chatList');
    const ids = ['beautify-smoke-own','beautify-smoke-other','beautify-smoke-image','beautify-smoke-sticker'];
    const rows = [
      buildMessageRow({id:ids[0],sender:'me',type:'text',text:'自己的消息预览',time:'20:18'}),
      buildMessageRow({id:ids[1],sender:'other',type:'text',text:'对方的消息预览',time:'20:19'}),
      buildMessageRow({id:ids[2],sender:'me',type:'image',url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}),
      buildMessageRow({id:ids[3],sender:'other',type:'sticker',url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'})
    ];
    rows.forEach((row,index) => {
      row.dataset.beautifySmokeId = ids[index];
      chat.appendChild(row);
    });
    return {
      imageRadius:getComputedStyle(rows[2].querySelector('.bubble')).borderRadius,
      stickerRadius:getComputedStyle(rows[3].querySelector('.bubble')).borderRadius
    };
  });
  await page.locator('[data-beautify-apply="pixel-console"]').click();
  const visualCheck = await page.evaluate(() => {
    const chat = document.getElementById('chatList');
    const find = id => chat.querySelector('[data-beautify-smoke-id="' + id + '"]');
    const style = row => {
      const bubble = row.querySelector('.bubble');
      const computed = getComputedStyle(bubble);
      return {radius:computed.borderRadius,position:computed.position,className:bubble.className};
    };
    const preview = document.querySelector('[data-preset-card="pixel-console"] .duo-chat-beautify-preview .msg-row.me .bubble');
    return {
      own:style(find('beautify-smoke-own')),
      other:style(find('beautify-smoke-other')),
      image:style(find('beautify-smoke-image')),
      sticker:style(find('beautify-smoke-sticker')),
      preview:preview?{radius:getComputedStyle(preview).borderRadius,position:getComputedStyle(preview).position}:null,
      liveClass:chat.classList.contains('duo-chat-beautify--pixel-console'),
      pageClass:document.getElementById('chatPage').classList.contains('duo-chat-beautify--pixel-console')
    };
  });
  assert.equal(visualCheck.liveClass, true, 'selected preset class must be attached to the real chat');
  assert.equal(visualCheck.pageClass, true, 'chat page and input composer must use the selected scope');
  assert.equal(visualCheck.own.radius, '0px');
  assert.equal(visualCheck.other.radius, '0px');
  assert.equal(visualCheck.own.position, 'relative');
  assert.ok(visualCheck.preview && visualCheck.preview.radius === '0px', 'preview must use the actual preset CSS');
  assert.match(visualCheck.image.className, /image-bubble/);
  assert.match(visualCheck.sticker.className, /sticker-bubble/);
  assert.equal(visualCheck.image.radius, testRows.imageRadius, 'image message styling must remain unchanged');
  assert.equal(visualCheck.sticker.radius, testRows.stickerRadius, 'sticker styling must remain unchanged');
  await exposeBeautifySettings();
  await page.locator('[data-beautify-apply="glass-lilac"]').click();
  const switched = await page.evaluate(() => ({
    id:state.chatBeautifyPresetId,
    pixel:document.getElementById('chatList').classList.contains('duo-chat-beautify--pixel-console'),
    glass:document.getElementById('chatList').classList.contains('duo-chat-beautify--glass-lilac'),
    customCSS:state.customCSS||''
  }));
  assert.equal(switched.id, 'glass-lilac');
  assert.equal(switched.pixel, false, 'switching must remove previous preset class');
  assert.equal(switched.glass, true);
  assert.equal(switched.customCSS, beautifyBefore.customCSS, 'preset selection must not modify user CSS');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => state.chatBeautifyPresetId === 'glass-lilac' &&
    document.getElementById('chatList').classList.contains('duo-chat-beautify--glass-lilac'));
  await exposeBeautifySettings();
  await page.locator('[data-beautify-reset]').click();
  const reset = await page.evaluate(() => ({
    id:state.chatBeautifyPresetId,
    hasPresetClass:[...document.getElementById('chatList').classList].some(name=>name.startsWith('duo-chat-beautify--')),
    customCSS:state.customCSS||''
  }));
  assert.equal(reset.id, '');
  assert.equal(reset.hasPresetClass, false);
  assert.equal(reset.customCSS, beautifyBefore.customCSS, 'reset must not remove user custom CSS');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => state.chatBeautifyPresetId === '' &&
    ![...document.getElementById('chatList').classList].some(name=>name.startsWith('duo-chat-beautify--')));
  await page.evaluate(id => {
    if (id) window.DuoChatBeautify.apply(id);
    ['beautify-smoke-own','beautify-smoke-other','beautify-smoke-image','beautify-smoke-sticker']
      .forEach(mid => document.querySelector('#chatList [data-beautify-smoke-id="' + mid + '"]')?.remove());
  }, beautifyBefore.selectedId);

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

  await page.evaluate(() => document.getElementById('emojiBtn').click());
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
  await page.evaluate(() => document.getElementById('emojiBtn').click());
  await page.locator('[data-duo-sticker-tab="favorites"]').click();
  assert.equal(await page.locator('#stickerList [data-sticker-send]').count(), 1, 'favorite should survive reload');
  await page.locator('[data-duo-sticker-tab="uploads"]').click();
  await page.locator('#stickerList [data-sticker-send]').first().click();
  await page.waitForFunction(() => state.chatHistory.some(message => message.mediaId), { timeout: 5000 });
  const sentMediaId = await page.evaluate(() => state.chatHistory.find(message => message.mediaId).mediaId);
  await page.evaluate(() => { const panel=document.getElementById('emojiPanel'); panel.classList.add('show'); panel.setAttribute('aria-hidden','false'); });
  await page.locator('[data-duo-sticker-tab="uploads"]').click();
  await page.evaluate(() => document.querySelector('#stickerList [data-sticker-del]').click());
  await page.waitForFunction(() => state.stickers.length === 1 && state.stickerFavorites.length === 0);
  const protectedMedia = await page.evaluate(async id => !!(await getMediaRecord(id)), sentMediaId);
  assert.equal(protectedMedia, true, 'deleting an uploaded sticker must not delete media still referenced by chat history');
  await page.evaluate(() => document.querySelector('#stickerList [data-sticker-del]').click());
  await page.waitForFunction(async id => state.stickers.length === 0 && !(await getMediaRecord(id)), uploaded[1].mediaId);
  const orphanMedia = await page.evaluate(async id => !!(await getMediaRecord(id)), uploaded[1].mediaId);
  assert.equal(orphanMedia, false, 'unreferenced deleted sticker media should be cleaned up');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('#duoStickerTabs'));
  await page.evaluate(() => document.getElementById('emojiBtn').click());
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
    cssBeautifyPresets: beautifyBefore.count,
    cssBeautifyLivePreview: true,
    cssBeautifyApplySwitchReset: true,
    cssBeautifyPersistence: true,
    cssBeautifyMediaSafe: true,
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
