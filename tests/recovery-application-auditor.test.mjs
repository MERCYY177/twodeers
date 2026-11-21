import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const sources = {
  zip: read('recovery-candidate-package.js'), validator: read('recovery-candidate-validator.js'),
  workbench: read('recovery-workbench.js'), engine: read('recovery-isolation-engine.js'),
  auditor: read('recovery-application-auditor.js')
};
const executable = sources.auditor.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
assert.doesNotMatch(executable, /global\.(?:localStorage|indexedDB)|\b(?:localStorage|indexedDB)\s*\.\s*(?:setItem|removeItem|open|deleteDatabase)/, 'application auditor must never access application storage');
assert.doesNotMatch(executable, /applyRestore|promoteCandidate|restoreIntoApplication/, 'application auditor must not expose a live restore path');

function makeEnv(withUi = false) {
  const elements = new Map();
  const ids = ['recoveryApplicationAuditFile','recoveryApplicationAuditBtn','recoveryApplicationAuditExportBtn','recoveryApplicationAuditStatus','recoveryApplicationAuditOutput'];
  for (const id of ids) elements.set(id, {
    id, disabled: id === 'recoveryApplicationAuditExportBtn', files: [], dataset: {}, textContent: '', listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; }
  });
  let downloads = 0;
  const createdUrls = new Map();
  const document = withUi ? {
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) { assert.equal(tag, 'a'); return { href: '', download: '', style: {}, click() { downloads++; }, remove() {} }; },
    body: { appendChild() {} }
  } : undefined;
  const window = { Blob, TextEncoder, TextDecoder, crypto: webcrypto };
  if (withUi) {
    window.document = document;
    window.confirm = () => true;
    window.URL = { createObjectURL(blob) { const url = 'blob:audit:' + createdUrls.size; createdUrls.set(url, blob); return url; }, revokeObjectURL() {} };
    window.setTimeout = () => 0;
  }
  const context = { window, Blob, TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, Date, Number, String, Set, Map, Object, Array, JSON, Error, RegExp, Promise, Math, crypto: webcrypto };
  vm.runInNewContext(sources.zip, context, { filename: 'recovery-candidate-package.js' });
  vm.runInNewContext(sources.validator, context, { filename: 'recovery-candidate-validator.js' });
  vm.runInNewContext(sources.workbench, context, { filename: 'recovery-workbench.js' });
  vm.runInNewContext(sources.engine, context, { filename: 'recovery-isolation-engine.js' });
  vm.runInNewContext(sources.auditor, context, { filename: 'recovery-application-auditor.js' });
  return { window, context, elements, createdUrls, get downloads() { return downloads; } };
}

