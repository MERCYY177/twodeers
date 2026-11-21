import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const backupV4 = fs.readFileSync(path.join(root, 'backup-v4.js'), 'utf8');

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing function: ${signature}`);
  const signatureEnd = source.indexOf('){', start);
  const open = signatureEnd >= 0 ? signatureEnd + 1 : source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function: ${signature}`);
}

const signatures = [
  'function assertVoiceCaptureIdle(action=',
  'async function ensureAudioStream(){',
  'function releaseRecordingStream(){',
  'function setRecordingUI(active){',
  'async function startVoiceRecord(evt){',
  'async function finishVoiceRecord(cancelled=false){',
  'function stopVoiceRecord(evt){',
  'function cancelVoiceRecord(evt){',
  'function cancelVoiceCaptureOnPageHide(force=false){',
  'function handleVoicePointerCaptureLost(){'
];
const sourceFunctions = signatures.map(signature => extractFunction(index, signature));

function createVoiceHarness({ getUserMedia, commitResult = true, stopNever = false } = {}) {
  const ui = { holdText: '按住说话', cancelHidden: true, recordingClass: false };
  const tracks = [];
  const recorders = [];
  const commits = [];
  const toasts = [];
  const replies = [];
  const sandbox = {
    ui, tracks, recorders, commits, toasts, replies,
    Date, Blob, setTimeout, clearTimeout,
    navigator: { mediaDevices: { getUserMedia: getUserMedia || (async () => {
      const track = { stopped: false, stop() { this.stopped = true; } };
      tracks.push(track);
      return { active: true, getTracks: () => [track] };
    }) } },
    document: { hidden: false },
    showToast(message) { toasts.push(String(message)); },
    formatAudioSec(seconds) { return `${Math.max(1, Math.round(seconds))}''`; },
    triggerReply(row) { replies.push(row); },
    $(selector) {
      if (selector === '#holdTalk') return { set textContent(value) { ui.holdText = value; }, get textContent() { return ui.holdText; } };
      if (selector === '#voiceCancelBtn') return { classList: { toggle(_name, value) { ui.cancelHidden = !!value; } } };
      if (selector === '#inputShell') return { classList: { toggle(_name, value) { ui.recordingClass = !!value; } } };
      return { classList: { toggle() {} } };
    },
    commitChatMediaBlob: async (blob, kind, name, extras) => {
      commits.push({ blob, kind, name, extras });
      if (commitResult instanceof Error) throw commitResult;
      return { id: 'voice-message-' + commits.length };
    }
  };
  class FakeMediaRecorder {
    static isTypeSupported(type) { return type.startsWith('audio/webm'); }
    constructor(stream, options = {}) {
      this.stream = stream; this.mimeType = options.mimeType || 'audio/webm'; this.state = 'inactive'; this.listeners = new Map();
      recorders.push(this);
    }
    addEventListener(type, callback, options = {}) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push({ callback, once: !!options.once });
    }
    emit(type, event = {}) {
      const handler = this['on' + type];
      if (typeof handler === 'function') handler(event);
      const entries = this.listeners.get(type) || [];
      for (const entry of [...entries]) {
        entry.callback(event);
        if (entry.once) this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== entry));
      }
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      if (stopNever) return;
      setTimeout(() => {
        this.emit('dataavailable', { data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: this.mimeType }) });
        this.emit('stop');
      }, 25);
    }
  }
  sandbox.MediaRecorder = FakeMediaRecorder;
  sandbox.window = {
    MediaRecorder: FakeMediaRecorder,
    __duoRestoreInProgress: false,
    __duoExportInProgress: false,
    __duoRuntimeCoordinator: { assertWritable() {}, isWritable() { return true; } }
  };
  const declarations = `
    let mediaStream=null,mediaRecorder=null,audioChunks=[],isRecording=false,recordStartedAt=0,voiceFinishing=false,voiceFinishPromise=null,voiceRecorderError=null;
    let pendingVoicePress=false,voiceCancelRequested=false;
    const VOICE_RECORD_STOP_TIMEOUT_MS=35;
    ${sourceFunctions.join('\n')}
    window.__duoVoiceCapture={isActive:()=>pendingVoicePress||isRecording||voiceFinishing,assertIdle:assertVoiceCaptureIdle};
    globalThis.voice={start:startVoiceRecord,finish:finishVoiceRecord,stop:stopVoiceRecord,cancel:cancelVoiceRecord,hide:cancelVoiceCaptureOnPageHide,lostCapture:handleVoicePointerCaptureLost,assertIdle:assertVoiceCaptureIdle};
    globalThis.snapshot=()=>({pendingVoicePress,isRecording,voiceFinishing,hasRecorder:!!mediaRecorder,chunkCount:audioChunks.length,streamActive:!!mediaStream?.active,ui:{...ui}});
  `;
  vm.runInNewContext(declarations, sandbox, { filename: 'voice-media-paths-real-source.js' });
  return sandbox;
}

// Normal recording produces a Blob-backed audio message with duration metadata and releases the microphone.
{
  const h = createVoiceHarness();
  assert.equal(await h.voice.start({ preventDefault() {} }), true);
  await new Promise(resolve => setTimeout(resolve, 520));
  assert.equal(h.snapshot().isRecording, true);
  assert.equal(h.window.__duoVoiceCapture.isActive(), true);
  assert.equal(await h.voice.stop({ preventDefault() {} }), true);
  assert.equal(h.commits.length, 1);
  assert.equal(h.commits[0].kind, 'audio');
  assert.match(h.commits[0].blob.type, /^audio\/webm/);
  assert.equal(h.commits[0].blob.size, 4);
  assert.ok(h.commits[0].extras.durationSec >= 1);
  assert.match(h.commits[0].extras.durationLabel, /''$/);
  assert.equal(h.tracks[0].stopped, true);
  assert.equal(h.snapshot().voiceFinishing, false);
  assert.equal(h.snapshot().ui.recordingClass, false);
  assert.equal(h.replies.length, 1);
}

