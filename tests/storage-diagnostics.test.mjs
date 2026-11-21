import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'storage-diagnostics.js'), 'utf8');
const values = new Map([
  ['dual_space_app_clean_test_v1', JSON.stringify({ chatHistory: [{ id: 'message-1', text: 'private-chat-message' }], stickers: [], cardPhrases: [] })],
  ['twodeers_card_system_v1', '{broken-card-json'],
  ['dual_space_sticker_library_v1', JSON.stringify({ version: 1, items: [], tombstones: [], favorites: [] })],
  ['twodeers_mailbox_letters_v1', JSON.stringify({ mailbox: { items: [], pending: [], settings: {} } })],
  ['circle_state_key', JSON.stringify({ posts: [] })],
  ['circle_state_key_visitor_backup_step01b', '{broken-visitor-json'],
  ['legacy_unknown_key', JSON.stringify({ legacy: true })],
]);
let storageWrites = 0;
const localStorage = {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] ?? null; },
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { storageWrites++; values.set(key, String(value)); },
  removeItem(key) { storageWrites++; values.delete(key); },
};
const mediaBlob = new Blob(['media-binary-payload'], { type: 'image/gif' });
const fontBlob = new Blob(['font-binary-payload'], { type: 'font/woff2' });
const journalBlob = new Blob(['journal-media-payload'], { type: 'image/png' });
const journal = {
  id: 'v4-restore-active', formatVersion: 1, phase: 'prepared', kind: 'all', createdAt: 123,
  oldState: '{"chatHistory":[]}', oldStorage: '{"chatHistory":[]}',
  oldBinary: new Uint8Array([1, 2, 3]).buffer, oldBinaryView: new Uint8Array([4, 5, 6]),
  oldMedia: [['old-media', { id: 'old-media', blob: journalBlob, kind: 'image', size: journalBlob.size }]],
  oldFonts: { currentFontId: 'old-font', fonts: [{ id: 'old-font', format: 'woff2', size: fontBlob.size, blob: fontBlob }] },
};
const created = new Map();
const downloads = [];
const localStorageStatus = { textContent: '', dataset: {} };
const buttons = new Map(['storageDiagnosticsBtn', 'storageReportExportBtn', 'storageSalvageExportBtn'].map(id => [id, { disabled: false, addEventListener(type, fn) { this.handler = fn; } }]));
const document = {
  getElementById(id) { return id === 'storageDiagnosticsStatus' ? localStorageStatus : buttons.get(id) || null; },
  createElement(tag) {
    assert.equal(tag, 'a');
    return { style: {}, href: '', download: '', click() { downloads.push({ name: this.download, blob: created.get(this.href) }); }, remove() {} };
  },
  body: { appendChild() {} },
};
const databaseRows = [
  { name: 'dual_space_chat_media_v1', version: 1 },
  { name: 'chuanxun-local-font-library', version: 1 },
  { name: 'twodeers-recovery-journal-v1', version: 1 },
];
const fakeWindow = {
  __duoStorageBootIssues: [{ key: 'twodeers_card_system_v1', name: 'SyntaxError', message: 'Unexpected token', detectedAt: 10 }],
  localStorage,
  document,
  navigator: { userAgent: 'Test Chromium', storage: { estimate: async () => ({ usage: 500, quota: 2000 }) } },
  location: { origin: 'https://example.test' },
  indexedDB: { databases: async () => databaseRows },
  URL: {
    createObjectURL(blob) { const id = 'blob:test-' + created.size; created.set(id, blob); return id; },
    revokeObjectURL() {},
  },
  setTimeout() {},
  btoa(value) { return Buffer.from(value, 'binary').toString('base64'); },
  __duoRuntimeCoordinator: {
    journalDatabaseName: 'twodeers-recovery-journal-v1',
    getStatus: () => ({ ready: true, writable: false, blocked: true, reason: 'damaged local record' }),
    estimateStorage: async () => ({ supported: true, usage: 500, quota: 2000, percent: 0.25 }),
    readRecoveryJournal: async () => journal,
  },
  __duoCircleApi: {
    getStoreKey: () => 'circle_state_key',
    validateState(value) { if (!value || !Array.isArray(value.posts)) throw new Error('bad circle'); return value; },
  },
  __duoMailbox: { validateData() {} },
  __duoCardSystem: { validateData() {} },
  __duoMediaStorageDiagnostics: {
    databaseName: 'dual_space_chat_media_v1',
    readAll: async () => [{ id: 'media-1', blob: mediaBlob, size: mediaBlob.size, kind: 'image', mimeType: mediaBlob.type, name: 'animated.gif', createdAt: 1 }],
  },
  async auditMediaStorage(options) {
    assert.equal(options.cleanup, false, 'diagnostic inspection must never request orphan cleanup');
    return { recordCount: 1, referencedCount: 1, missingIds: [], orphanCandidates: 0, storage: { percent: 0.25 }, checkedAt: 100 };
  },
  ChuanXunFontManager: {
    _dbName: 'chuanxun-local-font-library',
    async exportData() { return { currentFontId: 'old-font', fonts: [{ id: 'old-font', format: 'woff2', size: fontBlob.size, blob: fontBlob }] }; },
    async validateData() { return true; },
  },
};
vm.runInNewContext(source, {
  window: fakeWindow,
  Blob,
  TextEncoder,
  ArrayBuffer,
  Uint8Array,
  WeakSet,
  WeakMap,
  Set,
  Map,
  Date,
  Promise,
  JSON,
  Object,
  Number,
  String,
  Error,
  Math,
  Buffer,
}, { filename: 'storage-diagnostics.js' });

