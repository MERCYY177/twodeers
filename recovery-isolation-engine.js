/* Copy-on-write isolated reconstruction for independently validated candidates.
 * The embedded original candidate ZIP stays byte-for-byte intact. Only a full
 * localStorageRaw snapshot and explicitly reviewed candidate notes are added.
 * This module exposes no application restore/apply path and never touches app storage.
 */
(function (global) {
  'use strict';
  if (global.__duoRecoveryIsolationEngineInstalled) return;
  global.__duoRecoveryIsolationEngineInstalled = true;
  var MAX_LOCAL_STORAGE_JSON_BYTES = 64 * 1024 * 1024;
  var MAX_BUNDLE_BYTES = 200 * 1024 * 1024;
  var REVISION_KEY = '__twodeers_runtime_revision_v1';

  function fail(message) { throw new Error(message); }
  function cloneJson(value) { return JSON.parse(JSON.stringify(value)); }
  function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function utf8(value) { return new TextEncoder().encode(String(value)); }
  function exactRows(payload, key) { return payload.localStorageRaw.filter(function (row) { return row && row.key === key; }); }
  function validateLogicalSnapshot(payload) {
    if (!isObject(payload) || !Array.isArray(payload.localStorageRaw) || !Array.isArray(payload.mediaRecords) || !Array.isArray(payload.omissions)) fail('隔离副本结构不完整');
    var keys = new Set();
    payload.localStorageRaw.forEach(function (row) {
      if (!isObject(row) || typeof row.key !== 'string' || !row.key || typeof row.raw !== 'string' || keys.has(row.key)) fail('隔离副本 localStorage 键缺失、结构无效或重复');
      keys.add(row.key);
    });
    var mediaIds = new Set();
    payload.mediaRecords.forEach(function (record) {
      if (!isObject(record) || typeof record.id !== 'string' || !record.id || mediaIds.has(record.id) || !isObject(record.blob) || record.blob.__type !== 'Blob') fail('隔离副本媒体 ID 或二进制结构无效');
      mediaIds.add(record.id);
    });
    var fonts = payload.fontLibrary && Array.isArray(payload.fontLibrary.fonts) ? payload.fontLibrary.fonts : [];
    var fontIds = new Set();
    fonts.forEach(function (font) {
      if (!isObject(font) || typeof font.id !== 'string' || !font.id || fontIds.has(font.id) || !isObject(font.blob) || font.blob.__type !== 'Blob') fail('隔离副本字体 ID 或二进制结构无效');
      fontIds.add(font.id);
    });
    if (payload.fontLibrary && payload.fontLibrary.currentFontId && !fontIds.has(payload.fontLibrary.currentFontId)) fail('隔离副本当前字体指针缺失');
    return { localStorageKeys: keys.size, mediaRecords: mediaIds.size, fonts: fontIds.size, recoveryJournal: !!payload.recoveryJournal };
  }
  function applyInMemoryOperations(payload, validation, includeOperations) {
    var approved = Array.isArray(validation.approvedOperations) ? validation.approvedOperations : [];
    if (!includeOperations || !approved.length) return { applied: [], deferred: approved.map(function (item) { return { key: item.key, reason: '未勾选应用到隔离副本；原始内容保持不变' }; }) };
    if (validation.manifest.status !== 'ready-for-independent-validation') fail('候选包状态为 review-required；不得把候选覆盖写入隔离重建副本');
    if (approved.length !== 1 || approved[0].key !== REVISION_KEY || approved[0].after !== '0' || approved[0].requiresIndependentReview !== true) fail('隔离引擎只识别经过独立校验的运行时版本计数候选');
    var rows = exactRows(payload, REVISION_KEY);
    if (rows.length !== 1 || rows[0].raw !== approved[0].before) fail('隔离副本中的运行时版本计数与已验证候选不一致');
    var beforeBytes = utf8(rows[0].raw).byteLength;
    rows[0].raw = '0';
    return { applied: [{ key: REVISION_KEY, beforeBytes: beforeBytes, after: '0', scope: 'isolated-copy-only', preconditions: approved[0].preconditions.slice() }], deferred: [] };
  }
  function createManifest(validation, copy, localStorageBlob, baseCrc, baseBytes, changes) {
    var status = validation.manifest.status === 'ready-for-independent-validation' ? 'isolated-preview-built' : 'review-required';
    return {
      format: 'twodeers-isolated-reconstruction', formatVersion: 1,
      importableAsBackup: false, writesPerformed: false, promotable: false,
      status: status,
      base: { entry: 'base/twodeers-recovery-candidate.zip', bytes: baseBytes, crc32: baseCrc, sourceSha256: validation.report.sourceSha256 },
      reconstruction: {
        strategy: 'copy-on-write-localStorage-overlay',
        localStorageEntry: 'isolated/localStorageRaw.json',
        localStorageRecordCount: copy.localStorageRaw.length,
        localStorageBytes: localStorageBlob.size,
        mediaAndFonts: 'inherited byte-for-byte from the embedded base candidate; not rewritten',
        recoveryJournal: 'inherited unchanged from the embedded base candidate'
      },
      changes: changes,
      guardrails: [
        'This package is not a standard backup and cannot be imported through V4 or legacy restore.',
        'The embedded Phase 14 candidate ZIP is preserved as the immutable base.',
        'The isolated localStorage snapshot replaces the base payload localStorageRaw only when independently interpreted by a future recovery tool.',
        'Any candidate operation recorded as applied was applied only to an in-memory clone for this package; no live application database was written.',
        'Media, fonts, mailbox, sticker data, Circle data and recovery journal are not normalized or repaired.',
        'The package is not promotable; human review and a separate restore implementation remain required.'
      ]
    };
  }
  async function buildBundle(validation, options) {
    options = options || {};
    if (!validation || validation.ok !== true || !validation.report || validation.report.verified !== true || !validation.archiveBlob || !validation.payload || !validation.manifest) fail('必须先完成候选 ZIP 独立校验');
    var payloadCopy = cloneJson(validation.payload);
    var beforeSignature = JSON.stringify(payloadCopy.localStorageRaw);
    var changes = applyInMemoryOperations(payloadCopy, validation, options.includeValidatedCandidateOperations === true);
    var counts = validateLogicalSnapshot(payloadCopy);
    var localStorageText = JSON.stringify(payloadCopy.localStorageRaw, null, 2);
    var localStorageBlob = new Blob([localStorageText], { type: 'application/json;charset=utf-8' });
    if (localStorageBlob.size > MAX_LOCAL_STORAGE_JSON_BYTES) fail('隔离副本 localStorage 快照超过 64 MiB；未生成输出文件');
    var sourceRows = validation.payload.localStorageRaw;
    if (options.includeValidatedCandidateOperations !== true && JSON.stringify(payloadCopy.localStorageRaw) !== JSON.stringify(sourceRows)) fail('未勾选候选操作时，隔离副本不得改变任何 localStorage 原文');
    if (changes.applied.length) {
      var changed = payloadCopy.localStorageRaw.filter(function (row, index) { return row.raw !== sourceRows[index].raw || row.key !== sourceRows[index].key; });
      if (changed.length !== 1 || changed[0].key !== REVISION_KEY || changed[0].raw !== '0') fail('隔离副本出现超出白名单的 localStorage 变更');
    }
    var baseZip = validation.archiveBlob;
    var validator = global.__duoRecoveryCandidateValidator;
    var zipBuilder = global.__duoRecoveryCandidateZip;
    if (!validator || typeof validator.crc32Blob !== 'function' || typeof validator.sha256Blob !== 'function' || !zipBuilder || typeof zipBuilder.buildStoredZip !== 'function') fail('独立校验器或 ZIP 输出组件未加载');
    var baseCrc = zipBuilder.crc32Hex(await validator.crc32Blob(baseZip));
    var baseSha = await validator.sha256Blob(baseZip);
    var changesBlob = new Blob([JSON.stringify({ format: 'twodeers-isolated-changes', version: 1, applied: changes.applied, deferred: changes.deferred, writesPerformed: false }, null, 2)], { type: 'application/json;charset=utf-8' });
    var report = {
      format: 'twodeers-isolated-validation-report', formatVersion: 1,
      verifiedBaseCandidate: true, writesPerformed: false, importableAsBackup: false, promotable: false,
      candidateStatus: validation.manifest.status,
      baseCandidateBytes: baseZip.size, baseCandidateCrc32: baseCrc, baseCandidateSha256: baseSha,
      sourceSha256: validation.report.sourceSha256,
      sourceInventory: validation.report.sourceInventory,
      reconstructedInventory: counts,
      appliedOperationCount: changes.applied.length,
      deferredOperationCount: changes.deferred.length,
      localStorageBeforeAndAfterSignatureEqual: changes.applied.length === 0 && beforeSignature === JSON.stringify(payloadCopy.localStorageRaw),
      validationNotes: [
        'This is a copy-on-write logical reconstruction. The original candidate archive is embedded unchanged.',
        'localStorageRaw is a complete isolated snapshot. The source media/font/journal sections remain in the embedded base archive.',
        'No localStorage, IndexedDB, Web Storage, media database or font database in the running application was opened for writing.',
        'A passing report does not mean the data is safe to import or that application-level semantics are fully restored.'
      ]
    };
    var reportBlob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
    var manifest = createManifest(validation, payloadCopy, localStorageBlob, baseCrc, baseZip.size, changes);
    manifest.base.sha256 = baseSha;
    var manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json;charset=utf-8' });
    var readmeBlob = new Blob([[
      'Twodeers 隔离重建包（Phase 15）\n',
      '================================\n\n',
      '不是 V4/旧版备份，不可直接导入。\n',
      'base/twodeers-recovery-candidate.zip 是原候选 ZIP 的逐字节副本。\n',
      'isolated/localStorageRaw.json 是隔离副本的完整 localStorage 原文快照。\n',
      'isolated/changes.json 记录仅应用于内存副本的候选变更。\n',
      'validation/report.json 和 isolated/manifest.json 记录独立校验结果。\n\n',
      '媒体、字体、信箱、朋友圈、表情、字卡和恢复日志保持在基础候选包内，不被重写。\n',
      '此包不可提升为可导入状态，必须由后续独立恢复工具人工复核。\n',
      '源文件可能包含聊天正文、附件和私人数据，请只保存在可信设备。\n'
    ].join('')], { type: 'text/plain;charset=utf-8' });
    var entries = [
      { name: 'base/twodeers-recovery-candidate.zip', blob: baseZip },
      { name: 'isolated/localStorageRaw.json', blob: localStorageBlob },
      { name: 'isolated/changes.json', blob: changesBlob },
      { name: 'validation/report.json', blob: reportBlob },
      { name: 'isolated/manifest.json', blob: manifestBlob },
      { name: 'README.txt', blob: readmeBlob }
    ];
    var result = await zipBuilder.buildStoredZip(entries, MAX_BUNDLE_BYTES);
    var finalInspection = await validator.inspectStoredZip(result.blob, MAX_BUNDLE_BYTES);
    var expectedPaths = entries.map(function (entry) { return entry.name; }).sort();
    var actualPaths = finalInspection.entries.map(function (entry) { return entry.path; }).sort();
    if (expectedPaths.length !== actualPaths.length || expectedPaths.some(function (name, index) { return name !== actualPaths[index]; })) fail('隔离重建包二次 ZIP 结构检查失败');
    var reconciled = [];
    for (var expectedEntry of entries) {
      var actualEntry = finalInspection.entries.find(function (entry) { return entry.path === expectedEntry.name; });
      if (!actualEntry) fail('隔离重建包缺少内存副本条目：' + expectedEntry.name);
      var expectedCrc = expectedEntry.name === 'base/twodeers-recovery-candidate.zip' ? baseCrc : zipBuilder.crc32Hex(await validator.crc32Blob(expectedEntry.blob));
      var expectedSha = expectedEntry.name === 'base/twodeers-recovery-candidate.zip' ? baseSha : await validator.sha256Blob(expectedEntry.blob);
      if (actualEntry.bytes !== expectedEntry.blob.size || actualEntry.crc32 !== expectedCrc || actualEntry.sha256 !== expectedSha) fail('隔离重建包条目与内存副本逐项校验不一致：' + expectedEntry.name);
      reconciled.push({ path: expectedEntry.name, bytes: actualEntry.bytes, crc32: actualEntry.crc32, sha256: actualEntry.sha256, matchesExpectedBytes: true });
    }
    finalInspection.reconciled = true;
    finalInspection.reconciliation = reconciled;
    return { blob: result.blob, bytes: result.bytes, entries: result.entries.length, manifest: manifest, report: report, inspection: finalInspection };
  }
  global.__duoRecoveryIsolationEngine = {
    buildBundle: buildBundle,
    maxLocalStorageBytes: MAX_LOCAL_STORAGE_JSON_BYTES,
    maxBundleBytes: MAX_BUNDLE_BYTES
  };
})(window);

