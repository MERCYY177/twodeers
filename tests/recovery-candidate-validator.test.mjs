import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const zipSource = read('recovery-candidate-package.js');
const validatorSource = read('recovery-candidate-validator.js');
const workbenchSource = read('recovery-workbench.js');
const executable = validatorSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
assert.doesNotMatch(executable, /global\.(?:localStorage|indexedDB)|\b(?:localStorage|indexedDB)\s*\.\s*(?:setItem|removeItem|open|deleteDatabase)/, 'validator must not access application storage');

const elements = new Map();
for (const id of ['recoveryWorkbenchFile','recoveryWorkbenchAnalyzeBtn','recoveryWorkbenchExportBtn','recoveryWorkbenchCandidateBtn','recoveryWorkbenchIncludeRevisionProposal','recoveryWorkbenchStatus','recoveryWorkbenchOutput']) {
  elements.set(id, { disabled: false, checked: false, files: [], dataset: {}, textContent: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } });
}
const fakeWindow = { document: { getElementById(id) { return elements.get(id) || null; } }, Blob, TextEncoder, TextDecoder, crypto: webcrypto };
const context = { window: fakeWindow, Blob, TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, Date, Number, String, Set, Map, WeakSet, Object, Array, JSON, Error, RegExp, Promise, Math, crypto: webcrypto };
vm.runInNewContext(zipSource, context, { filename: 'phase15-zip-builder.js' });
vm.runInNewContext(validatorSource, context, { filename: 'phase15-independent-validator.js' });
vm.runInNewContext(workbenchSource, context, { filename: 'phase15-workbench-fixture.js' });
const zipBuilder = fakeWindow.__duoRecoveryCandidateZip;
const validator = fakeWindow.__duoRecoveryCandidateValidator;
const workbench = fakeWindow.__duoRecoveryWorkbench;
assert.ok(zipBuilder && validator && workbench);
assert.equal(typeof validator.validateFile, 'function');
assert.equal(typeof validator.inspectStoredZip, 'function');

