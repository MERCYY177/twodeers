import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const settings=readFileSync(new URL('../settings-pages.js',import.meta.url),'utf8');

test('首页信箱位于参数区之前，且入口命名为信箱',()=>{
  const mailbox=html.indexOf('<div class="label">信箱</div>');
  const params=html.indexOf('<div class="label">参数区</div>');
  assert.ok(mailbox>=0&&params>=0&&mailbox<params);
  assert.doesNotMatch(html,/<div class="label">信件<\/div>/);
});

test('聊天和信箱设置都从各自页面右上角三个点进入',()=>{
  assert.match(html,/id="chatMoreBtn"[\s\S]*?id="chatMoreMenu"[\s\S]*?data-chat-menu="settings"/);
  assert.match(html,/id="mailMoreBtn"[\s\S]*?id="mailMoreMenu"[\s\S]*?data-mail-menu="settings"/);
  assert.match(html,/id="mailSettingsModal"/);
  assert.doesNotMatch(html,/id="callEntry"/);
});

test('最近抽过是字卡顶部分类，不需要滚动到三个字卡池下方',()=>{
  const tabs=settings.slice(settings.indexOf('function buildCardManager'),settings.indexOf('function buildCircleCard'));
  assert.match(tabs,/data-card-tab="recent"/);
  assert.match(tabs,/data-card-pane="recent"/);
  assert.match(tabs,/data-card-tab="chat"[\s\S]*?data-card-tab="recent"/);
  assert.match(tabs,/data-card-tab="moments-dynamic"/);
  assert.match(tabs,/data-card-tab="moments-reply"/);
  assert.match(tabs,/data-card-pane="recent" hidden/);
});

test('参数区不再展示独立通话设置入口，通话设置由聊天菜单调起',()=>{
  assert.doesNotMatch(html,/data-settings-category="calls"/);
  assert.match(settings,/calls:\{title:'通话设置'/);
  assert.match(html,/__duoOpenSettingsCategory\('calls'\)/);
});

test('从聊天右上角打开通话设置后，返回会回到聊天页',()=>{
  assert.match(settings,/returnPage=\(typeof state!=='undefined'&&state\.currentPage\)\|\|'settingsPage'/);
  assert.match(settings,/const target=returnPage;goto\(target\);if\(target==='settingsPage'\)setSettingsTab\('param'\)/);
});