(function (global) {
  'use strict';
  if (!global.document) return;
  var elements = function (id) { return global.document.getElementById(id); };
  var input = elements('recoveryIsolationFile');
  var validateButton = elements('recoveryIsolationValidateBtn');
  var buildButton = elements('recoveryIsolationBuildBtn');
  var includeToggle = elements('recoveryIsolationIncludeRevision');
  var status = elements('recoveryIsolationStatus');
  var output = elements('recoveryIsolationOutput');
  var selectedFile = null;
  var validated = null;
  function setStatus(message, error) {
    if (status) { status.textContent = message; if (status.dataset) status.dataset.state = error ? 'error' : 'ok'; }
  }
  function reset() {
    selectedFile = input && input.files && input.files[0] || null;
    validated = null;
    if (buildButton) buildButton.disabled = true;
    if (includeToggle) { includeToggle.checked = false; includeToggle.disabled = true; }
    if (output) output.textContent = '请选择第十四阶段候选 ZIP，然后执行独立校验。';
    setStatus('已选择新文件；必须重新执行独立校验。', false);
  }
  if (input) input.addEventListener('change', reset);
  if (validateButton) validateButton.addEventListener('click', async function () {
    selectedFile = input && input.files && input.files[0] || null;
    validated = null;
    if (buildButton) buildButton.disabled = true;
    if (!selectedFile) { setStatus('请先选择候选 ZIP。', true); return; }
    validateButton.disabled = true;
    setStatus('正在独立读取 ZIP 目录、条目、清单和源数据；不会连接当前应用数据库……', false);
    try {
      var validator = global.__duoRecoveryCandidateValidator;
      if (!validator || typeof validator.validateFile !== 'function') throw new Error('候选包独立校验器未加载');
      validated = await validator.validateFile(selectedFile);
      if (includeToggle) {
        var available = validated.approvedOperations.length === 1 && validated.manifest.status === 'ready-for-independent-validation';
        includeToggle.disabled = !available; includeToggle.checked = false;
      }
      if (buildButton) buildButton.disabled = false;
      if (output) output.textContent = JSON.stringify(validated.report, null, 2);
      setStatus('独立校验完成：' + validated.report.entryCount + ' 个 ZIP 条目、源 SHA-256 和 manifest 清单已重新核对。状态：' + validated.manifest.status + '。未写入当前空间。', false);
    } catch (error) {
      validated = null;
      setStatus(error.message || String(error), true);
      if (output) output.textContent = '独立校验失败。不会生成隔离副本。\n' + (error.message || String(error));
    } finally { validateButton.disabled = false; }
  });
  if (buildButton) buildButton.addEventListener('click', async function () {
    if (!validated || !selectedFile || input && input.files && input.files[0] !== selectedFile) { setStatus('文件选择已变化或未完成校验；请重新校验。', true); return; }
    var include = !!(includeToggle && includeToggle.checked);
    var message = '隔离重建包将包含完整候选 ZIP 和 localStorage 原文快照，可能包含聊天正文及个人隐私。它不是可导入备份，也不会修改当前空间。' + (include ? '你已选择把运行时版本计数候选仅应用于内存副本。' : '不会应用任何候选操作。') + '继续生成并保存到可信设备？';
    if (typeof global.confirm !== 'function' || !global.confirm(message)) { setStatus('已取消隔离重建包生成。', false); return; }
    buildButton.disabled = true;
    setStatus('正在复制到内存隔离副本、验证允许的差异并生成 ZIP……', false);
    try {
      var engine = global.__duoRecoveryIsolationEngine;
      if (!engine || typeof engine.buildBundle !== 'function') throw new Error('隔离重建引擎未加载');
      var result = await engine.buildBundle(validated, { includeValidatedCandidateOperations: include });
      var url = global.URL.createObjectURL(result.blob);
      var link = global.document.createElement('a');
      link.href = url;
      link.download = 'twodeers-isolated-reconstruction-' + new Date().toISOString().replace(/[:.]/g, '-') + '.zip';
      link.style.display = 'none'; global.document.body.appendChild(link); link.click(); link.remove();
      global.setTimeout(function () { try { global.URL.revokeObjectURL(url); } catch (_) {} }, 15000);
      if (output) output.textContent = JSON.stringify({ manifest: result.manifest, validation: result.report, finalZipInspection: result.inspection }, null, 2);
      setStatus('隔离重建包已生成（' + (result.bytes / 1024 / 1024).toFixed(2) + ' MiB，' + result.entries + ' 个条目）。仍不可导入、不可提升；当前空间未写入。', false);
    } catch (error) { setStatus(error.message || String(error), true); }
    finally { buildButton.disabled = !validated; }
  });
})(window);
