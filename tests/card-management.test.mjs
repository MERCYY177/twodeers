import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'card-system.js'), 'utf8');

function createHarness(seed = {}) {
  const local = new Map();
  const state = {
    cardPhrases: [...(seed.chat || [])],
    cardUsageOutbox: [...(seed.chatOutbox || [])]
  };
  let circleState = {
    dynamicCards: [...(seed.dynamic || [])],
    replyCards: [...(seed.reply || [])],
    usageOutbox: [...(seed.circleOutbox || [])],
    posts: [], visitorRecords: [], notificationsEnabled: true
  };
  let failSave = false;
  let failCircleImport = false;
  let failMailboxPersist = false;
  let mailboxUsageOutbox = [...(seed.mailboxOutbox || [])];
  const document = {
    head: { appendChild() {} },
    body: { appendChild() {} },
    createElement() { return { textContent: '', style: {}, appendChild() {} }; },
    querySelector() { return null; },
    addEventListener() {}
  };
  const apiCircle = {
    exportState() { return JSON.parse(JSON.stringify(circleState)); },
    importState(next) {
      if (failCircleImport) {
        failCircleImport = false;
        // Simulate a bridge that mutates part of Circle's state and then throws.
        if (Array.isArray(next?.dynamicCards)) circleState.dynamicCards = [...next.dynamicCards];
        throw new Error('injected Circle transaction error after partial mutation');
      }
      if (!next || !Array.isArray(next.posts)) throw new Error('bad Circle state');
      circleState = JSON.parse(JSON.stringify(next));
      return true;
    },
    getUsageOutbox() { return circleState.usageOutbox.map(x => ({ ...x })); },
    ackUsageOutbox(ids) {
      const wanted = new Set(ids.map(String));
      circleState.usageOutbox = circleState.usageOutbox.filter(x => !wanted.has(String(x.eventId)));
      return true;
    }
  };
  const apiMailbox = {
    getUsageOutbox() { return JSON.parse(JSON.stringify(mailboxUsageOutbox)); },
    setUsageOutbox(events) {
      if (failMailboxPersist) { failMailboxPersist = false; throw new Error('injected mailbox queue persistence error'); }
      mailboxUsageOutbox = JSON.parse(JSON.stringify(events));
      return true;
    }
  };
  const coordinator = { getStatus() { return { ready: true, writable: true }; }, isWritable() { return true; }, assertWritable() { return true; }, markDataChanged() { return true; } };
  const window = { __duoCircleApi: apiCircle, __duoMailbox: apiMailbox, __duoRuntimeCoordinator: coordinator };
  const localStorage = {
    getItem(key) { return local.has(key) ? local.get(key) : null; },
    setItem(key, value) { local.set(key, String(value)); },
    removeItem(key) { local.delete(key); }
  };
  const context = {
    window, document, localStorage, state,
    save() {
      if (failSave) { failSave = false; return false; }
      localStorage.setItem('twodeers_state_test', JSON.stringify(state));
      return true;
    },
    showToast() {},
    escapeHtml(value) { return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); },
    setTimeout() { return 1; },
    clearTimeout() {},
    console,
    URL, Blob, Date, Math, JSON, Map, Set, Promise
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'card-system.js' });
  return {
    api: window.__duoCardSystem,
    state,
    getCircle: () => JSON.parse(JSON.stringify(circleState)),
    getMailboxOutbox: () => JSON.parse(JSON.stringify(mailboxUsageOutbox)),
    setFailMailboxPersist() { failMailboxPersist = true; },
    setFailSave() { failSave = true; },
    setFailCircleImport() { failCircleImport = true; },
    local
  };
}

const sourceApp = createHarness({
  chat: ['已有主字卡'],
  dynamic: ['动态 A'],
  reply: ['回复 A'],
  mailboxOutbox: [{ eventId: 'mail-use-1', textSnapshot: '信件里的字卡', source: 'mailbox', usedAt: 100 }]
});
const api = sourceApp.api;

// Bulk add: one non-empty line = one card; empty and duplicate lines are skipped.
const add = api.bulkAdd('chat', '第一条\n\n第二条\r\n 第一条 \r第三条   测试');
assert.equal(add.added, 3);
assert.equal(add.skipped, 1);
assert.equal(add.emptyLines, 1);
assert.deepEqual(Array.from(sourceApp.state.cardPhrases), ['已有主字卡', '第一条', '第二条', '第三条   测试']);

