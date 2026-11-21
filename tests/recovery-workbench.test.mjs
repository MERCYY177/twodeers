import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'recovery-workbench.js'), 'utf8');
const zipSource = fs.readFileSync(path.join(root, 'recovery-candidate-package.js'), 'utf8');
const executableSource = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
assert.doesNotMatch(executableSource, /global\.(?:localStorage|indexedDB)|\b(?:localStorage|indexedDB)\s*\.\s*(?:setItem|removeItem|open|deleteDatabase)/, 'recovery workbench must not access or mutate application storage');

const sensitiveText = 'private-chat-message-must-not-appear-in-preview';
const toBase64 = (value) => Buffer.from(value).toString('base64');
const mediaBytes = 'animated-gif-payload';
const fontBytes = 'font-binary-payload';
const journalBytes = 'journal-binary-payload';
const blobObject = (value, type) => ({ __type: 'Blob', type, size: Buffer.byteLength(value), dataUrl: `data:${type};base64,${toBase64(value)}` });
const arrayBufferObject = (value) => ({ __type: 'ArrayBuffer', byteLength: Buffer.byteLength(value), base64: toBase64(value) });
const payload = {
  format: 'twodeers-recovery-salvage',
  formatVersion: 1,
  generatedAt: new Date(0).toISOString(),
  importableAsBackup: false,
  complete: false,
  diagnosticReport: {
    format: 'twodeers-storage-diagnostic',
    formatVersion: 1,
    localStorage: { rows: [
      { key: 'dual_space_app_clean_test_v1', status: 'valid' },
      { key: 'twodeers_card_system_v1', status: 'corrupt-json' },
    ] },
    media: { missingCount: 2, missingIds: ['missing-a', 'missing-b'] },
  },
  localStorageRaw: [
    { key: '__twodeers_runtime_revision_v1', raw: 'NaN', parseStatus: 'unclassified' },
    { key: 'dual_space_app_clean_test_v1', raw: JSON.stringify({ chatHistory: [{ text: sensitiveText }], stickers: [], cardPhrases: [] }), parseStatus: 'valid' },
    { key: 'twodeers_card_system_v1', raw: '{broken-card-json', parseStatus: 'corrupt-json' },
    { key: 'legacy_private_key', raw: 'opaque-legacy-value', parseStatus: 'unclassified' },
  ],
  mediaRecords: [
    { id: 'media-1', kind: 'image', name: 'animated.gif', size: Buffer.byteLength(mediaBytes), blob: blobObject(mediaBytes, 'image/gif') },
  ],
  fontLibrary: { currentFontId: 'font-1', fonts: [
    { id: 'font-1', format: 'woff2', size: Buffer.byteLength(fontBytes), blob: blobObject(fontBytes, 'font/woff2') },
  ] },
  recoveryJournal: {
    id: 'restore-1', formatVersion: 1, phase: 'prepared', createdAt: 123, kind: 'all',
    oldState: JSON.stringify({ chatHistory: [], stickers: [], cardPhrases: [] }), oldStorage: null,
    oldCircle: { posts: [] }, oldStickerLibrary: null, oldFonts: null, oldMailbox: null, oldCards: null,
    oldMedia: [['journal-media', { id: 'journal-media', blob: blobObject(journalBytes, 'image/png') }]],
    oldBinary: arrayBufferObject(journalBytes), oldStorageEntries: [],
  },
  omissions: [{ path: 'mediaRecords.media-2', reason: 'binary-export-budget-exceeded' }],
};