const api = fakeWindow.__duoStorageDiagnostics;
assert.ok(api, 'diagnostics API must be exposed');
const report = await api.inspect();
const cardRow = report.localStorage.rows.find(row => row.key === 'twodeers_card_system_v1');
assert.equal(cardRow.status, 'corrupt-json');
assert.equal(report.localStorage.rows.find(row => row.key === 'dual_space_app_clean_test_v1').status, 'valid');
assert.equal(report.media.status, 'readable');
assert.equal(report.fonts.binaryValidation, 'passed');
assert.equal(report.recoveryJournal.phase, 'prepared');
assert.equal(JSON.stringify(report).includes('private-chat-message'), false, 'metadata-only report must not contain chat body text');
assert.equal(storageWrites, 0, 'inspection must not modify localStorage');

await api.exportReport();
assert.equal(downloads.length, 1);
const diagnosticFile = JSON.parse(await downloads[0].blob.text());
assert.equal(diagnosticFile.format, 'twodeers-storage-diagnostic');
assert.equal(JSON.stringify(diagnosticFile).includes('private-chat-message'), false);

const salvageResult = await api.exportRecoverable();
assert.equal(downloads.length, 2);
const salvage = JSON.parse(await downloads[1].blob.text());
assert.equal(salvage.format, 'twodeers-recovery-salvage');
assert.equal(salvage.importableAsBackup, false, 'salvage export must not pretend to be a normal importable backup');
assert.equal(salvage.complete, true);
assert.equal(salvageResult.omitted, 0);
assert.equal(salvage.localStorageRaw.find(row => row.key === 'twodeers_card_system_v1').raw, '{broken-card-json', 'corrupted raw bytes must be preserved verbatim as text');
assert.equal(salvage.mediaRecords[0].blob.__type, 'Blob');
assert.equal(Buffer.from(salvage.mediaRecords[0].blob.dataUrl.split(',')[1], 'base64').toString(), 'media-binary-payload');
assert.equal(Buffer.from(salvage.fontLibrary.fonts[0].blob.dataUrl.split(',')[1], 'base64').toString(), 'font-binary-payload');
assert.equal(Buffer.from(salvage.recoveryJournal.oldMedia[0][1].blob.dataUrl.split(',')[1], 'base64').toString(), 'journal-media-payload');
assert.equal(Buffer.from(salvage.recoveryJournal.oldBinary.base64, 'base64').toString('hex'), '010203', 'ArrayBuffer snapshots must be included in the binary budget and preserved');
assert.equal(Buffer.from(salvage.recoveryJournal.oldBinaryView.base64, 'base64').toString('hex'), '040506', 'typed-array snapshots must be included in the binary budget and preserved');
assert.equal(storageWrites, 0, 'salvage export must not write or delete source data');

console.log('PASS: metadata-only diagnostics, corrupt localStorage detection, read-only media/font/journal inspection, exact raw salvage preservation, Blob export for media/fonts/recovery snapshots, and no source writes.');

// When database enumeration is supported and a store is absent, diagnostics
// must not open it (opening without a version would create an empty database).
let forbiddenOpenCalls = 0;
const absentButtons = new Map();
const absentDocument = { getElementById(id) { return id === 'storageDiagnosticsStatus' ? { textContent: '', dataset: {} } : absentButtons.get(id) || null; }, createElement() { throw new Error('download is not expected in this branch'); }, body: { appendChild() {} } };
const absentWindow = {
  localStorage: { length: 1, key() { return 'legacy_token'; }, getItem() { return 'not-json-but-unclassified'; }, setItem() { throw new Error('write forbidden'); }, removeItem() { throw new Error('write forbidden'); } },
  document: absentDocument, navigator: { storage: { estimate: async () => ({}) } }, location: { origin: 'https://example.test' },
  indexedDB: { databases: async () => [] }, URL: {}, setTimeout() {}, btoa() { throw new Error('btoa should not be called'); },
  __duoRuntimeCoordinator: { journalDatabaseName: 'twodeers-recovery-journal-v1', getStatus: () => ({}), estimateStorage: async () => ({}), async readRecoveryJournal() { forbiddenOpenCalls++; throw new Error('must not open absent journal DB'); } },
  __duoMediaStorageDiagnostics: { databaseName: 'dual_space_chat_media_v1', async readAll() { forbiddenOpenCalls++; throw new Error('must not open absent media DB'); } },
  ChuanXunFontManager: { _dbName: 'chuanxun-local-font-library', async exportData() { forbiddenOpenCalls++; throw new Error('must not open absent font DB'); } },
};
vm.runInNewContext(source, { window: absentWindow, Blob, TextEncoder, ArrayBuffer, Uint8Array, WeakSet, WeakMap, Set, Map, Date, Promise, JSON, Object, Number, String, Error, Math, Buffer }, { filename: 'storage-diagnostics-absent-db.js' });
const absentReport = await absentWindow.__duoStorageDiagnostics.inspect();
assert.equal(absentReport.media.status, 'absent');
assert.equal(absentReport.fonts.status, 'absent');
assert.equal(absentReport.recoveryJournal.status, 'absent');
assert.equal(absentReport.localStorage.rows.find(row => row.key === 'legacy_token')?.status, 'unclassified', 'unknown non-JSON keys must not be incorrectly flagged as corrupt app data');
assert.equal(forbiddenOpenCalls, 0, 'absent databases must not be opened or created by a read-only diagnostic');

console.log('PASS: absent-database diagnostics do not create empty IndexedDB databases and unknown origin keys remain unclassified.');
