/* Independent second-pass validator for Phase 14 recovery candidate ZIPs.
 * It parses ZIP records and recomputes content checksums without trusting the
 * candidate manifest. It never touches application localStorage or IndexedDB.
 */
(function (global) {
  'use strict';
  if (global.__duoRecoveryCandidateValidatorInstalled) return;
  global.__duoRecoveryCandidateValidatorInstalled = true;

  var MAX_ARCHIVE_BYTES = 132 * 1024 * 1024;
  var MAX_ENTRIES = 16;
  var MAX_SOURCE_BYTES = 128 * 1024 * 1024;
  var REQUIRED = [
    'source/twodeers-recovery-salvage.json',
    'candidate/preview.json',
    'candidate/overlay.json',
    'README.txt',
    'candidate/manifest.json'
  ];
  var REVISION_KEY = '__twodeers_runtime_revision_v1';
  var CRC_TABLE = new Uint32Array(256);
  for (var t = 0; t < 256; t++) {
    var x = t;
    for (var b = 0; b < 8; b++) x = (x & 1) ? (0xEDB88320 ^ (x >>> 1)) : (x >>> 1);
    CRC_TABLE[t] = x >>> 0;
  }
  function fail(message) { throw new Error(message); }
  function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function readRange(blob, start, end) {
    var part = blob.slice(start, end);
    if (typeof part.arrayBuffer === 'function') return part.arrayBuffer().then(function (buffer) { return new Uint8Array(buffer); });
    if (typeof global.FileReader === 'function') return new Promise(function (resolve, reject) {
      var reader = new global.FileReader();
      reader.onload = function () { resolve(new Uint8Array(reader.result)); };
      reader.onerror = function () { reject(reader.error || new Error('ZIP 分块读取失败')); };
      reader.onabort = function () { reject(new Error('ZIP 读取已取消')); };
      try { reader.readAsArrayBuffer(part); } catch (error) { reject(error); }
    });
    return Promise.reject(new Error('当前 WebView 不支持安全的 ZIP 分块读取'));
  }
  function crcUpdate(crc, bytes) {
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return crc >>> 0;
  }
  async function crc32Blob(blob) {
    var crc = 0xFFFFFFFF;
    for (var offset = 0; offset < blob.size; offset += 1024 * 1024) crc = crcUpdate(crc, await readRange(blob, offset, Math.min(blob.size, offset + 1024 * 1024)));
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function hex32(value) { return (value >>> 0).toString(16).padStart(8, '0'); }
  function hexBytes(bytes) { return Array.from(bytes, function (value) { return value.toString(16).padStart(2, '0'); }).join(''); }
  function utf8Decode(bytes) {
    var Decoder = global.TextDecoder || (typeof TextDecoder === 'function' ? TextDecoder : null);
    if (!Decoder) fail('当前环境缺少 UTF-8 解码器');
    try { return new Decoder('utf-8', { fatal: true }).decode(bytes); }
    catch (_) { fail('ZIP 文件名或 JSON 条目不是有效 UTF-8'); }
  }
  function safeName(name) {
    return typeof name === 'string' && name.length > 0 && name.length <= 200 && !name.startsWith('/') && !name.includes('\\') && name.split('/').every(function (part) { return !!part && part !== '.' && part !== '..'; });
  }
  function parseEocd(bytes, archiveSize, tailOffset) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) !== 0x06054B50) continue;
      var commentLength = view.getUint16(i + 20, true);
      if (i + 22 + commentLength !== bytes.length) continue;
      var disk = view.getUint16(i + 4, true), centralDisk = view.getUint16(i + 6, true);
      var diskEntries = view.getUint16(i + 8, true), totalEntries = view.getUint16(i + 10, true);
      var centralSize = view.getUint32(i + 12, true), centralOffset = view.getUint32(i + 16, true);
      if (disk || centralDisk || diskEntries !== totalEntries) fail('ZIP 多磁盘结构不受支持');
      if (totalEntries === 0xFFFF || centralSize === 0xFFFFFFFF || centralOffset === 0xFFFFFFFF) fail('ZIP64 候选包不受支持');
      if (totalEntries < 1 || totalEntries > MAX_ENTRIES) fail('ZIP 条目数量超过安全上限');
      var eocdAbsolute = tailOffset + i;
      if (centralOffset + centralSize !== eocdAbsolute) fail('ZIP 中央目录位置或长度不一致');
      if (eocdAbsolute + 22 + commentLength !== archiveSize) fail('ZIP 结束记录不在文件末尾');
      return { count: totalEntries, centralSize: centralSize, centralOffset: centralOffset, eocdOffset: eocdAbsolute };
    }
    fail('找不到有效 ZIP 结束记录');
  }
  async function readEntryBytes(blob, entry) { return readRange(blob, entry.dataOffset, entry.dataOffset + entry.bytes); }
  async function parseZip(blob, expectedNames, maxBytes) {
    if (!blob || !Number.isSafeInteger(Number(blob.size)) || typeof blob.slice !== 'function') fail('所选候选文件不是有效 Blob/File');
    var sizeLimit = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : MAX_ARCHIVE_BYTES;
    if (blob.size < 22 || blob.size > sizeLimit) fail('ZIP 大小超出允许的安全范围');
    var tailLength = Math.min(blob.size, 65557);
    var tailOffset = blob.size - tailLength;
    var eocd = parseEocd(await readRange(blob, tailOffset, blob.size), blob.size, tailOffset);
    var centralBytes = await readRange(blob, eocd.centralOffset, eocd.centralOffset + eocd.centralSize);
    var cv = new DataView(centralBytes.buffer, centralBytes.byteOffset, centralBytes.byteLength);
    var entries = [], names = new Set(), cursor = 0;
    for (var index = 0; index < eocd.count; index++) {
      if (cursor + 46 > centralBytes.length || cv.getUint32(cursor, true) !== 0x02014B50) fail('ZIP 中央目录条目签名无效');
      var flags = cv.getUint16(cursor + 8, true), method = cv.getUint16(cursor + 10, true);
      var crc = cv.getUint32(cursor + 16, true), compressed = cv.getUint32(cursor + 20, true), uncompressed = cv.getUint32(cursor + 24, true);
      var nameLength = cv.getUint16(cursor + 28, true), extraLength = cv.getUint16(cursor + 30, true), commentLength = cv.getUint16(cursor + 32, true);
      var diskStart = cv.getUint16(cursor + 34, true), localOffset = cv.getUint32(cursor + 42, true);
      if (flags !== 0x0800 || method !== 0 || diskStart !== 0) fail('候选 ZIP 使用加密、数据描述符、额外标志或非 STORE 压缩；拒绝解析');
      if (extraLength !== 0 || commentLength !== 0) fail('候选 ZIP 中央目录包含未审核的额外字段');
      if (compressed !== uncompressed || compressed === 0xFFFFFFFF || uncompressed === 0xFFFFFFFF) fail('候选 ZIP 条目大小异常或使用 ZIP64');
      if (cursor + 46 + nameLength + extraLength + commentLength > centralBytes.length) fail('ZIP 中央目录条目越界');
      var name = utf8Decode(centralBytes.slice(cursor + 46, cursor + 46 + nameLength));
      if (!safeName(name)) fail('ZIP 包含不安全路径：' + name);
      if (names.has(name)) fail('ZIP 包含重复条目：' + name);
      names.add(name);
      entries.push({ name: name, flags: flags, method: method, crc32: crc, bytes: uncompressed, localOffset: localOffset });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    if (cursor !== centralBytes.length) fail('ZIP 中央目录存在未解释的尾随数据');
    if (Array.isArray(expectedNames) && (entries.length !== expectedNames.length || expectedNames.some(function (name) { return !names.has(name); }))) fail('ZIP 条目集合与要求的格式不符');
    var ranges = [];
    for (var entry of entries) {
      if (entry.localOffset + 30 > eocd.centralOffset) fail('ZIP 本地文件头位置越界：' + entry.name);
      var localHeader = await readRange(blob, entry.localOffset, entry.localOffset + 30);
      var lv = new DataView(localHeader.buffer, localHeader.byteOffset, localHeader.byteLength);
      if (lv.getUint32(0, true) !== 0x04034B50) fail('ZIP 本地文件头签名无效：' + entry.name);
      var lFlags = lv.getUint16(6, true), lMethod = lv.getUint16(8, true), lCrc = lv.getUint32(14, true);
      var lCompressed = lv.getUint32(18, true), lUncompressed = lv.getUint32(22, true);
      var lNameLength = lv.getUint16(26, true), lExtraLength = lv.getUint16(28, true);
      if (lFlags !== entry.flags || lMethod !== entry.method || lCrc !== entry.crc32 || lCompressed !== entry.bytes || lUncompressed !== entry.bytes || lExtraLength !== 0) fail('ZIP 本地头与中央目录不一致：' + entry.name);
      var localName = await readRange(blob, entry.localOffset + 30, entry.localOffset + 30 + lNameLength);
      if (utf8Decode(localName) !== entry.name) fail('ZIP 本地文件名与中央目录不一致：' + entry.name);
      var dataOffset = entry.localOffset + 30 + lNameLength + lExtraLength;
      var dataEnd = dataOffset + entry.bytes;
      if (dataEnd > eocd.centralOffset) fail('ZIP 条目数据越过中央目录：' + entry.name);
      entry.dataOffset = dataOffset;
      var actualCrc = await crc32Blob(blob.slice(dataOffset, dataEnd));
      if (actualCrc !== entry.crc32) fail('ZIP 条目 CRC-32 不匹配：' + entry.name);
      ranges.push({ start: entry.localOffset, end: dataEnd, name: entry.name });
    }
    ranges.sort(function (a, b) { return a.start - b.start; });
    var expectedOffset = 0;
    ranges.forEach(function (range) {
      if (range.start !== expectedOffset) fail(range.start < expectedOffset ? 'ZIP 本地条目重叠：' + range.name : 'ZIP 本地条目之间存在未审核空隙：' + range.name);
      expectedOffset = range.end;
    });
    if (expectedOffset !== eocd.centralOffset) fail('ZIP 本地条目与中央目录之间存在额外数据');
    return entries;
  }
  function parseJson(text, name) { try { return JSON.parse(text); } catch (error) { fail(name + ' JSON 无法解析：' + (error.message || error)); } }
  async function sha256(bytes) {
    var subtle = global.crypto && global.crypto.subtle;
    if (!subtle || typeof subtle.digest !== 'function') fail('当前环境缺少 Web Crypto SHA-256；独立校验停止，不降级为 CRC-only');
    var digest = await subtle.digest('SHA-256', bytes);
    return hexBytes(new Uint8Array(digest));
  }
  function base64Info(value, expectedMime, expectedSize) {
    if (typeof value !== 'string') return { ok: false, reason: 'Blob Data URL 缺失' };
    var match = /^data:([^;,]+)?;base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
    if (!match) return { ok: false, reason: 'Blob Data URL/Base64 格式无效' };
    var encoded = match[2];
    if (encoded.length % 4 !== 0 || (encoded.includes('=') && !/={1,2}$/.test(encoded))) return { ok: false, reason: 'Base64 分组或 padding 无效' };
    var padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    var bytes = encoded.length / 4 * 3 - padding;
    if (expectedMime && match[1] && expectedMime !== match[1]) return { ok: false, reason: 'Blob MIME 与 Data URL MIME 不一致' };
    if (Number.isSafeInteger(expectedSize) && expectedSize !== bytes) return { ok: false, reason: 'Blob 声明大小与 Base64 解码长度不一致' };
    return { ok: true, bytes: bytes, mime: match[1] || 'application/octet-stream' };
  }
  function validateEncodedTree(value, path, issues, counter, depth) {
    depth = depth || 0;
    if (depth > 48) { issues.push(path + '：二进制快照嵌套深度超过 48'); return; }
    if (!value || typeof value !== 'object') return;
    counter.count++;
    if (counter.count === 120001) { issues.push('救援资料对象数量超过独立校验上限'); return; }
    if (counter.count > 120001) return;
    if (value.__type === 'Blob') {
      var result = base64Info(value.dataUrl, value.type, value.size);
      if (!result.ok) issues.push(path + '：' + result.reason);
      return;
    }
    if (value.__type === 'ArrayBuffer' || value.__type === 'ArrayBufferView') {
      var binary = base64Info('data:application/octet-stream;base64,' + String(value.base64 || ''), 'application/octet-stream', value.byteLength);
      if (!binary.ok) issues.push(path + '：' + binary.reason);
      return;
    }
    if (value.__type === 'CircularReference') { issues.push(path + '：快照包含无法还原的循环引用标记'); return; }
    if (Array.isArray(value)) value.forEach(function (child, index) { validateEncodedTree(child, path + '[' + index + ']', issues, counter, depth + 1); });
    else Object.keys(value).forEach(function (key) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') issues.push(path + '：包含危险属性名 ' + key);
      validateEncodedTree(value[key], path + '.' + key, issues, counter, depth + 1);
    });
  }
  function collectReference(id, path, refs, invalid) {
    if (id === undefined || id === null || id === '') return;
    if (typeof id !== 'string' || id.length > 256) invalid.push(path + '：媒体 ID 类型或长度无效');
    else refs.push({ id: id, path: path });
  }
  function collectChatRefs(value, prefix, refs, invalid) {
    if (!isObject(value)) return;
    (Array.isArray(value.chatHistory) ? value.chatHistory : []).forEach(function (message, index) {
      if (isObject(message)) collectReference(message.mediaId, prefix + '.chatHistory[' + index + '].mediaId', refs, invalid);
    });
    (Array.isArray(value.stickers) ? value.stickers : []).forEach(function (sticker, index) {
      if (isObject(sticker)) collectReference(sticker.mediaId, prefix + '.stickers[' + index + '].mediaId', refs, invalid);
    });
  }
  function collectStickerRefs(value, prefix, refs, invalid) {
    if (!isObject(value)) return;
    (Array.isArray(value.items) ? value.items : []).forEach(function (sticker, index) {
      if (isObject(sticker)) collectReference(sticker.mediaId, prefix + '.items[' + index + '].mediaId', refs, invalid);
    });
  }
  function collectMailboxRefs(value, prefix, refs, invalid) {
    if (!isObject(value)) return;
    var mailbox = isObject(value.mailbox) ? value.mailbox : value;
    (Array.isArray(mailbox.items) ? mailbox.items : []).forEach(function (letter, letterIndex) {
      if (!isObject(letter)) return;
      (Array.isArray(letter.images) ? letter.images : []).forEach(function (image, imageIndex) {
        if (isObject(image)) collectReference(image.id, prefix + '.items[' + letterIndex + '].images[' + imageIndex + '].id', refs, invalid);
      });
    });
  }
  function collectCircleRefs(value, prefix, refs, invalid, embedded) {
    if (!isObject(value)) return;
    function inspect(raw, path) {
      if (typeof raw !== 'string') return;
      if (raw.startsWith('idb-media:')) {
        var id = raw.slice('idb-media:'.length);
        if (!/^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,255}$/.test(id)) invalid.push(path + '：朋友圈媒体 ID 格式无效');
        else refs.push({ id: id, path: path });
      } else if (raw.startsWith('data:')) {
        var supported = /^data:(?:image\/(?:png|jpe?g|webp|gif|avif)|video\/[a-z0-9.+-]+);base64,/i.test(raw);
        var info = base64Info(raw);
        embedded.push({ path: path, ok: supported && info.ok, reason: !supported ? '朋友圈 Data URL MIME 不受支持' : info.reason || '' });
      }
    }
    ['myAvatar', 'otherAvatar', 'myCover', 'otherCover'].forEach(function (field) { inspect(value[field], prefix + '.' + field); });
    (Array.isArray(value.posts) ? value.posts : []).forEach(function (post, postIndex) {
      if (!isObject(post)) return;
      (Array.isArray(post.media) ? post.media : []).forEach(function (media, mediaIndex) {
        if (isObject(media)) inspect(media.src, prefix + '.posts[' + postIndex + '].media[' + mediaIndex + '].src');
      });
    });
  }
  function validateJournalShape(journal) {
    var issues = [];
    if (!isObject(journal)) return ['恢复日志不是对象'];
    if (typeof journal.id !== 'string' || !journal.id || journal.id.length > 180) issues.push('恢复日志 ID 缺失或无效');
    if (journal.formatVersion !== 1) issues.push('恢复日志版本不受支持');
    if (typeof journal.createdAt !== 'number' || !Number.isFinite(journal.createdAt)) issues.push('恢复日志创建时间无效');
    if (typeof journal.kind !== 'string' || !journal.kind) issues.push('恢复日志事务类型缺失');
    if (!['prepared', 'committed'].includes(String(journal.phase || '').toLowerCase())) issues.push('恢复日志事务阶段不受支持');
    if (typeof journal.oldState !== 'string' || journal.oldState.length > 256 * 1024 * 1024) issues.push('恢复日志主状态快照缺失或超限');
    else { try { if (!isObject(JSON.parse(journal.oldState))) issues.push('恢复日志主状态快照顶层结构无效'); } catch (_) { issues.push('恢复日志主状态 JSON 损坏'); } }
    if (!(journal.oldStorage === null || typeof journal.oldStorage === 'string')) issues.push('恢复日志主存储原文快照类型无效');
    if (!Array.isArray(journal.oldMedia) || journal.oldMedia.length > 100000) issues.push('恢复日志 oldMedia 列表缺失或超限');
    else {
      var oldIds = new Set();
      journal.oldMedia.forEach(function (pair) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !pair[0] || oldIds.has(pair[0])) { issues.push('恢复日志 oldMedia 包含无效或重复媒体 ID'); return; }
        oldIds.add(pair[0]);
        if (pair[1] !== null && (!isObject(pair[1]) || pair[1].id !== pair[0] || !isObject(pair[1].blob) || pair[1].blob.__type !== 'Blob')) issues.push('恢复日志 oldMedia 记录与 ID/Blob 不一致：' + pair[0]);
      });
    }
    if (journal.oldStorageEntries !== undefined) {
      var allowed = new Set(['dual_space_sticker_library_v1', 'twodeers_mailbox_letters_v1', 'twodeers_mailbox_drafts_v1', 'twodeers_card_system_v1']);
      if (!Array.isArray(journal.oldStorageEntries) || journal.oldStorageEntries.length > 4) issues.push('恢复日志附加存储快照列表无效');
      else {
        var keys = new Set();
        journal.oldStorageEntries.forEach(function (pair) {
          if (!Array.isArray(pair) || pair.length !== 2 || !allowed.has(pair[0]) || keys.has(pair[0]) || !(pair[1] === null || typeof pair[1] === 'string')) issues.push('恢复日志附加存储快照包含非法键或重复记录');
          else keys.add(pair[0]);
        });
      }
    }
    if (journal.oldStickerLibrary !== null && journal.oldStickerLibrary !== undefined) {
      var sticker = journal.oldStickerLibrary;
      if (!isObject(sticker) || sticker.version !== 1 || !Array.isArray(sticker.items) || !Array.isArray(sticker.tombstones) || !Array.isArray(sticker.favorites)) issues.push('恢复日志旧表情库快照结构无效');
    }
    if (journal.oldCircle !== null && journal.oldCircle !== undefined && !isObject(journal.oldCircle)) issues.push('恢复日志旧朋友圈快照结构无效');
    ['oldFonts', 'oldMailbox', 'oldCards'].forEach(function (field) { if (journal[field] !== null && journal[field] !== undefined && !isObject(journal[field])) issues.push(field + ' 辅助快照结构无效'); });
    return issues;
  }

  function validateStickerSnapshot(value) {
    if (!isObject(value) || value.version !== 1 || !Array.isArray(value.items) || !Array.isArray(value.tombstones) || !Array.isArray(value.favorites)) return '表情索引结构或版本无效';
    var itemIds = new Set(), tombstoneIds = new Set();
    for (var item of value.items) {
      if (!isObject(item) || typeof item.id !== 'string' || !item.id || itemIds.has(item.id) || typeof item.mediaId !== 'string' || !item.mediaId) return '表情项目存在无效/重复 ID 或媒体引用缺失';
      itemIds.add(item.id);
    }
    for (var tombstone of value.tombstones) {
      if (!isObject(tombstone) || typeof tombstone.id !== 'string' || !tombstone.id || tombstoneIds.has(tombstone.id) || itemIds.has(tombstone.id)) return '表情删除账本存在无效/重复 ID 或与现存项目冲突';
      tombstoneIds.add(tombstone.id);
    }
    var favorites = new Set();
    for (var favoriteId of value.favorites) {
      if (typeof favoriteId !== 'string' || !itemIds.has(favoriteId) || favorites.has(favoriteId)) return '表情收藏列表存在无效或重复引用';
      favorites.add(favoriteId);
    }
    return '';
  }
  function validateCardSnapshot(value) {
    if (!isObject(value)) return '字卡库必须是对象';
    var pools = [['chatIds', 'chatTexts'], ['momentsDynamicIds', 'momentsDynamicTexts'], ['momentsReplyIds', 'momentsReplyTexts']];
    for (var pair of pools) {
      var hasIds = Object.prototype.hasOwnProperty.call(value, pair[0]), hasTexts = Object.prototype.hasOwnProperty.call(value, pair[1]);
      if (!hasIds && !hasTexts) continue;
      if (!hasIds || !hasTexts || !Array.isArray(value[pair[0]]) || !Array.isArray(value[pair[1]]) || value[pair[0]].length !== value[pair[1]].length || value[pair[0]].length > 20000) return pair[0] + '/' + pair[1] + ' 数组缺失、长度不一致或超限';
      var ids = new Set();
      for (var id of value[pair[0]]) { if (typeof id !== 'string' || !id || id.length > 128 || ids.has(id)) return pair[0] + ' 包含无效或重复 ID'; ids.add(id); }
      for (var textValue of value[pair[1]]) if (!(typeof textValue === 'string' || isObject(textValue))) return pair[1] + ' 包含无效文本项';
    }
    for (var field of ['recentDrawnRepliesV1', 'appliedEventIds', 'cardUsageOutbox', 'chatUsageOutbox', 'circleUsageOutbox', 'mailboxUsageOutbox']) {
      var max = field === 'appliedEventIds' ? 10000 : field === 'recentDrawnRepliesV1' ? 200 : 1000;
      if (value[field] !== undefined && (!Array.isArray(value[field]) || value[field].length > max)) return field + ' 数组无效或超限';
    }
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
  function validateCircleSnapshot(value) {
    if (!isObject(value)) return '朋友圈状态必须是对象';
    if (value.posts !== undefined && (!Array.isArray(value.posts) || value.posts.length > 10000)) return '朋友圈动态列表无效或超过数量上限';
    for (var field of ['myAvatar', 'otherAvatar', 'myCover', 'otherCover']) if (value[field] !== undefined && value[field] !== null && typeof value[field] !== 'string') return field + ' 必须是字符串或空值';
    if (Array.isArray(value.posts)) for (var post of value.posts) {
      if (!isObject(post)) return '朋友圈动态包含无效项目';
      if (post.media !== undefined && (!Array.isArray(post.media) || post.media.length > 100)) return '朋友圈动态媒体列表无效或超限';
      if (Array.isArray(post.media)) for (var media of post.media) if (!isObject(media) || media.src !== undefined && typeof media.src !== 'string') return '朋友圈媒体条目结构无效';
    }
    return '';
  }
  function countEncodedTree(value, counts, depth) {
    depth = depth || 0;
    if (depth > 48) { counts.invalid++; counts.notes.push('二进制快照嵌套深度超过 48'); return; }
    if (value === null || typeof value !== 'object') return;
    counts.visited++;
    if (counts.visited > 120000) { counts.invalid++; counts.notes.push('资源对象数量超过独立校验上限'); return; }
    if (value.__type === 'Blob') {
      var blobCheck = base64Info(value.dataUrl, value.type, value.size);
      if (!Number.isSafeInteger(value.size) || value.size < 0 || !blobCheck.ok) { counts.invalid++; counts.notes.push(blobCheck.reason || 'Blob 大小无效'); }
      else { counts.valid++; counts.bytes += blobCheck.bytes; }
      return;
    }
    if (value.__type === 'ArrayBuffer' || value.__type === 'ArrayBufferView') {
      var binaryCheck = base64Info('data:application/octet-stream;base64,' + String(value.base64 || ''), 'application/octet-stream', value.byteLength);
      if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 0 || !binaryCheck.ok) { counts.invalid++; counts.notes.push(binaryCheck.reason || '二进制快照无效'); }
      else { counts.valid++; counts.bytes += binaryCheck.bytes; }
      return;
    }
    if (value.__type === 'CircularReference') { counts.invalid++; counts.notes.push('快照包含循环引用标记'); return; }
    if (Array.isArray(value)) value.forEach(function (child) { countEncodedTree(child, counts, depth + 1); });
    else Object.keys(value).forEach(function (key) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') { counts.invalid++; counts.notes.push('快照包含危险属性名'); return; }
      countEncodedTree(value[key], counts, depth + 1);
    });
  }

  function validateSource(payload) {
    if (!isObject(payload) || payload.format !== 'twodeers-recovery-salvage' || payload.formatVersion !== 1 || payload.importableAsBackup !== false) fail('源条目不是受支持的 salvage v1 格式');
    if (!Array.isArray(payload.localStorageRaw) || !Array.isArray(payload.mediaRecords) || !Array.isArray(payload.omissions) || typeof payload.complete !== 'boolean' || !isObject(payload.diagnosticReport)) fail('源救援资料缺少必要的结构字段');
    if (payload.localStorageRaw.length + payload.mediaRecords.length > 30000) fail('源救援资料条目数量超过安全上限');
    var semanticIssues = [], keyCounts = new Map(), parsedRows = new Map(), uniqueMedia = new Map(), uniqueFonts = new Map();
    payload.localStorageRaw.forEach(function (row) {
      if (!isObject(row) || typeof row.key !== 'string' || !row.key || typeof row.raw !== 'string') { semanticIssues.push('localStorage 原始行结构无效'); return; }
      keyCounts.set(row.key, (keyCounts.get(row.key) || 0) + 1);
    });
    keyCounts.forEach(function (count, key) { if (count > 1) semanticIssues.push('localStorage 键重复：' + key); });
    var knownKeys = new Set(['dual_space_app_clean_test_v1', 'dual_space_sticker_library_v1', 'twodeers_mailbox_letters_v1', 'twodeers_mailbox_drafts_v1', 'twodeers_card_system_v1', 'moments_site_blank_v49_rebuild_baseline_same_layout', 'moments_site_blank_v49_rebuild_baseline_same_layout_visitor_backup_step01b']);
    var diagnosticRows = payload.diagnosticReport && payload.diagnosticReport.localStorage && Array.isArray(payload.diagnosticReport.localStorage.rows) ? payload.diagnosticReport.localStorage.rows : [];
    payload.localStorageRaw.forEach(function (row) {
      if (!isObject(row) || typeof row.key !== 'string' || typeof row.raw !== 'string' || keyCounts.get(row.key) !== 1) return;
      var diagnosticRow = diagnosticRows.find(function (entry) { return entry && entry.key === row.key; });
      if (['corrupt-json', 'invalid-structure', 'read-error'].includes(String(row.parseStatus || '')) || diagnosticRow && ['corrupt-json', 'invalid-structure', 'read-error'].includes(String(diagnosticRow.status || ''))) semanticIssues.push('localStorage 键被诊断为损坏：' + row.key);
      if (row.key === '__proto__' || row.key === 'constructor' || row.key === 'prototype') semanticIssues.push('localStorage 键名与危险对象属性重合：' + row.key);
      if (knownKeys.has(row.key)) {
        try {
          var value = JSON.parse(row.raw);
          if (!isObject(value) && !Array.isArray(value) && value !== null) fail('known storage top-level');
          var structureError = '';
          if (row.key === 'dual_space_app_clean_test_v1' && (!isObject(value) || ['chatHistory', 'stickers', 'cardPhrases'].some(function (key) { return value[key] !== undefined && !Array.isArray(value[key]); }))) structureError = '主状态关键集合结构无效';
          else if (row.key === 'dual_space_sticker_library_v1') structureError = validateStickerSnapshot(value);
          else if (row.key === 'twodeers_mailbox_letters_v1') structureError = validateMailboxSnapshot(value);
          else if (row.key === 'twodeers_card_system_v1') structureError = validateCardSnapshot(value);
          else if (row.key === 'moments_site_blank_v49_rebuild_baseline_same_layout' || row.key === 'moments_site_blank_v49_rebuild_baseline_same_layout_visitor_backup_step01b') structureError = validateCircleSnapshot(value);
          if (structureError) semanticIssues.push(row.key + '：' + structureError);
          parsedRows.set(row.key, value);
        } catch (_) { semanticIssues.push('已知 localStorage JSON 无法解析：' + row.key); }
      }
    });
    var diagnosticMedia = payload.diagnosticReport && payload.diagnosticReport.media;
    if (diagnosticMedia && Number(diagnosticMedia.missingCount) > 0) semanticIssues.push('原始诊断报告记录缺失媒体引用：' + Number(diagnosticMedia.missingCount));
    var mediaIds = new Set(), binaryCounter = { count: 0 };
    payload.mediaRecords.forEach(function (record, index) {
      if (!isObject(record) || typeof record.id !== 'string' || !record.id) { semanticIssues.push('媒体记录 ID 无效：' + index); return; }
      if (mediaIds.has(record.id)) semanticIssues.push('媒体 ID 重复：' + record.id);
      else mediaIds.add(record.id);
      var before = semanticIssues.length;
      validateEncodedTree(record.blob, 'mediaRecords[' + index + '].blob', semanticIssues, binaryCounter, 0);
      if (record.blob && record.blob.__type === 'Blob' && record.size !== undefined && Number(record.size) !== Number(record.blob.size)) semanticIssues.push('媒体元数据大小不一致：' + record.id);
      if (record.blob && record.blob.__type === 'Blob' && record.mimeType && record.blob.type && record.mimeType !== record.blob.type) semanticIssues.push('媒体 MIME 元数据不一致：' + record.id);
      if (semanticIssues.length === before) uniqueMedia.set(record.id, record);
    });
    if (payload.fontLibrary !== null && payload.fontLibrary !== undefined && (!isObject(payload.fontLibrary) || !Array.isArray(payload.fontLibrary.fonts))) semanticIssues.push('字体库顶层结构或 fonts 列表无效');
    var fonts = payload.fontLibrary && Array.isArray(payload.fontLibrary.fonts) ? payload.fontLibrary.fonts : [];
    fonts.forEach(function (font, index) {
      if (!isObject(font) || typeof font.id !== 'string' || !font.id) { semanticIssues.push('字体记录 ID 无效：' + index); return; }
      if (uniqueFonts.has(font.id)) semanticIssues.push('字体 ID 重复：' + font.id);
      var before = semanticIssues.length;
      validateEncodedTree(font.blob, 'fontLibrary.fonts[' + index + '].blob', semanticIssues, binaryCounter, 0);
      if (font.blob && font.blob.__type === 'Blob' && font.size !== undefined && Number(font.size) !== Number(font.blob.size)) semanticIssues.push('字体元数据大小不一致：' + font.id);
      if (semanticIssues.length === before) uniqueFonts.set(font.id, font);
    });
    if (payload.fontLibrary && payload.fontLibrary.currentFontId && !uniqueFonts.has(payload.fontLibrary.currentFontId)) semanticIssues.push('当前字体指针不存在或对应字体无效');

    var refs = [], referenceIssues = [], embedded = [];
    collectChatRefs(parsedRows.get('dual_space_app_clean_test_v1'), 'localStorage.dual_space_app_clean_test_v1', refs, referenceIssues);
    collectStickerRefs(parsedRows.get('dual_space_sticker_library_v1'), 'localStorage.dual_space_sticker_library_v1', refs, referenceIssues);
    collectMailboxRefs(parsedRows.get('twodeers_mailbox_letters_v1'), 'localStorage.twodeers_mailbox_letters_v1', refs, referenceIssues);
    collectCircleRefs(parsedRows.get('moments_site_blank_v49_rebuild_baseline_same_layout'), 'localStorage.moments_site_blank_v49_rebuild_baseline_same_layout', refs, referenceIssues, embedded);
    collectCircleRefs(parsedRows.get('moments_site_blank_v49_rebuild_baseline_same_layout_visitor_backup_step01b'), 'localStorage.moments_site_blank_v49_rebuild_baseline_same_layout_visitor_backup_step01b', refs, referenceIssues, embedded);
    var missingCurrent = 0;
    refs.forEach(function (ref) { if (!uniqueMedia.has(ref.id)) { missingCurrent++; referenceIssues.push(ref.path + '：引用媒体不存在唯一且二进制通过检查的记录：' + ref.id); } });
    var journalRefs = [], journalIssues = [], journalInvalidCount = 0, journalMissingCount = 0;
    if (isObject(payload.recoveryJournal)) {
      var journal = payload.recoveryJournal;
      validateEncodedTree(journal, 'recoveryJournal', semanticIssues, binaryCounter, 0);
      semanticIssues = semanticIssues.concat(validateJournalShape(journal));
      var oldMap = new Map();
      if (Array.isArray(journal.oldMedia)) journal.oldMedia.forEach(function (pair) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || oldMap.has(pair[0])) { journalIssues.push('恢复日志历史媒体 ID 缺失或重复'); journalInvalidCount++; return; }
        oldMap.set(pair[0], pair[1]);
      });
      try { if (typeof journal.oldState === 'string') collectChatRefs(JSON.parse(journal.oldState), 'recoveryJournal.oldState', journalRefs, journalIssues); } catch (_) { journalIssues.push('恢复日志 oldState JSON 损坏'); journalInvalidCount++; }
      collectCircleRefs(journal.oldCircle, 'recoveryJournal.oldCircle', journalRefs, journalIssues, embedded);
      collectStickerRefs(journal.oldStickerLibrary, 'recoveryJournal.oldStickerLibrary', journalRefs, journalIssues);
      collectMailboxRefs(journal.oldMailbox, 'recoveryJournal.oldMailbox', journalRefs, journalIssues);
      journalRefs.forEach(function (ref) {
        var record = oldMap.get(ref.id);
        if (!isObject(record) || record.id !== ref.id || !isObject(record.blob) || record.blob.__type !== 'Blob') { journalIssues.push(ref.path + '：未找到唯一 oldMedia 快照'); journalMissingCount++; return; }
        var localIssues = [];
        validateEncodedTree(record.blob, ref.path, localIssues, binaryCounter, 0);
        if (localIssues.length) { journalIssues.push(ref.path + '：oldMedia Blob 无效'); journalInvalidCount++; }
      });
      semanticIssues = semanticIssues.concat(journalIssues);
    }
    semanticIssues = semanticIssues.concat(referenceIssues);
    var embeddedInvalid = embedded.filter(function (entry) { return !entry.ok; }).length;
    embedded.forEach(function (entry) { if (!entry.ok) semanticIssues.push(entry.path + '：朋友圈内嵌 Data URL 无效：' + entry.reason); });
    return {
      keyCount: keyCounts.size, mediaCount: mediaIds.size, fontCount: fonts.length,
      referenceCount: refs.length + journalRefs.length, missingReferenceCount: missingCurrent + journalMissingCount,
      invalidReferenceCount: referenceIssues.length - missingCurrent + journalInvalidCount,
      journalReferenceCount: journalRefs.length, journalIssueCount: journalIssues.length,
      legacyDataUrlsChecked: embedded.length, legacyDataUrlsInvalid: embeddedInvalid,
      semanticIssues: Array.from(new Set(semanticIssues))
    };
  }
  function validateOverlay(overlay, payload, preview) {
    if (!isObject(overlay) || overlay.format !== 'twodeers-recovery-overlay' || overlay.version !== 1 || overlay.applyable !== false || overlay.writesPerformed !== false || !Array.isArray(overlay.selectedOperations) || overlay.selectedOperations.length > 1) fail('候选覆盖清单格式无效或包含禁止的执行标记');
    var operations = overlay.selectedOperations;
    if (!operations.length) return [];
    var operation = operations[0];
    if (!isObject(operation) || operation.operation !== 'localStorage-set-candidate' || operation.key !== REVISION_KEY || operation.value !== '0' || operation.requiresIndependentReview !== true || !Array.isArray(operation.preconditions)) fail('候选覆盖包含未授权操作；只允许运行时版本计数的审核候选');
    var required = ['关闭同源的其他 Twodeers 标签页和窗口', '退出后重新打开应用，再由独立恢复流程决定是否应用该提案'];
    if (!required.every(function (item) { return operation.preconditions.includes(item); })) fail('运行时计数候选缺少必要的跨标签页前置条件');
    var rows = payload.localStorageRaw.filter(function (row) { return row.key === REVISION_KEY; });
    if (rows.length !== 1) fail('运行时计数候选源键不存在或不唯一');
    var raw = rows[0].raw;
    var numeric = /^(0|[1-9]\d*)$/.test(raw) ? Number(raw) : NaN;
    if (Number.isSafeInteger(numeric) && numeric >= 0) fail('运行时计数候选的源值其实有效，拒绝应用覆盖');
    var expectedSummary = '无效版本计数（' + new TextEncoder().encode(raw).byteLength + ' 字节）';
    if (operation.sourceBeforeSummary !== expectedSummary) fail('运行时计数候选的源值摘要与实际原文不一致');
    var previewProposal = preview && Array.isArray(preview.proposals) ? preview.proposals : [];
    if (previewProposal.length !== 1 || previewProposal[0].path !== 'localStorage.' + REVISION_KEY || previewProposal[0].proposedValue !== '0') fail('候选覆盖没有对应的修复预览提案');
    return [{ key: REVISION_KEY, before: raw, after: '0', preconditions: required.slice(), requiresIndependentReview: true }];
  }
  function compareList(actual, expected, label) {
    if (!Array.isArray(expected) || actual.length !== expected.length || actual.some(function (value, index) { return value !== expected[index]; })) fail('manifest ' + label + ' 与源资料不一致');
  }
  async function validateCandidateFile(file) {
    var entries = await parseZip(file, REQUIRED, MAX_ARCHIVE_BYTES);
    var map = new Map(entries.map(function (entry) { return [entry.name, entry]; }));
    async function bytes(name) { return readEntryBytes(file, map.get(name)); }
    async function json(name) { return parseJson(utf8Decode(await bytes(name)), name); }
    var manifestBytes = await bytes('candidate/manifest.json');
    var manifest = parseJson(utf8Decode(manifestBytes), 'manifest');
    var payloadBytes = await bytes(REQUIRED[0]);
    var payloadText = utf8Decode(payloadBytes);
    var payload = parseJson(payloadText, 'source salvage');
    var preview = await json('candidate/preview.json');
    var overlay = await json('candidate/overlay.json');
    var readme = utf8Decode(await bytes('README.txt'));
    if (!isObject(manifest) || manifest.format !== 'twodeers-recovery-candidate' || manifest.formatVersion !== 1 || manifest.importableAsBackup !== false || manifest.writesPerformed !== false) fail('候选 manifest 格式或安全标记无效');
    if (!isObject(preview) || preview.format !== 'twodeers-recovery-preview' || preview.formatVersion !== 1 || preview.importableAsBackup !== false || preview.writesPerformed !== false || !isObject(preview.summary) || !Array.isArray(preview.items) || !Array.isArray(preview.proposals)) fail('候选 preview 结构或只读标记无效');
    if (!readme.includes('不是 V4 备份') || !readme.includes('原始救援 JSON')) fail('README 缺失必要的格式和隐私说明');
    var sourceEntry = map.get(REQUIRED[0]);
    var sourceCrc = hex32(sourceEntry.crc32);
    var sourceSha256 = await sha256(payloadBytes);
    if (!isObject(manifest.source) || manifest.source.entry !== REQUIRED[0] || manifest.source.format !== payload.format || manifest.source.formatVersion !== payload.formatVersion || manifest.source.bytes !== sourceEntry.bytes || String(manifest.source.crc32).toLowerCase() !== sourceCrc) fail('manifest 源文件声明与实际 source 条目不一致');
    if (manifest.source.complete !== (payload.complete === true && payload.omissions.length === 0) || manifest.source.omissions !== payload.omissions.length) fail('manifest 源完整性声明与原始救援资料不一致');
    var manifestEntries = manifest.entries;
    if (!Array.isArray(manifestEntries) || manifestEntries.length !== REQUIRED.length - 1) fail('manifest 条目清单数量不正确');
    var expectedNames = REQUIRED.filter(function (name) { return name !== 'candidate/manifest.json'; }).sort();
    var listedNames = manifestEntries.map(function (entry) { return entry && entry.path; }).sort();
    compareList(expectedNames, listedNames, 'entries.paths');
    var entryReports = [];
    for (var entry of entries) {
      var actualCrc = hex32(entry.crc32);
      var entryBytes = await bytes(entry.name);
      var digest = await sha256(entryBytes);
      entryReports.push({ path: entry.name, bytes: entry.bytes, crc32: actualCrc, sha256: digest });
      if (entry.name === 'candidate/manifest.json') continue;
      var listed = manifestEntries.find(function (row) { return row && row.path === entry.name; });
      if (!listed || listed.bytes !== entry.bytes || String(listed.crc32).toLowerCase() !== actualCrc) fail('manifest 条目长度或 CRC 与重新读取的实际文件不一致：' + entry.name);
    }
    var sourceShape = validateSource(payload);
    var inventory = manifest.inventory;
    if (!isObject(inventory) || inventory.localStorageRecordCount !== payload.localStorageRaw.length || inventory.mediaRecordCount !== payload.mediaRecords.length || inventory.fontRecordCount !== sourceShape.fontCount || inventory.recoveryJournalPresent !== !!payload.recoveryJournal) fail('manifest 资源数量与源资料不一致');
    compareList(payload.localStorageRaw.map(function (row) { return row.key; }), inventory.localStorageKeys, 'inventory.localStorageKeys');
    compareList(payload.mediaRecords.map(function (row) { return row.id; }), inventory.mediaIds, 'inventory.mediaIds');
    compareList((payload.fontLibrary && payload.fontLibrary.fonts || []).map(function (row) { return row.id; }), inventory.fontIds, 'inventory.fontIds');
    if (!isObject(preview.source) || preview.source.complete !== manifest.source.complete || preview.source.omissions !== manifest.source.omissions || preview.source.format !== payload.format || preview.source.formatVersion !== payload.formatVersion) fail('preview 源完整性信息与实际救援资料不一致');
    var previewSummary = preview.summary;
    var classification = manifest.classifications;
    if (!isObject(classification)) fail('manifest 分类摘要缺失');
    ['total', 'safeRebuildCandidates', 'preserved', 'manualReview', 'binaryValid', 'binaryInvalid', 'referencesChecked', 'missingMediaReferences', 'invalidMediaReferences', 'legacyDataUrlsChecked', 'legacyDataUrlsInvalid'].forEach(function (key) {
      var previewKey = ({ safeRebuildCandidates: 'safeRebuild', preserved: 'preserve' })[key] || key;
      if (classification[key] !== previewSummary[previewKey]) fail('manifest 分类摘要与 preview 不一致：' + key);
    });
    if (!['ready-for-independent-validation', 'review-required'].includes(manifest.status)) fail('候选包状态不受支持');
    var semanticIssues = sourceShape.semanticIssues || [];
    var previewItems = preview.items;
    var classCounts = { safe: 0, preserve: 0, manual: 0 };
    previewItems.forEach(function (item) {
      if (!isObject(item) || typeof item.path !== 'string' || !['可安全重建', '保留原始数据', '人工复核'].includes(item.classification)) { semanticIssues.push('preview items 包含未知或结构无效的分类项'); return; }
      if (item.classification === '可安全重建') classCounts.safe++;
      else if (item.classification === '保留原始数据') classCounts.preserve++;
      else classCounts.manual++;
    });
    if (previewSummary.total !== previewItems.length || previewSummary.safeRebuild !== classCounts.safe || previewSummary.preserve !== classCounts.preserve || previewSummary.manualReview !== classCounts.manual) semanticIssues.push('preview 分类条目数量与 summary 不一致');
    var binaryCounts = { visited: 0, valid: 0, invalid: 0, bytes: 0, notes: [] };
    payload.mediaRecords.forEach(function (record) { countEncodedTree(record && record.blob, binaryCounts, 0); });
    if (payload.fontLibrary) countEncodedTree(payload.fontLibrary, binaryCounts, 0);
    if (payload.recoveryJournal) countEncodedTree(payload.recoveryJournal, binaryCounts, 0);
    if (Number(previewSummary.binaryValid || 0) !== binaryCounts.valid || Number(previewSummary.binaryInvalid || 0) !== binaryCounts.invalid) semanticIssues.push('preview 二进制计数与独立重算结果不一致');
    var independentChecks = [
      ['referencesChecked', sourceShape.referenceCount],
      ['missingMediaReferences', sourceShape.missingReferenceCount],
      ['invalidMediaReferences', sourceShape.invalidReferenceCount],
      ['legacyDataUrlsChecked', sourceShape.legacyDataUrlsChecked],
      ['legacyDataUrlsInvalid', sourceShape.legacyDataUrlsInvalid]
    ];
    independentChecks.forEach(function (pair) { if (Number(previewSummary[pair[0]] || 0) !== Number(pair[1] || 0)) semanticIssues.push('preview ' + pair[0] + ' 与独立引用图重算结果不一致'); });
    var computedReady = manifest.source.complete === true && classification.manualReview === 0 && classification.binaryInvalid === 0 && classification.missingMediaReferences === 0 && classification.invalidMediaReferences === 0 && classification.legacyDataUrlsInvalid === 0 && semanticIssues.length === 0;
    if (manifest.status === 'ready-for-independent-validation' && !computedReady) fail('候选 manifest 声称 ready，但独立重算发现完整性问题');
    if (manifest.status === 'review-required' && computedReady) { /* conservative status is allowed */ }
    if (!isObject(manifest.candidateOverlay) || manifest.candidateOverlay.format !== 'twodeers-recovery-overlay' || manifest.candidateOverlay.version !== 1 || manifest.candidateOverlay.applyable !== false || manifest.candidateOverlay.writesPerformed !== false || !Array.isArray(manifest.candidateOverlay.operations)) fail('manifest 中的覆盖清单安全标记无效');
    function compareClassifiedItems(field, category) {
      var expected = preview.items.filter(function (item) { return item && item.classification === category; }).map(function (item) { return { path: item.path, reason: item.reason }; });
      var actual = manifest[field];
      if (!Array.isArray(actual) || actual.length !== expected.length || actual.some(function (item, index) { return !isObject(item) || item.path !== expected[index].path || item.reason !== expected[index].reason; })) fail('manifest ' + field + ' 与 preview 分类条目不一致');
    }
    compareClassifiedItems('preservedItems', '保留原始数据');
    compareClassifiedItems('manualReviewItems', '人工复核');
    if (JSON.stringify(manifest.candidateOverlay.operations) !== JSON.stringify(overlay.selectedOperations)) fail('manifest 和 overlay 条目不一致');
    var approvedOperations = validateOverlay(overlay, payload, preview);
    var baseReport = {
      format: 'twodeers-independent-candidate-validation', formatVersion: 1,
      verified: true, importableAsBackup: false, writesPerformed: false,
      archiveBytes: file.size, entryCount: entries.length, compression: 'STORE',
      sourceBytes: payloadBytes.length, sourceCrc32: sourceCrc, sourceSha256: sourceSha256,
      manifestChecks: 'passed', localHeaderCentralDirectoryChecks: 'passed',
      sourceInventoryChecks: 'passed', overlayPolicyChecks: 'passed',
      sourceInventory: sourceShape, sourceSemanticIssues: semanticIssues, candidateStatus: manifest.status,
      manualReviewItems: Number(classification.manualReview) || 0,
      missingMediaReferences: Number(classification.missingMediaReferences) || 0,
      approvedIsolatedOperations: approvedOperations,
      entries: entryReports,
      warnings: [
        'SHA-256 是本次重新计算的指纹；候选包没有数字签名，不能据此证明创建者身份或来源真实性。',
        '候选 preview 与 manifest 由源包提供；本次独立校验重新核对结构、摘要和条目，不把这些元数据当作权威签名。',
        manifest.status === 'ready-for-independent-validation' ? '结构与清单通过独立校验；仍不代表可以直接导入应用。' : '原候选包本身标记为 review-required；可以制作只读隔离副本，但不能标记为可提升或可导入。',
        semanticIssues.length ? ('独立语义检查发现 ' + semanticIssues.length + ' 个问题，按 review-required 处理：' + semanticIssues.slice(0, 20).join('；')) : '独立语义检查未发现额外问题。'
      ]
    };
    return { ok: true, report: baseReport, manifest: manifest, preview: preview, overlay: overlay, payload: payload, approvedOperations: approvedOperations, sourcePayloadBlob: new Blob([payloadBytes], { type: 'application/json' }), archiveBlob: file };
  }
  async function inspectStoredZip(file, maxBytes) {
    var entries = await parseZip(file, null, maxBytes || 200 * 1024 * 1024);
    var report = [];
    for (var entry of entries) {
      var content = await readEntryBytes(file, entry);
      report.push({ path: entry.name, bytes: entry.bytes, crc32: hex32(entry.crc32), sha256: await sha256(content) });
    }
    return { verified: true, bytes: file.size, entries: report, format: 'twodeers-verified-stored-zip' };
  }
  async function readStoredZipEntries(file, expectedNames, maxBytes) {
    var entries = await parseZip(file, expectedNames || null, maxBytes || 200 * 1024 * 1024);
    return entries.map(function (entry) {
      return {
        path: entry.name,
        bytes: entry.bytes,
        crc32: hex32(entry.crc32),
        blob: file.slice(entry.dataOffset, entry.dataOffset + entry.bytes)
      };
    });
  }
  global.__duoRecoveryCandidateValidator = {
    validateFile: validateCandidateFile, inspectStoredZip: inspectStoredZip,
    readStoredZipEntries: readStoredZipEntries,
    crc32Blob: crc32Blob, sha256Blob: async function (blob) { return sha256(await readRange(blob, 0, blob.size)); },
    maxArchiveBytes: MAX_ARCHIVE_BYTES, requiredEntries: REQUIRED.slice()
  };
})(window);
