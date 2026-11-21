import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'recovery-candidate-package.js'), 'utf8');
const executableSource = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
assert.doesNotMatch(executableSource, /global\.(?:localStorage|indexedDB)|\b(?:localStorage|indexedDB)\s*\.\s*(?:setItem|removeItem|open|deleteDatabase)/, 'ZIP builder must not access application storage');

const fakeWindow = { Blob, TextEncoder };
vm.runInNewContext(source, {
  window: fakeWindow, Blob, TextEncoder, Uint8Array, Uint32Array, DataView,
  Date, Number, String, Set, Array, Math, Error, Promise,
}, { filename: 'recovery-candidate-package.js' });

const zip = fakeWindow.__duoRecoveryCandidateZip;
assert.ok(zip, 'ZIP builder must install');
assert.equal(zip.crc32Hex(0xCBF43926), 'cbf43926');
const known = new Blob(['123456789']);
assert.equal(zip.crc32Hex(await zip.crc32Blob(known)), 'cbf43926', 'CRC-32 must match the standard check vector');

const legacyWindow = { Blob, TextEncoder };
legacyWindow.FileReader = class {
  readAsArrayBuffer(slice) { slice.nativeBlob.arrayBuffer().then((buffer) => { this.result = buffer; this.onload(); }, (error) => { this.error = error; this.onerror(); }); }
};
const legacyContext = { window: legacyWindow, Blob, TextEncoder, Uint8Array, Uint32Array, DataView, Date, Number, String, Set, Array, Math, Error, Promise };
vm.runInNewContext(source, legacyContext, { filename: 'recovery-candidate-package-legacy.js' });
const legacyBlob = new Blob(['123456789']);
const legacyWrapper = { size: legacyBlob.size, slice(start, end) { const nativeBlob = legacyBlob.slice(start, end); return { size: nativeBlob.size, nativeBlob }; } };
assert.equal(legacyWindow.__duoRecoveryCandidateZip.crc32Hex(await legacyWindow.__duoRecoveryCandidateZip.crc32Blob(legacyWrapper)), 'cbf43926', 'FileReader fallback must validate Blob slices on older WebViews');

const sourceFile = new Blob(['{"format":"twodeers-recovery-salvage","raw":"keep-this-exact"}'], { type: 'application/json' });
const manifest = new Blob(['{"format":"twodeers-recovery-candidate","applyable":false}'], { type: 'application/json' });
const readme = new Blob(['isolated candidate package']);
const result = await zip.buildStoredZip([
  { name: 'source/twodeers-recovery-salvage.json', blob: sourceFile },
  { name: 'candidate/manifest.json', blob: manifest },
  { name: 'README.txt', blob: readme },
]);
assert.equal(result.compression, 'STORE');
assert.equal(result.entries.length, 3);
const archiveBytes = new Uint8Array(await result.blob.arrayBuffer());
const archiveView = new DataView(archiveBytes.buffer, archiveBytes.byteOffset, archiveBytes.byteLength);
const decoder = new TextDecoder();
const names = [];
const contents = new Map();
let cursor = 0;
while (cursor + 30 <= archiveBytes.length && archiveView.getUint32(cursor, true) === 0x04034B50) {
  const checksum = archiveView.getUint32(cursor + 14, true);
  const compressedSize = archiveView.getUint32(cursor + 18, true);
  const uncompressedSize = archiveView.getUint32(cursor + 22, true);
  const nameLength = archiveView.getUint16(cursor + 26, true);
  const extraLength = archiveView.getUint16(cursor + 28, true);
  const name = decoder.decode(archiveBytes.slice(cursor + 30, cursor + 30 + nameLength));
  const dataStart = cursor + 30 + nameLength + extraLength;
  const data = archiveBytes.slice(dataStart, dataStart + compressedSize);
  assert.equal(compressedSize, uncompressedSize, 'STORE entries must retain exact byte length');
  assert.equal(zip.crc32Hex(await zip.crc32Blob(new Blob([data]))), zip.crc32Hex(checksum), 'entry CRC must validate');
  names.push(name);
  contents.set(name, new Blob([data]));
  cursor = dataStart + compressedSize;
}
assert.deepEqual(names, ['source/twodeers-recovery-salvage.json', 'candidate/manifest.json', 'README.txt']);
assert.equal(await contents.get(names[0]).text(), await sourceFile.text(), 'source salvage bytes must be preserved byte-for-byte');
assert.equal(archiveView.getUint32(cursor, true), 0x02014B50, 'central directory must follow file data');
assert.equal(archiveView.getUint32(archiveBytes.length - 22, true), 0x06054B50, 'end-of-central-directory record must be present');
await assert.rejects(() => zip.buildStoredZip([{ name: '../escape.txt', blob: readme }]), /不安全/);
await assert.rejects(() => zip.buildStoredZip([{ name: 'same.txt', blob: readme }, { name: 'same.txt', blob: readme }]), /重复文件名/);
await assert.rejects(() => zip.buildStoredZip([{ name: 'large.txt', blob: new Blob(['too-large']) }], 4), /超过 132 MiB/);
console.log('PASS: CRC-32 standard vector, chunked Blob checksums, byte-preserving STORE ZIP, central directory and EOCD, UTF-8 entry inventory, unsafe path rejection, duplicate path rejection, archive size ceiling, and no application storage access.');
