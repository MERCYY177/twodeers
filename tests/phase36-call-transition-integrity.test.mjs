import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function slice(startText, endText) {
  const start = index.indexOf(startText);
  const end = index.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `missing source boundary: ${startText}`);
  return index.slice(start, end);
}

const incomingCore = slice('function incomingCallBusy(){', 'function updateIncomingCallStatus(){');
const schedulerFunctions = slice('function armIncomingSchedule(', 'function triggerIncomingCall(type){');
const incomingFunctions = slice('function triggerIncomingCall(type){', 'function updateCallTexts(){');
const activeFunctions = slice('async function startCall(type){', 'async function restoreCallIfNeeded(){');

function buildHarness({ includeRealScheduler = false } = {}) {
  const classes = new Map();
  const node = id => {
    if (!classes.has(id)) classes.set(id, {
      classList: {
        add(name) { classes.get(id).values.add(name); },
        remove(name) { classes.get(id).values.delete(name); },
        contains(name) { return classes.get(id).values.has(name); },
      },
      values: new Set(),
      style: {},
      dataset: {},
      textContent: '',
      querySelector() { return { src: '', classList: { toggle() {} } }; },
    });
    return classes.get(id);
  };
  const h = {
    saveResult: true, saveCalls: 0, logs: [], scheduled: [], wakeRequests: 0,
    wakeReleases: 0, timerSequence: 0, clearedTimers: [],
    state: {
      call: { active: false, direction: '', phase: 'idle', type: '', mini: false, startAt: 0, incomingAt: 0, miniPos: null },
      callSettings: { enabled: true, audioEnabled: true, videoEnabled: true },
      incomingCallSettings: { enabled: true, audioEnabled: true, videoEnabled: true, ringTimeoutSec: 12 },
      incomingCallNextAt: 12345,
      otherName: '测试联系人',
      media: {},
    },
  };
  const context = {
    state: h.state,
    document: { visibilityState: 'visible', hidden: false },
    navigator: {},
    console,
    JSON, Date, Math, Number, String, Boolean, Object, Array, Set, Map, Promise,
    setTimeout(fn, ms) { h.timerSequence += 1; h.lastTimer = { id: h.timerSequence, fn, ms }; return h.timerSequence; },
    clearTimeout(id) { h.clearedTimers.push(id); },
    setInterval(fn, ms) { h.timerSequence += 1; return h.timerSequence; },
    clearInterval() {},
    $: selector => node(selector),
    formatDuration: () => '00:07',
    formatHM: () => '10:20',
    updateIncomingCallStatus() {},
    updateIncomingAvatar() {},
    updateCallTexts() {},
    startCallTimer() {},
    stopCallTimer() {},
    tickCallTimer() {},
    applyMiniCallPosition() {},
    syncCallAvatar() {},
    syncMiniPreview() {},
    requestWakeLock: async () => { h.wakeRequests += 1; return true; },
    releaseWakeLock: async () => { h.wakeReleases += 1; return true; },
    showToast() {},
    closeCallChoice() {},
    appendCallLog(message) { h.logs.push(message); },
    save() { h.saveCalls += 1; return h.saveResult; },
    clearIncomingSchedule(clearPersisted = true) { if (clearPersisted) h.state.incomingCallNextAt = 0; },
    normalizeIncomingCallSettings(value) { return { ...h.state.incomingCallSettings, ...(value || {}) }; },
    incomingAllowedTypes() { return ['audio', 'video']; },
    chooseIncomingCallType() { return 'audio'; },
    scheduleIncomingCall(options) { h.scheduled.push(options || {}); return true; },
    updateIncomingCallSettings() {},
  };
  context.window = { innerWidth: 400, innerHeight: 800 };
  vm.createContext(context);
  vm.runInContext(`
    let incomingRingTimer = null;
    let incomingScheduleTimer = null;
    let incomingScheduleToken = 0;
    let callTimerHandle = null;
    ${incomingCore}
    ${includeRealScheduler ? schedulerFunctions : ''}
    ${incomingFunctions}
    ${activeFunctions}
    globalThis.actions = {
      triggerIncomingCall, answerIncomingCall, rejectIncomingCall, missIncomingCall,
      cancelRingingIncomingCall, startCall, minimizeCall, restoreCall, endCall,
      clearCallToIdle, restoreCallUiAfterFailedTransition
    };
  `, context, { filename: 'twodeers-call-transition-functions.js' });
  return { context, h, node };
}

