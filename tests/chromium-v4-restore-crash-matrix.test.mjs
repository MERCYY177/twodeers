import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createValidSeed } from './isolated-application-fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harness = await readFile(path.join(ROOT, 'tests/chromium-v4-restore-crash-matrix.mjs'), 'utf8');
const workflow = await readFile(path.join(ROOT, '.github/workflows/isolated-restore-lifecycle.yml'), 'utf8');
const matrix = JSON.parse(await readFile(path.join(ROOT, 'docs/browser-recovery-acceptance-matrix.json'), 'utf8'));

const sourceMediaListMatch = harness.match(/const SOURCE_MEDIA_BYTE_LIST = \[([^\]]+)\];/);
assert.ok(sourceMediaListMatch, 'source media fixture must have one explicit byte list');
const sourceMediaBytes = Buffer.from(sourceMediaListMatch[1].split(',').map(value => Number(value.trim())));
assert.equal(sourceMediaBytes.length, 70, 'source media fixture must remain the complete 1x1 PNG fixture');
assert.deepEqual([...sourceMediaBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'source fixture must have a valid PNG signature');
let pngOffset = 8;
const pngChunks = [];
const idatParts = [];
while (pngOffset < sourceMediaBytes.length) {
  assert.ok(pngOffset + 12 <= sourceMediaBytes.length, 'source PNG chunk header and CRC must fit');
  const chunkLength = sourceMediaBytes.readUInt32BE(pngOffset);
  const chunkType = sourceMediaBytes.subarray(pngOffset + 4, pngOffset + 8);
  const chunkDataStart = pngOffset + 8;
  const chunkDataEnd = chunkDataStart + chunkLength;
  assert.ok(chunkDataEnd + 4 <= sourceMediaBytes.length, 'source PNG chunk data and CRC must fit');
  const expectedCrc = sourceMediaBytes.readUInt32BE(chunkDataEnd);
  const crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    return value >>> 0;
  });
  let actualCrc = 0xffffffff;
  for (const byte of Buffer.concat([chunkType, sourceMediaBytes.subarray(chunkDataStart, chunkDataEnd)])) actualCrc = crcTable[(actualCrc ^ byte) & 0xff] ^ (actualCrc >>> 8);
  actualCrc = (actualCrc ^ 0xffffffff) >>> 0;
  assert.equal(actualCrc, expectedCrc, `source PNG ${chunkType.toString('ascii')} chunk CRC must be valid`);
  pngChunks.push(chunkType.toString('ascii'));
  if (chunkType.toString('ascii') === 'IDAT') idatParts.push(sourceMediaBytes.subarray(chunkDataStart, chunkDataEnd));
  pngOffset = chunkDataEnd + 4;
}
assert.deepEqual(pngChunks, ['IHDR', 'IDAT', 'IEND'], 'source PNG must contain a complete minimal chunk sequence');
assert.equal(sourceMediaBytes.readUInt32BE(16), 1, 'source PNG width must be one pixel');
assert.equal(sourceMediaBytes.readUInt32BE(20), 1, 'source PNG height must be one pixel');
assert.deepEqual([...inflateSync(Buffer.concat(idatParts))], [0, 29, 41, 53, 255], 'source PNG image data must decode to its deterministic RGBA pixel');
assert.ok(harness.includes("Uint8Array.from([${SOURCE_MEDIA_BYTE_LIST.join(',')}])"), 'browser mutation must use the same validated PNG bytes as the Node evidence contract');