const downloads = [];
const createdUrls = new Map();
let nextUrl = 0;
const makeElement = () => ({ disabled: false, dataset: {}, files: [], textContent: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, });
const docElements = new Map([
  ['recoveryWorkbenchFile', makeElement()],
  ['recoveryWorkbenchAnalyzeBtn', makeElement()],
  ['recoveryWorkbenchExportBtn', makeElement()],
  ['recoveryWorkbenchCandidateBtn', makeElement()],
  ['recoveryWorkbenchIncludeRevisionProposal', makeElement()],
  ['recoveryWorkbenchStatus', makeElement()],
  ['recoveryWorkbenchOutput', makeElement()],
]);
const document = {
  getElementById(id) { return docElements.get(id) || null; },
  createElement(tag) {
    assert.equal(tag, 'a');
    return { href: '', download: '', style: {}, click() { downloads.push({ name: this.download, blob: createdUrls.get(this.href) }); }, remove() {} };
  },
  body: { appendChild() {} },
};
const fakeWindow = {
  document, Blob, TextEncoder, confirm() { return true; },
  URL: {
    createObjectURL(blob) { const url = `blob:test-${++nextUrl}`; createdUrls.set(url, blob); return url; },
    revokeObjectURL(url) { createdUrls.delete(url); },
  },
  setTimeout() {},
};
const vmContext = {
  window: fakeWindow,
  Blob,
  TextEncoder,
  Uint8Array,
  Uint32Array,
  DataView,
  Date,
  Set,
  Map,
  WeakSet,
  Number,
  String,
  Object,
  Array,
  JSON,
  Error,
  RegExp,
  Promise,
  Math,
};
vm.runInNewContext(zipSource, vmContext, { filename: 'recovery-candidate-package.js' });
vm.runInNewContext(source, vmContext, { filename: 'recovery-workbench.js' });

const api = fakeWindow.__duoRecoveryWorkbench;
assert.ok(api, 'read-only recovery workbench API must be installed');
assert.equal(typeof api.apply, 'undefined', 'workbench must not expose a repair/apply method');
assert.equal(docElements.get('recoveryWorkbenchCandidateBtn').disabled, true, 'candidate export stays disabled until a rescue source is analyzed');
const preview = api.analyzeObject(payload);
assert.equal(preview.format, 'twodeers-recovery-preview');
assert.equal(preview.importableAsBackup, false);
assert.equal(preview.writesPerformed, false);
assert.equal(preview.source.complete, false);
assert.equal(preview.summary.safeRebuild, 1, 'only the corrupt runtime revision counter may be suggested for rebuild');
assert.equal(preview.summary.manualReview >= 3, true, 'corrupt business data, missing references and omissions require manual review');
assert.equal(preview.proposals.length, 1);
assert.equal(preview.proposals[0].proposedValue, '0');
assert.equal(preview.proposals[0].path, 'localStorage.__twodeers_runtime_revision_v1');
assert.equal(preview.proposals[0].preconditions.length, 2, 'runtime counter preview must disclose cross-tab ABA safety preconditions');
assert.ok(preview.items.some((item) => item.path === 'localStorage.twodeers_card_system_v1' && item.classification === '人工复核'));
assert.ok(preview.items.some((item) => item.path === 'localStorage.legacy_private_key' && item.classification === '保留原始数据'));
assert.equal(preview.summary.binaryInvalid, 0);
assert.ok(preview.summary.binaryValid >= 3, 'media, font and journal binary payloads must be checked');
assert.equal(JSON.stringify(preview).includes(sensitiveText), false, 'repair preview must not include raw chat contents');
assert.equal(JSON.stringify(preview).includes('opaque-legacy-value'), false, 'repair preview must not expose unknown raw localStorage values');

const badBinary = structuredClone(payload);
badBinary.mediaRecords[0].blob.dataUrl = 'data:image/gif;base64,invalid*base64';
const badBinaryPreview = api.analyzeObject(badBinary);
assert.equal(badBinaryPreview.summary.binaryInvalid > 0, true);
assert.ok(badBinaryPreview.items.some((item) => item.path === 'mediaRecords[0]' && item.classification === '人工复核'));

