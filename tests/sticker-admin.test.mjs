import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../sticker-admin.js', import.meta.url), 'utf8');
const stickerLibrary = readFileSync(new URL('../sticker-library.js', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../settings-pages.js', import.meta.url), 'utf8');

test('管理中心只从参数区独立设置分类打开', () => {
  assert.ok(html.includes('data-settings-category="stickers"'));
  assert.ok(html.includes('sticker-admin.js'));
  assert.ok(settings.includes("stickers:{title:'表情包管理'"));
  assert.ok(settings.includes('window.__duoStickerAdmin.mount(content)'));
  assert.doesNotMatch(stickerLibrary,/data-open-sticker-admin|__duoOpenSettingsCategory/);
  assert.ok(html.includes('id="stickerOverlay"'));
});

test('管理中心提供搜索、分类筛选、全选、取消选择和批量删除', () => {
  for (const token of ['data-sticker-admin-search','data-sticker-admin-filter','data-sticker-admin-select-all','data-sticker-admin-clear-selection','data-sticker-admin-delete','deleteBatch(unique)']) {
    assert.ok(admin.includes(token), 'missing '+token);
  }
});

test('清单支持全部和已选 JSON / CSV，并标明不包含图片原文件', () => {
  for (const token of ['data-sticker-admin-export-all-json','data-sticker-admin-export-all-csv','data-sticker-admin-export-selected-json','data-sticker-admin-export-selected-csv','twodeers-sticker-library-list','text/csv;charset=utf-8','清单不包含图片原文件']) {
    assert.ok(admin.includes(token), 'missing '+token);
  }
});

test('管理页监听共享表情库的跨标签页更新', () => {
  assert.ok(admin.includes("addEventListener('storage'"));
  assert.match(admin,/dual_space_sticker_library_v1/);
});

test('批量删除先提交权威库墓碑，再清理未被引用媒体', () => {
  const deleteStart = admin.indexOf('async function deleteItems');
  const deleteEnd = admin.indexOf('function onClick', deleteStart);
  const source = admin.slice(deleteStart, deleteEnd);
  assert.ok(deleteStart >= 0 && deleteEnd > deleteStart);
  assert.ok(source.indexOf('deleteBatch(unique)') < source.indexOf('deleteIfUnreferenced(item.mediaId)'));
  assert.match(source, /历史聊天消息中已经发送的图片会保留/);
  assert.match(source, /图片清理失败/);
});