// Matching the reference project's normalized duplicate rule: trim, lowercase, collapse spaces.
const duplicate = api.bulkAdd('chat', '  第一条  \n第三条 测试\n第四条');
assert.equal(duplicate.added, 1);
assert.equal(duplicate.skipped, 2);
assert.equal(sourceApp.state.cardPhrases.at(-1), '第四条');

// Bulk add runs against all three real pools, not only the chat-card panel.
const threePoolAdd = createHarness({ dynamic: ['动态旧项'], reply: ['回复旧项'] });
assert.equal(threePoolAdd.api.bulkAdd('moments-dynamic', '动态新项一\n\n动态新项二').added, 2);
assert.equal(threePoolAdd.api.bulkAdd('moments-reply', '回复新项一\r回复新项二').added, 2);
assert.deepEqual(Array.from(threePoolAdd.api.getPoolItems('moments-dynamic'), x => x.text), ['动态旧项', '动态新项一', '动态新项二']);
assert.deepEqual(Array.from(threePoolAdd.api.getPoolItems('moments-reply'), x => x.text), ['回复旧项', '回复新项一', '回复新项二']);

// A removed card keeps its actual-use history as a historical record, without remaining active.
const deletedHistory = createHarness({ chat: ['会被删除的卡'] });
const removedCardId = deletedHistory.api.getCardIdAt('chat', 0);
deletedHistory.api.recordUsed('会被删除的卡', 'chat', removedCardId);
deletedHistory.api.bulkRemove('chat', [removedCardId]);
assert.equal(deletedHistory.api.getPoolItems('chat').length, 0);
assert.ok(deletedHistory.api.getRecent().some(row => row.cardId === removedCardId && row.textSnapshot === '会被删除的卡'));

// Stable IDs survive deleting a preceding item; selected deletion uses IDs, not stale indexes.
const idsBefore = api.getPoolItems('chat').map(x => x.id);
const deleteResult = api.bulkRemove('chat', [idsBefore[1], idsBefore[3]]);
assert.equal(deleteResult.removed, 2);
const remaining = api.getPoolItems('chat');
assert.deepEqual(Array.from(remaining, x => x.text), ['已有主字卡', '第二条', '第四条']);
assert.equal(remaining[0].id, idsBefore[0]);
assert.equal(remaining[1].id, idsBefore[2]);
assert.equal(remaining[2].id, idsBefore[4]);

// De-duplication keeps the first card and its ID.
sourceApp.state.cardPhrases.push('  已有主字卡  ', '已有主字卡');
const firstId = api.getPoolItems('chat')[0].id;
const dedup = api.deduplicate('chat');
assert.equal(dedup.removed, 2);
assert.equal(api.getPoolItems('chat')[0].id, firstId);
assert.equal(sourceApp.state.cardPhrases.length, 3);

// IDs and recent-use metadata travel independently from each of the three card pools.
api.recordUsed('已有主字卡', 'chat', firstId);
api.recordUsed('动态 A', 'moments-dynamic', api.getCardIdAt('moments-dynamic', 0));
const exported = api.exportModules(['chat', 'moments-dynamic', 'moments-reply', 'usage']);
assert.equal(exported.type, 'twodeers-card-library');
assert.equal(exported.pools.chat[0].id, firstId);
assert.equal(exported.pools['moments-dynamic'][0].text, '动态 A');
assert.ok(exported.usage.recentDrawnRepliesV1.length >= 2);
assert.equal(exported.usage.mailboxUsageOutbox[0].eventId, 'mail-use-1');

// Import append preserves existing content and is idempotent on repeated import.
const target = createHarness({ chat: ['本地已有'], dynamic: ['本地动态'], reply: ['本地回复'], mailboxOutbox: [{ eventId: 'mail-local-1', textSnapshot: '本地待处理信件字卡' }] });
const append1 = target.api.importModules(exported, { selectedModules: ['chat', 'moments-dynamic', 'moments-reply', 'usage'], mode: 'append' });
assert.equal(append1.added.chat, exported.pools.chat.length);
assert.equal(target.state.cardPhrases.length, exported.pools.chat.length + 1);
const afterFirstAppend = Array.from(target.api.getPoolItems('chat'), x => x.text);
target.api.importModules(exported, { selectedModules: ['chat', 'moments-dynamic', 'moments-reply', 'usage'], mode: 'append' });
assert.deepEqual(Array.from(target.api.getPoolItems('chat'), x => x.text), afterFirstAppend);
assert.equal(target.getMailboxOutbox().filter(x => x.eventId === 'mail-use-1').length, 1);
assert.equal(target.api.getPoolItems('moments-dynamic').length, 2);
assert.equal(target.api.getPoolItems('moments-reply').length, 2);
assert.ok(target.api.getRecent().some(x => x.textSnapshot === '已有主字卡'));
assert.deepEqual(Array.from(target.getMailboxOutbox(), x => x.eventId).sort(), ['mail-local-1','mail-use-1']);

