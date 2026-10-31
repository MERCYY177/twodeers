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
const normalize = css => css
  .replace(/#[0-9a-f]{3,8}\b/gi, '#COLOR')
  .replace(/rgba?\([^)]*\)/gi, 'COLOR')
  .replace(/hsla?\([^)]*\)/gi, 'COLOR')
  .replace(/content\s*:\s*(['"])[\s\S]*?\1/gi, 'content:""')
  .replace(/\s+/g, '');

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

test('every preset styles both sender sides plus avatar, metadata and composer', () => {
  for (const item of presets) {
    const scope = '.duo-chat-beautify--' + item.id;
    assert.ok(item.css.includes('#chatList' + scope), item.id + ' must target the target chat list root');
    assert.ok(item.css.includes(scope + ' .msg-row.me .bubble' + mediaExclusion), item.id + ' missing own-message bubble design');
    assert.ok(item.css.includes(scope + ' .msg-row.other .bubble' + mediaExclusion), item.id + ' missing peer-message bubble design');
    assert.ok(item.css.includes(scope + ' .chat-avatar'), item.id + ' missing avatar treatment');
    assert.ok(item.css.includes(scope + ' .meta'), item.id + ' missing message metadata treatment');
    assert.ok(item.css.includes('.duo-chat-preview-composer'), item.id + ' missing preview/input-area treatment');
    assert.ok(item.css.includes(scope + ' .bubble' + mediaExclusion + '{position:relative!important}'));
    assert.ok(!item.css.includes(scope + ' .bubble{'), item.id + ' must not blanket-style all media bubbles');
    assert.ok(item.css.startsWith('#chatList' + scope));
  }
});

test('preset CSS is scoped to real twodeers DOM and excludes media message classes', () => {
  assert.match(targetHtml, /class="page chat-page" id="chatPage"/);
  assert.match(targetHtml, /id="chatList"[^>]*class="chat-bg"|class="chat-bg"[^>]*id="chatList"/);
  assert.ok(targetHtml.includes("msg.sender==='me'?'me':'other'"));
  for (const mediaClass of ['image-bubble', 'video-bubble', 'audio-bubble', 'sticker-bubble']) {
    assert.ok(targetHtml.includes(mediaClass), 'target renderer must contain ' + mediaClass);
    for (const item of presets) assert.ok(item.css.includes(mediaExclusion), item.id + ' must exclude ' + mediaClass);
  }
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
