import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = process.cwd();
const source = readFileSync(resolve(root, 'chat-beautify-presets.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: 'chat-beautify-presets.js' });
const presets = sandbox.window.DuoChatBeautifyPresets;
const targetHtml = readFileSync(resolve(root, 'index.html'), 'utf8');
const manager = readFileSync(resolve(root, 'chat-beautify-manager.js'), 'utf8');
const appearanceManager = readFileSync(resolve(root, 'appearance-manager.js'), 'utf8');
const mediaExclusion = ':not(.image-bubble):not(.video-bubble):not(.audio-bubble):not(.sticker-bubble)';
const migratedSourceIds = new Set(["builtin_cfc47dbf_01_eve___v2","builtin_31b14a17_02_eve___v2","builtin_0e89fa2e_03_eve_iMessage","builtin_4ff48447_04_eve_iMessage","builtin_3ff838e0_07_eve_iMessage","builtin_30e73b53_08_miu","builtin_b9f7f258_22_miu__X","builtin_e6d04d09_23_miu__X","builtin_285c4628_02__WhatsApp","builtin_f39ffd4a_05_miu","builtin_80431c26_06_miu","builtin_25176e9f_08","builtin_1f7c7cb3_09_miu_iOS6","builtin_dbb9ed46_12","builtin_xiaoshu_webchat_pink_yellow_round_template_v1","builtin_xiaoshu_jrys_tuwan_pink_kkk35g_v1","builtin_xiaoshu_line_kitty_black_white_kkk35g_v1","builtin_xiaoshu_pink_gray_decor_v1","builtin_xiaoshu_frame_borderimage_v1","builtin_xiaoshu_soft_frame_pair_v1","builtin_xiaoshu_line_cat_milk_v1"]);
const normalize = css => css
  .replace(/#[0-9a-f]{3,8}\b/gi, '#COLOR')
  .replace(/rgba?\([^)]*\)/gi, 'COLOR')
  .replace(/hsla?\([^)]*\)/gi, 'COLOR')
  .replace(/content\s*:\s*(['"])[\s\S]*?\1/gi, 'content:""')
  .replace(/\s+/g, '');

test('chat beautification manager is valid executable JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(manager, { filename: 'chat-beautify-manager.js' }));
});

test('registers 78 independently identified CSS chat designs', () => {
  assert.equal(presets.length, 78);
  assert.equal(new Set(presets.map(item => item.id)).size, presets.length);
  assert.equal(new Set(presets.map(item => item.name)).size, presets.length);
  assert.ok(presets.every(item => item.description && item.category && item.css.length > 1200));
  assert.ok(new Set(presets.map(item => normalize(item.css))).size >= 40,
    'at least 40 CSS structures must remain distinct after color normalization');
  assert.equal(presets.filter(item => item.sourcePresetId).length, 22,
    'all 22 recognizable source bubble design directions are adapted');
});

test('native presets preserve target-specific avatar metadata and composer styling', () => {
  const native = presets.filter(item => !migratedSourceIds.has(item.sourcePresetId));
  assert.equal(native.length, 57);
  for (const item of native) {
    const scope = '.duo-chat-beautify--' + item.id;
    assert.ok(item.css.includes('#chatList' + scope), item.id + ' must target the target chat list root');
    assert.ok(item.css.includes(scope + ' .msg-row.me .bubble' + mediaExclusion), item.id + ' missing own-message bubble design');
    assert.ok(item.css.includes(scope + ' .msg-row.other .bubble' + mediaExclusion), item.id + ' missing peer-message bubble design');
    assert.ok(item.css.includes(scope + ' .chat-avatar'), item.id + ' missing avatar treatment');
    assert.ok(item.css.includes(scope + ' .meta'), item.id + ' missing message metadata treatment');
    assert.ok(item.css.includes('.duo-chat-preview-composer'), item.id + ' missing preview/input-area treatment');
    assert.ok(item.css.includes(scope + ' .bubble' + mediaExclusion + '{position:relative!important}'));
    assert.ok(!item.css.includes(scope + ' .bubble{'), item.id + ' must not blanket-style all media bubbles');
  }
});

test('migrated source CSS maps legacy message selectors without adding new visual rules', () => {
  const migrated = presets.filter(item => migratedSourceIds.has(item.sourcePresetId));
  assert.equal(migrated.length, 21);
  for (const item of migrated) {
    const scope = '.duo-chat-beautify--' + item.id;
    assert.ok(item.css.includes(scope), item.id + ' missing preset scope');
    assert.ok(item.css.includes(':is(#chatList,.duo-chat-beautify-preview)' + scope), item.id + ' must scope both live chat and CSS preview roots');
    assert.ok(item.css.includes('.msg-row.me'), item.id + ' missing own-message selector');
    assert.ok(item.css.includes('.msg-row.other'), item.id + ' missing peer-message selector');
    assert.ok(item.css.includes('.bubble'), item.id + ' missing target bubble selector');
    assert.ok(!item.css.includes('.chat-avatar'), item.id + ' must not gain non-source avatar rules');
    assert.ok(!item.css.includes('.duo-chat-preview-composer'), item.id + ' must not gain non-source composer rules');
    for (const legacy of ['.chat-container', '#chat-container', '.message-wrapper', '.message-content-wrapper', '.message-sent', '.message-received', '.message-image-bubble-none']) {
      assert.ok(!item.css.includes(legacy), item.id + ' retains legacy selector ' + legacy);
    }
  }
  const scopeOnly = css => css.replace(/\.duo-chat-beautify--[a-z0-9-]+/g, '.duo-chat-beautify--SCOPE');
  const first = migrated.find(item => item.sourcePresetId === 'builtin_cfc47dbf_01_eve___v2');
  const fifth = migrated.find(item => item.sourcePresetId === 'builtin_3ff838e0_07_eve_iMessage');
  assert.equal(scopeOnly(first.css), scopeOnly(fifth.css), 'original source styles 1 and 5 must remain identical');
});

test('preset CSS remains scoped to twodeers DOM and preserves migrated local assets', () => {
  assert.match(targetHtml, /class="page chat-page" id="chatPage"/);
  assert.match(targetHtml, /id="chatList"[^>]*class="chat-bg"|class="chat-bg"[^>]*id="chatList"/);
  assert.ok(targetHtml.includes("msg.sender==='me'?'me':'other'"));
  for (const mediaClass of ['image-bubble', 'video-bubble', 'audio-bubble', 'sticker-bubble']) {
    assert.ok(targetHtml.includes(mediaClass), 'target renderer must contain ' + mediaClass);
  }
  const migrated = presets.filter(item => migratedSourceIds.has(item.sourcePresetId));
  const localAssets = new Set();
  for (const item of migrated) {
    const urls = [...item.css.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi)].map(match => match[2]);
    for (const url of urls.filter(value => !/^https?:|^data:|^\/\//i.test(value))) {
      localAssets.add(url);
      assert.ok(existsSync(resolve(root, url)), item.id + ' missing local source asset ' + url);
    }
  }
  assert.equal(localAssets.size, 11, 'only the 11 locally referenced source assets should be present');
});

test('manager renders live CSS previews and persists only the chosen preset ID', () => {
  assert.match(manager, /duo-chat-beautify-preview/);
  assert.match(manager, /previewMarkup/);
  assert.match(manager, /state\.chatBeautifyPresetId/);
  assert.match(manager, /typeof save/);
  assert.match(manager, /customStyle/);
  assert.match(manager, /appendChild\(customStyle\)/);
  assert.match(manager, /恢复默认/);
  assert.match(manager, /insertBefore\(style, customStyle\)/);
  assert.match(manager, /applyToChat/);
  assert.match(manager, /settingsParam/);
  assert.match(manager, /duoChatBeautifyPresetStyles/);
  assert.match(targetHtml, /id="customCssInput"/);
  assert.match(targetHtml, /function applyCustomCSS\(\)/);
});

test('existing theme palette and custom CSS systems remain independent', () => {
  const presetTag = targetHtml.indexOf('<script src="chat-beautify-presets.js"></script>');
  const managerTag = targetHtml.indexOf('<script src="chat-beautify-manager.js"></script>');
  const backupTag = targetHtml.indexOf('<script src="backup-v4.js"></script>');
  assert.ok(backupTag >= 0 && presetTag > backupTag && managerTag > presetTag);
  assert.match(appearanceManager, /appearanceSettings/);
  assert.match(appearanceManager, /duoAppearanceThemeStyle/);
  assert.match(targetHtml, /function applyCustomCSS\(\)/);
  assert.match(targetHtml, /id="customCssInput"/);
});