const duplicateKey = structuredClone(payload);
duplicateKey.localStorageRaw.push({ key: 'dual_space_app_clean_test_v1', raw: '{}', parseStatus: 'valid' });
const duplicatePreview = api.analyzeObject(duplicateKey);
assert.ok(duplicatePreview.items.some((item) => item.path === 'localStorage.dual_space_app_clean_test_v1' && item.reason.includes('多条原始记录')));
const duplicateRevision = structuredClone(payload);
duplicateRevision.localStorageRaw.push({ key: '__twodeers_runtime_revision_v1', raw: '8', parseStatus: 'unclassified' });
const duplicateRevisionPreview = api.analyzeObject(duplicateRevision);
assert.equal(duplicateRevisionPreview.proposals.length, 0, 'duplicate coordination keys must not generate even low-risk patches');
const contradictoryCompleteness = structuredClone(payload);
contradictoryCompleteness.complete = true;
const contradictoryPreview = api.analyzeObject(contradictoryCompleteness);
assert.equal(contradictoryPreview.source.complete, false, 'a non-empty omission list overrides a contradictory complete marker');
assert.ok(contradictoryPreview.items.some((item) => item.path === 'package.complete' && item.classification === '人工复核'));
const malformedCard = structuredClone(payload);
const cardRow = malformedCard.localStorageRaw.find((item) => item.key === 'twodeers_card_system_v1');
cardRow.raw = JSON.stringify({ chatIds: ['a', 'b'], chatTexts: ['only-one'] });
cardRow.parseStatus = 'unclassified';
malformedCard.diagnosticReport.localStorage.rows.find((item) => item.key === 'twodeers_card_system_v1').status = 'unclassified';
const malformedCardPreview = api.analyzeObject(malformedCard);
assert.ok(malformedCardPreview.items.some((item) => item.path === 'localStorage.twodeers_card_system_v1' && item.classification === '人工复核' && item.reason.includes('长度不一致')));
const malformedJournal = structuredClone(payload);
delete malformedJournal.recoveryJournal.oldMedia;
const malformedJournalPreview = api.analyzeObject(malformedJournal);
assert.ok(malformedJournalPreview.items.some((item) => item.path === 'recoveryJournal' && item.classification === '人工复核' && item.reason.includes('媒体快照')));
const metadataMismatch = structuredClone(payload);
metadataMismatch.mediaRecords[0].size += 1;
const metadataMismatchPreview = api.analyzeObject(metadataMismatch);
assert.ok(metadataMismatchPreview.items.some((item) => item.path === 'mediaRecords[0]' && item.classification === '人工复核' && item.reason.includes('大小元数据')));

// Cross-module reachability graph: the candidate builder must not declare a
// source independently valid while chat, stickers, mailbox or Circle point to
// absent / malformed media IDs.
const referenceGraphPayload = structuredClone({
  ...payload,
  complete: true,
  omissions: [],
  diagnosticReport: { ...payload.diagnosticReport, media: { missingCount: 0, missingIds: [] } },
});
referenceGraphPayload.localStorageRaw = [
  { key: 'dual_space_app_clean_test_v1', raw: JSON.stringify({
    chatHistory: [{ mediaId: 'chat-media' }], stickers: [{ mediaId: 'main-sticker-media' }], cardPhrases: []
  }), parseStatus: 'valid' },
  { key: 'dual_space_sticker_library_v1', raw: JSON.stringify({
    version: 1, items: [{ id: 'sticker-1', mediaId: 'library-sticker-media' }], tombstones: [], favorites: []
  }), parseStatus: 'valid' },
  { key: 'twodeers_mailbox_letters_v1', raw: JSON.stringify({
    items: [{ id: 'letter-1', images: [{ id: 'mail-media' }] }]
  }), parseStatus: 'valid' },
  { key: 'moments_site_blank_v49_rebuild_baseline_same_layout', raw: JSON.stringify({
    myAvatar: 'idb-media:circle-avatar', otherAvatar: 'data:image/png;base64,' + toBase64('legacy-circle-image'), posts: [{ media: [{ src: 'idb-media:circle-post' }] }]
  }), parseStatus: 'valid' },
];
referenceGraphPayload.mediaRecords = [
  ['chat-media', 'image/png'], ['main-sticker-media', 'image/png'],
  ['library-sticker-media', 'image/png'], ['mail-media', 'image/png'],
  ['circle-avatar', 'image/png'], ['circle-post', 'image/png'],
].map(([id, type]) => ({ id, blob: blobObject('bytes-' + id, type) }));
const referenceGraphPreview = api.analyzeObject(referenceGraphPayload);
assert.equal(referenceGraphPreview.summary.referencesChecked, 6, 'all six chat/sticker/library/mail/Circle media references must be included');
assert.equal(referenceGraphPreview.summary.missingMediaReferences, 0, 'all references with unique valid blobs should resolve');
assert.equal(referenceGraphPreview.summary.invalidMediaReferences, 0);
assert.equal(referenceGraphPreview.summary.legacyDataUrlsChecked, 1, 'legacy Circle Data URLs must be checked alongside IndexedDB references');
assert.equal(referenceGraphPreview.summary.legacyDataUrlsInvalid, 0);
assert.equal(referenceGraphPreview.summary.manualReview, 0, 'valid cross-module reachability must not introduce false manual-review findings');