const revisionKey = '__twodeers_runtime_revision_v1';
const blobObject = (value, type) => ({ __type: 'Blob', type, size: Buffer.byteLength(value), dataUrl: `data:${type};base64,${Buffer.from(value).toString('base64')}` });
const payload = {
  format: 'twodeers-recovery-salvage', formatVersion: 1, generatedAt: new Date(0).toISOString(), importableAsBackup: false,
  complete: true, omissions: [], diagnosticReport: { format: 'twodeers-storage-diagnostic', formatVersion: 1, localStorage: { rows: [] }, media: { missingCount: 0, missingIds: [] } },
  localStorageRaw: [{ key: revisionKey, raw: 'NaN', parseStatus: 'unclassified' }],
  mediaRecords: [], fontLibrary: { currentFontId: null, fonts: [] }, recoveryJournal: null,
};
const preview = workbench.analyzeObject(payload);
assert.equal(preview.source.complete, true);
assert.equal(preview.summary.manualReview, 0);
assert.equal(preview.proposals.length, 1);
const operation = {
  operation: 'localStorage-set-candidate', key: revisionKey, value: '0',
  sourceBeforeSummary: '无效版本计数（3 字节）', reason: preview.proposals[0].reason,
  preconditions: ['关闭同源的其他 Twodeers 标签页和窗口', '退出后重新打开应用，再由独立恢复流程决定是否应用该提案'],
  requiresIndependentReview: true,
};
const overlay = { format: 'twodeers-recovery-overlay', version: 1, applyable: false, writesPerformed: false, selectedOperations: [operation], note: 'review only' };
const readme = 'Twodeers 隔离恢复候选包\n此文件不是 V4 备份。source/twodeers-recovery-salvage.json 是原始救援 JSON。';
const sourceBlob = new Blob([JSON.stringify(payload)], { type: 'application/json;charset=utf-8' });
const previewBlob = new Blob([JSON.stringify(preview)], { type: 'application/json;charset=utf-8' });
const overlayBlob = new Blob([JSON.stringify(overlay)], { type: 'application/json;charset=utf-8' });
const readmeBlob = new Blob([readme], { type: 'text/plain;charset=utf-8' });
const originalEntries = [
  { name: 'source/twodeers-recovery-salvage.json', blob: sourceBlob },
  { name: 'candidate/preview.json', blob: previewBlob },
  { name: 'candidate/overlay.json', blob: overlayBlob },
  { name: 'README.txt', blob: readmeBlob },
];
async function makeCandidate({ payloadValue = payload, previewValue = preview, overlayValue = overlay, badInventory = false, badClassification = false, forceReady = false, badManifestItems = false } = {}) {
  const src = new Blob([JSON.stringify(payloadValue)], { type: 'application/json' });
  const prev = new Blob([JSON.stringify(previewValue)], { type: 'application/json' });
  const over = new Blob([JSON.stringify(overlayValue)], { type: 'application/json' });
  const rm = readmeBlob;
  const rows = [
    { name: 'source/twodeers-recovery-salvage.json', blob: src },
    { name: 'candidate/preview.json', blob: prev },
    { name: 'candidate/overlay.json', blob: over },
    { name: 'README.txt', blob: rm },
  ];
  const entries = [];
  for (const row of rows) entries.push({ path: row.name, bytes: row.blob.size, crc32: zipBuilder.crc32Hex(await zipBuilder.crc32Blob(row.blob)) });
  const media = payloadValue.mediaRecords || [];
  const fonts = payloadValue.fontLibrary?.fonts || [];
  const manifest = {
    format: 'twodeers-recovery-candidate', formatVersion: 1, importableAsBackup: false, writesPerformed: false,
    status: forceReady || (previewValue.source.complete === true && previewValue.summary.manualReview === 0 && previewValue.summary.binaryInvalid === 0 && previewValue.summary.missingMediaReferences === 0 && previewValue.summary.invalidMediaReferences === 0 && previewValue.summary.legacyDataUrlsInvalid === 0) ? 'ready-for-independent-validation' : 'review-required',
    source: { entry: rows[0].name, format: payloadValue.format, formatVersion: payloadValue.formatVersion, bytes: src.size, crc32: zipBuilder.crc32Hex(await zipBuilder.crc32Blob(src)), generatedAt: payloadValue.generatedAt || null, complete: payloadValue.complete === true && payloadValue.omissions.length === 0, omissions: payloadValue.omissions.length, originalFileName: 'twodeers-recovery-salvage.json' },
    inventory: {
      localStorageRecordCount: payloadValue.localStorageRaw.length + (badInventory ? 1 : 0),
      localStorageKeys: payloadValue.localStorageRaw.map((row) => row.key),
      mediaRecordCount: media.length, mediaIds: media.map((row) => row.id),
      fontRecordCount: fonts.length, fontIds: fonts.map((row) => row.id),
      recoveryJournalPresent: !!payloadValue.recoveryJournal,
    },
    classifications: {
      total: previewValue.summary.total, safeRebuildCandidates: previewValue.summary.safeRebuild, preserved: previewValue.summary.preserve,
      manualReview: previewValue.summary.manualReview, binaryValid: previewValue.summary.binaryValid, binaryInvalid: previewValue.summary.binaryInvalid,
      referencesChecked: previewValue.summary.referencesChecked, missingMediaReferences: badClassification ? 0 : previewValue.summary.missingMediaReferences,
      invalidMediaReferences: previewValue.summary.invalidMediaReferences, legacyDataUrlsChecked: previewValue.summary.legacyDataUrlsChecked,
      legacyDataUrlsInvalid: previewValue.summary.legacyDataUrlsInvalid,
    },
    preservedItems: badManifestItems ? [] : previewValue.items.filter((item) => item.classification === '保留原始数据').map((item) => ({ path: item.path, reason: item.reason })),
    manualReviewItems: previewValue.items.filter((item) => item.classification === '人工复核').map((item) => ({ path: item.path, reason: item.reason })),
    candidateOverlay: { format: 'twodeers-recovery-overlay', version: 1, applyable: false, writesPerformed: false,
      operations: overlayValue.selectedOperations.map((item) => ({ ...item })) },
    entryInventoryScope: 'all payload entries except candidate/manifest.json (self-reference is intentionally excluded)',
    entries,
    guardrails: ['This archive is not a standard Twodeers backup and must not be imported through V4 or legacy restore.'],
  };
  const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  return zipBuilder.buildStoredZip([...rows, { name: 'candidate/manifest.json', blob: manifestBlob }]).then((result) => result.blob);
}