const blobObject = (value, type) => ({ __type: 'Blob', type, size: Buffer.byteLength(value), dataUrl: `data:${type};base64,${Buffer.from(value).toString('base64')}` });
function buildPayload(options = {}) {
  const chatPhrase = options.cardDrift ? '旧版主字卡' : '主字卡';
  const cardPhrase = '主字卡';
  const circleDynamic = options.cardDrift ? '动态旧文本' : '动态字卡';
  const cardDynamic = '动态字卡';
  const circleReply = '回复字卡';
  const main = {
    chatHistory: [{ id: 'message-1', type: 'image', mediaId: options.missingChatMedia ? 'missing-chat-media' : 'chat-media', text: 'SECRET_CHAT_BODY_DO_NOT_EXPORT' }],
    stickers: [], stickerFavorites: ['sticker-1'], stickerTombstones: [],
    cardPhrases: [chatPhrase], cardUsageOutbox: []
  };
  const card = {
    version: 1, chatIds: ['chat-card-1'], chatTexts: [cardPhrase],
    momentsDynamicIds: ['circle-dynamic-1'], momentsDynamicTexts: [cardDynamic],
    momentsReplyIds: ['circle-reply-1'], momentsReplyTexts: [circleReply],
    recentDrawnRepliesV1: [], appliedEventIds: [], cardUsageOutbox: [], chatUsageOutbox: [], circleUsageOutbox: [], mailboxUsageOutbox: []
  };
  const circle = {
    myAvatar: 'idb-media:circle-media', otherAvatar: '', myCover: '', otherCover: '',
    posts: [{ id: 'post-1', media: [{ src: 'idb-media:circle-media' }] }],
    dynamicCards: [circleDynamic], replyCards: [circleReply]
  };
  const mailbox = { version: 1, items: [{ id: 'letter-1', type: 'outgoing', images: [{ id: 'mail-media', name: '附件', mimeType: 'image/png', size: 4 }] }], pending: options.orphanPending ? [{ id: 'pending-1', type: 'reply', sourceId: 'missing-letter', due: 1 }] : [], usageOutbox: [], recentCardKeys: [], settings: {} };
  const sticker = { version: 1, revision: 1, items: [{ id: 'sticker-1', mediaId: 'sticker-media', source: 'upload', name: '上传表情' }], tombstones: [], favorites: ['sticker-1'] };
  const rows = [
    { key: '__twodeers_runtime_revision_v1', raw: 'NaN', parseStatus: 'unclassified' },
    { key: 'dual_space_app_clean_test_v1', raw: JSON.stringify(main), parseStatus: 'valid' },
    { key: 'dual_space_sticker_library_v1', raw: JSON.stringify(sticker), parseStatus: 'valid' },
    { key: 'twodeers_mailbox_letters_v1', raw: JSON.stringify(mailbox), parseStatus: 'valid' },
    { key: 'twodeers_card_system_v1', raw: JSON.stringify(card), parseStatus: 'valid' },
    { key: 'moments_site_blank_v49_rebuild_baseline_same_layout', raw: JSON.stringify(circle), parseStatus: 'valid' }
  ];
  const media = [
    ['chat-media', 'chat', 'image/png'], ['sticker-media', 'sticker', 'image/png'],
    ['mail-media', 'mail', 'image/png'], ['circle-media', 'circle', 'image/png']
  ].map(([id, body, type]) => ({ id, kind: 'image', mimeType: type, size: Buffer.byteLength(body), blob: blobObject(body, type) }));
  const fontBody = 'font-bytes';
  return {
    format: 'twodeers-recovery-salvage', formatVersion: 1, importableAsBackup: false,
    generatedAt: new Date(0).toISOString(), complete: true, omissions: [],
    diagnosticReport: { format: 'twodeers-storage-diagnostic', formatVersion: 1, localStorage: { rows: rows.map((row) => ({ key: row.key, status: 'valid' })) }, media: { missingCount: 0, missingIds: [] } },
    localStorageRaw: rows, mediaRecords: media,
    fontLibrary: { currentFontId: options.fontPointerMissing ? 'missing-font' : 'font-1', fonts: [{ id: 'font-1', family: 'Test Font', mimeType: 'font/woff2', size: Buffer.byteLength(fontBody), blob: blobObject(fontBody, 'font/woff2') }] },
    recoveryJournal: null
  };
}

