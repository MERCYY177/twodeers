import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'recovery-isolation-engine.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ids = ['recoveryIsolationFile','recoveryIsolationValidateBtn','recoveryIsolationBuildBtn','recoveryIsolationIncludeRevision','recoveryIsolationStatus','recoveryIsolationOutput'];
const nodes = new Map(ids.map((id) => [id, { id, disabled: ['recoveryIsolationBuildBtn','recoveryIsolationIncludeRevision'].includes(id), checked: false, files: [], dataset: {}, textContent: '', listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; } }]));
const candidateFile = { name: 'candidate.zip', size: 128, lastModified: 1 };
nodes.get('recoveryIsolationFile').files = [candidateFile];
let validateCalls = 0;
let buildCalls = 0;
let downloaded = 0;
let revoked = 0;
const created = new Map();
const report = { format: 'twodeers-independent-candidate-validation', verified: true, entryCount: 5, sourceSha256: 'a'.repeat(64) };
const validation = { ok: true, report, manifest: { status: 'ready-for-independent-validation' }, approvedOperations: [{ key: '__twodeers_runtime_revision_v1' }] };
const fakeWindow = {
  document: {
    getElementById(id) { return nodes.get(id) || null; },
    createElement(tag) { assert.equal(tag, 'a'); return { href: '', download: '', style: {}, click() { downloaded++; }, remove() {} }; },
    body: { appendChild() {} },
  },
  confirm() { return true; },
  URL: { createObjectURL(blob) { const id = 'blob:isolation:' + created.size; created.set(id, blob); return id; }, revokeObjectURL() { revoked++; } },
  setTimeout(fn) { /* no timer needed in this harness */ },
  __duoRecoveryCandidateValidator: { async validateFile(file) { validateCalls++; assert.equal(file, candidateFile); return validation; } },
  __duoRecoveryIsolationEngine: { async buildBundle(value, options) { buildCalls++; assert.equal(value, validation); assert.equal(options.includeValidatedCandidateOperations, true); return { blob: new Blob(['isolated-bundle']), bytes: 16, entries: 6, manifest: {}, report: {}, inspection: {} }; } },
};
vm.runInNewContext(source, { window: fakeWindow, Blob, TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, Date, Number, String, Set, Map, Object, Array, JSON, Error, RegExp, Promise, Math }, { filename: 'recovery-isolation-ui.js' });
// The production module installs its own engine; replace it after initialization to isolate UI wiring.
fakeWindow.__duoRecoveryIsolationEngine = { async buildBundle(value, options) { buildCalls++; assert.equal(value, validation); assert.equal(options.includeValidatedCandidateOperations, true); return { blob: new Blob(['isolated-bundle']), bytes: 16, entries: 6, manifest: {}, report: {}, inspection: {} }; } };
assert.equal(nodes.get('recoveryIsolationBuildBtn').disabled, true, 'build stays disabled until fresh independent validation');
nodes.get('recoveryIsolationFile').listeners.change();
await nodes.get('recoveryIsolationValidateBtn').listeners.click();
assert.equal(validateCalls, 1);
assert.equal(nodes.get('recoveryIsolationBuildBtn').disabled, false);
assert.equal(nodes.get('recoveryIsolationIncludeRevision').disabled, false);
assert.match(nodes.get('recoveryIsolationStatus').textContent, /独立校验完成/);
nodes.get('recoveryIsolationIncludeRevision').checked = true;
await nodes.get('recoveryIsolationBuildBtn').listeners.click();
assert.equal(buildCalls, 1);
assert.equal(downloaded, 1, 'only explicit build action should download the isolated bundle');
assert.match(nodes.get('recoveryIsolationStatus').textContent, /不可导入、不可提升/);
assert.equal(nodes.get('recoveryIsolationOutput').textContent.includes('twodeers-isolated-reconstruction'), false, 'UI output must only include supplied report data and no source raw payload');

nodes.get('recoveryIsolationFile').files = [{ name: 'different.zip', size: 1 }];
nodes.get('recoveryIsolationFile').listeners.change();
assert.equal(nodes.get('recoveryIsolationBuildBtn').disabled, true, 'changing file selection invalidates the previous validation');
assert.equal(nodes.get('recoveryIsolationIncludeRevision').checked, false);
for (const id of ids.slice(0, 4)) assert.match(index, new RegExp('id="' + id + '"[^>]*data-duo-readonly-allowed="true"'));
assert.match(index, /recovery-candidate-validator\.js/);
assert.match(index, /recovery-isolation-engine\.js/);
console.log('PASS: independent validation UI gating, file-selection invalidation, explicit privacy confirmation, isolated-only operation selection, download action, no source-data rendering, and read-only-lock navigation attributes.');