const missingChatReference = structuredClone(referenceGraphPayload);
missingChatReference.localStorageRaw[0].raw = JSON.stringify({ chatHistory: [{ mediaId: 'missing-chat-media' }], stickers: [], cardPhrases: [] });
const missingChatPreview = api.analyzeObject(missingChatReference);
assert.equal(missingChatPreview.summary.missingMediaReferences, 1);
assert.ok(missingChatPreview.items.some((item) => item.path.includes('chatHistory[0].mediaId') && item.reason.includes('不存在唯一')));

const missingCircleReference = structuredClone(referenceGraphPayload);
missingCircleReference.localStorageRaw[3].raw = JSON.stringify({ posts: [{ media: [{ src: 'idb-media:missing-circle-media' }] }] });
const missingCirclePreview = api.analyzeObject(missingCircleReference);
assert.equal(missingCirclePreview.summary.missingMediaReferences, 1);
assert.ok(missingCirclePreview.items.some((item) => item.path.includes('posts[0].media[0].src')));

const malformedCircleSnapshot = structuredClone(referenceGraphPayload);
malformedCircleSnapshot.localStorageRaw[3].raw = JSON.stringify({ posts: 'not-an-array' });
const malformedCirclePreview = api.analyzeObject(malformedCircleSnapshot);
assert.ok(malformedCirclePreview.items.some((item) => item.path === 'localStorage.moments_site_blank_v49_rebuild_baseline_same_layout' && item.classification === '人工复核' && item.reason.includes('朋友圈动态列表无效')));

const malformedLegacyDataUrl = structuredClone(referenceGraphPayload);
malformedLegacyDataUrl.localStorageRaw[3].raw = JSON.stringify({ otherAvatar: 'data:image/png;base64,not*base64' });
const malformedLegacyDataUrlPreview = api.analyzeObject(malformedLegacyDataUrl);
assert.equal(malformedLegacyDataUrlPreview.summary.legacyDataUrlsChecked, 1);
assert.equal(malformedLegacyDataUrlPreview.summary.legacyDataUrlsInvalid, 1);
assert.ok(malformedLegacyDataUrlPreview.items.some((item) => item.path.endsWith('.otherAvatar') && item.classification === '人工复核'));

const malformedMediaReference = structuredClone(referenceGraphPayload);
malformedMediaReference.localStorageRaw[0].raw = JSON.stringify({ chatHistory: [{ mediaId: 42 }], stickers: [], cardPhrases: [] });
const malformedReferencePreview = api.analyzeObject(malformedMediaReference);
assert.equal(malformedReferencePreview.summary.invalidMediaReferences, 1);
assert.ok(malformedReferencePreview.items.some((item) => item.path.includes('chatHistory[0].mediaId') && item.reason.includes('类型无效')));

const malformedJournalCircleDataUrl = structuredClone(payload);
malformedJournalCircleDataUrl.recoveryJournal.oldCircle = { otherAvatar: 'data:image/png;base64,not*base64' };
const malformedJournalCirclePreview = api.analyzeObject(malformedJournalCircleDataUrl);
assert.equal(malformedJournalCirclePreview.summary.legacyDataUrlsInvalid, 1);
assert.ok(malformedJournalCirclePreview.items.some((item) => item.path === 'recoveryJournal.oldCircle.otherAvatar' && item.classification === '人工复核'));

const missingJournalMedia = structuredClone(payload);
missingJournalMedia.recoveryJournal.oldState = JSON.stringify({ chatHistory: [{ mediaId: 'journal-media-missing' }], stickers: [] });
const missingJournalMediaPreview = api.analyzeObject(missingJournalMedia);
assert.equal(missingJournalMediaPreview.summary.missingMediaReferences, 1, 'historical recovery-journal media must be counted as missing when oldMedia has no matching blob');
assert.ok(missingJournalMediaPreview.items.some((item) => item.path.includes('recoveryJournal.oldState.chatHistory[0].mediaId')));

const oversizedFile = { size: 128 * 1024 * 1024 + 1, text() { throw new Error('must reject before reading'); } };
await assert.rejects(() => api.analyzeFile(oversizedFile), /128 MiB/);
assert.throws(() => api.analyzeObject({ format: 'twodeers-v4-backup', formatVersion: 4, importableAsBackup: true }), /不是受支持/);
await assert.rejects(() => api.analyzeFile({ size: 2, async text() { return '{not-json'; } }), /JSON 无法解析/);