async function makeCandidate(env, payload, selectRevisionOperation = false, options = {}) {
  const preview = env.window.__duoRecoveryWorkbench.analyzeObject(payload);
  const selectedOperations = selectRevisionOperation ? [{
    operation: 'localStorage-set-candidate', key: '__twodeers_runtime_revision_v1', value: '0',
    sourceBeforeSummary: '无效版本计数（3 字节）', reason: '无效运行时版本计数，仅生成隔离副本候选。',
    preconditions: ['关闭同源的其他 Twodeers 标签页和窗口', '退出后重新打开应用，再由独立恢复流程决定是否应用该提案'],
    requiresIndependentReview: true
  }] : [];
  const overlay = { format: 'twodeers-recovery-overlay', version: 1, applyable: false, writesPerformed: false, selectedOperations };
  const readme = new Blob(['Twodeers 隔离恢复候选包\n此文件不是 V4 备份。source/twodeers-recovery-salvage.json 是原始救援 JSON。'], { type: 'text/plain;charset=utf-8' });
  const rows = [
    { name: 'source/twodeers-recovery-salvage.json', blob: new Blob([JSON.stringify(payload)], { type: 'application/json;charset=utf-8' }) },
    { name: 'candidate/preview.json', blob: new Blob([JSON.stringify(preview)], { type: 'application/json;charset=utf-8' }) },
    { name: 'candidate/overlay.json', blob: new Blob([JSON.stringify(overlay)], { type: 'application/json;charset=utf-8' }) },
    { name: 'README.txt', blob: readme }
  ];
  const checks = [];
  for (const row of rows) checks.push({ path: row.name, bytes: row.blob.size, crc32: env.window.__duoRecoveryCandidateZip.crc32Hex(await env.window.__duoRecoveryCandidateValidator.crc32Blob(row.blob)) });
  const summary = preview.summary;
  const manifest = {
    format: 'twodeers-recovery-candidate', formatVersion: 1, importableAsBackup: false, writesPerformed: false,
    status: payload.complete && summary.manualReview === 0 && summary.binaryInvalid === 0 && summary.missingMediaReferences === 0 && summary.invalidMediaReferences === 0 && summary.legacyDataUrlsInvalid === 0 ? 'ready-for-independent-validation' : 'review-required',
    source: { entry: rows[0].name, format: payload.format, formatVersion: payload.formatVersion, bytes: rows[0].blob.size, crc32: checks[0].crc32, generatedAt: payload.generatedAt, complete: true, omissions: 0 },
    inventory: { localStorageRecordCount: payload.localStorageRaw.length, localStorageKeys: payload.localStorageRaw.map((row) => row.key), mediaRecordCount: payload.mediaRecords.length, mediaIds: payload.mediaRecords.map((row) => row.id), fontRecordCount: payload.fontLibrary.fonts.length, fontIds: payload.fontLibrary.fonts.map((row) => row.id), recoveryJournalPresent: false },
    classifications: { total: summary.total, safeRebuildCandidates: summary.safeRebuild, preserved: summary.preserve, manualReview: summary.manualReview, binaryValid: summary.binaryValid, binaryInvalid: summary.binaryInvalid, referencesChecked: summary.referencesChecked, missingMediaReferences: summary.missingMediaReferences, invalidMediaReferences: summary.invalidMediaReferences, legacyDataUrlsChecked: summary.legacyDataUrlsChecked, legacyDataUrlsInvalid: summary.legacyDataUrlsInvalid },
    preservedItems: preview.items.filter((item) => item.classification === '保留原始数据').map((item) => ({ path: item.path, reason: item.reason })),
    manualReviewItems: preview.items.filter((item) => item.classification === '人工复核').map((item) => ({ path: item.path, reason: item.reason })),
    candidateOverlay: { format: overlay.format, version: overlay.version, applyable: false, writesPerformed: false, operations: selectedOperations },
    entryInventoryScope: 'all payload entries except candidate/manifest.json (self-reference is intentionally excluded)', entries: checks,
    guardrails: ['This archive is not a standard Twodeers backup and must not be imported through V4 or legacy restore.']
  };
  const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const candidate = (await env.window.__duoRecoveryCandidateZip.buildStoredZip(rows.concat([{ name: 'candidate/manifest.json', blob: manifestBlob }]))).blob;
  const validated = await env.window.__duoRecoveryCandidateValidator.validateFile(candidate);
  if (options.skipIsolation) return { candidate, validated, isolated: null };
  const isolated = await env.window.__duoRecoveryIsolationEngine.buildBundle(validated, { includeValidatedCandidateOperations: selectRevisionOperation });
  return { candidate, validated, isolated };
}