// Outgoing state transitions: all failed writes keep the previous call state,
// restore the matching visible panel, and avoid emitting a call log or releasing
// a lock for a call which was never durably ended.
{
  const { context, h, node } = buildHarness();
  h.saveResult = false;
  const before = JSON.stringify(h.state.call);
  assert.equal(await context.actions.startCall('audio'), false);
  assert.equal(JSON.stringify(h.state.call), before, 'failed outgoing start must restore the idle state');
  assert.equal(h.state.incomingCallNextAt, 12345, 'failed outgoing start must restore the prior schedule timestamp');
  assert.equal(node('#callScreen').classList.contains('show'), false);
  assert.equal(h.wakeRequests, 0);

  h.saveResult = true;
  assert.equal(await context.actions.startCall('video'), true);
  assert.equal(h.state.call.phase, 'active');
  assert.equal(h.state.call.direction, 'outgoing');
  assert.equal(h.state.call.type, 'video');
  assert.equal(node('#callScreen').classList.contains('show'), true);
  assert.equal(h.wakeRequests, 1);

  h.saveResult = false;
  assert.equal(context.actions.minimizeCall(), false);
  assert.equal(h.state.call.mini, false);
  assert.equal(node('#callScreen').classList.contains('show'), true);
  assert.equal(node('#miniCallWindow').classList.contains('show'), false);

  h.saveResult = true;
  assert.equal(context.actions.minimizeCall(), true);
  assert.equal(h.state.call.mini, true);
  assert.equal(node('#miniCallWindow').classList.contains('show'), true);

  h.saveResult = false;
  assert.equal(await context.actions.restoreCall(), false);
  assert.equal(h.state.call.mini, true, 'failed restore must keep the minimized state');
  assert.equal(node('#miniCallWindow').classList.contains('show'), true);

  h.saveResult = true;
  assert.equal(await context.actions.restoreCall(), true);
  assert.equal(h.state.call.mini, false);
  assert.equal(node('#callScreen').classList.contains('show'), true);

  h.saveResult = false;
  const oldLogCount = h.logs.length;
  assert.equal(await context.actions.endCall(), false);
  assert.equal(h.state.call.phase, 'active', 'failed hang-up must restore the active call');
  assert.equal(h.logs.length, oldLogCount, 'failed hang-up must not append a completed call log');
  assert.equal(h.wakeReleases, 0, 'failed hang-up must not release the active call lock');

  h.saveResult = true;
  assert.equal(await context.actions.endCall(), true);
  assert.equal(h.state.call.phase, 'idle');
  assert.equal(h.logs.length, oldLogCount + 1);
  assert.match(h.logs.at(-1), /已结束主动拨出视频通话/);
  assert.equal(h.wakeReleases, 1);
  assert.equal(h.scheduled.length, 2, 'failed start restores the original schedule and a successful hang-up schedules a new one');
  assert.equal(h.scheduled.at(-1).forceNew, true, 'a successful hang-up starts a fresh incoming-call interval');
}