const fileText = JSON.stringify(payload);
const filePreview = await api.analyzeFile({ size: Buffer.byteLength(fileText), async text() { return fileText; } });
assert.equal(filePreview.summary.safeRebuild, 1, 'File-based workflow must use the same conservative analyzer');
fakeWindow.FileReader = class {
  readAsText() { this.result = fileText; queueMicrotask(() => this.onload()); }
};
const legacyReaderPreview = await api.analyzeFile({ size: Buffer.byteLength(fileText) });
assert.equal(legacyReaderPreview.summary.safeRebuild, 1, 'older WebView FileReader fallback must produce the same read-only preview');
const downloadInfo = api.downloadPreview();
assert.equal(downloadInfo.proposals, 1);
assert.equal(downloads.length, 1);
const exportedPreview = JSON.parse(await downloads[0].blob.text());
assert.equal(exportedPreview.format, 'twodeers-recovery-preview');
assert.equal(exportedPreview.writesPerformed, false);
assert.equal(JSON.stringify(exportedPreview).includes(sensitiveText), false);

const fileInput = docElements.get('recoveryWorkbenchFile');
fileInput.files = [new Blob([fileText], { type: 'application/json' })];
await docElements.get('recoveryWorkbenchAnalyzeBtn').listeners.click();
assert.match(docElements.get('recoveryWorkbenchStatus').textContent, /分析完成/);
assert.match(docElements.get('recoveryWorkbenchOutput').textContent, /修复预览/);
docElements.get('recoveryWorkbenchExportBtn').listeners.click();
assert.equal(downloads.length, 2, 'the visible UI export action must download the preview only');
const visiblePreview = JSON.parse(await downloads[1].blob.text());
assert.equal(visiblePreview.importableAsBackup, false);


const proposalToggle = docElements.get('recoveryWorkbenchIncludeRevisionProposal');
const candidateButton = docElements.get('recoveryWorkbenchCandidateBtn');
assert.equal(candidateButton.disabled, false, 'candidate export becomes available only after successful analysis');
assert.equal(proposalToggle.disabled, false, 'the unique low-risk proposal can be explicitly selected');
assert.equal(proposalToggle.checked, false, 'candidate overlays are opt-in and unchecked by default');
proposalToggle.checked = true;
await candidateButton.listeners.click();
assert.equal(downloads.length, 3, 'candidate package UI action must create a separate ZIP download');
const candidateDownload = downloads[2];
assert.match(candidateDownload.name, /twodeers-recovery-candidate-.*\.zip/);
assert.equal(candidateDownload.blob.type, 'application/zip');
const zipBytes = new Uint8Array(await candidateDownload.blob.arrayBuffer());
const zipView = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
const zipNames = [];
const zipContents = new Map();
const zipEntryChecksums = new Map();
let zipOffset = 0;
while (zipOffset + 30 <= zipBytes.length && zipView.getUint32(zipOffset, true) === 0x04034B50) {
  const size = zipView.getUint32(zipOffset + 18, true);
  const crc32 = zipView.getUint32(zipOffset + 14, true).toString(16).padStart(8, '0');
  const nameLength = zipView.getUint16(zipOffset + 26, true);
  const extraLength = zipView.getUint16(zipOffset + 28, true);
  const name = new TextDecoder().decode(zipBytes.slice(zipOffset + 30, zipOffset + 30 + nameLength));
  const start = zipOffset + 30 + nameLength + extraLength;
  zipNames.push(name);
  zipContents.set(name, new Blob([zipBytes.slice(start, start + size)]));
  zipEntryChecksums.set(name, crc32);
  zipOffset = start + size;
}
assert.deepEqual(zipNames.sort(), [
  'README.txt', 'candidate/manifest.json', 'candidate/overlay.json', 'candidate/preview.json', 'source/twodeers-recovery-salvage.json'
].sort());
assert.equal(await zipContents.get('source/twodeers-recovery-salvage.json').text(), fileText, 'candidate ZIP must include the original salvage JSON byte-for-byte');
const candidateManifest = JSON.parse(await zipContents.get('candidate/manifest.json').text());
const candidateOverlay = JSON.parse(await zipContents.get('candidate/overlay.json').text());
const candidatePreview = JSON.parse(await zipContents.get('candidate/preview.json').text());
assert.equal(candidateManifest.format, 'twodeers-recovery-candidate');
assert.equal(candidateManifest.importableAsBackup, false);
assert.equal(candidateManifest.writesPerformed, false);
assert.equal(candidateManifest.status, 'review-required', 'incomplete source or manual review must keep the package in review status');
assert.equal(candidateManifest.candidateOverlay.applyable, false);
assert.equal(candidateManifest.candidateOverlay.operations.length, 1, 'only the explicitly selected runtime-counter candidate is recorded');
assert.equal(candidateManifest.candidateOverlay.operations[0].value, '0');
assert.equal(candidateManifest.entryInventoryScope.includes('except candidate/manifest.json'), true);
assert.equal(candidateManifest.source.bytes, zipContents.get('source/twodeers-recovery-salvage.json').size);
assert.equal(candidateManifest.source.crc32, zipEntryChecksums.get('source/twodeers-recovery-salvage.json'), 'manifest source CRC must match the original source ZIP member');
assert.equal(candidateOverlay.applyable, false);
assert.equal(candidateOverlay.writesPerformed, false);
assert.equal(candidateOverlay.selectedOperations.length, 1);
assert.equal(JSON.stringify(candidatePreview).includes(sensitiveText), false, 'preview member must remain privacy-safe while source member retains exact original data');
assert.match(docElements.get('recoveryWorkbenchStatus').textContent, /未写入当前空间/);
fakeWindow.confirm = () => false;
const cancelled = await api.downloadCandidatePackage();
assert.equal(cancelled.cancelled, true);
assert.equal(downloads.length, 3, 'cancelling privacy confirmation must not create another file');