for (const stage of ['prepared', 'media', 'media-inflight', 'font', 'font-inflight', 'committed']) {
  assert.match(harness, new RegExp(`'${stage}'`), `real Chromium crash harness must include ${stage} checkpoint`);
}
assert.match(harness, /window\.__duoBackupV4\.build\('all'\)/, 'harness must build an actual V4 ZIP in Chromium');
assert.match(harness, /window\.__duoBackupV4\.restore\(window\.__phase30Archive\)/, 'harness must invoke the production V4 restore entrypoint');
assert.match(harness, /window\.putMediaBlob/, 'media checkpoint must intercept the actual global production media writer');
assert.match(harness, /id==='phase17-chat-media'/, 'media checkpoint must target the exact chat-media record used by the post-restart byte assertion');
assert.match(harness, /mediaBytes, TARGET_MEDIA_BASE64/, 'checkpoint must read back the target Blob bytes before SIGKILL');
assert.match(harness, /IDBObjectStore\.prototype\.put/, 'Phase 31 must hook the actual IndexedDB ObjectStore put request for an in-flight media transaction');
assert.match(harness, /IDBObjectStore\.prototype\.clear/, 'Phase 31 must hook the actual font-store clear request inside the snapshot transaction');
assert.match(harness, /Runtime\.addBinding/, 'in-flight checkpoints must reach the Node controller while the renderer event loop is blocked');
assert.match(harness, /Runtime\.bindingCalled/, 'the harness must wait for the DevTools binding emitted from the live transaction request event');
assert.match(harness, /probeQueued/, 'the checkpoint must queue a second request to prove the readwrite transaction remains active');
assert.match(harness, /transactionDurability:store\.transaction\.durability/, 'the in-flight event must capture the transaction durability mode');
assert.match(harness, /inspectPersistedProfileBeforeApp/, 'restart must inspect IndexedDB before application startup can mutate or recover it');
assert.match(harness, /assertPreStartupProfile\(stage, preStartupProfile, sourceFontBase64, targetFontBase64\)/, 'every crash stage must validate the raw pre-startup profile before app recovery');
assert.match(harness, /phase33-chromium-v4-ci-independent-matrix\.json/);
assert.match(harness, /sourceState:main\?\.chatHistory/);
assert.match(harness, /circleText:circle\?\.posts/);
assert.match(harness, /mediaRecords/);
assert.match(harness, /currentFontId:fontSnapshot\.currentFontId/);
assert.match(harness, /journalOldStateSource/);
assert.match(harness, /journalOldMediaBytes/);
assert.match(harness, /journalOldFontBytes/);
assert.match(harness, /requestDone/, 'raw IndexedDB inspections must not resolve on request success alone');
assert.match(harness, /tx\.oncomplete=/, 'raw IndexedDB inspections must wait for transaction completion');
assert.match(harness, /readFontSnapshot/, 'font rows and current-font pointer must be read in one consistent readonly transaction');
assert.match(harness, /indexedDB\.databases\(\)/, 'inspection must not create a missing database while trying to read crash evidence');
assert.match(harness, /preStartupProfile\.journalPhase, 'prepared'/, 'in-flight transaction crash must preserve PREPARED before the app is loaded');
assert.match(harness, /ChuanXunFontManager\.importData/, 'font checkpoint must intercept the actual font importer');
assert.match(harness, /markRecoveryCommitted/, 'committed checkpoint must stop after the real commit marker');
assert.match(harness, /process\.kill\(-child\.pid, 'SIGKILL'\)/, 'browser process group must be forcibly terminated');
assert.match(harness, /waitForProcessGroupExit\(child\.pid\)/, 'the browser process group must be proven gone before reusing its profile');
assert.match(harness, /processGroupGone:true/, 'process-group exit evidence must be stored in the JSON artifact');
assert.match(harness, /window\.__duoBackupV4\.unzip\(window\.__phase30Archive\)/, 'the actual archive manifest and resource bytes must be independently re-read before mutation');
assert.match(harness, /launchChrome\(binary, profile\)/, 'relaunch must reuse the same persistent browser profile');
assert.match(harness, /sourceState|targetState/);
assert.match(harness, /circleText/);
assert.match(harness, /mediaBytes/);
assert.match(harness, /fontId/);
assert.match(harness, /fontBytes/);
assert.match(harness, /assert\.notEqual\(targetFontBase64, sourceFontBase64/, 'source and target font fixtures must contain distinct real bytes');
assert.match(harness, /fontFiles/, 'restart verification must compare exact font Blob bytes, not only IDs');
assert.match(harness, /MEDIA_IDS/, 'restart verification must cover every media record in the all-backup fixture');
assert.match(harness, /CHECKPOINT_DETAIL_KEY/, 'each crash checkpoint must persist inspectable evidence about the operation that just completed');
assert.match(harness, /journalPhase/);
assert.match(harness, /externalRequests/);
assert.match(harness, /phase33-chromium-v4-ci-independent-matrix\.json/);
assert.doesNotMatch(harness, /mercyy177\.github\.io|github\.com\/MERCYY177\/twodeers/i, 'crash rehearsal must stay on isolated loopback origin');
assert.match(workflow, /v4-restore-crash-matrix:/, 'the crash matrix must have an independent CI job');
assert.match(workflow, /TWODEERS_E2E_ARTIFACT_DIR: test-results\/browser-e2e\/phase33/);
assert.match(workflow, /node tests\/chromium-v4-restore-crash-matrix\.mjs/);
assert.match(workflow, /test-results\/browser-e2e\/phase33\//);
const independentJob = workflow.slice(workflow.indexOf('  v4-restore-crash-matrix:'));
assert.doesNotMatch(independentJob, /\n    needs:/, 'the V4 crash matrix must not depend on Phase 18');
assert.match(independentJob, /timeout-minutes: 60/);
assert.match(independentJob, /if: always\(\)/, 'matrix evidence upload and hardening must run even when the browser matrix fails');
assert.match(independentJob, /playwright install --with-deps chromium/);
assert.match(independentJob, /actions\/upload-artifact@v4/);
const phase18Job = workflow.slice(workflow.indexOf('  isolated-restore-lifecycle:'), workflow.indexOf('  v4-restore-crash-matrix:'));
assert.doesNotMatch(phase18Job, /node tests\/chromium-v4-restore-crash-matrix\.mjs/, 'Phase 18 failure must not serially prevent the crash matrix from running');

const checkpointStart = harness.indexOf('function installCheckpointScript(stage) {');
const checkpointEnd = harness.indexOf('\nasync function waitForCheckpoint', checkpointStart);
assert.ok(checkpointStart >= 0 && checkpointEnd > checkpointStart, 'checkpoint source function must remain extractable for syntax validation');
const checkpointFactory = new Function('CHECKPOINT_KEY', 'CHECKPOINT_DETAIL_KEY', 'PHASE31_BINDING', `${harness.slice(checkpointStart, checkpointEnd)}; return installCheckpointScript;`);
const installCheckpointScript = checkpointFactory('__phase31-test-checkpoint__', '__phase31-test-detail__', '__phase31_test_binding__');
for (const stage of ['prepared', 'media', 'media-inflight', 'font', 'font-inflight', 'committed']) {
  const browserExpression = installCheckpointScript(stage);
  assert.ok(browserExpression.startsWith('(async()=>'), `${stage}: generated browser checkpoint must be an async IIFE`);
  assert.doesNotThrow(() => new Function(`return (${browserExpression});`), `${stage}: generated DevTools expression must parse before Chromium is launched`);
}

const profileAssertStart = harness.indexOf('function assertPreStartupProfile(stage, profile, sourceFontBase64, targetFontBase64) {');
const profileAssertEnd = harness.indexOf('\nasync function verifyAfterRestart(page, stage) {', profileAssertStart);
assert.ok(profileAssertStart >= 0 && profileAssertEnd > profileAssertStart, 'raw pre-startup profile assertions must be independently testable');
const profileAssertFactory = new Function('assert', 'MEDIA_IDS', 'SOURCE_MEDIA_BASE64', 'TARGET_MEDIA_BASE64', `${harness.slice(profileAssertStart, profileAssertEnd)}; return assertPreStartupProfile;`);
const targetMediaBase64 = createValidSeed().pngBase64;
const sourceMediaMatch = harness.match(/const SOURCE_MEDIA_BYTE_LIST = \[([^\]]+)\];/);
const sourceMediaBase64 = Buffer.from(sourceMediaMatch[1].split(',').map(value=>Number(value.trim()))).toString('base64');
const assertPreStartupProfile = profileAssertFactory(assert, ['phase17-chat-media','phase17-sticker-media','phase17-mail-media','phase17-circle-avatar','phase17-circle-cover','phase17-circle-post-media'], sourceMediaBase64, targetMediaBase64);
const sourceFontBase64 = Buffer.from('phase32-source-font-fixture').toString('base64');
const targetFontBase64 = Buffer.from('phase32-target-font-fixture-with-distinct-bytes').toString('base64');
const mediaIdsForProfile = ['phase17-chat-media','phase17-sticker-media','phase17-mail-media','phase17-circle-avatar','phase17-circle-cover','phase17-circle-post-media'];
for (const stage of ['prepared', 'media', 'media-inflight', 'font', 'font-inflight', 'committed']) {
  const chatSource = stage === 'prepared' || stage === 'media-inflight';
  const targetFonts = stage === 'font' || stage === 'committed';
  const circleTarget = ['font','font-inflight','committed'].includes(stage);
  const profile = {
    journalPhase: stage === 'committed' ? 'committed' : 'prepared',
    journalOldStateSource: true,
    journalOldCircleText: 'Phase 30 pre-restore Circle state',
    journalOldMediaBytes: sourceMediaBase64,
    journalOldFontId: 'phase30-source-font',
    journalOldFontBytes: sourceFontBase64,
    sourceState: stage !== 'committed',
    targetState: stage === 'committed',
    circleText: circleTarget ? '第十七阶段合成朋友圈动态' : 'Phase 30 pre-restore Circle state',
    mediaRecords: mediaIdsForProfile.map(id => ({ id, bytes:id==='phase17-chat-media'&&chatSource?sourceMediaBase64:targetMediaBase64, type:'image/png', size:Buffer.from(id==='phase17-chat-media'&&chatSource?sourceMediaBase64:targetMediaBase64,'base64').length })),
    sourceFontId: targetFonts ? null : 'phase30-source-font',
    sourceFontBytes: targetFonts ? null : sourceFontBase64,
    targetFontId: targetFonts ? 'phase30-target-font' : null,
    targetFontBytes: targetFonts ? targetFontBase64 : null,
    fontFiles: targetFonts ? [{ id:'phase30-target-font', size:Buffer.from(targetFontBase64,'base64').length, bytes:targetFontBase64 }] : [{ id:'phase30-source-font', size:Buffer.from(sourceFontBase64,'base64').length, bytes:sourceFontBase64 }],
    currentFontId: targetFonts ? 'phase30-target-font' : 'phase30-source-font'
  };
  assert.doesNotThrow(() => assertPreStartupProfile(stage, profile, sourceFontBase64, targetFontBase64), `${stage}: synthetic pre-startup snapshot should match the actual crash boundary`);
  const corruptMedia = structuredClone(profile);
  corruptMedia.mediaRecords[0].bytes = chatSource ? targetMediaBase64 : sourceMediaBase64;
  assert.throws(() => assertPreStartupProfile(stage, corruptMedia, sourceFontBase64, targetFontBase64), `${stage}: an incorrect crash-time media Blob must be rejected before app startup`);
  const corruptFont = structuredClone(profile);
  corruptFont.fontFiles[0].bytes = targetFonts ? sourceFontBase64 : targetFontBase64;
  assert.throws(() => assertPreStartupProfile(stage, corruptFont, sourceFontBase64, targetFontBase64), `${stage}: an incorrect crash-time font Blob must be rejected before app startup`);
  const corruptJournal = structuredClone(profile);
  corruptJournal.journalPhase = stage === 'committed' ? 'prepared' : 'committed';
  assert.throws(() => assertPreStartupProfile(stage, corruptJournal, sourceFontBase64, targetFontBase64), `${stage}: an incorrect crash-time journal phase must be rejected before app startup`);
  const corruptJournalSnapshot = structuredClone(profile);
  corruptJournalSnapshot.journalOldMediaBytes = targetMediaBase64;
  assert.throws(() => assertPreStartupProfile(stage, corruptJournalSnapshot, sourceFontBase64, targetFontBase64), `${stage}: a corrupt rollback snapshot must be rejected before app startup`);
}

const phase18 = matrix.browserSuites.find(item => item.id === 'phase18-restore-lifecycle');
assert.ok(phase18, 'Phase 18 isolated restore workflow must own the real crash matrix');
assert.ok(phase18.supportingTests.includes('tests/chromium-v4-restore-crash-matrix.mjs'));
assert.ok(phase18.supportingTests.includes('tests/chromium-v4-restore-crash-matrix.test.mjs'));
assert.ok(phase18.browserScenarios.some(item => item.includes('PREPARED') && item.includes('COMMITTED') && item.includes('SIGKILL')));
assert.equal(phase18.realBrowserStatus, 'not-run');
assert.equal(phase18.githubActionsStatus, 'not-run');
const phase30Gate = matrix.crossCuttingGates.find(gate => gate.id === 'phase30-v4-crash-checkpoint-integrity');
assert.ok(phase30Gate, 'Phase 30 exact checkpoint integrity gate must be represented');
assert.equal(phase30Gate.localStatus, 'passed');
assert.equal(phase30Gate.browserExecutionStatus, 'blocked-local-admin-policy');
assert.equal(phase30Gate.ciExecutionStatus, 'not-run');
assert.ok(phase30Gate.requiredAssertions.some(item => item.includes('valid deterministic PNG') && item.includes('CRC')), 'Phase 30 gate must keep the source-media PNG validity contract explicit');
const phase31Gate = matrix.crossCuttingGates.find(gate => gate.id === 'phase31-v4-inflight-transaction-durability');
assert.ok(phase31Gate, 'Phase 31 in-flight transaction durability gate must be represented');
assert.equal(phase31Gate.localStatus, 'passed');
assert.equal(phase31Gate.browserExecutionStatus, 'blocked-local-admin-policy');
assert.equal(phase31Gate.ciExecutionStatus, 'not-run');
assert.ok(phase31Gate.requiredAssertions.some(item => item.includes('media transaction') && item.includes('request success')));
assert.ok(phase31Gate.requiredAssertions.some(item => item.includes('font clear') && item.includes('same atomic transaction')));
assert.ok(phase31Gate.requiredAssertions.some(item => item.includes('strict') && item.includes('PREPARED')));
assert.ok(harness.includes("['prepared','media','media-inflight','font','font-inflight','committed']"), 'Phase 31 browser matrix must execute both in-flight transaction kill points');
assert.ok(harness.includes('phase33-chromium-v4-ci-independent-matrix.json'));

console.log('PASS: Phase 30–34 real-Chromium V4 crash matrix contract validates generated DevTools scripts, actual ZIP resources, all six crash checkpoints, exact raw localStorage/Circle/media/font/journal state before app startup, and failure-safe browser process-group cleanup, completed and in-flight transactions, strict durability, SIGKILL process-group exit, loopback isolation, CI invocation and evidence artifact.');