const candidate = await makeCandidate();
const verified = await validator.validateFile(candidate);
assert.equal(verified.ok, true);
assert.equal(verified.report.verified, true);
assert.equal(verified.report.sourceInventory.keyCount, 1);
assert.match(verified.report.sourceSha256, /^[0-9a-f]{64}$/);
assert.equal(verified.approvedOperations.length, 1);
assert.equal(verified.archiveBlob.size, candidate.size);

const damagedBytes = new Uint8Array(await candidate.arrayBuffer());
const sourceMarker = Buffer.from('NaN').indexOf(0x4E); // first marker position in serialized payload
const sourceNameBytes = Buffer.from('source/twodeers-recovery-salvage.json');
const sourceNameIndex = Buffer.from(damagedBytes).indexOf(sourceNameBytes);
assert.ok(sourceNameIndex >= 0);
const sourceDataStart = sourceNameIndex + sourceNameBytes.length;
damagedBytes[sourceDataStart + sourceMarker] ^= 0x01;
await assert.rejects(() => validator.validateFile(new Blob([damagedBytes])), /CRC-32 不匹配/);

const wrongInventory = await makeCandidate({ badInventory: true });
await assert.rejects(() => validator.validateFile(wrongInventory), /资源数量与源资料不一致/);

const illegalOverlay = structuredClone(overlay);
illegalOverlay.selectedOperations = [{ operation: 'localStorage-remove-candidate', key: 'dual_space_app_clean_test_v1', value: null, requiresIndependentReview: true, preconditions: [] }];
const illegalOverlayZip = await makeCandidate({ overlayValue: illegalOverlay });
await assert.rejects(() => validator.validateFile(illegalOverlayZip), /未授权操作/);

const mismatchedPreview = structuredClone(preview);
mismatchedPreview.summary.missingMediaReferences = 9;
const mismatchZip = await makeCandidate({ previewValue: mismatchedPreview, badClassification: true });
await assert.rejects(() => validator.validateFile(mismatchZip), /分类摘要与 preview 不一致/);

const truncated = candidate.slice(0, candidate.size - 11);
await assert.rejects(() => validator.validateFile(truncated), /结束记录/);

