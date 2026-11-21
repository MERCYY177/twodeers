/*
 * Read-only recovery workbench for Phase 12 salvage packages.
 * It analyzes user-selected JSON and creates a repair preview only.
 * It never reads or writes the app's localStorage / IndexedDB and exposes no apply method.
 */
(function (global) {
  'use strict';
  if (global.__duoRecoveryWorkbenchInstalled) return;
  global.__duoRecoveryWorkbenchInstalled = true;

  var FORMAT = 'twodeers-recovery-salvage';
  var FORMAT_VERSION = 1;
  // JSON.parse temporarily duplicates the selected file in memory. Keep this
  // deliberately below Phase 12's maximum salvage size for mobile WebView safety.
  var MAX_INPUT_BYTES = 128 * 1024 * 1024;
  var MAX_ITEMS = 30000;
  var MAX_DEPTH = 48;
  var REVISION_KEY = '__twodeers_runtime_revision_v1';
  var KNOWN_KEYS = new Set([
    'dual_space_app_clean_test_v1',
    'dual_space_sticker_library_v1',
    'twodeers_mailbox_letters_v1',
    'twodeers_mailbox_drafts_v1',
    'twodeers_card_system_v1',
    'moments_site_blank_v49_rebuild_baseline_same_layout',
    'moments_site_blank_v49_rebuild_baseline_same_layout_visitor_backup_step01b',
    REVISION_KEY
  ]);
  var statusNode = null;
  var outputNode = null;
  var lastPreview = null;
  var lastPayload = null;
  var lastSourceBlob = null;
  var lastSourceName = '';
  var lastSourceInputFile = null;

  function asText(value) { return String(value == null ? '' : value); }
  function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function safeCount(value) { return Number.isSafeInteger(value) && value >= 0; }
  function byteLength(value) {
    try { return new TextEncoder().encode(asText(value)).byteLength; }
    catch (_) { return asText(value).length * 2; }
  }
  function setStatus(message, isError) {
    if (!statusNode && global.document) statusNode = global.document.getElementById('recoveryWorkbenchStatus');
    if (statusNode) {
      statusNode.textContent = message;
      if (statusNode.dataset) statusNode.dataset.state = isError ? 'error' : 'ok';
    }
  }
  function resetCandidateControls() {
    if (!global.document) return;
    var candidateButton = global.document.getElementById('recoveryWorkbenchCandidateBtn');
    var proposalToggle = global.document.getElementById('recoveryWorkbenchIncludeRevisionProposal');
    if (candidateButton) candidateButton.disabled = true;
    if (proposalToggle) { proposalToggle.disabled = true; proposalToggle.checked = false; }
  }
  function enableCandidateControls(preview) {
    if (!global.document) return;
    var candidateButton = global.document.getElementById('recoveryWorkbenchCandidateBtn');
    var proposalToggle = global.document.getElementById('recoveryWorkbenchIncludeRevisionProposal');
    if (candidateButton) candidateButton.disabled = false;
    var hasRevisionProposal = !!(preview && Array.isArray(preview.proposals) && preview.proposals.some(function (proposal) {
      return proposal && proposal.type === 'localStorage-set-preview' && proposal.path === 'localStorage.' + REVISION_KEY && proposal.proposedValue === '0';
    }));
    if (proposalToggle) { proposalToggle.disabled = !hasRevisionProposal; proposalToggle.checked = false; }
  }
  function renderPreview(preview) {
    if (!outputNode && global.document) outputNode = global.document.getElementById('recoveryWorkbenchOutput');
    if (!outputNode) return;
    outputNode.textContent = [
      '分析结果：' + preview.summary.total + ' 项',
      '可安全重建（仅预览）：' + preview.summary.safeRebuild,
      '保留原始数据：' + preview.summary.preserve,
      '需要人工判断：' + preview.summary.manualReview,
      '二进制资源：' + preview.summary.binaryValid + ' 项通过长度/编码检查，' + preview.summary.binaryInvalid + ' 项异常',
      '媒体引用关系：检查 ' + preview.summary.referencesChecked + ' 项，缺失 ' + preview.summary.missingMediaReferences + ' 项，格式异常 ' + preview.summary.invalidMediaReferences + ' 项；旧版朋友圈 Data URL 检查 ' + preview.summary.legacyDataUrlsChecked + ' 项，异常 ' + preview.summary.legacyDataUrlsInvalid + ' 项',
      '资料完整性：' + (preview.source.complete ? '完整标记' : '不完整或存在遗漏'),
      '',
      ...preview.items.map(function (item) {
        return '[' + item.classification + '] ' + item.path + ' — ' + item.reason;
      }),
      '',
      '修复预览（不会写入）：',
      ...preview.proposals.map(function (proposal) { return proposal.path + ': ' + proposal.beforeSummary + ' → ' + proposal.afterSummary; }),
      preview.proposals.length ? '' : '没有可自动提出的低风险变更。'
    ].join('\n');
  }
  function validateCardSnapshot(value) {
    if (!isObject(value)) return '字卡库必须是对象';
    var pools = [['chatIds', 'chatTexts'], ['momentsDynamicIds', 'momentsDynamicTexts'], ['momentsReplyIds', 'momentsReplyTexts']];
    for (var pair of pools) {
      var hasIds = Object.prototype.hasOwnProperty.call(value, pair[0]);
      var hasTexts = Object.prototype.hasOwnProperty.call(value, pair[1]);
      if (!hasIds && !hasTexts) continue;
      if (!hasIds || !hasTexts || !Array.isArray(value[pair[0]]) || !Array.isArray(value[pair[1]]) || value[pair[0]].length !== value[pair[1]].length || value[pair[0]].length > 20000) return pair[0] + '/' + pair[1] + ' 数组缺失、长度不一致或超限';
      var ids = new Set();
      for (var id of value[pair[0]]) { if (typeof id !== 'string' || !id || id.length > 128 || ids.has(id)) return pair[0] + ' 包含无效或重复 ID'; ids.add(id); }
      for (var textValue of value[pair[1]]) if (!(typeof textValue === 'string' || isObject(textValue))) return pair[1] + ' 包含无效文本项';
    }
    for (var field of ['recentDrawnRepliesV1', 'appliedEventIds', 'cardUsageOutbox', 'chatUsageOutbox', 'circleUsageOutbox', 'mailboxUsageOutbox']) if (value[field] !== undefined && (!Array.isArray(value[field]) || value[field].length > (field === 'appliedEventIds' ? 10000 : field === 'recentDrawnRepliesV1' ? 200 : 1000))) return field + ' 数组无效或超限';
    if (value.legacyModules !== undefined && !isObject(value.legacyModules)) return '旧版字卡兼容归档不是对象';
    return '';
  }
  function validateMailboxSnapshot(value) {
    if (!isObject(value)) return '信箱数据必须是对象';
    var source = value.mailbox === undefined ? value : value.mailbox;
    if (!isObject(source)) return '信箱数据主体必须是对象';
    for (var pair of [['items', 5000], ['pending', 1000], ['usageOutbox', 1000], ['recentCardKeys', 24]]) if (source[pair[0]] !== undefined && (!Array.isArray(source[pair[0]]) || source[pair[0]].length > pair[1])) return pair[0] + ' 数组无效或超限';
    if (source.settings !== undefined && !isObject(source.settings)) return '信箱设置结构无效';
    if (Array.isArray(source.items)) for (var item of source.items) {
      if (!isObject(item)) return '包含无效信件项目';
      if (item.images !== undefined && (!Array.isArray(item.images) || item.images.length > 6)) return '信件图片清单无效';
      if (item.cardFragments !== undefined && (!Array.isArray(item.cardFragments) || item.cardFragments.length > 100)) return '信件字卡清单无效';
    }
    return '';
  }

  function classifyLocalStorage(payload, items, proposals) {
    var rows = Array.isArray(payload.localStorageRaw) ? payload.localStorageRaw : [];
    var keyCounts = new Map();
    rows.forEach(function (row) { if (isObject(row) && typeof row.key === 'string') keyCounts.set(row.key, (keyCounts.get(row.key) || 0) + 1); });
    rows.forEach(function (row, index) {
      var path = 'localStorageRaw[' + index + ']';
      if (!isObject(row) || typeof row.key !== 'string' || !row.key || typeof row.raw !== 'string') {
        items.push({ path: path, classification: '人工复核', reason: '记录结构不完整；无法安全确定原始键和值' });
        return;
      }
      if ((keyCounts.get(row.key) || 0) > 1) {
        items.push({ path: 'localStorage.' + row.key, classification: '人工复核', reason: '同一存储键出现多条原始记录；拒绝猜测先后顺序，也不生成该键的修复建议' });
        return;
      }
      if (row.key === REVISION_KEY) {
        var numeric = /^(0|[1-9]\d*)$/.test(row.raw) ? Number(row.raw) : NaN;
        if (!Number.isSafeInteger(numeric) || numeric < 0) {
          items.push({ path: 'localStorage.' + row.key, classification: '可安全重建', reason: '这是标签页协调用的非业务数据版本计数；原值会在预览中保留，不触碰聊天或媒体数据' });
          proposals.push({
            type: 'localStorage-set-preview', path: 'localStorage.' + row.key,
            beforeSummary: '无效版本计数（' + byteLength(row.raw) + ' 字节）', afterSummary: '0（重新建立协调计数）',
            proposedValue: '0', reason: '运行时协调器对缺失版本键按 0 处理；该键不承载业务内容，但重置计数存在跨标签页版本号 ABA 风险',
            preconditions: ['关闭同源的其他 Twodeers 标签页和窗口', '退出后重新打开应用，再由独立恢复流程决定是否应用该提案']
          });
        } else {
          items.push({ path: 'localStorage.' + row.key, classification: '保留原始数据', reason: '运行时版本计数格式有效，无需修改' });
        }
        return;
      }
      if (row.key === '__proto__' || row.key === 'constructor' || row.key === 'prototype') {
        items.push({ path: 'localStorage.' + row.key, classification: '人工复核', reason: '键名与危险对象属性重合；只保留原始文本，不生成变更建议' });
        return;
      }
      var parseStatus = asText(row.parseStatus || 'unclassified');
      var hasReport = payload.diagnosticReport && payload.diagnosticReport.localStorage && Array.isArray(payload.diagnosticReport.localStorage.rows);
      var reportRow = hasReport ? payload.diagnosticReport.localStorage.rows.find(function (item) { return item && item.key === row.key; }) : null;
      if (['corrupt-json', 'invalid-structure', 'read-error'].includes(parseStatus) || (reportRow && ['corrupt-json', 'invalid-structure', 'read-error'].includes(reportRow.status))) {
        items.push({ path: 'localStorage.' + row.key, classification: '人工复核', reason: '诊断报告标记为 ' + (reportRow && reportRow.status || parseStatus) + '；可能包含无法安全重建的用户数据，必须保留原文' });
        return;
      }
      if (!KNOWN_KEYS.has(row.key)) {
        items.push({ path: 'localStorage.' + row.key, classification: '保留原始数据', reason: '未知或旧版键；无法证明它是缓存，保留完整原文，不自动重命名或删除' });
        return;
      }
      try {
        var parsed = JSON.parse(row.raw);
        if (!isObject(parsed) && !Array.isArray(parsed) && parsed !== null) throw new Error('顶层不是对象或数组');
        if (row.key === 'dual_space_app_clean_test_v1' && (!isObject(parsed) || ['chatHistory', 'stickers', 'cardPhrases'].some(function (key) { return parsed[key] !== undefined && !Array.isArray(parsed[key]); }))) throw new Error('主状态集合字段结构异常');
        if (row.key === 'dual_space_sticker_library_v1') {
          if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.items) || !Array.isArray(parsed.tombstones) || !Array.isArray(parsed.favorites)) throw new Error('表情索引结构或版本异常');
          var stickerIds = new Set(), tombstoneIds = new Set();
          for (var sticker of parsed.items) { if (!isObject(sticker) || typeof sticker.id !== 'string' || !sticker.id || stickerIds.has(sticker.id) || typeof sticker.mediaId !== 'string') throw new Error('表情项目存在无效/重复 ID 或媒体引用缺失'); stickerIds.add(sticker.id); }
          for (var tombstone of parsed.tombstones) { if (!isObject(tombstone) || typeof tombstone.id !== 'string' || !tombstone.id || tombstoneIds.has(tombstone.id) || stickerIds.has(tombstone.id)) throw new Error('表情删除账本存在无效/重复 ID'); tombstoneIds.add(tombstone.id); }
          var favoriteIds = new Set(); for (var favoriteId of parsed.favorites) { if (typeof favoriteId !== 'string' || !stickerIds.has(favoriteId) || favoriteIds.has(favoriteId)) throw new Error('表情收藏列表存在无效引用'); favoriteIds.add(favoriteId); }
        }
        if (row.key === 'twodeers_card_system_v1') { var cardError = validateCardSnapshot(parsed); if (cardError) throw new Error(cardError); }
        if (row.key === 'twodeers_mailbox_letters_v1') { var mailboxError = validateMailboxSnapshot(parsed); if (mailboxError) throw new Error(mailboxError); }
        if (row.key === 'moments_site_blank_v49_rebuild_baseline_same_layout' || row.key === 'moments_site_blank_v49_rebuild_baseline_same_layout_visitor_backup_step01b') {
          if (!isObject(parsed)) throw new Error('朋友圈状态必须是对象');
          if (parsed.posts !== undefined && (!Array.isArray(parsed.posts) || parsed.posts.length > 10000)) throw new Error('朋友圈动态列表无效或超过数量上限');
          for (var profileField of ['myAvatar', 'otherAvatar', 'myCover', 'otherCover']) if (parsed[profileField] !== undefined && parsed[profileField] !== null && typeof parsed[profileField] !== 'string') throw new Error(profileField + ' 必须是字符串或空值');
          if (Array.isArray(parsed.posts)) for (var circlePost of parsed.posts) {
            if (!isObject(circlePost)) throw new Error('朋友圈动态包含无效项目');
            if (circlePost.media !== undefined && (!Array.isArray(circlePost.media) || circlePost.media.length > 100)) throw new Error('朋友圈动态媒体列表无效或超限');
            if (Array.isArray(circlePost.media)) for (var circleMedia of circlePost.media) if (!isObject(circleMedia) || circleMedia.src !== undefined && typeof circleMedia.src !== 'string') throw new Error('朋友圈媒体条目结构无效');
          }
        }
        items.push({ path: 'localStorage.' + row.key, classification: '保留原始数据', reason: '可解析且通过工作台的保守结构检查；不重排、不去重、不规范化业务记录' });
      } catch (error) {
        items.push({ path: 'localStorage.' + row.key, classification: '人工复核', reason: 'JSON 或已知顶层结构无法验证：' + asText(error.message || error) + '；原始值不变' });
      }
    });
  }
  function inspectBase64DataUrl(value, expectedType, expectedSize) {
    if (typeof value !== 'string') return { ok: false, reason: 'dataUrl 缺失' };
    var match = /^data:([^;,]+)?;base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
    if (!match) return { ok: false, reason: '不是合法的 Base64 Data URL' };
    var base64 = match[2];
    if (base64.length % 4 !== 0) return { ok: false, reason: 'Base64 长度不符合 4 字节分组' };
    var padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    var decodedBytes = (base64.length / 4) * 3 - padding;
    if (expectedType && match[1] && expectedType !== match[1]) return { ok: false, reason: 'MIME 类型与资源元数据不一致' };
    if (safeCount(expectedSize) && decodedBytes !== expectedSize) return { ok: false, reason: '声明大小与 Base64 解码长度不一致（' + decodedBytes + '/' + expectedSize + '）' };
    return { ok: true, decodedBytes: decodedBytes, mimeType: match[1] || 'application/octet-stream' };
  }
  function inspectEncodedTree(value, path, counts, depth) {
    depth = depth || 0;
    if (depth > MAX_DEPTH) { counts.invalid++; counts.notes.push(path + '：嵌套超过安全深度'); return; }
    if (value === null || typeof value !== 'object') return;
    counts.visited++;
    if (counts.visited > MAX_ITEMS) { counts.invalid++; counts.notes.push('资源对象数量超过安全上限'); return; }
    if (value.__type === 'Blob') {
      var blobCheck = inspectBase64DataUrl(value.dataUrl, value.type, value.size);
      if (!safeCount(value.size) || !blobCheck.ok) { counts.invalid++; counts.notes.push(path + '：' + (blobCheck.reason || 'Blob 大小无效')); }
      else { counts.valid++; counts.bytes += blobCheck.decodedBytes; }
      return;
    }
    if (value.__type === 'ArrayBuffer' || value.__type === 'ArrayBufferView') {
      var binaryCheck = inspectBase64DataUrl('data:application/octet-stream;base64,' + asText(value.base64), 'application/octet-stream', value.byteLength);
      if (!safeCount(value.byteLength) || !binaryCheck.ok) { counts.invalid++; counts.notes.push(path + '：' + (binaryCheck.reason || '二进制快照无效')); }
      else { counts.valid++; counts.bytes += binaryCheck.decodedBytes; }
      return;
    }
    if (value.__type === 'CircularReference') { counts.invalid++; counts.notes.push(path + '：原始资料中标记了循环引用，相关结构不完整'); return; }
    if (Array.isArray(value)) value.forEach(function (child, index) { inspectEncodedTree(child, path + '[' + index + ']', counts, depth + 1); });
    else Object.keys(value).forEach(function (key) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') { counts.invalid++; counts.notes.push(path + '：包含危险属性名'); return; }
      inspectEncodedTree(value[key], path + '.' + key, counts, depth + 1);
    });
  }
  function validateJournalShape(journal) {
    var failures = [];
    if (!isObject(journal)) return ['恢复日志不是对象'];
    if (typeof journal.id !== 'string' || !journal.id || journal.id.length > 180) failures.push('恢复日志 ID 缺失或无效');
    if (journal.formatVersion !== 1) failures.push('恢复日志版本不受支持');
    if (typeof journal.createdAt !== 'number' || !Number.isFinite(journal.createdAt)) failures.push('恢复日志创建时间无效');
    if (typeof journal.kind !== 'string' || !journal.kind) failures.push('恢复日志缺少事务类型');
    if (typeof journal.oldState !== 'string' || journal.oldState.length > 256 * 1024 * 1024) failures.push('主状态快照缺失或超出安全上限');
    else {
      try { var state = JSON.parse(journal.oldState); if (!isObject(state)) failures.push('主状态快照顶层结构无效'); }
      catch (_) { failures.push('主状态快照不是有效 JSON'); }
    }
    if (!(journal.oldStorage === null || typeof journal.oldStorage === 'string')) failures.push('主存储原文快照类型无效');
    if (!Array.isArray(journal.oldMedia) || journal.oldMedia.length > 100000) failures.push('媒体快照列表缺失或数量无效');
    else {
      var mediaIds = new Set();
      journal.oldMedia.forEach(function (pair) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !pair[0] || mediaIds.has(pair[0])) { failures.push('媒体快照包含无效或重复 ID'); return; }
        mediaIds.add(pair[0]);
        if (pair[1] !== null && (!isObject(pair[1]) || pair[1].id !== pair[0] || !isObject(pair[1].blob) || pair[1].blob.__type !== 'Blob')) failures.push('媒体快照记录与 ID/Blob 不一致：' + pair[0]);
      });
    }
    if (journal.oldStorageEntries !== undefined) {
      var allowed = new Set(['dual_space_sticker_library_v1', 'twodeers_mailbox_letters_v1', 'twodeers_mailbox_drafts_v1', 'twodeers_card_system_v1']);
      if (!Array.isArray(journal.oldStorageEntries) || journal.oldStorageEntries.length > 4) failures.push('附加存储快照列表无效');
      else {
        var extraKeys = new Set();
        journal.oldStorageEntries.forEach(function (pair) {
          if (!Array.isArray(pair) || pair.length !== 2 || !allowed.has(pair[0]) || extraKeys.has(pair[0]) || !(pair[1] === null || typeof pair[1] === 'string')) failures.push('附加存储快照包含非法键或重复记录');
          else extraKeys.add(pair[0]);
        });
      }
    }
    if (journal.oldStickerLibrary !== null && journal.oldStickerLibrary !== undefined) {
      var sticker = journal.oldStickerLibrary;
      if (!isObject(sticker) || sticker.version !== 1 || !Array.isArray(sticker.items) || !Array.isArray(sticker.tombstones) || !Array.isArray(sticker.favorites)) failures.push('表情库快照结构无效');
    }
    if (journal.oldCircle !== null && journal.oldCircle !== undefined && !isObject(journal.oldCircle)) failures.push('朋友圈快照顶层结构无效');
    for (var field of ['oldFonts', 'oldMailbox', 'oldCards']) if (journal[field] !== null && journal[field] !== undefined && !isObject(journal[field])) failures.push(field + ' 辅助快照结构无效');
    return failures;
  }

  function classifyResources(payload, items) {
    var media = Array.isArray(payload.mediaRecords) ? payload.mediaRecords : [];
    var seenIds = new Set();
    media.forEach(function (record, index) {
      var path = 'mediaRecords[' + index + ']';
      if (!isObject(record) || typeof record.id !== 'string' || !record.id || seenIds.has(record.id)) {
        items.push({ path: path, classification: '人工复核', reason: '媒体记录 ID 缺失、重复或结构无效' });
        return;
      }
      seenIds.add(record.id);
      var counts = { visited: 0, valid: 0, invalid: 0, bytes: 0, notes: [] };
      inspectEncodedTree(record.blob, path + '.blob', counts, 0);
      if (record.blob && record.blob.__type === 'Blob' && record.size !== undefined && Number(record.size) !== Number(record.blob.size)) counts.notes.push('媒体记录大小元数据与 Blob 声明大小不一致');
      if (record.blob && record.blob.__type === 'Blob' && record.mimeType && record.blob.type && record.mimeType !== record.blob.type) counts.notes.push('媒体记录 MIME 与 Blob MIME 不一致');
      if (counts.invalid || !counts.valid || counts.notes.length) items.push({ path: path, classification: '人工复核', reason: counts.notes.join('；') || '媒体二进制不可验证' });
      else items.push({ path: path, classification: '保留原始数据', reason: '媒体 ID 唯一，Blob 编码、声明长度和元数据通过检查；工作台不改写原始字节' });
    });
    var fontLibrary = payload.fontLibrary;
    if (fontLibrary !== null && fontLibrary !== undefined) {
      if (!isObject(fontLibrary) || !Array.isArray(fontLibrary.fonts)) items.push({ path: 'fontLibrary', classification: '人工复核', reason: '字体库快照结构不完整' });
      else {
        var fontIds = new Set();
        fontLibrary.fonts.forEach(function (font, index) {
          var path = 'fontLibrary.fonts[' + index + ']';
          if (!isObject(font) || typeof font.id !== 'string' || !font.id || fontIds.has(font.id)) {
            items.push({ path: path, classification: '人工复核', reason: '字体 ID 缺失或重复' }); return;
          }
          fontIds.add(font.id);
          var counts = { visited: 0, valid: 0, invalid: 0, bytes: 0, notes: [] };
          inspectEncodedTree(font.blob, path + '.blob', counts, 0);
          if (font.blob && font.blob.__type === 'Blob' && font.size !== undefined && Number(font.size) !== Number(font.blob.size)) counts.notes.push('字体记录大小元数据与 Blob 声明大小不一致');
          if (counts.invalid || !counts.valid || counts.notes.length) items.push({ path: path, classification: '人工复核', reason: counts.notes.join('；') || '字体二进制不可验证' });
          else items.push({ path: path, classification: '保留原始数据', reason: '字体二进制编码、长度和元数据通过检查；不转换字体格式' });
        });
        if (fontLibrary.currentFontId && !fontIds.has(fontLibrary.currentFontId)) items.push({ path: 'fontLibrary.currentFontId', classification: '人工复核', reason: '当前字体指针不指向快照中的字体记录' });
      }
    }
    if (payload.recoveryJournal !== null && payload.recoveryJournal !== undefined) {
      if (!isObject(payload.recoveryJournal) || !['prepared', 'committed'].includes(String(payload.recoveryJournal.phase || '').toLowerCase())) {
        items.push({ path: 'recoveryJournal', classification: '人工复核', reason: '恢复日志结构或事务阶段不受支持；不可据此自动回滚' });
      } else {
        var journalCounts = { visited: 0, valid: 0, invalid: 0, bytes: 0, notes: [] };
        inspectEncodedTree(payload.recoveryJournal, 'recoveryJournal', journalCounts, 0);
        var journalFailures = validateJournalShape(payload.recoveryJournal);
        if (journalCounts.invalid) journalFailures = journalFailures.concat(journalCounts.notes);
        items.push({ path: 'recoveryJournal', classification: journalFailures.length ? '人工复核' : '保留原始数据', reason: journalFailures.length ? journalFailures.join('；') : '主状态、存储键、媒体快照和二进制结构通过基础完整性检查；事务阶段仍需结合原设备诊断人工判断' });
      }
    }
  }
  function parseRawRows(payload) {
    var map = new Map();
    var rows = Array.isArray(payload.localStorageRaw) ? payload.localStorageRaw : [];
    var counts = new Map();
    rows.forEach(function (row) { if (row && typeof row.key === 'string') counts.set(row.key, (counts.get(row.key) || 0) + 1); });
    rows.forEach(function (row) {
      if (!row || typeof row.key !== 'string' || typeof row.raw !== 'string' || counts.get(row.key) !== 1) return;
      try { map.set(row.key, JSON.parse(row.raw)); } catch (_) {}
    });
    return map;
  }
  function collectMediaId(refs, invalid, path, id) {
    if (id === undefined || id === null || id === '') return;
    if (typeof id !== 'string' || id.length > 256) { invalid.push({ path: path, reason: '媒体引用 ID 类型无效或超过 256 个字符' }); return; }
    refs.push({ path: path, id: id });
  }
  function collectChatStateReferences(value, prefix, refs, invalid) {
    if (!isObject(value)) return;
    (Array.isArray(value.chatHistory) ? value.chatHistory : []).forEach(function (message, index) {
      if (isObject(message)) collectMediaId(refs, invalid, prefix + '.chatHistory[' + index + '].mediaId', message.mediaId);
    });
    (Array.isArray(value.stickers) ? value.stickers : []).forEach(function (sticker, index) {
      if (isObject(sticker)) collectMediaId(refs, invalid, prefix + '.stickers[' + index + '].mediaId', sticker.mediaId);
    });
  }
  function collectStickerLibraryReferences(value, prefix, refs, invalid) {
    if (!isObject(value)) return;
    (Array.isArray(value.items) ? value.items : []).forEach(function (sticker, index) {
      if (isObject(sticker)) collectMediaId(refs, invalid, prefix + '.items[' + index + '].mediaId', sticker.mediaId);
    });
  }
  function collectMailboxReferences(value, prefix, refs, invalid) {
    if (!isObject(value)) return;
    var mailbox = isObject(value.mailbox) ? value.mailbox : value;
    (Array.isArray(mailbox.items) ? mailbox.items : []).forEach(function (letter, letterIndex) {
      if (!isObject(letter)) return;
      (Array.isArray(letter.images) ? letter.images : []).forEach(function (image, imageIndex) {
        if (isObject(image)) collectMediaId(refs, invalid, prefix + '.items[' + letterIndex + '].images[' + imageIndex + '].id', image.id);
      });
    });
  }
  function collectCircleReferences(value, prefix, refs, invalid, embedded) {
    if (!isObject(value)) return;
    function inspectCircleMedia(raw, path) {
      if (typeof raw !== 'string') return;
      if (raw.startsWith('idb-media:')) {
        var id = raw.slice('idb-media:'.length);
        if (!/^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,255}$/.test(id)) invalid.push({ path: path, reason: '朋友圈媒体引用前缀存在，但媒体 ID 格式无效' });
        else collectMediaId(refs, invalid, path, id);
        return;
      }
      // Legacy Circle snapshots can still contain inline Data URLs. Validate
      // their encoding/declared byte length without decoding or rewriting bytes.
      if (raw.startsWith('data:')) {
        var supported = /^data:(?:image\/(?:png|jpe?g|webp|gif|avif)|video\/[a-z0-9.+-]+);base64,/i.test(raw);
        var check = inspectBase64DataUrl(raw);
        if (!supported || !check.ok) embedded.push({ path: path, reason: !supported ? '朋友圈 Data URL MIME/编码格式不在支持范围内' : check.reason });
        else embedded.push({ path: path, bytes: check.decodedBytes, ok: true });
      }
    }
    ['myAvatar', 'otherAvatar', 'myCover', 'otherCover'].forEach(function (field) { inspectCircleMedia(value[field], prefix + '.' + field); });
    (Array.isArray(value.posts) ? value.posts : []).forEach(function (post, postIndex) {
      if (!isObject(post)) return;
      (Array.isArray(post.media) ? post.media : []).forEach(function (media, mediaIndex) {
        if (isObject(media)) inspectCircleMedia(media.src, prefix + '.posts[' + postIndex + '].media[' + mediaIndex + '].src');
      });
    });
  }
  function usableMediaIds(records) {
    var counts = new Map();
    (Array.isArray(records) ? records : []).forEach(function (record) {
      if (record && typeof record.id === 'string' && record.id) counts.set(record.id, (counts.get(record.id) || 0) + 1);
    });
    var valid = new Set();
    (Array.isArray(records) ? records : []).forEach(function (record) {
      if (!record || typeof record.id !== 'string' || counts.get(record.id) !== 1 || !isObject(record.blob) || record.blob.__type !== 'Blob') return;
      var countsResult = { visited: 0, valid: 0, invalid: 0, bytes: 0, notes: [] };
      inspectEncodedTree(record.blob, 'media.' + record.id, countsResult, 0);
      if (countsResult.valid === 1 && countsResult.invalid === 0 && !countsResult.notes.length) valid.add(record.id);
    });
    return valid;
  }
  function classifyReferenceGraph(payload, items) {
    var rows = parseRawRows(payload);
    var refs = [], invalid = [], embedded = [];
    collectChatStateReferences(rows.get('dual_space_app_clean_test_v1'), 'localStorage.dual_space_app_clean_test_v1', refs, invalid);
    collectStickerLibraryReferences(rows.get('dual_space_sticker_library_v1'), 'localStorage.dual_space_sticker_library_v1', refs, invalid);
    collectMailboxReferences(rows.get('twodeers_mailbox_letters_v1'), 'localStorage.twodeers_mailbox_letters_v1', refs, invalid);
    collectCircleReferences(rows.get('moments_site_blank_v49_rebuild_baseline_same_layout'), 'localStorage.moments_site_blank_v49_rebuild_baseline_same_layout', refs, invalid, embedded);
    collectCircleReferences(rows.get('moments_site_blank_v49_rebuild_baseline_same_layout_visitor_backup_step01b'), 'localStorage.moments_site_blank_v49_rebuild_baseline_same_layout_visitor_backup_step01b', refs, invalid, embedded);
    var available = usableMediaIds(payload.mediaRecords);
    var missing = [];
    refs.forEach(function (reference) {
      if (!available.has(reference.id)) {
        missing.push(reference);
        items.push({ path: reference.path, classification: '人工复核', reason: '引用媒体 ID ' + reference.id + ' 不存在唯一且通过二进制检查的媒体记录；不得用空文件或其他媒体替代' });
      }
    });
    invalid.forEach(function (entry) { items.push({ path: entry.path, classification: '人工复核', reason: entry.reason }); });

    // A PREPARED/COMMITTED journal has its own historical media snapshot. Validate
    // references against oldMedia, not against the current mediaRecords collection.
    var journal = payload.recoveryJournal;
    var journalReferenceCount = 0, journalInvalidCount = 0, journalMissingCount = 0;
    if (isObject(journal)) {
      var journalRefs = [], journalInvalid = [];
      try { if (typeof journal.oldState === 'string') collectChatStateReferences(JSON.parse(journal.oldState), 'recoveryJournal.oldState', journalRefs, journalInvalid); } catch (_) {}
      collectCircleReferences(journal.oldCircle, 'recoveryJournal.oldCircle', journalRefs, journalInvalid, embedded);
      collectStickerLibraryReferences(journal.oldStickerLibrary, 'recoveryJournal.oldStickerLibrary', journalRefs, journalInvalid);
      collectMailboxReferences(journal.oldMailbox, 'recoveryJournal.oldMailbox', journalRefs, journalInvalid);
      var oldMediaMap = new Map();
      (Array.isArray(journal.oldMedia) ? journal.oldMedia : []).forEach(function (pair) {
        if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && !oldMediaMap.has(pair[0])) oldMediaMap.set(pair[0], pair[1]);
      });
      journalRefs.forEach(function (reference) {
        journalReferenceCount++;
        var record = oldMediaMap.get(reference.id);
        var snapshotValid = !!record && record.id === reference.id && isObject(record.blob) && record.blob.__type === 'Blob';
        if (snapshotValid) {
          var check = { visited: 0, valid: 0, invalid: 0, bytes: 0, notes: [] };
          inspectEncodedTree(record.blob, reference.path, check, 0);
          snapshotValid = check.valid === 1 && check.invalid === 0;
        }
        if (!snapshotValid) { journalMissingCount++; items.push({ path: reference.path, classification: '人工复核', reason: '恢复日志中的历史媒体引用未对应到唯一、完整的 oldMedia 快照记录' }); }
      });
      journalInvalid.forEach(function (entry) { journalInvalidCount++; items.push({ path: entry.path, classification: '人工复核', reason: entry.reason }); });
    }
    embedded.forEach(function (entry) { items.push({ path: entry.path, classification: entry.ok ? '保留原始数据' : '人工复核', reason: entry.ok ? '旧版朋友圈内嵌 Data URL 的 MIME、Base64 编码和解码长度通过检查；原始字符串不变' : '旧版朋友圈内嵌媒体无法验证：' + entry.reason }); });
    return { checked: refs.length + journalReferenceCount, currentReferences: refs.length, journalReferences: journalReferenceCount, missing: missing.length + journalMissingCount, invalid: invalid.length + journalInvalidCount, embeddedChecked: embedded.length, embeddedInvalid: embedded.filter(function (entry) { return !entry.ok; }).length };
  }

  function buildPreview(payload) {
    var items = [], proposals = [];
    classifyLocalStorage(payload, items, proposals);
    classifyResources(payload, items);
    var referenceGraph = classifyReferenceGraph(payload, items);
    var diagMedia = payload.diagnosticReport && payload.diagnosticReport.media;
    if (diagMedia && Number(diagMedia.missingCount) > 0) items.push({ path: 'media.references', classification: '人工复核', reason: '原诊断报告存在 ' + Number(diagMedia.missingCount) + ' 条缺失媒体引用；不能用空文件代替' });
    var omissions = Array.isArray(payload.omissions) ? payload.omissions : [];
    var packageComplete = payload.complete === true && omissions.length === 0;
    omissions.forEach(function (entry, index) {
      items.push({ path: 'omissions[' + index + ']', classification: '人工复核', reason: '救援资料导出时遗漏：' + asText(entry && entry.reason || '原因未知') });
    });
    if (payload.complete !== true && omissions.length === 0) items.push({ path: 'package.complete', classification: '人工复核', reason: '救援包没有声明完整；不能推定未列出的数据不存在' });
    if (payload.complete === true && omissions.length > 0) items.push({ path: 'package.complete', classification: '人工复核', reason: '完整性标记与非空遗漏清单矛盾；按不完整资料处理' });
    var summary = {
      total: items.length,
      safeRebuild: items.filter(function (item) { return item.classification === '可安全重建'; }).length,
      preserve: items.filter(function (item) { return item.classification === '保留原始数据'; }).length,
      manualReview: items.filter(function (item) { return item.classification === '人工复核'; }).length,
      binaryValid: 0, binaryInvalid: 0,
      referencesChecked: referenceGraph.checked, missingMediaReferences: referenceGraph.missing, invalidMediaReferences: referenceGraph.invalid, legacyDataUrlsChecked: referenceGraph.embeddedChecked, legacyDataUrlsInvalid: referenceGraph.embeddedInvalid
    };
    var binaryCounts = { visited: 0, valid: 0, invalid: 0, bytes: 0, notes: [] };
    (payload.mediaRecords || []).forEach(function (record, index) { inspectEncodedTree(record && record.blob, 'mediaRecords[' + index + '].blob', binaryCounts, 0); });
    if (payload.fontLibrary) inspectEncodedTree(payload.fontLibrary, 'fontLibrary', binaryCounts, 0);
    if (payload.recoveryJournal) inspectEncodedTree(payload.recoveryJournal, 'recoveryJournal', binaryCounts, 0);
    summary.binaryValid = binaryCounts.valid;
    summary.binaryInvalid = binaryCounts.invalid;
    return {
      format: 'twodeers-recovery-preview', formatVersion: 1, importableAsBackup: false, writesPerformed: false,
      generatedAt: new Date().toISOString(),
      source: { format: payload.format, formatVersion: payload.formatVersion, complete: packageComplete, omissions: omissions.length, sourceBytes: payload.__sourceBytes || null },
      summary: summary, items: items, proposals: proposals,
      warnings: [
        '本报告仅提供只读判断和修复预览，不会写入 localStorage 或 IndexedDB。',
        '唯一的重建候选是运行时协调版本计数；该提案有关闭其他标签页等前置条件，不代表当前可立即应用。',
        '业务数据、媒体、字体和信箱记录均不生成自动修复补丁。',
        '“保留原始数据”不代表其业务内容已经全部正确，只表示不应被工作台自动改写。',
        packageComplete ? '' : '源救援资料不完整、标记矛盾或存在遗漏；分析结果不能代表完整数据集。'
      ].filter(Boolean)
    };
  }
  function validateEnvelope(payload) {
    if (!isObject(payload) || payload.format !== FORMAT || payload.formatVersion !== FORMAT_VERSION || payload.importableAsBackup !== false) throw new Error('文件不是受支持的第十二阶段救援资料包；不会尝试把普通备份当作救援文件解析');
    if (!isObject(payload.diagnosticReport) || payload.diagnosticReport.format !== 'twodeers-storage-diagnostic' || payload.diagnosticReport.formatVersion !== 1 || !Array.isArray(payload.localStorageRaw) || !Array.isArray(payload.mediaRecords) || !Array.isArray(payload.omissions) || typeof payload.complete !== 'boolean') throw new Error('救援资料包结构不完整：缺少有效诊断报告、localStorage、媒体、完整性标记或遗漏清单');
    if (payload.localStorageRaw.length + payload.mediaRecords.length > MAX_ITEMS) throw new Error('条目数量超过工作台安全上限');
    return payload;
  }
  function readFileText(file) {
    if (file && typeof file.text === 'function') return file.text();
    if (typeof global.FileReader === 'function') {
      return new Promise(function (resolve, reject) {
        var reader = new global.FileReader();
        reader.onload = function () { resolve(asText(reader.result)); };
        reader.onerror = function () { reject(reader.error || new Error('无法读取所选救援资料文件')); };
        reader.onabort = function () { reject(new Error('救援资料读取已取消')); };
        try { reader.readAsText(file, 'UTF-8'); } catch (error) { reject(error); }
      });
    }
    throw new Error('当前浏览器不支持安全读取所选文件；请更新 WebView 或使用桌面浏览器分析');
  }
  async function analyzeFile(file) {
    lastPreview = null; lastPayload = null; lastSourceBlob = null; lastSourceName = ''; lastSourceInputFile = null;
    resetCandidateControls();
    if (!file || !safeCount(Number(file.size))) throw new Error('请先选择有效的 JSON 救援资料文件');
    if (file.size > MAX_INPUT_BYTES) throw new Error('文件超过工作台 128 MiB 安全读取上限；请在可信桌面环境中拆分或重新导出较小范围的救援资料');
    var raw = await readFileText(file);
    if (byteLength(raw) > MAX_INPUT_BYTES) throw new Error('解码后的 JSON 超过工作台安全读取上限');
    var payload;
    try { payload = JSON.parse(raw); }
    catch (error) { throw new Error('救援资料 JSON 无法解析：' + asText(error.message || error)); }
    validateEnvelope(payload);
    Object.defineProperty(payload, '__sourceBytes', { value: Number(file.size) || byteLength(raw), enumerable: false });
    var BlobCtor = global.Blob || (typeof Blob === 'function' ? Blob : null);
    if (file && typeof file.slice === 'function' && Number(file.size) >= 0) lastSourceBlob = file.slice(0, file.size, 'application/json');
    else if (BlobCtor) lastSourceBlob = new BlobCtor([raw], { type: 'application/json;charset=utf-8' });
    else throw new Error('当前环境无法保留原始文件字节，不能生成候选恢复包');
    lastSourceName = 'twodeers-recovery-salvage.json';
    lastSourceInputFile = file;
    lastPayload = payload;
    lastPreview = buildPreview(payload);
    renderPreview(lastPreview);
    enableCandidateControls(lastPreview);
    var summary = lastPreview.summary;
    setStatus('分析完成：' + summary.safeRebuild + ' 项可安全重建预览，' + summary.preserve + ' 项建议保留，' + summary.manualReview + ' 项需要人工判断。未执行任何写入。', false);
    return lastPreview;
  }
  function downloadPreview() {
    if (!lastPreview) throw new Error('请先选择并分析救援资料');
    var blob = new Blob([JSON.stringify(lastPreview, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = global.URL.createObjectURL(blob);
    var link = global.document.createElement('a');
    link.href = url; link.download = 'twodeers-recovery-preview-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    link.style.display = 'none'; global.document.body.appendChild(link); link.click(); link.remove();
    global.setTimeout(function () { try { global.URL.revokeObjectURL(url); } catch (_) {} }, 10000);
    return { bytes: blob.size, proposals: lastPreview.proposals.length, items: lastPreview.items.length };
  }
  function analyzeObject(payload) {
    lastPreview = null; lastPayload = null; lastSourceBlob = null; lastSourceName = ''; lastSourceInputFile = null;
    resetCandidateControls();
    validateEnvelope(payload);
    var BlobCtor = global.Blob || (typeof Blob === 'function' ? Blob : null);
    if (!BlobCtor) throw new Error('当前环境不支持 Blob，无法生成候选恢复包');
    var raw = JSON.stringify(payload);
    if (byteLength(raw) > MAX_INPUT_BYTES) throw new Error('救援资料超过工作台 128 MiB 安全读取上限');
    lastSourceBlob = new BlobCtor([raw], { type: 'application/json;charset=utf-8' });
    lastSourceName = 'twodeers-recovery-salvage.json';
    lastSourceInputFile = null;
    lastPayload = payload;
    lastPreview = buildPreview(payload);
    renderPreview(lastPreview);
    enableCandidateControls(lastPreview);
    setStatus('分析完成。未执行任何写入。', false);
    return lastPreview;
  }
  function buildCandidateManifest(sourceChecksum, sourceBytes, selectedProposals, zipEntries) {
    var payload = lastPayload;
    var preview = lastPreview;
    var rows = Array.isArray(payload.localStorageRaw) ? payload.localStorageRaw : [];
    var media = Array.isArray(payload.mediaRecords) ? payload.mediaRecords : [];
    var fonts = payload.fontLibrary && Array.isArray(payload.fontLibrary.fonts) ? payload.fontLibrary.fonts : [];
    var reviewItems = preview.items.filter(function (item) { return item.classification === '人工复核'; }).map(function (item) {
      return { path: item.path, reason: item.reason };
    });
    var preservedItems = preview.items.filter(function (item) { return item.classification === '保留原始数据'; }).map(function (item) {
      return { path: item.path, reason: item.reason };
    });
    var ready = preview.source.complete === true && preview.summary.manualReview === 0 && preview.summary.binaryInvalid === 0 && preview.summary.missingMediaReferences === 0 && preview.summary.invalidMediaReferences === 0 && preview.summary.legacyDataUrlsInvalid === 0;
    return {
      format: 'twodeers-recovery-candidate', formatVersion: 1,
      importableAsBackup: false, writesPerformed: false,
      status: ready ? 'ready-for-independent-validation' : 'review-required',
      createdAt: new Date().toISOString(),
      source: {
        entry: 'source/twodeers-recovery-salvage.json',
        format: FORMAT, formatVersion: FORMAT_VERSION,
        bytes: sourceBytes, crc32: sourceChecksum,
        generatedAt: payload.generatedAt || null,
        complete: preview.source.complete,
        omissions: preview.source.omissions,
        originalFileName: lastSourceName
      },
      inventory: {
        localStorageRecordCount: rows.length,
        localStorageKeys: rows.filter(function (row) { return row && typeof row.key === 'string'; }).map(function (row) { return row.key; }),
        mediaRecordCount: media.length,
        mediaIds: media.filter(function (record) { return record && typeof record.id === 'string'; }).map(function (record) { return record.id; }),
        fontRecordCount: fonts.length,
        fontIds: fonts.filter(function (font) { return font && typeof font.id === 'string'; }).map(function (font) { return font.id; }),
        recoveryJournalPresent: !!payload.recoveryJournal
      },
      classifications: {
        total: preview.summary.total,
        safeRebuildCandidates: preview.summary.safeRebuild,
        preserved: preview.summary.preserve,
        manualReview: preview.summary.manualReview,
        binaryValid: preview.summary.binaryValid,
        binaryInvalid: preview.summary.binaryInvalid,
        referencesChecked: preview.summary.referencesChecked,
        missingMediaReferences: preview.summary.missingMediaReferences,
        invalidMediaReferences: preview.summary.invalidMediaReferences,
        legacyDataUrlsChecked: preview.summary.legacyDataUrlsChecked,
        legacyDataUrlsInvalid: preview.summary.legacyDataUrlsInvalid
      },
      preservedItems: preservedItems,
      manualReviewItems: reviewItems,
      candidateOverlay: {
        format: 'twodeers-recovery-overlay', version: 1,
        applyable: false, writesPerformed: false,
        operations: selectedProposals.map(function (proposal) {
          return {
            operation: 'localStorage-set-candidate',
            key: REVISION_KEY, value: '0',
            sourceBeforeSummary: proposal.beforeSummary,
            reason: proposal.reason,
            preconditions: proposal.preconditions.slice(),
            requiresIndependentReview: true
          };
        })
      },
      entryInventoryScope: 'all payload entries except candidate/manifest.json (self-reference is intentionally excluded)',
      entries: zipEntries.map(function (entry) { return { path: entry.name, bytes: entry.bytes, crc32: entry.crc32 }; }),
      guardrails: [
        'This archive is not a standard Twodeers backup and must not be imported through V4 or legacy restore.',
        'The original salvage JSON is included byte-for-byte and remains unchanged.',
        'Candidate overlay operations are review notes only; no live localStorage or IndexedDB writes were performed.',
        'Business records, media and font binaries are preserved in the source entry; they are not normalized or repaired.',
        'CRC-32 detects accidental archive corruption but is not a cryptographic authenticity or tamper-proof signature.',
        'A later isolated recovery tool must revalidate every source entry and require a separate explicit review before constructing a new dataset.'
      ]
    };
  }
  async function downloadCandidatePackage() {
    if (!lastPreview || !lastPayload || !lastSourceBlob) throw new Error('请先成功分析救援资料，再生成候选包');
    var currentFileInput = global.document && global.document.getElementById('recoveryWorkbenchFile');
    if (lastSourceInputFile && currentFileInput && currentFileInput.files && currentFileInput.files[0] !== lastSourceInputFile) throw new Error('当前选择的文件与上次分析的文件不同；请重新分析，不能打包旧分析结果');
    if (typeof global.confirm !== 'function' || !global.confirm('隔离候选包会完整包含所选救援 JSON，其中可能含聊天正文、原始 localStorage、媒体和字体二进制。它不是可直接导入的备份，也不会修改当前空间。请确认只保存到可信设备。继续生成？')) return { cancelled: true };
    var zipBuilder = global.__duoRecoveryCandidateZip;
    if (!zipBuilder || typeof zipBuilder.crc32Blob !== 'function' || typeof zipBuilder.buildStoredZip !== 'function') throw new Error('候选 ZIP 组件未加载，未生成任何文件');
    var selected = [];
    var proposalToggle = global.document && global.document.getElementById('recoveryWorkbenchIncludeRevisionProposal');
    if (proposalToggle && proposalToggle.checked) {
      selected = lastPreview.proposals.filter(function (proposal) {
        return proposal && proposal.type === 'localStorage-set-preview' && proposal.path === 'localStorage.' + REVISION_KEY && proposal.proposedValue === '0' && Array.isArray(proposal.preconditions);
      });
      if (selected.length !== 1) throw new Error('低风险版本计数候选已不再满足唯一性条件；请重新分析原始文件');
    }
    var sourceChecksum = zipBuilder.crc32Hex(await zipBuilder.crc32Blob(lastSourceBlob));
    var sourceBytes = Number(lastSourceBlob.size) || 0;
    var previewBlob = new (global.Blob || Blob)([JSON.stringify(lastPreview, null, 2)], { type: 'application/json;charset=utf-8' });
    var overlay = {
      format: 'twodeers-recovery-overlay', version: 1,
      applyable: false, writesPerformed: false,
      selectedOperations: selected.map(function (proposal) {
        return { operation: 'localStorage-set-candidate', key: REVISION_KEY, value: '0', sourceBeforeSummary: proposal.beforeSummary, reason: proposal.reason, preconditions: proposal.preconditions.slice(), requiresIndependentReview: true };
      }),
      note: '候选覆盖项只保存在独立 ZIP 内，不是对源救援 JSON 或当前数据库的修改。'
    };
    var overlayBlob = new (global.Blob || Blob)([JSON.stringify(overlay, null, 2)], { type: 'application/json;charset=utf-8' });
    var readme = [
      'Twodeers 隔离恢复候选包（Phase 14）',
      '====================================',
      '',
      '此文件不是 V4 备份，也不能通过应用内普通导入功能导入。',
      'source/twodeers-recovery-salvage.json 是所选救援 JSON 的原始字节副本。',
      'candidate/manifest.json 描述源文件校验值、资源清单和完整性状态。',
      'candidate/preview.json 是不含原始聊天正文的只读分析结果。',
      'candidate/overlay.json 仅记录用户勾选的候选操作；applyable=false，未写入任何数据库。',
      '',
      '不要删除或覆盖原始救援资料。请把本候选包与原始设备/浏览器数据副本分开保存。',
      'CRC-32 只用于检测意外损坏，不是数字签名，也不能证明来源可信。',
      '下一阶段工具必须在独立副本中重新校验所有文件、引用、ID 和二进制资源。',
      '',
      '隐私提示：源救援 JSON 可能包含聊天内容、附件、字体及其他私人数据，不要公开分享。'
    ].join('\n');
    var readmeBlob = new (global.Blob || Blob)([readme], { type: 'text/plain;charset=utf-8' });
    var initialEntries = [
      { name: 'source/twodeers-recovery-salvage.json', blob: lastSourceBlob },
      { name: 'candidate/preview.json', blob: previewBlob },
      { name: 'candidate/overlay.json', blob: overlayBlob },
      { name: 'README.txt', blob: readmeBlob }
    ];
    // Calculate entry checksums first so the manifest can inventory the exact ZIP members.
    var entryChecksums = [];
    for (var entry of initialEntries) entryChecksums.push({ name: entry.name, bytes: entry.blob.size, crc32: zipBuilder.crc32Hex(await zipBuilder.crc32Blob(entry.blob)) });
    var manifest = buildCandidateManifest(sourceChecksum, sourceBytes, selected, entryChecksums.map(function (entry) { return { name: entry.name, bytes: entry.bytes, crc32: entry.crc32 }; }));
    var manifestBlob = new (global.Blob || Blob)([JSON.stringify(manifest, null, 2)], { type: 'application/json;charset=utf-8' });
    var allEntries = initialEntries.concat([{ name: 'candidate/manifest.json', blob: manifestBlob }]);
    var result = await zipBuilder.buildStoredZip(allEntries, zipBuilder.maxBytes);
    var url = global.URL.createObjectURL(result.blob);
    var link = global.document.createElement('a');
    link.href = url; link.download = 'twodeers-recovery-candidate-' + new Date().toISOString().replace(/[:.]/g, '-') + '.zip';
    link.style.display = 'none'; global.document.body.appendChild(link); link.click(); link.remove();
    global.setTimeout(function () { try { global.URL.revokeObjectURL(url); } catch (_) {} }, 10000);
    return { bytes: result.bytes, entries: result.entries.length, selectedOperations: selected.length, status: manifest.status, manifest: manifest };
  }
  var api = {
    analyzeFile: analyzeFile, analyzeObject: analyzeObject,
    downloadPreview: downloadPreview, downloadCandidatePackage: downloadCandidatePackage,
    getLastPreview: function () { return lastPreview; }, _validateEnvelope: validateEnvelope
  };
  global.__duoRecoveryWorkbench = api;

  if (global.document) {
    resetCandidateControls();
    var fileInput = global.document.getElementById('recoveryWorkbenchFile');
    if (fileInput) fileInput.addEventListener('change', function () {
      lastPreview = null; lastPayload = null; lastSourceBlob = null; lastSourceName = ''; lastSourceInputFile = null;
      resetCandidateControls();
      setStatus('已选择新文件，请重新分析；上一次分析结果不能用于当前文件。', false);
      if (outputNode) outputNode.textContent = '文件已更换，请重新分析。';
    });
    var analyzeButton = global.document.getElementById('recoveryWorkbenchAnalyzeBtn');
    var exportButton = global.document.getElementById('recoveryWorkbenchExportBtn');
    if (analyzeButton) analyzeButton.addEventListener('click', async function () {
      var file = fileInput && fileInput.files && fileInput.files[0];
      analyzeButton.disabled = true; setStatus('正在只读解析救援资料；不会连接或修改当前数据库……');
      try { await analyzeFile(file); }
      catch (error) { setStatus(error.message || String(error), true); }
      finally { analyzeButton.disabled = false; }
    });
    if (exportButton) exportButton.addEventListener('click', function () {
      exportButton.disabled = true;
      try { var result = downloadPreview(); setStatus('修复预览已导出（' + Math.round(result.bytes / 1024) + ' KB）。该文件不含原始聊天内容，也不能直接导入。'); }
      catch (error) { setStatus(error.message || String(error), true); }
      finally { exportButton.disabled = false; }
    });
    var candidateButton = global.document.getElementById('recoveryWorkbenchCandidateBtn');
    if (candidateButton) candidateButton.addEventListener('click', async function () {
      candidateButton.disabled = true;
      try {
        var result = await downloadCandidatePackage();
        if (result && result.cancelled) setStatus('已取消候选包导出；没有生成文件。', false);
        else setStatus('隔离候选包已生成（' + Math.round(result.bytes / 1024 / 1024 * 100) / 100 + ' MiB，' + result.entries + ' 个文件）。状态：' + result.status + '。未写入当前空间。', false);
      } catch (error) { setStatus(error.message || String(error), true); }
      finally { candidateButton.disabled = !lastPreview; }
    });
  }
})(window);