// Incoming state transitions: a failed ring or answer write does not leave an
// invisible active call; a failed reject/miss/cancel restores the ringing panel
// and timer without adding a false history entry.
{
  const { context, h, node } = buildHarness();
  h.saveResult = false;
  assert.equal(context.actions.triggerIncomingCall('audio'), false);
  assert.equal(h.state.call.phase, 'idle');
  assert.equal(h.state.incomingCallNextAt, 12345);
  assert.equal(node('#incomingCallMask').classList.contains('show'), false);
  assert.equal(h.logs.length, 0);

  h.saveResult = true;
  assert.equal(context.actions.triggerIncomingCall('audio'), true);
  assert.equal(h.state.call.phase, 'ringing');
  assert.equal(node('#incomingCallMask').classList.contains('show'), true);
  const logCount = h.logs.length;

  h.saveResult = false;
  assert.equal(await context.actions.answerIncomingCall(), false);
  assert.equal(h.state.call.phase, 'ringing', 'failed answer must restore incoming ringing');
  assert.equal(node('#incomingCallMask').classList.contains('show'), true);
  assert.equal(h.wakeRequests, 0);

  h.saveResult = true;
  assert.equal(await context.actions.answerIncomingCall(), true);
  assert.equal(h.state.call.phase, 'active');
  assert.equal(h.state.call.direction, 'incoming');
  assert.equal(node('#callScreen').classList.contains('show'), true);
  assert.equal(h.wakeRequests, 1);
  assert.equal(h.logs.length, logCount);

  assert.equal(await context.actions.endCall(), true);
  assert.equal(h.state.call.phase, 'idle');
  assert.match(h.logs.at(-1), /已结束对方拨入语音通话/);

  h.state.call = { active: false, direction: 'incoming', phase: 'ringing', type: 'video', mini: false, startAt: 0, incomingAt: Date.now(), miniPos: null };
  node('#incomingCallMask').classList.add('show');
  h.saveResult = false;
  const beforeRejectLogs = h.logs.length;
  context.actions.rejectIncomingCall();
  assert.equal(h.state.call.phase, 'ringing', 'failed reject must restore ringing state');
  assert.equal(node('#incomingCallMask').classList.contains('show'), true);
  assert.equal(h.logs.length, beforeRejectLogs, 'failed reject must not append a refusal log');

  h.saveResult = true;
  context.actions.rejectIncomingCall();
  assert.equal(h.state.call.phase, 'idle');
  assert.match(h.logs.at(-1), /已拒绝对方的视频来电/);

  h.state.call = { active: false, direction: 'incoming', phase: 'ringing', type: 'audio', mini: false, startAt: 0, incomingAt: Date.now(), miniPos: null };
  node('#incomingCallMask').classList.add('show');
  h.saveResult = false;
  const beforeMissLogs = h.logs.length;
  context.actions.missIncomingCall();
  assert.equal(h.state.call.phase, 'ringing');
  assert.equal(h.logs.length, beforeMissLogs, 'failed missed-call commit must not add history');

  h.saveResult = true;
  context.actions.missIncomingCall();
  assert.equal(h.state.call.phase, 'idle');
  assert.match(h.logs.at(-1), /未接来电/);
}

// The incoming-call scheduler previously armed a timeout before saving its due
// timestamp and ignored save() failure both when scheduling and when the timer
// fired. Execute the actual functions to prove the timer is only armed after a
// successful commit, and a failed due-time commit retries without showing a call.
{
  const { context, h } = buildHarness({ includeRealScheduler: true });
  h.state.incomingCallNextAt = Date.now() + 60_000;
  const originalDueAt = h.state.incomingCallNextAt;
  h.saveResult = false;
  assert.equal(context.scheduleIncomingCall(), false);
  assert.equal(h.state.incomingCallNextAt, originalDueAt, 'failed schedule commit preserves the prior due timestamp');
  assert.equal(h.lastTimer, undefined, 'no incoming timer may be armed before its due timestamp is saved');

  h.saveResult = true;
  assert.equal(context.scheduleIncomingCall(), true);
  assert.equal(h.state.incomingCallNextAt, originalDueAt);
  const firstTimer = h.lastTimer;
  assert.ok(firstTimer && firstTimer.ms >= 0);

  h.saveResult = false;
  firstTimer.fn();
  assert.equal(h.state.call.phase, 'idle', 'failed due-time commit must not trigger a visible incoming call');
  assert.equal(h.state.incomingCallNextAt, originalDueAt, 'failed due-time commit retains the durable due timestamp in memory');
  const retryTimer = h.lastTimer;
  assert.equal(retryTimer.ms, 5000, 'due-time commit failure retries after a bounded delay rather than spinning');

  h.saveResult = true;
  retryTimer.fn();
  const dueRetryTimer = h.lastTimer;
  assert.equal(dueRetryTimer.ms, 5000);
  dueRetryTimer.fn();
  assert.equal(h.state.call.phase, 'ringing', 'a successfully committed due timestamp can trigger the incoming call');
  assert.equal(h.state.call.direction, 'incoming');

  const replace = buildHarness({ includeRealScheduler: true });
  replace.h.state.incomingCallNextAt = Date.now() + 90_000;
  const preservedDueAt = replace.h.state.incomingCallNextAt;
  replace.context.scheduleIncomingCall();
  const priorTimer = replace.h.lastTimer;
  replace.h.saveResult = false;
  assert.equal(replace.context.scheduleIncomingCall({ forceNew: true }), false);
  assert.ok(replace.h.clearedTimers.includes(priorTimer.id), 'forced reschedule cancels the superseded timer');
  assert.equal(replace.h.state.incomingCallNextAt, preservedDueAt, 'failed force-reschedule restores the previous due timestamp');
  assert.ok(replace.h.lastTimer, 'the previous valid schedule is re-armed after a failed replacement');
}

console.log('PASS: Phase 36 actual call transitions preserve state/UI parity; incoming-call scheduler commits timestamps before arming timers, restores prior schedules on save failure and retries failed due-time commits safely.');