const env = makeEnv();
const payload = buildPayload();
const generated = await makeCandidate(env, payload, false);
const audit = await env.window.__duoRecoveryApplicationAuditor.auditFile(generated.isolated.blob);
assert.equal(audit.ok, true);
assert.equal(audit.report.status, 'consistent-for-human-review');
assert.equal(audit.report.writesPerformed, false);
assert.equal(audit.report.importableAsBackup, false);
assert.equal(audit.report.promotable, false);
assert.equal(audit.report.consistency.blockingIssues, 0);
assert.equal(audit.report.consistency.reviewItems, 0);
assert.equal(audit.report.applicationCounts.chatMessages, 1);
assert.equal(audit.report.applicationCounts.uploadedStickers, 1);
assert.equal(audit.report.applicationCounts.mailLetters, 1);
assert.equal(audit.report.applicationCounts.circlePosts, 1);
assert.equal(audit.report.applicationCounts.fonts, 1);
assert.equal(JSON.stringify(audit.report).includes('SECRET_CHAT_BODY_DO_NOT_EXPORT'), false, 'application audit must not leak chat content');

const appliedEnv = makeEnv();
const applied = await makeCandidate(appliedEnv, buildPayload(), true);
const appliedAudit = await appliedEnv.window.__duoRecoveryApplicationAuditor.auditFile(applied.isolated.blob);
assert.equal(appliedAudit.report.status, 'consistent-for-human-review');
assert.equal(appliedAudit.report.isolatedReconstruction.appliedOperations, 1);
assert.equal(JSON.stringify(appliedAudit.report.isolatedReconstruction.changedKeys), JSON.stringify(['__twodeers_runtime_revision_v1']));

const driftEnv = makeEnv();
const drift = await makeCandidate(driftEnv, buildPayload({ cardDrift: true }), false);
const driftAudit = await driftEnv.window.__duoRecoveryApplicationAuditor.auditFile(drift.isolated.blob);
assert.equal(driftAudit.report.status, 'review-required');
assert.ok(driftAudit.report.consistency.findings.some((item) => item.code === 'card-pool-runtime-drift'));

const orphanEnv = makeEnv();
const orphan = await makeCandidate(orphanEnv, buildPayload({ orphanPending: true }), false);
const orphanAudit = await orphanEnv.window.__duoRecoveryApplicationAuditor.auditFile(orphan.isolated.blob);
assert.equal(orphanAudit.report.status, 'review-required');
assert.ok(orphanAudit.report.consistency.findings.some((item) => item.code === 'mailbox-pending-orphan'));

const fontEnv = makeEnv();
const badFont = await makeCandidate(fontEnv, buildPayload({ fontPointerMissing: true }), false, { skipIsolation: true });
assert.equal(badFont.validated.manifest.status, 'review-required');
await assert.rejects(() => fontEnv.window.__duoRecoveryIsolationEngine.buildBundle(badFont.validated, { includeValidatedCandidateOperations: false }), /当前字体指针缺失/);

const mediaEnv = makeEnv();
const missingMedia = await makeCandidate(mediaEnv, buildPayload({ missingChatMedia: true }), false);
const missingMediaAudit = await mediaEnv.window.__duoRecoveryApplicationAuditor.auditFile(missingMedia.isolated.blob);
assert.equal(missingMediaAudit.report.status, 'review-required');
assert.ok(missingMediaAudit.report.consistency.findings.some((item) => item.code === 'candidate-source-semantic-issue'));
assert.equal(missingMediaAudit.report.applicationCounts.missingMediaReferences, 1);