// Overwrite affects only selected modules; Circle's unrelated data survives.
const beforeOverwriteCircle = target.getCircle();
const replacePayload = {
  type: 'twodeers-card-library', version: 1,
  modules: ['chat'],
  pools: { chat: [{ id: 'imported-id-1', text: '替换后的主字卡' }] }
};
target.api.importModules(replacePayload, { selectedModules: ['chat'], mode: 'replace' });
assert.deepEqual(Array.from(target.api.getPoolItems('chat'), x => x.text), ['替换后的主字卡']);
assert.deepEqual(Array.from(target.api.getPoolItems('moments-dynamic'), x => x.text), ['本地动态', '动态 A']);
assert.deepEqual(Array.from(target.api.getPoolItems('moments-reply'), x => x.text), ['本地回复', '回复 A']);
assert.equal(target.getCircle().notificationsEnabled, beforeOverwriteCircle.notificationsEnabled);
assert.deepEqual(target.getCircle().posts, beforeOverwriteCircle.posts);

// KKK legacy reply-library exports map customReplies to the live chat pool and
// preserve non-native pools/groups in a separately selectable compatibility archive.
const legacy = {
  customReplies: ['KKK 字卡一', 'KKK 字卡二'],
  kaomojiLibrary: ['(=^・^=)'],
  customPokes: ['拍一拍旧词条'],
  customIntros: ['标题|副标题'],
  customEmojis: ['🌷'],
  customReplyGroups: [{ name: '旧主字卡分组', color: '#ff8899', items: ['KKK 字卡一'] }],
  customPokeGroups: [{ name: '旧拍一拍分组', items: ['拍一拍旧词条'] }],
  kaomojiGroups: [{ name: '旧颜文字分组', items: ['(=^・^=)'] }],
  customStatuses: ['未实现的状态词库']
};
const legacyInfo = target.api.inspectImport(legacy);
assert.deepEqual(Array.from(legacyInfo.available), ['chat', 'legacy:kaomojiLibrary', 'legacy:customPokes', 'legacy:customIntros', 'legacy:customEmojis', 'legacy:customReplyGroups', 'legacy:customPokeGroups', 'legacy:kaomojiGroups']);
assert.ok(legacyInfo.unsupported.includes('customStatuses'));
assert.throws(() => target.api.inspectImport({ customReplies: ['字'.repeat(1001)] }), /超过 1000 字/);
target.api.importModules(legacy, { selectedModules: legacyInfo.available, mode: 'append' });
assert.ok(target.state.cardPhrases.includes('KKK 字卡一'));
assert.deepEqual(Array.from(target.api.getLegacyModules().kaomojiLibrary), ['(=^・^=)']);
assert.deepEqual(Array.from(target.api.getLegacyModules().customPokes), ['拍一拍旧词条']);
assert.deepEqual(Array.from(target.api.getLegacyModules().customIntros), ['标题|副标题']);
assert.deepEqual(Array.from(target.api.getLegacyModules().customEmojis), ['🌷']);
assert.deepEqual(target.api.getLegacyModules().customReplyGroups[0].items, ['KKK 字卡一']);
assert.deepEqual(target.api.getLegacyModules().customPokeGroups[0].items, ['拍一拍旧词条']);
assert.deepEqual(target.api.getLegacyModules().kaomojiGroups[0].items, ['(=^・^=)']);
const archiveKeys=['legacy:kaomojiLibrary','legacy:customPokes','legacy:customIntros','legacy:customEmojis','legacy:customReplyGroups','legacy:customPokeGroups','legacy:kaomojiGroups'];
const legacyRoundTrip = target.api.exportModules(['chat', ...archiveKeys]);
assert.deepEqual(Array.from(legacyRoundTrip.customReplies), Array.from(target.state.cardPhrases));
assert.deepEqual(Array.from(legacyRoundTrip.customPokes), ['拍一拍旧词条']);
assert.deepEqual(legacyRoundTrip.legacyModules.customReplyGroups[0].items, ['KKK 字卡一']);
const legacyRoundTripTarget = createHarness();
legacyRoundTripTarget.api.importModules(legacyRoundTrip, { selectedModules: ['chat', ...archiveKeys], mode: 'replace' });
for (const key of ['kaomojiLibrary','customPokes','customIntros','customEmojis','customReplyGroups','customPokeGroups','kaomojiGroups']) assert.deepEqual(legacyRoundTripTarget.api.getLegacyModules()[key], target.api.getLegacyModules()[key]);
const backupRoundTrip = createHarness();
backupRoundTrip.api.importData(target.api.exportData());
assert.deepEqual(backupRoundTrip.api.getLegacyModules(), target.api.getLegacyModules());
assert.throws(() => target.api.inspectImport({ customReplyGroups: [{ name: '坏分组', items: [42] }] }), /内容格式无效/);


