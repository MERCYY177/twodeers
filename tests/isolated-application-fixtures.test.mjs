import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { createMissingMediaSeed, createValidSeed, PNG_BASE64 } from './isolated-application-fixtures.mjs';

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function validatePng(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8, width = 0, height = 0, compressed = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset); offset += 4;
    const type = buffer.toString('ascii', offset, offset + 4); offset += 4;
    const data = buffer.subarray(offset, offset + length); offset += length;
    const storedCrc = buffer.readUInt32BE(offset); offset += 4;
    assert.equal(crc32(Buffer.concat([Buffer.from(type), data])), storedCrc, `PNG ${type} chunk CRC`);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === 'IDAT') compressed.push(data);
    if (type === 'IEND') break;
  }
  assert.equal(offset, buffer.length, 'PNG must not have truncated chunks or trailing bytes');
  assert.equal(width, 1); assert.equal(height, 1);
  assert.ok(inflateSync(Buffer.concat(compressed)).length >= 4, 'PNG pixel stream should inflate');
}

const valid = createValidSeed();
const png = Buffer.from(valid.pngBase64, 'base64');
assert.equal(valid.pngBytes, png.length);
validatePng(png);
assert.equal(valid.media.length, 6);
assert.equal(new Set(valid.media.map(row => row.id)).size, valid.media.length);
assert.ok(valid.media.every(row => row.blob === null && row.mimeType === 'image/png' && row.size === png.length));

const mediaIds = new Set(valid.media.map(row => row.id));
assert.ok(mediaIds.has(valid.main.chatHistory.find(row => row.type === 'image').mediaId));
assert.ok(mediaIds.has(valid.stickerLibrary.items[0].mediaId));
assert.ok(mediaIds.has(valid.mailbox.items[0].images[0].id));
for (const ref of [valid.circle.myAvatar, valid.circle.myCover, valid.circle.posts[0].media[0].src]) {
  assert.ok(ref.startsWith('idb-media:'));
  assert.ok(mediaIds.has(ref.slice('idb-media:'.length)));
}
assert.deepEqual(valid.main.stickers.map(row => row.id), valid.stickerLibrary.items.map(row => row.id));
assert.deepEqual(valid.main.stickerFavorites, valid.stickerLibrary.favorites);
assert.equal(valid.cards.chatIds.length, valid.cards.chatTexts.length);
assert.equal(valid.cards.momentsDynamicIds.length, valid.cards.momentsDynamicTexts.length);
assert.equal(valid.cards.momentsReplyIds.length, valid.cards.momentsReplyTexts.length);
assert.equal(valid.cards.chatTexts[0], valid.main.cardPhrases[0]);
assert.equal(valid.cards.momentsDynamicTexts[0], valid.circle.dynamicCards[0]);
assert.equal(valid.cards.momentsReplyTexts[0], valid.circle.replyCards[0]);
assert.equal(valid.mailbox.items.length, 1);
assert.equal(valid.mailbox.items[0].images.length, 1);
assert.equal(valid.circle.posts.length, 1);

const missing = createMissingMediaSeed();
const missingId = missing.main.chatHistory[0].mediaId;
assert.ok(missingId);
assert.equal(missing.media.length, 0);
assert.equal(missing.media.some(row => row.id === missingId), false);
assert.equal(missing.main.chatHistory.length, 1);
console.log('PASS: Phase 17 synthetic valid/negative application fixtures; PNG signature/chunk CRC/IDAT decode; chat/sticker/mailbox/Circle shared-media references; card text/stable-ID alignment; missing-media negative sample.');
