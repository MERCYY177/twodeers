import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Blob } from 'node:buffer';

const source = readFileSync(new URL('../backup-file-service.js', import.meta.url), 'utf8');

function createService(adapter) {
  const window = { triggerDownloadBlob: adapter };
  const sandbox = { window, Blob, Object, TypeError, Error, URL, document: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'backup-file-service.js' });
  return window.BackupFileService;
}

test('save delegates a same-realm Blob to the shared platform adapter', async () => {
  let received;
  const service = createService((name, blob) => { received = { name, blob }; return true; });
  const result = await service.save('test.zip', new Blob(['backup'], { type: 'application/zip' }));
  assert.equal(received.name, 'test.zip');
  assert.equal(await received.blob.text(), 'backup');
  assert.equal(result.status, 'handed-off');
  assert.equal(result.method, 'platform-adapter');
});

test('cross-realm Blob-like values are rewrapped before delegation', async () => {
  let received;
  const service = createService((name, blob) => { received = blob; return true; });
  const foreignBlob = {
    size: 6,
    type: 'application/octet-stream',
    slice() { return this; },
    async arrayBuffer() { return new TextEncoder().encode('binary').buffer; },
    get [Symbol.toStringTag]() { return 'Blob'; }
  };
  assert.equal(service.isBlobLike(foreignBlob), true);
  await service.save('cross-realm.bin', foreignBlob);
  assert.ok(received instanceof Blob);
  assert.equal(await received.text(), 'binary');
});

test('non-Blob inputs and adapter failures reject instead of reporting success', async () => {
  const service = createService(() => { throw new Error('user cancelled'); });
  await assert.rejects(() => service.save('bad.bin', { size: 1 }), /必须是 Blob/);
  await assert.rejects(() => service.save('cancelled.zip', new Blob(['x'])), /user cancelled/);
});
