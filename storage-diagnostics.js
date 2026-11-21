/* Read-only storage diagnostics and user-triggered salvage export. Never repairs or deletes data. */
(function (global) {
  'use strict';
  if (global.__duoStorageDiagnosticsInstalled) return;
  global.__duoStorageDiagnosticsInstalled = true;

  var MAX_BLOB_EXPORT_BYTES = 96 * 1024 * 1024;
  var MAX_RAW_LOCAL_BYTES = 48 * 1024 * 1024;
  var MAX_RAW_LOCAL_JSON_BYTES = 64 * 1024 * 1024;
  var MAX_JSON_EXPORT_BYTES = 220 * 1024 * 1024;
  var MAIN_KEY = 'dual_space_app_clean_test_v1';
  var STICKER_KEY = 'dual_space_sticker_library_v1';
  var MAILBOX_KEY = 'twodeers_mailbox_letters_v1';
  var DRAFT_KEY = 'twodeers_mailbox_drafts_v1';
  var CARD_KEY = 'twodeers_card_system_v1';
  var statusNode = null;

  function text(value) { return String(value == null ? '' : value); }
  function byteLength(value) {
    try { return new TextEncoder().encode(text(value)).byteLength; }
    catch (_) { return text(value).length * 2; }
  }
  function setStatus(message, isError) {
    if (!statusNode && global.document) statusNode = global.document.getElementById('storageDiagnosticsStatus');
    if (!statusNode) return;
    statusNode.textContent = message;
    statusNode.dataset.state = isError ? 'error' : 'ok';
  }
  function getKnownKeys() {
    var keys = [MAIN_KEY, STICKER_KEY, MAILBOX_KEY, DRAFT_KEY, CARD_KEY];
    try {
      var circleKey = global.__duoCircleApi && global.__duoCircleApi.getStoreKey && global.__duoCircleApi.getStoreKey();
      if (circleKey) { keys.push(circleKey); keys.push(circleKey + '_visitor_backup_step01b'); }
    } catch (_) {}
    try {
      for (var i = 0; i < global.localStorage.length; i++) {
        var key = global.localStorage.key(i);
        if (key) keys.push(key);
      }
    } catch (_) {}
    return Array.from(new Set(keys));
  }
  function validateKnownValue(key, value) {
    if (value === null) return { status: 'missing' };
    var circleKey = '';
    try { circleKey = global.__duoCircleApi && global.__duoCircleApi.getStoreKey && global.__duoCircleApi.getStoreKey() || ''; } catch (_) {}
    var known = [MAIN_KEY, STICKER_KEY, MAILBOX_KEY, DRAFT_KEY, CARD_KEY].includes(key) || key === circleKey || key === circleKey + '_visitor_backup_step01b';
    if (!known) return { status: 'unclassified' };
    var parsed;
    try { parsed = JSON.parse(value); }
    catch (error) { return { status: 'corrupt-json', error: error.message || String(error) }; }
    if (key === MAIN_KEY) {
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'invalid-structure', error: '主状态必须是对象' };
      for (var field of ['chatHistory', 'stickers', 'cardPhrases']) if (parsed[field] !== undefined && !Array.isArray(parsed[field])) return { status: 'invalid-structure', error: field + ' 必须是数组' };
      return { status: 'valid', topLevelKeys: Object.keys(parsed).slice(0, 80) };
    }
    if (key === STICKER_KEY) {
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== 1 || !Array.isArray(parsed.items) || !Array.isArray(parsed.tombstones) || !Array.isArray(parsed.favorites)) return { status: 'invalid-structure', error: '表情索引结构或版本无效' };
      return { status: 'valid', counts: { items: parsed.items.length, tombstones: parsed.tombstones.length, favorites: parsed.favorites.length } };
    }
    if (key === MAILBOX_KEY) {
      try { global.__duoMailbox && global.__duoMailbox.validateData ? global.__duoMailbox.validateData(parsed) : null; }
      catch (error) { return { status: 'invalid-structure', error: error.message || String(error) }; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'invalid-structure', error: '信箱数据必须是对象' };
      return { status: 'valid' };
    }
    if (key === CARD_KEY) {
      try { global.__duoCardSystem && global.__duoCardSystem.validateData ? global.__duoCardSystem.validateData(parsed) : null; }
      catch (error) { return { status: 'invalid-structure', error: error.message || String(error) }; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'invalid-structure', error: '字卡数据必须是对象' };
      return { status: 'valid' };
    }
    try {
      var circleKey = global.__duoCircleApi && global.__duoCircleApi.getStoreKey && global.__duoCircleApi.getStoreKey();
      if (circleKey && key === circleKey) {
        if (!global.__duoCircleApi.validateState) return { status: 'validator-unavailable' };
        global.__duoCircleApi.validateState(parsed);
        return { status: 'valid' };
      }
    } catch (error) { return { status: 'invalid-structure', error: error.message || String(error) }; }
    if (parsed === null || (typeof parsed !== 'object' && typeof parsed !== 'string' && typeof parsed !== 'number' && typeof parsed !== 'boolean')) return { status: 'invalid-structure', error: 'JSON 顶层类型无效' };
    return { status: 'valid' };
  }
  function readLocalStorageReport() {
    var rows = [], failures = [];
    var keys = getKnownKeys();
    keys.forEach(function (key) {
      try {
        var raw = global.localStorage.getItem(key);
        var result = validateKnownValue(key, raw);
        rows.push({ key: key, exists: raw !== null, bytes: raw === null ? 0 : byteLength(raw), status: result.status, error: result.error || null, counts: result.counts || null, topLevelKeys: result.topLevelKeys || null });
      } catch (error) {
        failures.push({ key: key, message: error.message || String(error) });
        rows.push({ key: key, exists: null, bytes: null, status: 'read-error', error: error.message || String(error) });
      }
    });
    return { rows: rows, failures: failures };
  }
  async function inspectDatabases() {
    var result = { supported: !!(global.indexedDB && typeof global.indexedDB.databases === 'function'), rows: [], error: null };
    if (!result.supported) return result;
    try {
      var databases = await global.indexedDB.databases();
      result.rows = (databases || []).map(function (db) { return { name: db.name || '', version: Number(db.version) || 0 }; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    } catch (error) { result.error = error.message || String(error); }
    return result;
  }
  async function inspect() {
    var local = readLocalStorageReport();
    var coordinator = global.__duoRuntimeCoordinator;
    var report = {
      format: 'twodeers-storage-diagnostic', formatVersion: 1, generatedAt: new Date().toISOString(),
      app: { userAgent: global.navigator && global.navigator.userAgent || '', urlOrigin: global.location && global.location.origin || '' },
      coordinator: coordinator && coordinator.getStatus ? coordinator.getStatus() : { supported: false },
      bootIssues: Array.isArray(global.__duoStorageBootIssues) ? global.__duoStorageBootIssues.map(function (item) { return { key: item.key, name: item.name, message: item.message, detectedAt: item.detectedAt }; }) : [],
      localStorage: local,
      storageEstimate: coordinator && coordinator.estimateStorage ? await coordinator.estimateStorage() : { supported: false },
      indexedDB: await inspectDatabases(),
      media: null, fonts: null, recoveryJournal: null,
      warnings: []
    };
    var databaseNames = new Set((report.indexedDB.rows || []).map(function (item) { return item.name; }));
    var mediaDbName = global.__duoMediaStorageDiagnostics && global.__duoMediaStorageDiagnostics.databaseName;
    if (report.indexedDB.supported && mediaDbName && databaseNames.has(mediaDbName) && typeof global.auditMediaStorage === 'function') {
      try {
        var mediaHealth = await global.auditMediaStorage({ cleanup: false });
        var mediaRecords = await global.__duoMediaStorageDiagnostics.readAll();
        var seenMediaIds = new Set(), invalidRecords = [];
        mediaRecords.forEach(function (record) {
          if (!record || typeof record.id !== 'string' || !record.id || seenMediaIds.has(record.id)) { invalidRecords.push({ id: record && record.id || null, reason: 'invalid-or-duplicate-id' }); return; }
          seenMediaIds.add(record.id);
          if (!record.blob || typeof record.blob.arrayBuffer !== 'function' || !Number.isFinite(Number(record.blob.size))) invalidRecords.push({ id: record.id, reason: 'blob-missing-or-invalid' });
          else if (record.size !== undefined && Number(record.size) !== Number(record.blob.size)) invalidRecords.push({ id: record.id, reason: 'size-metadata-mismatch' });
        });
        report.media = { status: 'readable', recordCount: mediaHealth.recordCount, referencedCount: mediaHealth.referencedCount, missingCount: mediaHealth.missingIds.length, missingIds: mediaHealth.missingIds.slice(0, 500), invalidRecords: invalidRecords.slice(0, 500), invalidRecordCount: invalidRecords.length, orphanCandidates: mediaHealth.orphanCandidates, storagePercent: mediaHealth.storage && mediaHealth.storage.percent, checkedAt: mediaHealth.checkedAt };
      } catch (error) { report.media = { status: 'read-error', error: error.message || String(error) }; }
    } else if (report.indexedDB.supported && mediaDbName) {
      var unresolvedRefs = [];
      try { unresolvedRefs = typeof global.referencedMediaIds === 'function' ? Array.from(global.referencedMediaIds()) : []; } catch (error) { report.warnings.push('媒体引用无法完整读取：' + (error.message || String(error))); }
      report.media = { status: 'absent', recordCount: 0, referencedCount: unresolvedRefs.length, missingCount: unresolvedRefs.length, missingIds: unresolvedRefs.slice(0, 500), invalidRecordCount: 0 };
    } else { report.media = { status: 'existence-unverifiable' }; report.warnings.push('当前浏览器不能安全枚举现有 IndexedDB；媒体数据库只读检查未启动，避免创建空数据库'); }
    var fontDbName = global.ChuanXunFontManager && global.ChuanXunFontManager._dbName;
    if (report.indexedDB.supported && fontDbName && !databaseNames.has(fontDbName)) report.fonts = { status: 'absent', count: 0, totalBytes: 0, currentFontExists: null };
    else if (!report.indexedDB.supported) { report.fonts = { status: 'existence-unverifiable' }; report.warnings.push('当前浏览器不能安全确认字体数据库是否存在，未尝试打开以避免创建空数据库'); }
    else if (global.ChuanXunFontManager && global.ChuanXunFontManager.exportData) {
      try {
        var fonts = await global.ChuanXunFontManager.exportData();
        var fontRows = Array.isArray(fonts.fonts) ? fonts.fonts : [];
        report.fonts = { status: 'readable', count: fontRows.length, totalBytes: fontRows.reduce(function (sum, item) { return sum + (Number(item.size) || 0); }, 0), currentFontExists: !fonts.currentFontId || fontRows.some(function (item) { return item.id === fonts.currentFontId; }) };
        if (global.ChuanXunFontManager.validateData) {
          try { await global.ChuanXunFontManager.validateData(fonts); report.fonts.binaryValidation = 'passed'; }
          catch (error) { report.fonts.binaryValidation = 'failed'; report.fonts.validationError = error.message || String(error); }
        }
      } catch (error) { report.fonts = { status: 'read-error', error: error.message || String(error) }; }
    } else report.fonts = { status: 'unavailable' };
    var journalDbName = coordinator && coordinator.journalDatabaseName;
    if (report.indexedDB.supported && journalDbName && !databaseNames.has(journalDbName)) report.recoveryJournal = { status: 'absent' };
    else if (!report.indexedDB.supported) { report.recoveryJournal = { status: 'existence-unverifiable' }; report.warnings.push('当前浏览器不能安全确认恢复日志数据库是否存在，未尝试创建或打开新库'); }
    else if (coordinator && coordinator.readRecoveryJournal) {
      try {
        var journal = await coordinator.readRecoveryJournal();
        report.recoveryJournal = journal ? { status: 'present', id: journal.id || '', phase: journal.phase || '', kind: journal.kind || '', createdAt: journal.createdAt || null, mediaSnapshotCount: Array.isArray(journal.oldMedia) ? journal.oldMedia.length : null, hasFontSnapshot: !!journal.oldFonts, hasMailboxSnapshot: !!journal.oldMailbox, hasCardSnapshot: !!journal.oldCards } : { status: 'absent' };
      } catch (error) { report.recoveryJournal = { status: 'read-error', error: error.message || String(error) }; }
    } else report.recoveryJournal = { status: 'unavailable' };
    return report;
  }
  function downloadBlob(name, blob) {
    var url = global.URL.createObjectURL(blob), link = global.document.createElement('a');
    link.href = url; link.download = name; link.style.display = 'none';
    global.document.body.appendChild(link); link.click(); link.remove();
    global.setTimeout(function () { try { global.URL.revokeObjectURL(url); } catch (_) {} }, 10000);
    return true;
  }
  async function exportReport() {
    var report = await inspect();
    var blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob('twodeers-storage-diagnostic-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json', blob);
    return report;
  }
  function makeBudget() { return { blobBytes: 0, rawBytes: 0, rawJsonBytes: 0, omissions: [], blobCache: new WeakMap(), binaryCache: new WeakMap() }; }
  async function blobToDataUrl(blob, budget, label) {
    if (!blob || typeof blob.arrayBuffer !== 'function' || !Number.isFinite(Number(blob.size))) throw new Error('不可读取的 Blob：' + label);
    if (budget.blobCache.has(blob)) return budget.blobCache.get(blob);
    var size = Number(blob.size) || 0;
    if (budget.blobBytes + size > MAX_BLOB_EXPORT_BYTES) {
      budget.omissions.push({ path: label, reason: 'binary-export-budget-exceeded', bytes: size });
      return null;
    }
    var bytes = new Uint8Array(await blob.arrayBuffer());
    var binary = '';
    for (var offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
    var encoded = 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + global.btoa(binary);
    budget.blobBytes += size;
    budget.blobCache.set(blob, encoded);
    return encoded;
  }
  async function encodeTree(value, budget, label, seen) {
    if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'function') return undefined;
    if (typeof value.arrayBuffer === 'function' && typeof value.size === 'number' && typeof value.type === 'string') {
      var dataUrl = await blobToDataUrl(value, budget, label);
      return dataUrl ? { __type: 'Blob', type: value.type, size: value.size, dataUrl: dataUrl } : { __type: 'Blob', type: value.type, size: value.size, omitted: true };
    }
    var binaryView = value instanceof ArrayBuffer ? new Uint8Array(value) : (ArrayBuffer.isView && ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : null);
    if (binaryView) {
      if (budget.binaryCache.has(value)) return budget.binaryCache.get(value);
      if (budget.blobBytes + binaryView.byteLength > MAX_BLOB_EXPORT_BYTES) {
        budget.omissions.push({ path: label, reason: 'binary-export-budget-exceeded', bytes: binaryView.byteLength });
        var omittedBinary = { __type: value instanceof ArrayBuffer ? 'ArrayBuffer' : 'ArrayBufferView', byteLength: binaryView.byteLength, omitted: true };
        budget.binaryCache.set(value, omittedBinary);
        return omittedBinary;
      }
      var binary = '';
      for (var i = 0; i < binaryView.length; i += 0x8000) binary += String.fromCharCode.apply(null, binaryView.subarray(i, Math.min(i + 0x8000, binaryView.length)));
      budget.blobBytes += binaryView.byteLength;
      var encodedBinary = { __type: value instanceof ArrayBuffer ? 'ArrayBuffer' : 'ArrayBufferView', byteLength: binaryView.byteLength, base64: global.btoa(binary) };
      budget.binaryCache.set(value, encodedBinary);
      return encodedBinary;
    }
    if (typeof value !== 'object') return text(value);
    seen = seen || new WeakSet();
    if (seen.has(value)) return { __type: 'CircularReference' };
    seen.add(value);
    if (Array.isArray(value)) {
      var outArray = [];
      for (var index = 0; index < value.length; index++) outArray.push(await encodeTree(value[index], budget, label + '[' + index + ']', seen));
      return outArray;
    }
    var out = {};
    for (var key of Object.keys(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      var encoded = await encodeTree(value[key], budget, label + '.' + key, seen);
      if (encoded !== undefined) out[key] = encoded;
    }
    return out;
  }
  async function exportRecoverable() {
    var report = await inspect();
    var budget = makeBudget();
    var localStorageRows = [], keys = getKnownKeys();
    for (var key of keys) {
      try {
        var raw = global.localStorage.getItem(key);
        if (raw === null) continue;
        var bytes = byteLength(raw);
        var row = { key: key, raw: raw, parseStatus: validateKnownValue(key, raw).status };
        var jsonBytes = byteLength(JSON.stringify(row));
        if (budget.rawBytes + bytes > MAX_RAW_LOCAL_BYTES || budget.rawJsonBytes + jsonBytes > MAX_RAW_LOCAL_JSON_BYTES) {
          budget.omissions.push({ path: 'localStorage.' + key, reason: 'raw-localStorage-budget-exceeded', bytes: bytes, jsonBytes: jsonBytes });
          localStorageRows.push({ key: key, omitted: true, bytes: bytes, jsonBytes: jsonBytes });
          continue;
        }
        budget.rawBytes += bytes;
        budget.rawJsonBytes += jsonBytes;
        localStorageRows.push(row);
      } catch (error) { budget.omissions.push({ path: 'localStorage.' + key, reason: 'read-error', message: error.message || String(error) }); }
    }
    var payload = { format: 'twodeers-recovery-salvage', formatVersion: 1, generatedAt: new Date().toISOString(), importableAsBackup: false, complete: true, diagnosticReport: report, localStorageRaw: localStorageRows, mediaRecords: [], fontLibrary: null, recoveryJournal: null, omissions: [] };
    var mediaDbPresent = report.indexedDB.supported && global.__duoMediaStorageDiagnostics && (report.indexedDB.rows || []).some(function (item) { return item.name === global.__duoMediaStorageDiagnostics.databaseName; });
    if (mediaDbPresent && global.__duoMediaStorageDiagnostics && global.__duoMediaStorageDiagnostics.readAll) {
      try {
        var records = await global.__duoMediaStorageDiagnostics.readAll();
        var seenMedia = new Set();
        for (var record of records) {
          if (!record || typeof record.id !== 'string' || !record.id || seenMedia.has(record.id)) { budget.omissions.push({ path: 'mediaRecords', reason: 'invalid-or-duplicate-record-id' }); continue; }
          seenMedia.add(record.id);
          var media = { id: record.id, kind: record.kind || '', mimeType: record.mimeType || record.blob && record.blob.type || '', name: record.name || '', size: Number(record.size) || record.blob && record.blob.size || 0, createdAt: Number(record.createdAt) || 0 };
          if (record.blob) media.blob = await encodeTree(record.blob, budget, 'mediaRecords.' + record.id);
          else { media.blob = null; budget.omissions.push({ path: 'mediaRecords.' + record.id, reason: 'blob-missing' }); }
          payload.mediaRecords.push(media);
        }
      } catch (error) { budget.omissions.push({ path: 'mediaRecords', reason: 'read-error', message: error.message || String(error) }); }
    } else if (!report.indexedDB.supported) budget.omissions.push({ path: 'mediaRecords', reason: 'database-existence-unverifiable' });
    var fontDbPresent = report.indexedDB.supported && global.ChuanXunFontManager && (report.indexedDB.rows || []).some(function (item) { return item.name === global.ChuanXunFontManager._dbName; });
    if (fontDbPresent && global.ChuanXunFontManager.exportData) {
      try { payload.fontLibrary = await encodeTree(await global.ChuanXunFontManager.exportData(), budget, 'fontLibrary'); }
      catch (error) { budget.omissions.push({ path: 'fontLibrary', reason: 'read-error', message: error.message || String(error) }); }
    } else if (!report.indexedDB.supported) budget.omissions.push({ path: 'fontLibrary', reason: 'database-existence-unverifiable' });
    var journalDbPresent = report.indexedDB.supported && global.__duoRuntimeCoordinator && (report.indexedDB.rows || []).some(function (item) { return item.name === global.__duoRuntimeCoordinator.journalDatabaseName; });
    if (journalDbPresent && global.__duoRuntimeCoordinator.readRecoveryJournal) {
      try {
        var journal = await global.__duoRuntimeCoordinator.readRecoveryJournal();
        if (journal) payload.recoveryJournal = await encodeTree(journal, budget, 'recoveryJournal');
      } catch (error) { budget.omissions.push({ path: 'recoveryJournal', reason: 'read-error', message: error.message || String(error) }); }
    } else if (!report.indexedDB.supported) budget.omissions.push({ path: 'recoveryJournal', reason: 'database-existence-unverifiable' });
    payload.omissions = budget.omissions;
    payload.complete = budget.omissions.length === 0;
    payload.exportedBinaryBytes = budget.blobBytes;
    payload.exportedRawLocalStorageBytes = budget.rawBytes;
    payload.exportedRawLocalStorageJsonBytes = budget.rawJsonBytes;
    var output = new Blob([JSON.stringify(payload)], { type: 'application/json;charset=utf-8' });
    if (output.size > MAX_JSON_EXPORT_BYTES) throw new Error('可恢复数据导出超过 220 MB 安全上限；诊断报告已可单独导出，请优先使用标准 V4 备份或分批处理媒体数据');
    downloadBlob('twodeers-recovery-salvage-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json', output);
    return { complete: payload.complete, omitted: payload.omissions.length, bytes: output.size, blobBytes: budget.blobBytes, rawBytes: budget.rawBytes };
  }
  var api = { inspect: inspect, exportReport: exportReport, exportRecoverable: exportRecoverable, _validateKnownValue: validateKnownValue };
  global.__duoStorageDiagnostics = api;
  if (global.document) {
    var inspectButton = global.document.getElementById('storageDiagnosticsBtn');
    var reportButton = global.document.getElementById('storageReportExportBtn');
    var salvageButton = global.document.getElementById('storageSalvageExportBtn');
    if (inspectButton) inspectButton.addEventListener('click', async function () {
      inspectButton.disabled = true; setStatus('正在只读检查本地数据……');
      try {
        var result = await inspect();
        var damaged = result.localStorage.rows.filter(function (row) { return ['corrupt-json', 'invalid-structure', 'read-error'].includes(row.status); }).length;
        var mediaMissing = result.media && result.media.missingCount || 0;
        var blocked = result.coordinator && result.coordinator.blocked;
        setStatus('检查完成：' + damaged + ' 项本地记录异常，' + mediaMissing + ' 条媒体引用缺失。' + (blocked ? ' 当前已锁定写入。' : ' 未发现启动锁定。'));
      } catch (error) { setStatus('检查失败：' + (error.message || error), true); }
      finally { inspectButton.disabled = false; }
    });
    if (reportButton) reportButton.addEventListener('click', async function () {
      reportButton.disabled = true; setStatus('正在生成不含消息正文的诊断报告……');
      try { await exportReport(); setStatus('诊断报告已下载。报告只包含键名、大小、校验状态和错误摘要，不包含聊天正文。'); }
      catch (error) { setStatus('诊断报告导出失败：' + (error.message || error), true); }
      finally { reportButton.disabled = false; }
    });
    if (salvageButton) salvageButton.addEventListener('click', async function () {
      if (typeof global.confirm === 'function' && !global.confirm('可恢复资料包含本站 localStorage 原文、聊天内容以及媒体/字体二进制，可能包含隐私信息。请勿公开分享。此文件不是可直接导入的备份。仍要导出吗？')) return;
      salvageButton.disabled = true; setStatus('正在读取原始存储和可恢复媒体；不会修改或删除数据……');
      try {
        var result = await exportRecoverable();
        setStatus('可恢复资料已下载（' + Math.round(result.bytes / 1024 / 1024) + ' MB）。' + (result.complete ? '未发现导出遗漏。' : '有 ' + result.omitted + ' 项未能纳入，文件内已逐项列出；这不是可直接导入的备份。'));
      } catch (error) { setStatus('可恢复资料导出失败：' + (error.message || error), true); }
      finally { salvageButton.disabled = false; }
    });
  }
})(window);