// Rebuild a structurally valid outer ZIP after tampering with the isolated snapshot; semantic comparison must catch it.
const validator = env.window.__duoRecoveryCandidateValidator;
const entries = await validator.readStoredZipEntries(generated.isolated.blob, null, 200 * 1024 * 1024);
const blobs = new Map(entries.map((entry) => [entry.path, entry.blob]));
const isolatedRows = JSON.parse(await blobs.get('isolated/localStorageRaw.json').text());
const mainRow = isolatedRows.find((row) => row.key === 'dual_space_app_clean_test_v1');
const alteredMain = JSON.parse(mainRow.raw); alteredMain.cardPhrases = ['forged phrase']; mainRow.raw = JSON.stringify(alteredMain);
const changedLocal = new Blob([JSON.stringify(isolatedRows, null, 2)], { type: 'application/json;charset=utf-8' });
const alteredManifest = JSON.parse(await blobs.get('isolated/manifest.json').text());
alteredManifest.reconstruction.localStorageBytes = changedLocal.size;
const forgedEntries = [];
for (const [name, blob] of blobs) forgedEntries.push({ name, blob: name === 'isolated/localStorageRaw.json' ? changedLocal : name === 'isolated/manifest.json' ? new Blob([JSON.stringify(alteredManifest, null, 2)]) : blob });
const forgedOuter = (await env.window.__duoRecoveryCandidateZip.buildStoredZip(forgedEntries, 200 * 1024 * 1024)).blob;
await assert.rejects(() => env.window.__duoRecoveryApplicationAuditor.auditFile(forgedOuter), /没有应用候选操作|基础源不同|localStorage 原文与基础源不同/);

const corruptFlags = JSON.parse(await blobs.get('isolated/manifest.json').text());
corruptFlags.importableAsBackup = true;
const invalidEntries = [];
for (const [name, blob] of blobs) invalidEntries.push({ name, blob: name === 'isolated/manifest.json' ? new Blob([JSON.stringify(corruptFlags)]) : blob });
const invalidOuter = (await env.window.__duoRecoveryCandidateZip.buildStoredZip(invalidEntries, 200 * 1024 * 1024)).blob;
await assert.rejects(() => env.window.__duoRecoveryApplicationAuditor.auditFile(invalidOuter), /安全标记无效/);

// Exercise the actual production UI event wiring using a second browser-like VM.
const ui = makeEnv(true);
const uiGenerated = await makeCandidate(ui, buildPayload(), false);
const input = ui.elements.get('recoveryApplicationAuditFile');
input.files = [uiGenerated.isolated.blob];
input.listeners.change();
assert.equal(ui.elements.get('recoveryApplicationAuditExportBtn').disabled, true);
await ui.elements.get('recoveryApplicationAuditBtn').listeners.click();
assert.equal(ui.elements.get('recoveryApplicationAuditExportBtn').disabled, false);
assert.match(ui.elements.get('recoveryApplicationAuditStatus').textContent, /consistent-for-human-review/);
assert.equal(ui.elements.get('recoveryApplicationAuditOutput').textContent.includes('SECRET_CHAT_BODY_DO_NOT_EXPORT'), false);
ui.elements.get('recoveryApplicationAuditExportBtn').listeners.click();
assert.equal(ui.downloads, 1);
const exported = [...ui.createdUrls.values()][0];
assert.equal((await exported.text()).includes('SECRET_CHAT_BODY_DO_NOT_EXPORT'), false);
input.files = [{ name: 'different.zip', size: 1 }]; input.listeners.change();
assert.equal(ui.elements.get('recoveryApplicationAuditExportBtn').disabled, true, 'changing the selected file invalidates the old audit result');

const index = read('index.html');
assert.match(index, /id="recoveryApplicationAuditFile"[^>]*data-duo-readonly-allowed="true"/);
assert.match(index, /id="recoveryApplicationAuditBtn"[^>]*data-duo-readonly-allowed="true"/);
assert.match(index, /id="recoveryApplicationAuditExportBtn"[^>]*data-duo-readonly-allowed="true"/);
assert.ok(index.indexOf('recovery-candidate-validator.js') < index.indexOf('recovery-application-auditor.js'));
console.log('PASS: Phase 15 isolated ZIP and nested candidate revalidation, manifest/report/base reconciliation, exact localStorage overlay comparison, chat/card/sticker/mailbox/Circle/font application invariants, media and font inheritance checks, drift/orphan review findings, forged snapshot and security-flag rejection, privacy-safe report export, UI revalidation gating, and zero live application storage access.');