// Independent media graph is recomputed from known source schemas rather than trusting the manifest/preview counts.
const graphPayload = structuredClone(payload);
graphPayload.complete = true; graphPayload.omissions = [];
graphPayload.diagnosticReport = { ...payload.diagnosticReport, media: { missingCount: 0, missingIds: [] }, localStorage: { rows: [] } };
const circlePng = 'data:image/png;base64,' + Buffer.from('legacy-circle').toString('base64');
graphPayload.localStorageRaw = [
  { key: 'dual_space_app_clean_test_v1', raw: JSON.stringify({ chatHistory: [{ mediaId: 'chat-ref' }], stickers: [], cardPhrases: [] }), parseStatus: 'valid' },
  { key: 'moments_site_blank_v49_rebuild_baseline_same_layout', raw: JSON.stringify({ myAvatar: 'idb-media:circle-avatar', posts: [{ media: [{ src: 'idb-media:circle-post' }, { src: circlePng }] }] }), parseStatus: 'valid' },
];
const makeBlobRecord = (id, body, mimeType) => ({ id, kind: 'image', mimeType, size: Buffer.byteLength(body), blob: blobObject(body, mimeType) });
graphPayload.mediaRecords = [makeBlobRecord('chat-ref', 'chat', 'image/png'), makeBlobRecord('circle-avatar', 'avatar', 'image/png'), makeBlobRecord('circle-post', 'post', 'image/gif')];
const graphPreview = workbench.analyzeObject(graphPayload);
assert.equal(graphPreview.summary.referencesChecked, 3);
assert.equal(graphPreview.summary.missingMediaReferences, 0);
assert.equal(graphPreview.summary.legacyDataUrlsChecked, 1);
const graphZip = await makeCandidate({ payloadValue: graphPayload, previewValue: graphPreview, overlayValue: { format: 'twodeers-recovery-overlay', version: 1, applyable: false, writesPerformed: false, selectedOperations: [] } });
const graphVerified = await validator.validateFile(graphZip);
assert.equal(graphVerified.report.candidateStatus, 'ready-for-independent-validation');
const forgedManifestItemsZip = await makeCandidate({ payloadValue: graphPayload, previewValue: graphPreview, overlayValue: { format: 'twodeers-recovery-overlay', version: 1, applyable: false, writesPerformed: false, selectedOperations: [] }, badManifestItems: true });
await assert.rejects(() => validator.validateFile(forgedManifestItemsZip), /manifest preservedItems 与 preview 分类条目不一致/);
assert.equal(graphVerified.report.sourceSemanticIssues.length, 0, 'independent reference graph must align with a valid source');

const missingGraphPayload = structuredClone(graphPayload);
const badCircle = JSON.parse(missingGraphPayload.localStorageRaw[1].raw);
badCircle.posts[0].media[0].src = 'idb-media:not-present';
missingGraphPayload.localStorageRaw[1].raw = JSON.stringify(badCircle);
const missingGraphPreview = workbench.analyzeObject(missingGraphPayload);
assert.equal(missingGraphPreview.summary.missingMediaReferences, 1);
const missingGraphZip = await makeCandidate({ payloadValue: missingGraphPayload, previewValue: missingGraphPreview, overlayValue: { format: 'twodeers-recovery-overlay', version: 1, applyable: false, writesPerformed: false, selectedOperations: [] } });
const missingGraphVerified = await validator.validateFile(missingGraphZip);
assert.equal(missingGraphVerified.report.candidateStatus, 'review-required');
assert.ok(missingGraphVerified.report.sourceSemanticIssues.some((item) => item.includes('not-present')));
const forgedReadyZip = await makeCandidate({ payloadValue: missingGraphPayload, previewValue: missingGraphPreview, overlayValue: { format: 'twodeers-recovery-overlay', version: 1, applyable: false, writesPerformed: false, selectedOperations: [] }, forceReady: true });
await assert.rejects(() => validator.validateFile(forgedReadyZip), /独立重算发现完整性问题/);

// A hostile package cannot make malformed known business data appear ready by editing both preview and manifest summaries.
const malformedCardsPayload = {
  ...structuredClone(payload),
  localStorageRaw: [{ key: 'twodeers_card_system_v1', raw: JSON.stringify({ chatIds: ['dup', 'dup'], chatTexts: ['A', 'B'] }), parseStatus: 'valid' }],
};
const malformedCardsPreview = structuredClone(workbench.analyzeObject(malformedCardsPayload));
assert.equal(malformedCardsPreview.summary.manualReview, 1);
malformedCardsPreview.items.forEach((item) => { if (item.classification === '人工复核') item.classification = '保留原始数据'; });
malformedCardsPreview.summary.manualReview = 0;
malformedCardsPreview.summary.preserve = malformedCardsPreview.items.filter((item) => item.classification === '保留原始数据').length;
const emptyOverlay = { format: 'twodeers-recovery-overlay', version: 1, applyable: false, writesPerformed: false, selectedOperations: [] };
const forgedReadyCards = await makeCandidate({ payloadValue: malformedCardsPayload, previewValue: malformedCardsPreview, overlayValue: emptyOverlay, forceReady: true });
await assert.rejects(() => validator.validateFile(forgedReadyCards), /独立重算发现完整性问题/);

