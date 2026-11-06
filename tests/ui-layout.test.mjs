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


test('来电间隔改为分钟显示，保存时换算回秒，超时仍保持秒',()=>{
  assert.match(html,/最短来电间隔（分钟）/);
  assert.match(html,/最长来电间隔（分钟）/);
  assert.match(html,/cfg\.minIntervalSec=Math\.max\(1,Math\.round\(Number\(\$\('#incomingMinInterval'\)\.value\)\*60\)\)/);
  assert.match(html,/cfg\.maxIntervalSec=Math\.max\(1,Math\.round\(Number\(\$\('#incomingMaxInterval'\)\.value\)\*60\)\)/);
  assert.match(html,/cfg\.minIntervalSec\/60\)\.toFixed\(3\)/);
  assert.match(html,/无人接听超时（秒）/);
});

test('朋友圈回复间隔改为分钟显示并保留秒级内部计时兼容',()=>{
  assert.match(html,/最短互动（分钟）/);
  assert.match(html,/最长互动（分钟）/);
  assert.match(html,/state\.replyMin = Math\.max\(1, Math\.round\(\(Number\(qs\('#replyMinInput'\)\.value\)\|\|state\.replyMin\/60\)\*60\)\)/);
  assert.match(html,/state\.replyMax = Math\.max\(state\.replyMin, Math\.round\(\(Number\(qs\('#replyMaxInput'\)\.value\)\|\|state\.replyMax\/60\)\*60\)\)/);
  assert.match(html,/rand\(state\.replyMin, state\.replyMax\) \* 1000/);
});

test('朋友圈访客入口、访客列表和自动记录逻辑已恢复',()=>{
  assert.match(html,/id="visitorBtn"/);
  assert.match(html,/id="visitorBadge"/);
  assert.match(html,/id="visitorMask"/);
  assert.match(html,/id="visitorList"/);
  assert.match(html,/visitorRecords:\[\]/);
  assert.match(html,/window\.openCircleVisitorPanel=openVisitorPanel/);
  assert.match(html,/visitorTimer=setInterval/);
});

test('访客记录从独立备份恢复，旧备份导入不会覆盖已有访客',()=>{
  assert.match(html,/moments_site_blank_v49_rebuild_baseline_same_layout_visitor_backup_step01b/);
  assert.match(html,/if\(backupCount>primaryCount\)/);
  assert.match(html,/visitorHadRecords&&\(!Array\.isArray\(state\.visitorRecords\)\|\|!state\.visitorRecords\.length\)&&!allowEmptyVisitorWrite/);
  assert.match(html,/return buildSanitizedState\(data\)/);
});
