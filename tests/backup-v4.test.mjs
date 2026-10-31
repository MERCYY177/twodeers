import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { TextEncoder, TextDecoder } from 'node:util';

const source = readFileSync(new URL('../backup-v4.js', import.meta.url), 'utf8');
const coordinatorSource = readFileSync(new URL('../backup-snapshot-coordinator.js', import.meta.url), 'utf8');
const state = {
  icons: {}, media: {}, avatarShape: 'round', bubbleShape: 'round',
  bubbleColors: { me:'#f2f5fb', other:'#fff' },
  appearanceColors: { theme:'#8aa05f', buttonBg:'#342d28', buttonText:'#fff' },
  appearanceSettings: { mode:'system', palette:'sage' },
  customCSS: '', replyWindow: {min:3,max:12}, showReadReceipt:true,
  typing:{enabled:true,text:'正在输入中'}, offline:{chatEnabled:true},
  cardPhrases:[], callSettings:{audioEnabled:true,videoEnabled:true},
  incomingCallSettings:{enabled:true}, stickerFavorites:[], chatHistory:[], stickers:[]
};
const mediaBlob = new Blob(['chat-media-binary']);
const sandbox = {
  state,
  window: { ChuanXunFontManager: { exportData: async () => ({ currentFontId: null, fonts: [] }) } },
  document: { addEventListener(){}, removeEventListener(){}, getElementById(){ return null; } },
  TextEncoder, TextDecoder, Blob,
  getCircleState(){ return {}; },
  getCurrentMediaIds(){ return sandbox.currentMediaIds || []; },
  currentMediaIds: ['media-test-1'],
  getMediaRecord(id){ return Promise.resolve(id === 'media-test-1' ? { id, blob: mediaBlob, kind:'image', mimeType:'image/png', name:'test.png', createdAt:1 } : null); },
  console
};
vm.createContext(sandbox);
vm.runInContext(coordinatorSource, sandbox, { filename:'backup-snapshot-coordinator.js' });
vm.runInContext(source, sandbox, { filename:'backup-v4.js' });
const api = sandbox.window.__duoBackupV4;

test('SHA-256 and CRC-32 use standard test vectors', async () => {
  const result = await api.inspect(new Blob(['abc']));
  assert.equal(result.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(result.crc32, '352441c2');
});

test('param v4 ZIP builds, parses, and verifies manifest resources', async () => {
  const archive = await api.build('param');
  assert.equal(archive.type, 'application/zip');
  const parsed = await api.unzip(archive);
  assert.equal(parsed.manifest.format, 'twodeers-backup');
  assert.equal(parsed.manifest.formatVersion, 4);
  assert.equal(parsed.manifest.kind, 'param');
  assert.equal(parsed.manifest.resources.length, 1);
  const stateFile = parsed.map.get('state.json');
  assert.ok(stateFile);
  const payload = JSON.parse(await stateFile.blob.text());
  assert.equal(payload.appearanceSettings.palette, 'sage');
});

test('all/chat V4 ZIP include media blobs and references', async () => {
  state.chatHistory = [{ id:'m1', type:'image', mediaId:'media-test-1' }];
  state.stickers = [{ id:'stk1', mediaId:'media-test-1', mimeType:'image/png' }];
  const all = await api.unzip(await api.build('all'));
  assert.equal(all.manifest.kind, 'all');
  assert.ok(all.map.has('circle-state.json'));
  const media = all.manifest.resources.find(x => x.type === 'media');
  assert.equal(media.id, 'media-test-1');
  assert.equal(await all.map.get(media.path).blob.text(), 'chat-media-binary');
  const chat = await api.unzip(await api.build('chat'));
  assert.equal(chat.manifest.kind, 'chat');
  assert.ok(chat.manifest.resources.some(x => x.type === 'media'));
});

test('corrupted ZIP resource bytes must fail SHA-256 validation', async () => {
  const archive = await api.build('param');
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const nameLength = bytes[26] | (bytes[27] << 8);
  const extraLength = bytes[28] | (bytes[29] << 8);
  const dataOffset = 30 + nameLength + extraLength;
  bytes[dataOffset + 1] ^= 0xff;
  await assert.rejects(() => api.unzip(new Blob([bytes])), /校验失败|manifest|ZIP/);
});
