/* Independent application-consistency audit for Phase 15 isolated reconstruction ZIPs.
 * Reads only the selected file and the embedded Phase 14 candidate. It never opens
 * live localStorage, IndexedDB, media stores, fonts or any application persistence API.
 */
(function (global) {
  'use strict';
  if (global.__duoRecoveryApplicationAuditorInstalled) return;
  global.__duoRecoveryApplicationAuditorInstalled = true;
  var MAX_INPUT_BYTES = 200 * 1024 * 1024;
  var OUTER_ENTRIES = [
    'base/twodeers-recovery-candidate.zip',
    'isolated/localStorageRaw.json',
    'isolated/changes.json',
    'validation/report.json',
    'isolated/manifest.json',
    'README.txt'
  ];
  var MAIN_KEY = 'dual_space_app_clean_test_v1';
  var STICKER_KEY = 'dual_space_sticker_library_v1';
  var MAILBOX_KEY = 'twodeers_mailbox_letters_v1';
  var CARD_KEY = 'twodeers_card_system_v1';
  var CIRCLE_KEY = 'moments_site_blank_v49_rebuild_baseline_same_layout';
  var VISITOR_KEY = 'moments_site_blank_v49_rebuild_baseline_same_layout_visitor_backup_step01b';
  var REVISION_KEY = '__twodeers_runtime_revision_v1';
  var REQUIRED_REVISION_PRECONDITIONS = [
    '关闭同源的其他 Twodeers 标签页和窗口',
    '退出后重新打开应用，再由独立恢复流程决定是否应用该提案'
  ];

  function fail(message) { throw new Error(message); }
  function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function jsonEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function parseJson(text, label) {
    try { return JSON.parse(text); }
    catch (error) { fail(label + ' JSON 无法解析：' + (error && error.message || error)); }
  }
  async function blobText(blob) {
    if (blob && typeof blob.text === 'function') return blob.text();
    if (blob && typeof blob.arrayBuffer === 'function') return new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer());
    if (typeof global.FileReader === 'function') return new Promise(function (resolve, reject) {
      var reader = new global.FileReader();
      reader.onload = function () { try { resolve(new TextDecoder('utf-8', { fatal: true }).decode(reader.result)); } catch (error) { reject(error); } };
      reader.onerror = function () { reject(reader.error || new Error('隔离 ZIP 条目读取失败')); };
      reader.onabort = function () { reject(new Error('隔离 ZIP 条目读取已取消')); };
      try { reader.readAsArrayBuffer(blob); } catch (error) { reject(error); }
    });
    fail('当前环境不支持读取隔离 ZIP 条目');
  }
  function findRows(rows, key) { return rows.filter(function (row) { return row && row.key === key; }); }
  function parseKnown(rows, key, findings, required) {
    var found = findRows(rows, key);
    if (!found.length) {
      if (required) findings.push({ severity: 'review', code: 'known-key-missing', path: key, message: '应用已知存储键未出现在隔离快照中；不能据此假定为空数据。' });
      return null;
    }
    if (found.length !== 1 || typeof found[0].raw !== 'string') {
      findings.push({ severity: 'blocking', code: 'known-key-duplicate-or-invalid', path: key, message: '已知存储键重复或原始值结构无效。' });
      return null;
    }
    try { return parseJson(found[0].raw, key); }
    catch (error) {
      findings.push({ severity: 'blocking', code: 'known-json-invalid', path: key, message: error.message });
      return null;
    }
  }
  function validateMainState(value, findings, counts) {
    if (!isObject(value)) { findings.push({ severity: 'blocking', code: 'main-state-not-object', path: MAIN_KEY, message: '主状态必须是 JSON 对象。' }); return null; }
    var arrays = ['chatHistory', 'stickers', 'stickerFavorites', 'stickerTombstones', 'cardPhrases', 'cardUsageOutbox'];
    arrays.forEach(function (field) {
      if (value[field] !== undefined && !Array.isArray(value[field])) findings.push({ severity: 'blocking', code: 'main-array-invalid', path: MAIN_KEY + '.' + field, message: '主状态已知集合字段不是数组。' });
    });
    ['icons', 'media', 'bubbleColors', 'appearanceColors', 'appearanceSettings', 'replyWindow', 'typing', 'offline', 'call', 'callSettings', 'incomingCallSettings'].forEach(function (field) {
      if (value[field] !== undefined && !isObject(value[field])) findings.push({ severity: 'blocking', code: 'main-object-invalid', path: MAIN_KEY + '.' + field, message: '主状态已知对象字段不是普通对象。' });
    });
    var messages = Array.isArray(value.chatHistory) ? value.chatHistory : [];
    var seenMessages = new Set();
    messages.forEach(function (message, index) {
      if (!isObject(message)) findings.push({ severity: 'blocking', code: 'chat-message-invalid', path: MAIN_KEY + '.chatHistory[' + index + ']', message: '聊天记录包含非对象项目。' });
      else if (typeof message.id === 'string' && message.id) {
        if (seenMessages.has(message.id)) findings.push({ severity: 'review', code: 'chat-message-id-duplicate', path: MAIN_KEY + '.chatHistory[' + index + '].id', message: '检测到重复聊天消息 ID；不能自动合并或删除。' });
        seenMessages.add(message.id);
      }
    });
    var phrases = Array.isArray(value.cardPhrases) ? value.cardPhrases : [];
    phrases.forEach(function (phrase, index) {
      if (typeof phrase !== 'string') findings.push({ severity: 'blocking', code: 'main-card-phrase-invalid', path: MAIN_KEY + '.cardPhrases[' + index + ']', message: '聊天主字卡必须为字符串。' });
    });
    counts.chatMessages = messages.length;
    counts.chatCards = phrases.length;
    counts.legacyStickerItems = Array.isArray(value.stickers) ? value.stickers.length : 0;
    return value;
  }
  function validateCardSystem(value, main, circle, findings, counts) {
    if (!isObject(value)) { findings.push({ severity: 'blocking', code: 'card-system-invalid', path: CARD_KEY, message: '字卡系统必须是对象。' }); return; }
    var pools = [
      ['chatIds', 'chatTexts', MAIN_KEY, main && main.cardPhrases, '主字卡'],
      ['momentsDynamicIds', 'momentsDynamicTexts', CIRCLE_KEY, circle && circle.dynamicCards, '朋友圈动态字卡'],
      ['momentsReplyIds', 'momentsReplyTexts', CIRCLE_KEY, circle && circle.replyCards, '朋友圈回复字卡']
    ];
    pools.forEach(function (pool) {
      var ids = value[pool[0]], texts = value[pool[1]];
      if (ids === undefined && texts === undefined) return;
      if (!Array.isArray(ids) || !Array.isArray(texts) || ids.length !== texts.length) {
        findings.push({ severity: 'blocking', code: 'card-pool-pair-invalid', path: CARD_KEY + '.' + pool[0], message: pool[2] + '的 ID/文本数组缺失或数量不一致。' });
        return;
      }
      var seen = new Set();
      ids.forEach(function (id, index) {
        if (typeof id !== 'string' || !id || seen.has(id)) findings.push({ severity: 'blocking', code: 'card-id-invalid', path: CARD_KEY + '.' + pool[0] + '[' + index + ']', message: pool[2] + '包含空 ID、非字符串 ID 或重复 ID。' });
        seen.add(id);
        if (!(typeof texts[index] === 'string' || isObject(texts[index]))) findings.push({ severity: 'blocking', code: 'card-text-invalid', path: CARD_KEY + '.' + pool[1] + '[' + index + ']', message: pool[2] + '包含无效文本项。' });
      });
      if (Array.isArray(pool[3])) {
        var left = pool[3].map(function (v) { return typeof v === 'string' ? v.trim() : ''; });
        var right = texts.map(function (v) { return typeof v === 'string' ? v.trim() : ''; });
        if (!jsonEqual(left, right)) findings.push({ severity: 'review', code: 'card-pool-runtime-drift', path: CARD_KEY + '.' + pool[0], message: pool[2] + '与对应运行时状态文本不一致；应人工决定是否按稳定 ID 重新协调。' });
      } else if (texts.length) {
        findings.push({ severity: 'review', code: 'card-pool-runtime-missing', path: CARD_KEY + '.' + pool[0], message: pool[2] + '有稳定 ID/文本记录，但对应主状态或朋友圈运行时文本缺失。' });
      }
      counts[pool[2] + '数量'] = texts.length;
    });
    ['recentDrawnRepliesV1', 'appliedEventIds', 'cardUsageOutbox', 'chatUsageOutbox', 'circleUsageOutbox', 'mailboxUsageOutbox'].forEach(function (field) {
      if (value[field] !== undefined && !Array.isArray(value[field])) findings.push({ severity: 'blocking', code: 'card-usage-array-invalid', path: CARD_KEY + '.' + field, message: '字卡使用记录字段必须为数组。' });
    });
    if (Array.isArray(value.appliedEventIds) && new Set(value.appliedEventIds).size !== value.appliedEventIds.length) findings.push({ severity: 'review', code: 'card-applied-event-duplicate', path: CARD_KEY + '.appliedEventIds', message: '字卡事件去重账本存在重复项目；保留原文，需人工判断。' });
  }
  function validateStickerLibrary(value, main, findings, counts) {
    if (!isObject(value) || value.version !== 1 || !Array.isArray(value.items) || !Array.isArray(value.tombstones) || !Array.isArray(value.favorites)) {
      findings.push({ severity: 'blocking', code: 'sticker-library-invalid', path: STICKER_KEY, message: '独立表情库版本或核心集合结构无效。' }); return;
    }
    var items = new Map();
    value.items.forEach(function (item, index) {
      if (!isObject(item) || typeof item.id !== 'string' || !item.id || typeof item.mediaId !== 'string' || !item.mediaId || items.has(item.id)) findings.push({ severity: 'blocking', code: 'sticker-item-invalid', path: STICKER_KEY + '.items[' + index + ']', message: '表情项目 ID、媒体引用无效或存在重复 ID。' });
      else items.set(item.id, item);
    });
    var tombstones = new Set();
    value.tombstones.forEach(function (item, index) {
      if (!isObject(item) || typeof item.id !== 'string' || !item.id || tombstones.has(item.id) || items.has(item.id)) findings.push({ severity: 'blocking', code: 'sticker-tombstone-invalid', path: STICKER_KEY + '.tombstones[' + index + ']', message: '表情删除账本存在重复 ID 或与现存项目冲突。' });
      else tombstones.add(item.id);
    });
    var favorites = new Set();
    value.favorites.forEach(function (id, index) {
      if (typeof id !== 'string' || !items.has(id) || favorites.has(id)) findings.push({ severity: 'blocking', code: 'sticker-favorite-invalid', path: STICKER_KEY + '.favorites[' + index + ']', message: '收藏项目引用不存在、格式错误或重复。' });
      favorites.add(id);
    });
    if (main && Array.isArray(main.stickerFavorites)) {
      var legacy = Array.from(new Set(main.stickerFavorites.filter(function (id) { return typeof id === 'string'; }))).sort();
      var current = Array.from(favorites).sort();
      if (!jsonEqual(legacy, current)) findings.push({ severity: 'review', code: 'sticker-favorites-drift', path: STICKER_KEY + '.favorites', message: '主状态旧收藏副本与独立表情库收藏集合不同；以哪一份为准需要人工确认。' });
    }
    counts.uploadedStickers = value.items.length;
    counts.deletedStickerTombstones = value.tombstones.length;
    counts.favoriteStickers = value.favorites.length;
  }
  function validateMailbox(value, findings, counts) {
    if (!isObject(value)) { findings.push({ severity: 'blocking', code: 'mailbox-invalid', path: MAILBOX_KEY, message: '信箱存储必须是对象。' }); return; }
    var box = isObject(value.mailbox) ? value.mailbox : value;
    ['items', 'pending', 'usageOutbox', 'recentCardKeys'].forEach(function (field) {
      if (box[field] !== undefined && !Array.isArray(box[field])) findings.push({ severity: 'blocking', code: 'mailbox-array-invalid', path: MAILBOX_KEY + '.' + field, message: '信箱字段 ' + field + ' 必须是数组。' });
    });
    if (box.settings !== undefined && !isObject(box.settings)) findings.push({ severity: 'blocking', code: 'mailbox-settings-invalid', path: MAILBOX_KEY + '.settings', message: '信箱设置必须是对象。' });
    var items = Array.isArray(box.items) ? box.items : [];
    var ids = new Set();
    items.forEach(function (item, index) {
      if (!isObject(item)) { findings.push({ severity: 'blocking', code: 'mailbox-item-invalid', path: MAILBOX_KEY + '.items[' + index + ']', message: '信件条目必须是对象。' }); return; }
      if (typeof item.id === 'string' && item.id) {
        if (ids.has(item.id)) findings.push({ severity: 'review', code: 'mailbox-id-duplicate', path: MAILBOX_KEY + '.items[' + index + '].id', message: '信件 ID 重复；不自动合并信件。' });
        ids.add(item.id);
      }
      if (item.images !== undefined && !Array.isArray(item.images)) findings.push({ severity: 'blocking', code: 'mailbox-images-invalid', path: MAILBOX_KEY + '.items[' + index + '].images', message: '信件附件必须是数组。' });
    });
    var pending = Array.isArray(box.pending) ? box.pending : [];
    pending.forEach(function (task, index) {
      if (!isObject(task) || typeof task.sourceId !== 'string' || !ids.has(task.sourceId)) findings.push({ severity: 'review', code: 'mailbox-pending-orphan', path: MAILBOX_KEY + '.pending[' + index + ']', message: '信箱待处理任务找不到对应信件；不会自动删除任务。' });
    });
    counts.mailLetters = items.length;
    counts.mailPendingTasks = pending.length;
  }
  function validateCircle(value, findings, counts, key) {
    if (!isObject(value)) { findings.push({ severity: 'blocking', code: 'circle-invalid', path: key, message: '朋友圈状态必须是对象。' }); return; }
    if (value.posts !== undefined && !Array.isArray(value.posts)) findings.push({ severity: 'blocking', code: 'circle-posts-invalid', path: key + '.posts', message: '朋友圈 posts 必须是数组。' });
    ['dynamicCards', 'replyCards'].forEach(function (field) {
      if (value[field] !== undefined && !Array.isArray(value[field])) findings.push({ severity: 'blocking', code: 'circle-card-pool-invalid', path: key + '.' + field, message: '朋友圈字卡池必须是数组。' });
    });
    var posts = Array.isArray(value.posts) ? value.posts : [];
    var postIds = new Set();
    posts.forEach(function (post, index) {
      if (!isObject(post)) { findings.push({ severity: 'blocking', code: 'circle-post-invalid', path: key + '.posts[' + index + ']', message: '朋友圈动态必须是对象。' }); return; }
      if (typeof post.id === 'string' && post.id) {
        if (postIds.has(post.id)) findings.push({ severity: 'review', code: 'circle-post-id-duplicate', path: key + '.posts[' + index + '].id', message: '朋友圈动态 ID 重复；不能自动选择保留哪一条。' });
        postIds.add(post.id);
      }
      if (post.media !== undefined && !Array.isArray(post.media)) findings.push({ severity: 'blocking', code: 'circle-media-array-invalid', path: key + '.posts[' + index + '].media', message: '动态媒体列表必须是数组。' });
    });
    counts[key === CIRCLE_KEY ? 'circlePosts' : 'circleVisitorBackupPosts'] = posts.length;
  }
  function auditBusinessRules(payload, localStorageRows, nestedValidation) {
    var findings = [];
    var sourceInventory = nestedValidation && nestedValidation.report && nestedValidation.report.sourceInventory || {};
    var counts = {
      localStorageKeys: localStorageRows.length,
      mediaRecords: payload.mediaRecords.length,
      fonts: (payload.fontLibrary && payload.fontLibrary.fonts || []).length,
      recoveryJournal: payload.recoveryJournal ? 1 : 0,
      mediaReferencesChecked: Number(sourceInventory.referenceCount) || 0,
      missingMediaReferences: Number(sourceInventory.missingReferenceCount) || 0,
      invalidMediaReferences: Number(sourceInventory.invalidReferenceCount) || 0,
      legacyDataUrlsChecked: Number(sourceInventory.legacyDataUrlsChecked) || 0,
      legacyDataUrlsInvalid: Number(sourceInventory.legacyDataUrlsInvalid) || 0,
      journalMediaReferences: Number(sourceInventory.journalReferenceCount) || 0
    };
    var main = validateMainState(parseKnown(localStorageRows, MAIN_KEY, findings, true), findings, counts);
    var sticker = parseKnown(localStorageRows, STICKER_KEY, findings, false);
    var mailbox = parseKnown(localStorageRows, MAILBOX_KEY, findings, false);
    var cards = parseKnown(localStorageRows, CARD_KEY, findings, false);
    var circle = parseKnown(localStorageRows, CIRCLE_KEY, findings, false);
    var visitor = parseKnown(localStorageRows, VISITOR_KEY, findings, false);
    if (sticker !== null) validateStickerLibrary(sticker, main, findings, counts);
    if (mailbox !== null) validateMailbox(mailbox, findings, counts);
    if (cards !== null) validateCardSystem(cards, main, circle, findings, counts);
    if (circle !== null) validateCircle(circle, findings, counts, CIRCLE_KEY);
    if (visitor !== null) validateCircle(visitor, findings, counts, VISITOR_KEY);
    if (payload.fontLibrary) {
      var fonts = Array.isArray(payload.fontLibrary.fonts) ? payload.fontLibrary.fonts : [];
      var fontIds = new Set(fonts.map(function (font) { return font && font.id; }));
      if (payload.fontLibrary.currentFontId && !fontIds.has(payload.fontLibrary.currentFontId)) findings.push({ severity: 'blocking', code: 'font-pointer-orphan', path: 'fontLibrary.currentFontId', message: '当前字体指针无法定位到字体记录。' });
      fonts.forEach(function (font, index) { if (!font || typeof font.id !== 'string' || !font.id || !font.blob || font.blob.__type !== 'Blob') findings.push({ severity: 'blocking', code: 'font-record-invalid', path: 'fontLibrary.fonts[' + index + ']', message: '字体记录缺少稳定 ID 或 Blob。' }); });
    }
    if (nestedValidation && nestedValidation.report && nestedValidation.report.sourceSemanticIssues.length) {
      nestedValidation.report.sourceSemanticIssues.forEach(function (message) { findings.push({ severity: 'blocking', code: 'candidate-source-semantic-issue', path: 'base/source', message: message }); });
    }
    return { findings: findings, counts: counts };
  }
  function compareLocalStorage(baseRows, isolatedRows, changes, approvedOperations, findings) {
    if (!Array.isArray(isolatedRows) || isolatedRows.length !== baseRows.length) fail('隔离 localStorage 快照行数与基础候选源不一致');
    var seen = new Set();
    isolatedRows.forEach(function (row, index) {
      if (!isObject(row) || typeof row.key !== 'string' || !row.key || typeof row.raw !== 'string' || seen.has(row.key)) fail('隔离 localStorage 快照包含无效或重复键');
      seen.add(row.key);
      if (row.key !== baseRows[index].key) fail('隔离 localStorage 快照改变了源键的顺序或名称');
    });
    if (!isObject(changes) || changes.format !== 'twodeers-isolated-changes' || changes.version !== 1 || changes.writesPerformed !== false || !Array.isArray(changes.applied) || !Array.isArray(changes.deferred)) fail('隔离 changes 清单结构或只读标记无效');
    var applied = changes.applied;
    if (applied.length === 0) {
      if (!jsonEqual(isolatedRows, baseRows)) fail('没有应用候选操作，但隔离 localStorage 原文与基础源不同');
      if (changes.deferred.length !== approvedOperations.length) fail('隔离 deferred 数量与基础候选批准操作不一致');
      changes.deferred.forEach(function (item, index) {
        if (!isObject(item) || item.key !== approvedOperations[index].key || typeof item.reason !== 'string') fail('隔离 deferred 记录与原始候选不一致');
      });
      return { applied: 0, deferred: changes.deferred.length, changedKeys: [] };
    }
    if (applied.length !== 1 || approvedOperations.length !== 1 || changes.deferred.length !== 0) fail('隔离重建包包含未授权的多项候选操作');
    var operation = applied[0];
    var approved = approvedOperations[0];
    if (!isObject(operation) || operation.key !== REVISION_KEY || operation.after !== '0' || operation.scope !== 'isolated-copy-only' || !Array.isArray(operation.preconditions) || !REQUIRED_REVISION_PRECONDITIONS.every(function (item) { return operation.preconditions.includes(item); })) fail('隔离重建包应用了白名单之外的候选变更');
    if (approved.key !== REVISION_KEY || approved.after !== '0') fail('基础候选没有批准对应的运行时版本计数提案');
    var changed = [];
    isolatedRows.forEach(function (row, index) { if (!jsonEqual(row, baseRows[index])) changed.push({ before: baseRows[index], after: row, index: index }); });
    if (changed.length !== 1 || changed[0].before.key !== REVISION_KEY || changed[0].before.raw !== approved.before || changed[0].after.raw !== '0' || changed[0].after.parseStatus !== changed[0].before.parseStatus) fail('隔离快照变化与唯一运行时版本计数候选不一致');
    if (operation.beforeBytes !== new TextEncoder().encode(changed[0].before.raw).byteLength) fail('隔离变更记录的原值长度不一致');
    return { applied: 1, deferred: 0, changedKeys: [REVISION_KEY] };
  }
  async function auditFile(file) {
    if (!file || !Number.isSafeInteger(Number(file.size)) || file.size < 22 || file.size > MAX_INPUT_BYTES) fail('请提供有效的 Phase 15 隔离重建 ZIP（最大 200 MiB）');
    var validator = global.__duoRecoveryCandidateValidator;
    if (!validator || typeof validator.readStoredZipEntries !== 'function' || typeof validator.validateFile !== 'function' || typeof validator.sha256Blob !== 'function' || typeof validator.crc32Blob !== 'function') fail('独立 ZIP 读取器或候选校验器未加载');
    var entries = await validator.readStoredZipEntries(file, OUTER_ENTRIES, MAX_INPUT_BYTES);
    var map = new Map(entries.map(function (entry) { return [entry.path, entry]; }));
    async function readJson(path) { return parseJson(await blobText(map.get(path).blob), path); }
    var outerManifest = await readJson('isolated/manifest.json');
    var changes = await readJson('isolated/changes.json');
    var previousReport = await readJson('validation/report.json');
    var isolatedRows = await readJson('isolated/localStorageRaw.json');
    var readme = await blobText(map.get('README.txt').blob);
    if (!Array.isArray(isolatedRows)) fail('隔离 localStorage 快照必须是数组');
    if (!isObject(outerManifest) || outerManifest.format !== 'twodeers-isolated-reconstruction' || outerManifest.formatVersion !== 1 || outerManifest.importableAsBackup !== false || outerManifest.writesPerformed !== false || outerManifest.promotable !== false) fail('隔离重建 manifest 格式或安全标记无效');
    if (!['isolated-preview-built', 'review-required'].includes(outerManifest.status)) fail('隔离重建 manifest 状态不受支持');
    if (!isObject(previousReport) || previousReport.format !== 'twodeers-isolated-validation-report' || previousReport.formatVersion !== 1 || previousReport.verifiedBaseCandidate !== true || previousReport.writesPerformed !== false || previousReport.importableAsBackup !== false || previousReport.promotable !== false) fail('Phase 15 校验报告结构或安全标记无效');
    if (!readme.includes('不是 V4/旧版备份') || !readme.includes('不可提升') || !readme.includes('原候选 ZIP')) fail('隔离重建 README 缺少必要安全说明');
    var baseBlob = map.get('base/twodeers-recovery-candidate.zip').blob;
    var baseSha = await validator.sha256Blob(baseBlob);
    var zipBuilder = global.__duoRecoveryCandidateZip;
    if (!zipBuilder || typeof zipBuilder.crc32Hex !== 'function') fail('ZIP CRC 格式化组件未加载');
    var baseCrc = zipBuilder.crc32Hex(await validator.crc32Blob(baseBlob));
    if (!isObject(outerManifest.base) || outerManifest.base.entry !== 'base/twodeers-recovery-candidate.zip' || outerManifest.base.bytes !== baseBlob.size || String(outerManifest.base.crc32).toLowerCase() !== baseCrc || String(outerManifest.base.sha256).toLowerCase() !== baseSha) fail('隔离 manifest 基础候选的长度/CRC/SHA 与实际嵌入文件不一致');
    if (previousReport.baseCandidateBytes !== baseBlob.size || previousReport.baseCandidateCrc32 !== baseCrc || previousReport.baseCandidateSha256 !== baseSha) fail('Phase 15 校验报告与实际嵌入候选 ZIP 不一致');
    var nested = await validator.validateFile(baseBlob);
    if (outerManifest.base.sourceSha256 !== nested.report.sourceSha256 || previousReport.sourceSha256 !== nested.report.sourceSha256 || previousReport.candidateStatus !== nested.manifest.status) fail('外层隔离包与内层候选源摘要/状态不一致');
    var rowComparisonFindings = [];
    var rowResult = compareLocalStorage(nested.payload.localStorageRaw, isolatedRows, changes, nested.approvedOperations, rowComparisonFindings);
    if (outerManifest.reconstruction.strategy !== 'copy-on-write-localStorage-overlay' || outerManifest.reconstruction.localStorageEntry !== 'isolated/localStorageRaw.json' || outerManifest.reconstruction.localStorageRecordCount !== isolatedRows.length || outerManifest.reconstruction.localStorageBytes !== map.get('isolated/localStorageRaw.json').bytes) fail('隔离 reconstruction 声明与实际快照不一致');
    if (previousReport.appliedOperationCount !== changes.applied.length || previousReport.deferredOperationCount !== changes.deferred.length || previousReport.localStorageBeforeAndAfterSignatureEqual !== (changes.applied.length === 0)) fail('Phase 15 校验报告与隔离操作记录不一致');
    if (!jsonEqual(previousReport.sourceInventory, nested.report.sourceInventory)) fail('Phase 15 报告中的源资源统计与独立重算结果不一致');
    var expectedReconstructionCounts = { localStorageKeys: isolatedRows.length, mediaRecords: nested.payload.mediaRecords.length, fonts: (nested.payload.fontLibrary && nested.payload.fontLibrary.fonts || []).length, recoveryJournal: !!nested.payload.recoveryJournal };
    if (!jsonEqual(previousReport.reconstructedInventory, expectedReconstructionCounts)) fail('Phase 15 报告中的隔离副本计数与实际数据不一致');
    if (outerManifest.reconstruction.mediaAndFonts !== 'inherited byte-for-byte from the embedded base candidate; not rewritten' || outerManifest.reconstruction.recoveryJournal !== 'inherited unchanged from the embedded base candidate') fail('隔离重建包没有声明媒体/字体/恢复日志的只读继承边界');
    var expectedStatus = nested.manifest.status === 'ready-for-independent-validation' ? 'isolated-preview-built' : 'review-required';
    if (outerManifest.status !== expectedStatus || previousReport.candidateStatus !== nested.manifest.status) fail('隔离重建状态与内层候选状态不一致');
    if (!Array.isArray(outerManifest.changes && outerManifest.changes.applied) || !Array.isArray(outerManifest.changes && outerManifest.changes.deferred) || !jsonEqual(outerManifest.changes.applied, changes.applied) || !jsonEqual(outerManifest.changes.deferred, changes.deferred)) fail('隔离 manifest 中的变更记录与 changes.json 不一致');
    var semantics = auditBusinessRules(nested.payload, isolatedRows, nested);
    Array.prototype.push.apply(semantics.findings, rowComparisonFindings);
    var blocking = semantics.findings.filter(function (item) { return item.severity === 'blocking'; }).length;
    var review = semantics.findings.filter(function (item) { return item.severity === 'review'; }).length;
    var consistent = blocking === 0 && review === 0 && nested.manifest.status === 'ready-for-independent-validation';
    var report = {
      format: 'twodeers-application-consistency-audit', formatVersion: 1,
      verified: true, writesPerformed: false, importableAsBackup: false, promotable: false,
      status: consistent ? 'consistent-for-human-review' : 'review-required',
      outerArchive: { bytes: file.size, entries: entries.map(function (entry) { return { path: entry.path, bytes: entry.bytes, crc32: entry.crc32 }; }) },
      baseCandidate: { status: nested.manifest.status, sourceSha256: nested.report.sourceSha256, localStorageKeys: nested.payload.localStorageRaw.length, mediaRecords: nested.payload.mediaRecords.length, fonts: (nested.payload.fontLibrary && nested.payload.fontLibrary.fonts || []).length, recoveryJournal: !!nested.payload.recoveryJournal },
      isolatedReconstruction: { localStorageRows: isolatedRows.length, appliedOperations: rowResult.applied, deferredOperations: rowResult.deferred, changedKeys: rowResult.changedKeys, mediaInheritedUnchanged: true, fontsInheritedUnchanged: true, recoveryJournalInheritedUnchanged: true },
      applicationCounts: semantics.counts,
      consistency: { blockingIssues: blocking, reviewItems: review, findings: semantics.findings },
      limitations: [
        '本报告只验证救援候选与隔离 localStorage 快照的结构和已知业务关系；不代表可直接恢复到应用。',
        '媒体和字体二进制的 MIME/长度/引用检查不等同于真实浏览器解码、FontFace 加载或设备播放成功。',
        '报告不包含聊天正文、信件正文、媒体原文或字体二进制。',
        '没有打开或写入当前页面 localStorage、IndexedDB、媒体库或字体库。',
        '即使状态为 consistent-for-human-review，也必须由独立人工确认和后续专用恢复流程处理。'
      ]
    };
    return { ok: true, report: report, baseValidation: nested, isolatedRows: isolatedRows };
  }
  global.__duoRecoveryApplicationAuditor = { auditFile: auditFile, maxInputBytes: MAX_INPUT_BYTES };

  if (!global.document) return;
  var input = global.document.getElementById('recoveryApplicationAuditFile');
  var auditButton = global.document.getElementById('recoveryApplicationAuditBtn');
  var exportButton = global.document.getElementById('recoveryApplicationAuditExportBtn');
  var status = global.document.getElementById('recoveryApplicationAuditStatus');
  var output = global.document.getElementById('recoveryApplicationAuditOutput');
  var selected = null;
  var audited = null;
  function setStatus(message, isError) {
    if (status) { status.textContent = message; if (status.dataset) status.dataset.state = isError ? 'error' : 'ok'; }
  }
  function reset() {
    selected = input && input.files && input.files[0] || null;
    audited = null;
    if (exportButton) exportButton.disabled = true;
    if (output) output.textContent = '请选择第十五阶段隔离重建 ZIP，再执行应用级一致性审计。';
    setStatus('文件已选择；必须针对当前文件重新执行应用级审计。', false);
  }
  if (input) input.addEventListener('change', reset);
  if (auditButton) auditButton.addEventListener('click', async function () {
    selected = input && input.files && input.files[0] || null;
    audited = null;
    if (exportButton) exportButton.disabled = true;
    if (!selected) { setStatus('请先选择隔离重建 ZIP。', true); return; }
    auditButton.disabled = true;
    setStatus('正在重新解析内外层 ZIP、核对源候选和应用数据关系；不会访问当前应用数据库……', false);
    try {
      audited = await global.__duoRecoveryApplicationAuditor.auditFile(selected);
      if (output) output.textContent = JSON.stringify(audited.report, null, 2);
      if (exportButton) exportButton.disabled = false;
      setStatus('应用级一致性审计完成：' + audited.report.status + '；发现 ' + audited.report.consistency.blockingIssues + ' 项阻断问题、' + audited.report.consistency.reviewItems + ' 项人工复核。没有写入当前空间。', false);
    } catch (error) {
      audited = null;
      setStatus(error.message || String(error), true);
      if (output) output.textContent = '审计失败；不会生成报告或修改任何数据。\n' + (error.message || String(error));
    } finally { auditButton.disabled = false; }
  });
  if (exportButton) exportButton.addEventListener('click', function () {
    if (!audited || !selected || input && input.files && input.files[0] !== selected) { setStatus('当前文件没有有效的最新审计结果，请重新审计。', true); return; }
    var reportBlob = new Blob([JSON.stringify(audited.report, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = global.URL.createObjectURL(reportBlob);
    var link = global.document.createElement('a');
    link.href = url; link.download = 'twodeers-application-consistency-audit-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    link.style.display = 'none'; global.document.body.appendChild(link); link.click(); link.remove();
    global.setTimeout(function () { try { global.URL.revokeObjectURL(url); } catch (_) {} }, 15000);
    setStatus('已导出应用级一致性报告；报告不含聊天正文和媒体原文，仍不可导入。', false);
  });
})(window);
