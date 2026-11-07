import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const settings=readFileSync(new URL('../settings-pages.js',import.meta.url),'utf8');
const mailbox=readFileSync(new URL('../mailbox-manager.js',import.meta.url),'utf8');

test('首页信箱位于参数区之前，且入口命名为信箱',()=>{
  const mailbox=html.indexOf('<div class="label">信箱</div>');
  const params=html.indexOf('<div class="label">参数区</div>');
  assert.ok(mailbox>=0&&params>=0&&mailbox<params);
  assert.doesNotMatch(html,/<div class="label">信件<\/div>/);
});

test('表情包选择面板独立展示，Emoji 继续保留为单独入口',()=>{
  assert.match(html,/id="stickerOverlay"[\s\S]*?id="stickerGrid"/);
  assert.match(html,/id="emojiPanel"[\s\S]*?id="emojiGrid"/);
  assert.match(html,/id="quickEmojiBtn"/);
  assert.doesNotMatch(html,/emoji-panel-columns/);
  assert.doesNotMatch(html,/id="stickerList"/);
  assert.doesNotMatch(html,/id="addStickerBtn"/);
});

test('表情包发送面板不承载管理操作或额外发送按钮',()=>{
  assert.match(html,/id="settingsCategoryGrid"[\s\S]*data-settings-category="stickers"/);
  assert.match(html,/id="stickerAdd"/);
  assert.match(html,/id="stickerClose"/);
  assert.match(html,/data-sticker-id/);
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

test('信箱与模拟通话设置都从参数区入口打开',()=>{
  assert.match(html,/data-settings-category="mail"/);
  assert.match(html,/data-settings-category="calls"/);
  assert.doesNotMatch(html,/id="mailMoreBtn"|id="mailMoreMenu"|id="mailSettingsModal"/);
  assert.match(settings,/mail:\{title:'信箱设置'/);
  assert.match(settings,/window\.__duoMailbox\?\.mountSettings/);
  assert.match(settings,/calls:\{title:'模拟通话'/);
});

test('聊天更多菜单只提供直接语音与视频通话操作',()=>{
  assert.match(html,/data-chat-menu="audio">语音通话/);
  assert.match(html,/data-chat-menu="video">视频通话/);
  assert.doesNotMatch(html,/data-chat-menu="settings"|data-chat-menu="call"/);
  assert.match(html,/action==='audio'[\s\S]*?startCall\('audio'\)/);
  assert.match(html,/action==='video'[\s\S]*?startCall\('video'\)/);
});

test('模拟通话采用参考表单和固定频率档位，旧外呼选项保留在高级设置',()=>{
  assert.match(html,/id="callMasterEnabled"/);
  assert.match(html,/id="callIncomingEnabled"/);
  assert.match(html,/id="callIncomingAudioEnabled"/);
  assert.match(html,/id="callIncomingVideoEnabled"/);
  assert.match(html,/id="incomingCallFrequency"/);
  assert.match(html,/low:\{minIntervalSec:3600,maxIntervalSec:10800\}/);
  assert.match(html,/medium:\{minIntervalSec:1800,maxIntervalSec:5400\}/);
  assert.match(html,/high:\{minIntervalSec:600,maxIntervalSec:1800\}/);
  assert.match(html,/id="callSettingsCancel"/);
  assert.match(html,/id="callSettingsSave"/);
  assert.match(html,/视频来电概率/);
  assert.match(html,/无人接听超时（秒）/);
  assert.match(html,/id="audioCallSeg"/);
  assert.match(html,/id="videoCallSeg"/);
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
  assert.match(html,/VISITOR_BACKUP_KEY = STORE_KEY \+ '_visitor_backup_step01b'/);
  assert.match(html,/if\(backupCount>primaryCount\)/);
  assert.match(html,/visitorHadRecords&&\(!Array\.isArray\(state\.visitorRecords\)\|\|!state\.visitorRecords\.length\)&&!allowEmptyVisitorWrite/);
  assert.match(html,/return buildSanitizedState\(data\)/);
});

test('信件正文图片保留原始比例，只有编辑器缩略图允许裁切',()=>{
  assert.ok(mailbox.includes('.mail-image-thumb img{width:100%;height:100%;object-fit:cover;display:block}'));
  assert.ok(mailbox.includes('.mail-read-images{display:grid;'));
  assert.ok(mailbox.includes('.mail-read-image img{display:block;width:auto;height:auto;max-width:100%;max-height:70vh;object-fit:contain}'));
  assert.ok(!mailbox.includes('compressMailJpeg'),'mail attachment uploads must not re-encode source JPEGs');
  assert.ok(mailbox.includes('const stored=file;'),'mail attachments must be stored as the original File blob');
  assert.ok(mailbox.includes('jpeg|png|webp|gif|avif'));
});
test('页面浮层层级统一走命名 token，备份与恢复遮罩保持最高优先级',()=>{
  for(const token of ['--z-message-decoration:10','--z-more-panel:34','--z-input-helper:35','--z-emoji-panel:38','--z-sticker-overlay:1000','--z-header-menu:12000','--z-backup-overlay:2147482000','--z-restore-overlay:2147483000']) {
    assert.ok(html.includes(token),'missing layer token '+token);
  }
  assert.ok(html.includes('z-index:var(--z-header-menu,12000)'));
  assert.equal((html.match(/\\.more-panel\\{z-index:var\\(--z-more-panel,34\\)\\}/g)||[]).length,1,'more-panel must have one authoritative stacking rule');
  assert.ok(html.includes('z-index:var(--z-sticker-overlay,1000)'));
  assert.ok(html.includes('z-index:var(--z-incoming-call,110)'));
  assert.ok(mailbox.includes('z-index:var(--z-mail-modal,80)'));
});

test('移除旧信箱模态框与旧双栏表情包样式残留',()=>{
  assert.doesNotMatch(html,/mail-settings-modal|mail-settings-sheet|mailMoreBtn|mailMoreMenu|mail-header-menu-host/);
  assert.doesNotMatch(html,/emoji-zone-title|sticker-item button:active|emoji-panel-columns|emoji-column-stickers/);
  assert.match(html,/\.chat-header-menu-host\{position:relative\}/);
});