// The validator also honors original diagnostic corruption flags for unknown keys and media gaps.
async function assertMalformedKnownKeyCannotBeForgedReady(key, value) {
  const source = { ...structuredClone(payload), localStorageRaw: [{ key, raw: JSON.stringify(value), parseStatus: 'valid' }] };
  const analyzed = structuredClone(workbench.analyzeObject(source));
  assert.ok(analyzed.summary.manualReview > 0, key + ' fixture must be classified for manual review by the original workbench');
  analyzed.items.forEach((item) => { if (item.classification === '人工复核') item.classification = '保留原始数据'; });
  analyzed.summary.manualReview = 0;
  analyzed.summary.preserve = analyzed.items.filter((item) => item.classification === '保留原始数据').length;
  const forged = await makeCandidate({ payloadValue: source, previewValue: analyzed, overlayValue: emptyOverlay, forceReady: true });
  await assert.rejects(() => validator.validateFile(forged), /独立重算发现完整性问题/, key + ' must not be promoted by a forged preview/manifest');
}
await assertMalformedKnownKeyCannotBeForgedReady('dual_space_sticker_library_v1', { version: 1, items: [{ id: 'dup', mediaId: 'm1' }, { id: 'dup', mediaId: 'm2' }], tombstones: [], favorites: [] });
await assertMalformedKnownKeyCannotBeForgedReady('twodeers_mailbox_letters_v1', { items: [], settings: 'not-an-object' });
await assertMalformedKnownKeyCannotBeForgedReady('moments_site_blank_v49_rebuild_baseline_same_layout', { posts: 'not-an-array' });

const diagnosticCorruptPayload = {
  ...structuredClone(payload),
  localStorageRaw: [{ key: 'legacy_unknown', raw: '{kept exactly', parseStatus: 'valid' }],
  diagnosticReport: { ...structuredClone(payload.diagnosticReport), localStorage: { rows: [{ key: 'legacy_unknown', status: 'corrupt-json' }] }, media: { missingCount: 1, missingIds: ['lost'] } },
};
const diagnosticCorruptPreview = workbench.analyzeObject(diagnosticCorruptPayload);
const diagnosticCorruptZip = await makeCandidate({ payloadValue: diagnosticCorruptPayload, previewValue: diagnosticCorruptPreview, overlayValue: emptyOverlay });
const diagnosticCorruptVerified = await validator.validateFile(diagnosticCorruptZip);
assert.equal(diagnosticCorruptVerified.report.candidateStatus, 'review-required');
assert.ok(diagnosticCorruptVerified.report.sourceSemanticIssues.some((item) => item.includes('legacy_unknown')));
assert.ok(diagnosticCorruptVerified.report.sourceSemanticIssues.some((item) => item.includes('缺失媒体引用')));
const forgedDiagnosticReady = await makeCandidate({ payloadValue: diagnosticCorruptPayload, previewValue: diagnosticCorruptPreview, overlayValue: emptyOverlay, forceReady: true });
await assert.rejects(() => validator.validateFile(forgedDiagnosticReady), /独立重算发现完整性问题/);

const generic = await validator.inspectStoredZip(candidate);
assert.equal(generic.verified, true);
assert.equal(generic.entries.length, 5);
assert.equal(generic.entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256)), true);
console.log('PASS: independent ZIP structure parsing, CRC-32 and SHA-256 recomputation, source/manifest/inventory reconciliation, overlay allowlist enforcement, preview-summary consistency, independent card/mailbox/sticker/Circle structural checks, diagnostic corruption flags, CRC-corruption and truncation rejection, and generic stored-ZIP inspection.');
