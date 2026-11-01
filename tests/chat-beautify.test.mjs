import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

const expectedSourceIds = {
  "ink-minimal": "builtin_cfc47dbf_01_eve___v2",
  "rose-letter": "builtin_31b14a17_02_eve___v2",
  "blue-imessage": "builtin_0e89fa2e_03_eve_iMessage",
  "mint-sms": "builtin_4ff48447_04_eve_iMessage",
  "carbon-glass": "builtin_3ff838e0_07_eve_iMessage",
  "miffy-memo": "builtin_30e73b53_08_miu",
  "x-blue-dm": "builtin_b9f7f258_22_miu__X",
  "x-night-dm": "builtin_e6d04d09_23_miu__X",
  "whatsapp-tails": "builtin_285c4628_02__WhatsApp",
  "miu-pink-sms": "builtin_f39ffd4a_05_miu",
  "miu-blue-sms": "builtin_80431c26_06_miu",
  "leaf-garden": "builtin_25176e9f_08",
  "ios6-bluegray": "builtin_1f7c7cb3_09_miu_iOS6",
  "wechat-moon": "builtin_dbb9ed46_12",
  "pink-lemon": "builtin_xiaoshu_webchat_pink_yellow_round_template_v1",
  "rabbit-milk": "builtin_xiaoshu_jrys_tuwan_pink_kkk35g_v1",
  "line-kitty": "builtin_xiaoshu_line_kitty_black_white_kkk35g_v1",
  "pink-gray-stars": "builtin_xiaoshu_pink_gray_decor_v1",
  "picture-frame": "builtin_xiaoshu_frame_borderimage_v1",
  "soft-double-frame": "builtin_xiaoshu_soft_frame_pair_v1",
  "line-cat-milk": "builtin_xiaoshu_line_cat_milk_v1"
};
const expectedPresetIds = ["ink-minimal","rose-letter","blue-imessage","mint-sms","carbon-glass","miffy-memo","x-blue-dm","x-night-dm","whatsapp-tails","miu-pink-sms","miu-blue-sms","leaf-garden","ios6-bluegray","wechat-moon","pink-lemon","rabbit-milk","line-kitty","pink-gray-stars","picture-frame","soft-double-frame","line-cat-milk"];
const decorativePresetIds = ['pink-gray-stars', 'picture-frame', 'soft-double-frame', 'line-cat-milk'];
const mediaClasses = ['image-bubble', 'video-bubble', 'audio-bubble', 'sticker-bubble', 'media-pending'];

function splitSelectorList(value) {
  const selectors = [];
  let start = 0, depth = 0, quote = '', escaped = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (char === ',' && depth === 0) { selectors.push(value.slice(start, i)); start = i + 1; }
  }
  selectors.push(value.slice(start));
  return selectors;
}

function parseCssRules(css) {
  const input = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let index = 0;
  while (index < input.length) {
    while (/\s/.test(input[index] || '')) index++;
    if (index >= input.length) break;
    const start = index;
    let depth = 0, quote = '', escaped = false;
    for (; index < input.length; index++) {
      const char = input[index];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (quote) { if (char === quote) quote = ''; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '(' || char === '[') depth++;
      else if (char === ')' || char === ']') depth--;
      else if (char === '{' && depth === 0) break;
    }
    assert.ok(index < input.length, 'unterminated CSS rule prelude');
    const selector = input.slice(start, index).trim();
    index++;
    const bodyStart = index;
    let braces = 1;
    quote = ''; escaped = false;
    for (; index < input.length && braces; index++) {
      const char = input[index];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (quote) { if (char === quote) quote = ''; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '{') braces++;
      else if (char === '}') braces--;
    }
    assert.equal(braces, 0, 'unterminated CSS declaration block');
    rules.push({ selector, body: input.slice(bodyStart, index - 1) });
  }
  return rules;
}

function negatesClass(selector, className) {
  return new RegExp(':not\\([^)]*\\.' + className + '(?![\\w-])').test(selector);
}