const completePayload = {
  format: 'twodeers-recovery-salvage', formatVersion: 1, generatedAt: new Date(0).toISOString(),
  importableAsBackup: false, complete: true,
  diagnosticReport: { format: 'twodeers-storage-diagnostic', formatVersion: 1, localStorage: { rows: [] }, media: { missingCount: 0, missingIds: [] } },
  localStorageRaw: [{ key: '__twodeers_runtime_revision_v1', raw: 'not-a-counter', parseStatus: 'unclassified' }],
  mediaRecords: [], fontLibrary: null, recoveryJournal: null, omissions: [],
};
const completePreview = api.analyzeObject(completePayload);
assert.equal(completePreview.summary.manualReview, 0);
assert.equal(completePreview.summary.binaryInvalid, 0);
assert.equal(completePreview.source.complete, true);
assert.equal(candidateButton.disabled, false);
proposalToggle.checked = true;
fakeWindow.confirm = () => true;
const readyResult = await api.downloadCandidatePackage();
assert.equal(readyResult.status, 'ready-for-independent-validation', 'only a complete, no-manual-review source can reach independent-validation-ready status');
assert.equal(readyResult.selectedOperations, 1);
assert.equal(readyResult.manifest.candidateOverlay.applyable, false, 'ready means eligible for a later isolated validator, not importable or applied');

const reanalysisBlob = new Blob([fileText], { type: 'application/json' });
fileInput.files = [reanalysisBlob];
await docElements.get('recoveryWorkbenchAnalyzeBtn').listeners.click();
assert.equal(candidateButton.disabled, false);
fileInput.files = [new Blob([fileText], { type: 'application/json' })];
await assert.rejects(() => api.downloadCandidatePackage(), /不同/ , 'changed FileList without a change event must not package a stale analysis');
fileInput.listeners.change();
assert.equal(candidateButton.disabled, true, 'choosing a new source invalidates the previous candidate and proposal selection');
await assert.rejects(() => api.downloadCandidatePackage(), /先成功分析/);

api.analyzeObject(missingChatReference);
proposalToggle.checked = false;
const unresolvedCandidate = await api.downloadCandidatePackage();
assert.equal(unresolvedCandidate.status, 'review-required', 'missing cross-module media references must prevent independent-validation readiness');
assert.equal(unresolvedCandidate.manifest.classifications.missingMediaReferences, 1);
assert.equal(unresolvedCandidate.manifest.candidateOverlay.operations.length, 0);

console.log('PASS: Phase 12 salvage analysis, privacy-safe preview, explicit candidate overlay selection, byte-preserving source preservation, ZIP manifest/preview/overlay/README composition, complete/incomplete source gating, cross-module media reachability (chat/stickers/mailbox/Circle/journal), malformed Circle-state detection, legacy Circle Data URL validation, missing and malformed reference detection, source-selection invalidation, non-importable/no-write markers, user privacy confirmation, and cancellation handling.');