// KKK main reply overwrite normalization trims and removes exact duplicate strings, without case folding.
const overwriteNormalization = createHarness({ chat: ['旧字卡'] });
overwriteNormalization.api.importModules({ customReplies: [' 新字卡 ', '新字卡', '新字卡 ', 'New Card', 'new card'] }, { selectedModules: ['chat'], mode: 'replace' });
assert.deepEqual(Array.from(overwriteNormalization.api.getPoolItems('chat'), x => x.text), ['新字卡', 'New Card', 'new card']);

// Card-ID collisions across pools are remapped, and imported usage follows the remapped ID.
const collisionSource = createHarness({ chat: ['源端字卡'], dynamic: ['源动态'], reply: [] });
collisionSource.api.importData({
  chatIds: ['shared-card-id'], chatTexts: ['源端字卡'],
  recentDrawnRepliesV1: [{ cardId: 'shared-card-id', source: 'chat', textSnapshot: '源端字卡', count: 4, lastDrawAt: 400 }],
  appliedEventIds: ['source-use-event']
});
const collisionExport = collisionSource.api.exportModules(['chat', 'usage']);
const collisionTarget = createHarness({ chat: ['本地字卡'], dynamic: ['本地动态'], reply: [] });
collisionTarget.api.importData({ momentsDynamicIds: ['shared-card-id'], momentsDynamicTexts: ['本地动态'] });
collisionTarget.api.importModules(collisionExport, { selectedModules: ['chat', 'usage'], mode: 'append' });
const remappedId = collisionTarget.api.getPoolItems('chat').find(x => x.text === '源端字卡').id;
assert.notEqual(remappedId, 'shared-card-id');
assert.ok(collisionTarget.api.getRecent().some(x => x.textSnapshot === '源端字卡' && x.cardId === remappedId));

// A source ID reused across two different pools is disambiguated by pool + source ID.
const crossPoolTarget = createHarness();
assert.throws(() => crossPoolTarget.api.inspectImport({ type: 'twodeers-card-library', pools: { chat: [{ id: 'dup', text: 'a' }, { id: 'dup', text: 'b' }] } }), /重复 ID/);
const crossPoolPayload = {
  type: 'twodeers-card-library', version: 1,
  modules: ['chat', 'moments-dynamic', 'usage'],
  pools: { chat: [{ id: 'same-source-id', text: '聊天导入卡' }], 'moments-dynamic': [{ id: 'same-source-id', text: '朋友圈导入卡' }] },
  usage: { recentDrawnRepliesV1: [
    { cardId: 'same-source-id', source: 'chat', textSnapshot: '聊天导入卡', count: 2, lastDrawAt: 200 },
    { cardId: 'same-source-id', source: 'moments-dynamic', textSnapshot: '朋友圈导入卡', count: 3, lastDrawAt: 300 }
  ], appliedEventIds: [] }
};
crossPoolTarget.api.importModules(crossPoolPayload, { selectedModules: ['chat', 'moments-dynamic', 'usage'], mode: 'append' });
const crossChatId = crossPoolTarget.api.getPoolItems('chat').find(x => x.text === '聊天导入卡').id;
const crossMomentId = crossPoolTarget.api.getPoolItems('moments-dynamic').find(x => x.text === '朋友圈导入卡').id;
assert.notEqual(crossChatId, crossMomentId);
assert.ok(crossPoolTarget.api.getRecent().some(x => x.source === 'chat' && x.cardId === crossChatId));
assert.ok(crossPoolTarget.api.getRecent().some(x => x.source === 'moments-dynamic' && x.cardId === crossMomentId));

