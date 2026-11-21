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
const engineSource = read('recovery-isolation-engine.js');
const executable = engineSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
assert.doesNotMatch(executable, /global\.(?:localStorage|indexedDB)|\b(?:localStorage|indexedDB)\s*\.\s*(?:setItem|removeItem|open|deleteDatabase)/, 'isolation engine must not access application storage');

const fakeWindow = { Blob, TextEncoder, TextDecoder, crypto: webcrypto };
const context = { window: fakeWindow, Blob, TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, Date, Number, String, Set, Map, Object, Array, JSON, Error, RegExp, Promise, Math, crypto: webcrypto };
vm.runInNewContext(zipSource, context, { filename: 'phase15-isolation-zip-builder.js' });
vm.runInNewContext(validatorSource, context, { filename: 'phase15-isolation-validator.js' });
vm.runInNewContext(engineSource, context, { filename: 'phase15-isolation-engine.js' });
const zipBuilder = fakeWindow.__duoRecoveryCandidateZip;
const validator = fakeWindow.__duoRecoveryCandidateValidator;
const engine = fakeWindow.__duoRecoveryIsolationEngine;
assert.ok(zipBuilder && validator && engine);

const revisionKey = '__twodeers_runtime_revision_v1';
const sourcePayload = {
  format: 'twodeers-recovery-salvage', formatVersion: 1, importableAsBackup: false, complete: true,
  generatedAt: new Date(0).toISOString(), omissions: [],
  diagnosticReport: { format: 'twodeers-storage-diagnostic', formatVersion: 1, localStorage: { rows: [] }, media: { missingCount: 0, missingIds: [] } },
  localStorageRaw: [
    { key: revisionKey, raw: 'NaN', parseStatus: 'unclassified' },
    { key: 'legacy_unknown', raw: '{opaque original content', parseStatus: 'unclassified' },
  ],
  mediaRecords: [], fontLibrary: { currentFontId: null, fonts: [] }, recoveryJournal: null,
};
const approved = {
  operation: 'localStorage-set-candidate', key: revisionKey, value: '0', sourceBeforeSummary: '无效版本计数（3 字节）',
  reason: 'only a review candidate', preconditions: ['关闭同源的其他 Twodeers 标签页和窗口', '退出后重新打开应用，再由独立恢复流程决定是否应用该提案'],
  requiresIndependentReview: true,
};
const overlay = { format: 'twodeers-recovery-overlay', version: 1, applyable: false, writesPerformed: false, selectedOperations: [approved] };
const preview = {
  format: 'twodeers-recovery-preview', formatVersion: 1, importableAsBackup: false, writesPerformed: false,
  source: { format: sourcePayload.format, formatVersion: sourcePayload.formatVersion, complete: true, omissions: 0 }, summary: {
    total: 1, safeRebuild: 1, preserve: 0, manualReview: 0, binaryValid: 0, binaryInvalid: 0,
    referencesChecked: 0, missingMediaReferences: 0, invalidMediaReferences: 0, legacyDataUrlsChecked: 0, legacyDataUrlsInvalid: 0,
  }, items: [{ path: 'localStorage.' + revisionKey, classification: '可安全重建', reason: '无效版本计数，仅作为隔离预览' }], proposals: [{ type: 'localStorage-set-preview', path: 'localStorage.' + revisionKey, proposedValue: '0', preconditions: approved.preconditions }],
};
const sourceBlob = new Blob([JSON.stringify(sourcePayload)], { type: 'application/json' });
const previewBlob = new Blob([JSON.stringify(preview)], { type: 'application/json' });
const overlayBlob = new Blob([JSON.stringify(overlay)], { type: 'application/json' });
const readmeBlob = new Blob(['此文件不是 V4 备份。原始救援 JSON 保留。'], { type: 'text/plain' });
const initialRows = [
  { name: 'source/twodeers-recovery-salvage.json', blob: sourceBlob },
  { name: 'candidate/preview.json', blob: previewBlob },
  { name: 'candidate/overlay.json', blob: overlayBlob },
  { name: 'README.txt', blob: readmeBlob },
];
const manifestEntries = [];
for (const row of initialRows) manifestEntries.push({ path: row.name, bytes: row.blob.size, crc32: zipBuilder.crc32Hex(await validator.crc32Blob(row.blob)) });
const manifest = {
  format: 'twodeers-recovery-candidate', formatVersion: 1, importableAsBackup: false, writesPerformed: false,
  status: 'ready-for-independent-validation',
  source: { entry: initialRows[0].name, format: sourcePayload.format, formatVersion: 1, bytes: sourceBlob.size, crc32: manifestEntries[0].crc32, generatedAt: sourcePayload.generatedAt, complete: true, omissions: 0 },
  inventory: { localStorageRecordCount: 2, localStorageKeys: sourcePayload.localStorageRaw.map((row) => row.key), mediaRecordCount: 0, mediaIds: [], fontRecordCount: 0, fontIds: [], recoveryJournalPresent: false },
  classifications: { total: 1, safeRebuildCandidates: 1, preserved: 0, manualReview: 0, binaryValid: 0, binaryInvalid: 0, referencesChecked: 0, missingMediaReferences: 0, invalidMediaReferences: 0, legacyDataUrlsChecked: 0, legacyDataUrlsInvalid: 0 },
  preservedItems: [], manualReviewItems: [],
  candidateOverlay: { format: 'twodeers-recovery-overlay', version: 1, applyable: false, writesPerformed: false, operations: [approved] },
  entryInventoryScope: 'all payload entries except candidate/manifest.json (self-reference is intentionally excluded)', entries: manifestEntries,
  guardrails: ['This archive is not a standard Twodeers backup and must not be imported through V4 or legacy restore.'],
};
const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
const candidateZip = (await zipBuilder.buildStoredZip([...initialRows, { name: 'candidate/manifest.json', blob: manifestBlob }])).blob;
const validated = await validator.validateFile(candidateZip);
assert.equal(validated.ok, true);
const originalRaw = sourcePayload.localStorageRaw.map((row) => row.raw);

