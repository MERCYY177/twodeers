import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const required = ['appearance-manager.js','custom-font-manager.js','font-panel.js','sticker-library.js','backup-v4.js','card-system.js','mailbox-manager.js','settings-pages.js'];
for (const file of required) {
  const source = readFileSync(resolve(root, file), 'utf8');
  new vm.Script(source, { filename: file });
  if (!html.includes('src="' + file + '"')) throw new Error('index.html 未接入 ' + file);
}
const inline = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
inline.forEach((match, index) => new vm.Script(match[1], { filename: 'index.html:inline-' + index }));
if (inline.length < 3) throw new Error('主页面脚本块数量异常');
for (const path of ['android-apps/app/src/main/java/com/mercyy/twodeers/MainActivity.java',
                    'android-apps/app/src/main/AndroidManifest.xml']) {
  if (!readFileSync(resolve(root, path), 'utf8').length) throw new Error('缺少 Android 文件：' + path);
}
const mainScript = inline.map(x => x[1]).join('\n');
if (!mainScript.includes('initializeIncomingCallScheduler') || !mainScript.includes('triggerIncomingCall')) throw new Error('主动来电现有逻辑缺失');
if (!html.includes('id="stickerOverlay"') || !html.includes('id="stickerGrid"') || html.includes('emoji-panel-columns')) throw new Error('独立表情包底部面板结构缺失');
for (const token of ['data-settings-category="profile"','data-settings-category="chat"','data-settings-category="cards"','data-settings-category="circle"','data-settings-category="appearance"','data-settings-category="mail"','data-settings-category="calls"','data-settings-category="stickers"','data-settings-category="privacy"','id="mailPage"','id="mailDraftList"','id="chatMoreBtn"','data-chat-menu="audio"','data-chat-menu="video"']) if (!html.includes(token)) throw new Error('页面导航/参数入口缺失：'+token);
for (const token of ['id="visitorBtn"','id="visitorMask"','id="visitorList"','VISITOR_BACKUP_KEY','visitorRecords:[]','来电频率','低 60～180 分钟 · 中 30～90 分钟 · 高 10～30 分钟','无人接听超时（秒）','最短互动（分钟）','window.openCircleVisitorPanel=openVisitorPanel']) if (!html.includes(token)) throw new Error('访客记录/分钟间隔功能缺失：'+token);

for (const token of ['STICKER_LIBRARY_STORAGE_KEY','function normalizeStickerLibrary','function deleteStickerFromLibrary','function applyImportedStickerLibrary','function latestPersistedMediaReferences','twodeers_mailbox_letters_v1','twodeers_mailbox_drafts_v1','function replaceStickerFavorites','function isStickerSendable','const resetKeys=[STORAGE_KEY,STICKER_LIBRARY_STORAGE_KEY,','data-sticker-id']) {
  if (!html.includes(token)) throw new Error('表情包删除安全机制缺失：' + token);
}
const stickerManager = readFileSync(resolve(root, 'sticker-library.js'), 'utf8');
for (const token of ['toggleFavorite','data-sticker-id','data-sticker-favorite']) if (!stickerManager.includes(token)) throw new Error('表情包收藏管理缺失：' + token);
const v4 = readFileSync(resolve(root, 'backup-v4.js'), 'utf8');
for (const token of ['SHA-256','crc32','manifest.json','applyBackupPayload','font-library.json','mailbox-data.json','card-system.json','circle-settings.json','restoreInProgress','pauseTasks','stickerTombstones','applyImportedState','replaceFavorites']) {
  if (!v4.includes(token)) throw new Error('V4 备份关键能力缺失：' + token);
}
const native = readFileSync(resolve(root, 'android-apps/app/src/main/java/com/mercyy/twodeers/MainActivity.java'), 'utf8');
for (const token of ['onShowFileChooser','ACTION_CREATE_DOCUMENT','triggerDownloadBlob','writeChunk','finishSave']) {
  if (!native.includes(token)) throw new Error('Android 文件桥接缺失：' + token);
}
const card = readFileSync(resolve(root, 'card-system.js'), 'utf8');
for (const token of ['recentDrawnRepliesV1','momentsDynamicIds','momentsReplyIds','recordUsed','confirmDraw','function draw']) if (!card.includes(token)) throw new Error('统一字卡系统缺失：'+token);
const mailbox = readFileSync(resolve(root, 'mailbox-manager.js'), 'utf8');
for (const token of ['DRAFT_KEY','autoIncoming','autoReply','processDue','exportData','importData']) if (!mailbox.includes(token)) throw new Error('信件系统缺失：'+token);
console.log('OK: ' + required.length + ' 个模块已接入；' + inline.length + ' 个 index.html 内联脚本通过语法编译；六类参数入口、信箱/草稿、右上角设置菜单、访客记录与独立备份、分钟间隔换算、字卡分栏、备份、来电、双列表情包及 Android 入口静态检查通过。');