// Cancelling during recording never commits a partial audio message.
{
  const h = createVoiceHarness();
  await h.voice.start({ preventDefault() {} });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(await h.voice.cancel({ preventDefault() {} }), false);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(h.commits.length, 0);
  assert.equal(h.tracks[0].stopped, true);
  assert.equal(h.snapshot().isRecording, false);
  assert.equal(h.snapshot().ui.cancelHidden, true);
}

// Hiding the page cancels capture even if the tab is no longer writable.
{
  const h = createVoiceHarness();
  await h.voice.start({ preventDefault() {} });
  await new Promise(resolve => setTimeout(resolve, 60));
  h.document.hidden = true;
  h.window.__duoRuntimeCoordinator.isWritable = () => false;
  assert.equal(await h.voice.hide(), false);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(h.commits.length, 0);
  assert.equal(h.tracks[0].stopped, true);
}

// pagehide is a terminal lifecycle event: force cancellation even if document.hidden is not updated first.
{
  const h = createVoiceHarness();
  await h.voice.start({ preventDefault() {} });
  await new Promise(resolve => setTimeout(resolve, 60));
  h.document.hidden = false;
  assert.equal(await h.voice.hide(true), false);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(h.commits.length, 0);
  assert.equal(h.tracks[0].stopped, true);
}

// A pending microphone permission request can be cancelled before getUserMedia resolves.
{
  let resolveStream;
  const h = createVoiceHarness({ getUserMedia: () => new Promise(resolve => { resolveStream = resolve; }) });
  const starting = h.voice.start({ preventDefault() {} });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.snapshot().pendingVoicePress, true);
  await h.voice.lostCapture();
  const track = { stopped: false, stop() { this.stopped = true; } };
  h.tracks.push(track);
  resolveStream({ active: true, getTracks: () => [track] });
  assert.equal(await starting, false);
  assert.equal(track.stopped, true);
  assert.equal(h.commits.length, 0);
}

// The finish lock prevents starting another recording while the previous recorder's stop event is pending.
{
  const h = createVoiceHarness();
  await h.voice.start({ preventDefault() {} });
  await new Promise(resolve => setTimeout(resolve, 500));
  const finishing = h.voice.finish(false);
  assert.equal(h.snapshot().voiceFinishing, true);
  assert.throws(() => h.voice.assertIdle('导出备份'), /结束或取消/);
  assert.equal(await h.voice.start({ preventDefault() {} }), false);
  assert.equal(h.recorders.length, 1, 'a second MediaRecorder must not start until the first stop event has completed');
  assert.equal(await finishing, true);
  assert.equal(h.snapshot().voiceFinishing, false);
}

// Recorder error events must fail closed, release the microphone, and never send a partial Blob.
{
  const h = createVoiceHarness();
  await h.voice.start({ preventDefault() {} });
  await new Promise(resolve => setTimeout(resolve, 60));
  h.recorders[0].emit('error', { error: new Error('synthetic recorder failure') });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(h.commits.length, 0);
  assert.equal(h.tracks[0].stopped, true);
  assert.ok(h.toasts.some(message => message.includes('录音失败')));
}

// A browser that never dispatches the MediaRecorder stop event times out, releases the track and never commits partial audio.
{
  const h = createVoiceHarness({ stopNever: true });
  await h.voice.start({ preventDefault() {} });
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(await h.voice.finish(false), false);
  assert.equal(h.commits.length, 0);
  assert.equal(h.tracks[0].stopped, true);
  assert.equal(h.snapshot().voiceFinishing, false);
  assert.ok(h.toasts.some(message => message.includes('等待录音停止超时')));
}

// Capture cannot begin after backup/restore has acquired its operation lock.
{
  const h = createVoiceHarness();
  h.window.__duoExportInProgress = true;
  assert.equal(await h.voice.start({ preventDefault() {} }), false);
  assert.equal(h.tracks.length, 0);
  assert.equal(h.recorders.length, 0);
  assert.ok(h.toasts.some(message => message.includes('备份导出或恢复期间')));
}

// A permission rejection leaves no active stream, pending press, or recorder.
{
  const error = new Error('permission denied'); error.name = 'NotAllowedError';
  const h = createVoiceHarness({ getUserMedia: async () => { throw error; } });
  assert.equal(await h.voice.start({ preventDefault() {} }), false);
  assert.equal(h.snapshot().pendingVoicePress, false);
  assert.equal(h.snapshot().streamActive, false);
  assert.equal(h.snapshot().hasRecorder, false);
  assert.ok(h.toasts.some(message => message.includes('麦克风权限被拒绝')));
}


assert.match(backupV4, /async function buildV4\(kind\)\{\s*window\.__duoVoiceCapture\?\.assertIdle/);
assert.match(backupV4, /async function restoreV4\(blob\)\{\s*window\.__duoVoiceCapture\?\.assertIdle/);
assert.match(index, /async function buildBackup\(kind\)\{\s*window\.__duoVoiceCapture\?\.assertIdle/);
assert.match(index, /async function applyBackupPayload\(payload\)\{\s*window\.__duoVoiceCapture\?\.assertIdle/);
assert.match(index, /async function resetWholeDuoSpace\(\)\{\s*try\{window\.__duoVoiceCapture\?\.assertIdle/);

console.log('PASS: MediaRecorder success/cancel/error/stop-timeout, pending permission and pointer-capture cancellation, page-hide cancellation, backup-idle guard, stop-event concurrency lock, duration metadata, and microphone track cleanup.');