const built = await engine.buildBundle(validated, { includeValidatedCandidateOperations: true });
assert.equal(built.manifest.format, 'twodeers-isolated-reconstruction');
assert.equal(built.manifest.importableAsBackup, false);
assert.equal(built.manifest.writesPerformed, false);
assert.equal(built.manifest.promotable, false);
assert.equal(built.manifest.status, 'isolated-preview-built');
assert.equal(built.manifest.changes.applied.length, 1);
assert.equal(built.report.appliedOperationCount, 1);
assert.equal(built.inspection.verified, true);
assert.equal(built.inspection.reconciled, true, 'the final ZIP must reconcile every embedded entry to its expected in-memory Blob');
assert.equal(built.inspection.reconciliation.length, 6);
assert.equal(built.inspection.reconciliation.every((entry) => entry.matchesExpectedBytes), true);
assert.equal(built.inspection.entries.length, 6);
assert.deepEqual(sourcePayload.localStorageRaw.map((row) => row.raw), originalRaw, 'isolated reconstruction must never mutate the parsed source payload');

async function readStoredZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map(); let cursor = 0;
  while (cursor + 30 <= bytes.length && view.getUint32(cursor, true) === 0x04034B50) {
    const size = view.getUint32(cursor + 18, true); const nameLength = view.getUint16(cursor + 26, true); const extra = view.getUint16(cursor + 28, true);
    const name = new TextDecoder().decode(bytes.slice(cursor + 30, cursor + 30 + nameLength));
    const start = cursor + 30 + nameLength + extra; out.set(name, bytes.slice(start, start + size)); cursor = start + size;
  }
  return out;
}
const entries = await readStoredZip(built.blob);
assert.ok(entries.has('base/twodeers-recovery-candidate.zip'));
assert.ok(entries.has('isolated/localStorageRaw.json'));
assert.ok(entries.has('isolated/changes.json'));
assert.ok(entries.has('validation/report.json'));
assert.deepEqual(entries.get('base/twodeers-recovery-candidate.zip'), new Uint8Array(await candidateZip.arrayBuffer()), 'the embedded base ZIP must remain byte-for-byte unchanged');
const isolatedRows = JSON.parse(new TextDecoder().decode(entries.get('isolated/localStorageRaw.json')));
assert.equal(isolatedRows.find((row) => row.key === revisionKey).raw, '0');
assert.equal(isolatedRows.find((row) => row.key === 'legacy_unknown').raw, '{opaque original content');
const changes = JSON.parse(new TextDecoder().decode(entries.get('isolated/changes.json')));
assert.equal(changes.applied.length, 1);
assert.equal(changes.writesPerformed, false);
const isolatedReport = JSON.parse(new TextDecoder().decode(entries.get('validation/report.json')));
assert.equal(isolatedReport.importableAsBackup, false);
assert.equal(isolatedReport.promotable, false);

// A structurally valid ZIP with a digest that no longer matches its expected in-memory entry must not pass the second pass.
const inspectOriginal = validator.inspectStoredZip;
validator.inspectStoredZip = async (...args) => {
  const result = await inspectOriginal(...args);
  result.entries[0].sha256 = '0'.repeat(64);
  return result;
};
await assert.rejects(() => engine.buildBundle(validated, { includeValidatedCandidateOperations: false }), /逐项校验不一致/);
validator.inspectStoredZip = inspectOriginal;

const unchanged = await engine.buildBundle(validated, { includeValidatedCandidateOperations: false });
const unchangedEntries = await readStoredZip(unchanged.blob);
const unchangedRows = JSON.parse(new TextDecoder().decode(unchangedEntries.get('isolated/localStorageRaw.json')));
assert.equal(unchangedRows.find((row) => row.key === revisionKey).raw, 'NaN', 'default isolation mode must preserve the source raw value');
assert.equal(unchanged.manifest.changes.applied.length, 0);
assert.equal(unchanged.manifest.changes.deferred.length, 1);

const reviewRequired = { ...validated, manifest: { ...validated.manifest, status: 'review-required' } };
await assert.rejects(() => engine.buildBundle(reviewRequired, { includeValidatedCandidateOperations: true }), /review-required/);
const reviewBundle = await engine.buildBundle(reviewRequired, { includeValidatedCandidateOperations: false });
assert.equal(reviewBundle.manifest.status, 'review-required');

console.log('PASS: isolated copy-on-write reconstruction, validated allowlisted revision proposal, source preservation, complete localStorage snapshot, base ZIP byte preservation, default no-op mode, review-required refusal, output ZIP reinspection with byte/CRC/SHA reconciliation, corrupted-output rejection, and no live storage access.');