// Failed Circle commit rolls back chat cards, Circle cards, and persisted ID state together.
const rollback = createHarness({ chat: ['回滚前主字卡'], dynamic: ['回滚前动态'], reply: ['回滚前回复'] });
const rollbackChat = rollback.state.cardPhrases.slice();
const rollbackCircle = rollback.getCircle();
const rollbackDataBefore = JSON.stringify(rollback.api.exportData());
rollback.setFailCircleImport();
assert.throws(() => rollback.api.importModules({
  type: 'twodeers-card-library', version: 1,
  modules: ['chat', 'moments-dynamic'],
  pools: { chat: [{ text: '不应留下的主字卡' }], 'moments-dynamic': [{ text: '不应留下的朋友圈字卡' }] }
}, { selectedModules: ['chat', 'moments-dynamic'], mode: 'replace' }), /injected Circle transaction error after partial mutation/);
assert.deepEqual(rollback.state.cardPhrases, rollbackChat);
assert.deepEqual(rollback.getCircle(), rollbackCircle);
assert.equal(JSON.stringify(rollback.api.exportData()), rollbackDataBefore);

// V4 backup import must roll back Circle even if the bridge mutates/throws mid-commit.
const importRollback = createHarness({ chat: ['备份前主字卡'], dynamic: ['备份前动态'], reply: ['备份前回复'] });
const importRollbackChat = importRollback.state.cardPhrases.slice();
const importRollbackCircle = importRollback.getCircle();
importRollback.setFailCircleImport();
assert.throws(() => importRollback.api.importData({
  chatIds: ['new-id'], chatTexts: ['备份导入主字卡'],
  momentsDynamicIds: ['new-dynamic-id'], momentsDynamicTexts: ['备份导入动态'], momentsDynamic: ['备份导入动态']
}), /injected Circle transaction error after partial mutation/);
assert.deepEqual(importRollback.state.cardPhrases, importRollbackChat);
assert.deepEqual(importRollback.getCircle(), importRollbackCircle);

// Mailbox pending usage events are transactional with the independent card import.
const mailboxRollback = createHarness({ chat: ['信箱回滚测试'], mailboxOutbox: [{ eventId: 'mail-before', textSnapshot: '旧待同步' }] });
const mailboxBefore = mailboxRollback.getMailboxOutbox();
mailboxRollback.setFailMailboxPersist();
assert.throws(() => mailboxRollback.api.importModules({
  type: 'twodeers-card-library', version: 1, modules: ['usage'], pools: {},
  usage: { recentDrawnRepliesV1: [], appliedEventIds: [], mailboxUsageOutbox: [{ eventId: 'mail-incoming', textSnapshot: '新待同步' }] }
}, { selectedModules: ['usage'], mode: 'replace' }), /injected mailbox queue persistence error/);
assert.deepEqual(mailboxRollback.getMailboxOutbox(), mailboxBefore);

// Failed main-state save also restores the selected pool and ID metadata.
const failedSave = createHarness({ chat: ['保存前字卡'] });
const oldItems = failedSave.api.getPoolItems('chat');
failedSave.setFailSave();
assert.throws(() => failedSave.api.bulkAdd('chat', '保存失败项目'), /聊天字卡保存失败/);
assert.deepEqual(Array.from(failedSave.api.getPoolItems('chat'), x => x.text), Array.from(oldItems, x => x.text));

// Source UI has real controls for all pools, selection, import/export and batch entry.
const settings = fs.readFileSync(path.join(ROOT, 'settings-pages.js'), 'utf8');
assert.ok(settings.includes('data-transfer-module=\"legacy:'), 'missing compatibility-archive transfer options');
for (const marker of ['data-card-bulk-add="chat"','data-card-bulk-add="moments-dynamic"','data-card-bulk-add="moments-reply"','data-card-select-all="chat"','data-card-select-all="moments-dynamic"','data-card-select-all="moments-reply"','data-card-bulk-delete="chat"','data-card-bulk-delete="moments-dynamic"','data-card-bulk-delete="moments-reply"','data-card-import','data-card-export','data-card-search="chat"','data-card-dedup="chat"','getLegacyModules','legacyCardLabels','KKK 兼容归档']) {
  assert.ok(settings.includes(marker), `missing UI control ${marker}`);
}
const mailboxSource = fs.readFileSync(path.join(ROOT, 'mailbox-manager.js'), 'utf8');
assert.match(mailboxSource, /function getUsageOutbox\(\)/);
assert.match(mailboxSource, /function setUsageOutbox\(events,mode='replace'\)/);
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
assert.match(html, /id="phraseBatchInput"/);
assert.match(html, /id="phraseBatchAddBtn"/);

console.log('PASS: bulk add/blank-line handling, normalized dedup, stable-ID selection/delete, three-pool UI and import/export, usage outboxes (chat/Circle/mailbox), append/replace isolation, KKK customReplies compatibility, archived legacy-module import/export round trip/overwrite normalization, import-size validation, and V4/Circle/mailbox transaction rollback.');