function isExplicitMediaRule(selector) {
  return /\.bubble(?:\.(?:image-bubble|video-bubble|audio-bubble|sticker-bubble|media-pending|xiaoshu-card-message-outer)|:is\(\.image-bubble\)|:has\((?:img|video|canvas|\.red-packet-card|\.transfer-bubble|\.ta-phone-product-card|\.shop-chat-card|\.product-card|\.order-product|\.chat-card|\.bubble-card|\.message-card|\[data-chat-card|\[data-card))/i.test(selector);
}

function assertMediaSafeSelector(selector, presetId) {
  if (!/\.bubble(?![-\w])/.test(selector) || isExplicitMediaRule(selector)) return;
  for (const className of ['image-bubble', 'video-bubble', 'sticker-bubble', 'media-pending']) {
    assert.ok(negatesClass(selector, className),
      presetId + ' generic bubble selector must exclude .' + className + ': ' + selector);
  }
  assert.ok(negatesClass(selector, 'audio-bubble') || /\.audio-bubble/.test(selector),
    presetId + ' generic bubble selector must exclude audio or explicitly target its voice design: ' + selector);
}

test('chat beautification manager is valid executable JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(manager, { filename: 'chat-beautify-manager.js' }));
});

test('only the exact 21 approved CSS designs are registered, with exact source IDs', () => {
  assert.equal(presets.length, 21, 'only 21 approved designs may exist in the preset array');
  assert.deepEqual(Array.from(presets, item => item.id), expectedPresetIds);
  assert.equal(new Set(presets.map(item => item.id)).size, 21, 'preset IDs must be unique');
  assert.equal(new Set(presets.map(item => item.name)).size, 21, 'preset names must be unique');
  assert.deepEqual(Object.fromEntries(presets.map(item => [item.id, item.sourcePresetId])), expectedSourceIds);
  assert.equal(presets.filter(item => item.sourcePresetId).length, 21);
  assert.ok(presets.every(item => item.description && item.category && item.css.length > 1200));
  assert.ok(!presets.some(item => item.id === 'wechat-old-green'));
  assert.ok(!presets.some(item => !expectedPresetIds.includes(item.id)), 'no native or backup preset may remain');
});

test('all 21 migrated CSS styles retain their original scope and both chat directions', () => {
  for (const item of presets) {
    const scope = '.duo-chat-beautify--' + item.id;
    assert.ok(item.css.includes(scope), item.id + ' missing its original scope');
    assert.ok(item.css.includes(':is(#chatList,.duo-chat-beautify-preview)' + scope),
      item.id + ' must scope both live chat and preview roots');
    assert.ok(item.css.includes('.msg-row.me'), item.id + ' missing own-message design');
    assert.ok(item.css.includes('.msg-row.other'), item.id + ' missing peer-message design');
    assert.ok(item.css.includes('.bubble'), item.id + ' missing bubble design');
    assert.ok(!item.css.includes('.chat-avatar'), item.id + ' must not gain non-source avatar rules');
    assert.ok(!item.css.includes('.duo-chat-preview-composer'), item.id + ' must not gain non-source composer rules');
    for (const legacy of ['.chat-container', '#chat-container', '.message-wrapper', '.message-content-wrapper', '.message-sent', '.message-received', '.message-image-bubble-none']) {
      assert.ok(!item.css.includes(legacy), item.id + ' retains legacy selector ' + legacy);
    }
  }
  const scopeOnly = css => css.replace(/\.duo-chat-beautify--[a-z0-9-]+/g, '.duo-chat-beautify--SCOPE');
  const first = presets.find(item => item.id === 'ink-minimal');
  const fifth = presets.find(item => item.id === 'carbon-glass');
  assert.equal(scopeOnly(first.css), scopeOnly(fifth.css), 'original source styles 1 and 5 must remain identical');
});

test('all 21 designs isolate generic bubble rules and pseudo-elements from media classes', () => {
  for (const item of presets) {
    const rules = parseCssRules(item.css);
    assert.ok(rules.length >= 3, item.id + ' CSS should contain real parsed rules');
    for (const rule of rules) {
      for (const selector of splitSelectorList(rule.selector)) {
        assertMediaSafeSelector(selector.trim(), item.id);
      }
    }
  }
  for (const id of ['rabbit-milk', 'line-kitty']) {
    const item = presets.find(entry => entry.id === id);
    assert.match(item.css, /\.bubble:has\(video\)/, id + ' must preserve its source video-specific decoration');
    assert.match(item.css, /\.bubble:has\(\.message-card\)|\.bubble:has\(\.chat-card\)/,
      id + ' must preserve its source card-specific decoration');
    assert.match(item.css, /:is\(\.audio-bubble\)/, id + ' must preserve its source voice-bubble design');
    assert.match(item.css, /\.bubble:has\(img\):not\(\.sticker-bubble\)/, id + ' image decoration must not spill onto sticker bubbles');
  }
});

test('four decorative designs use real text-bubble DOM selectors and preserve decoration declarations', () => {
  for (const id of decorativePresetIds) {
    const item = presets.find(entry => entry.id === id);
    assert.ok(item, id + ' must remain in the approved list');
    assert.ok(!item.css.includes('data-xiaoshu-uniform-text'),
      id + ' must not depend on an attribute absent from the target DOM');
    assert.ok(item.css.includes(':is(#chatList,.duo-chat-beautify-preview)'),
      id + ' must target live chat and preview roots');
    assert.ok(item.css.includes('.msg-row.me') && item.css.includes('.msg-row.other'),
      id + ' must target both sender directions');
    assert.ok(/background-image|border-image/i.test(item.css) && item.css.includes('url('),
      id + ' must retain original decorative image/border rules');
    for (const rule of parseCssRules(item.css)) {
      for (const selector of splitSelectorList(rule.selector)) {
        assertMediaSafeSelector(selector.trim(), id);
      }
    }
  }
});

test('all 11 migrated local decoration assets still exist and remain the only local preset assets', () => {
  const localAssets = new Set();
  for (const item of presets) {
    const urls = [...item.css.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi)].map(match => match[2]);
    for (const url of urls.filter(value => !/^https?:|^data:|^\/\//i.test(value))) {
      localAssets.add(url);
      assert.ok(existsSync(resolve(root, url)), item.id + ' missing local source asset ' + url);
    }
  }
  assert.equal(localAssets.size, 11, 'the 11 original local assets must remain present');
});

test('manager removes only a stale selected preset ID and preserves all other state', () => {
  assert.match(manager, /const storedPresetId = state\.chatBeautifyPresetId/);
  assert.match(manager, /delete state\.chatBeautifyPresetId/);
  assert.match(manager, /save\(\)/);
  assert.match(manager, /validPresets\.some\(item => item\.id === storedPresetId\)/);
  assert.match(manager, /applyToChat\(id\)/);
  assert.match(manager, /state\.chatBeautifyPresetId/);
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
