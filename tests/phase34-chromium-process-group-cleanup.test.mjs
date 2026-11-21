import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harness = await readFile(path.join(ROOT, 'tests/chromium-v4-restore-crash-matrix.mjs'), 'utf8');

// Exercise the real process-group signal helper with a leader that has already
// exited. Chromium child processes can outlive the Node child handle's leader.
const signalStart = harness.indexOf('function signalChromeProcessGroup(child) {');
const signalEnd = harness.indexOf('\nasync function terminateChromeProcessGroup', signalStart);
assert.ok(signalStart >= 0 && signalEnd > signalStart);
const signalCalls = [];
const fakeProcess = {
  platform: 'linux',
  kill(pid, signal) { signalCalls.push({ pid, signal }); }
};
const signalChromeProcessGroup = new Function('process', `${harness.slice(signalStart, signalEnd)}; return signalChromeProcessGroup;`)(fakeProcess);
assert.equal(signalChromeProcessGroup({ pid: 4412, exitCode: 0, signalCode: null }), true);
assert.deepEqual(signalCalls, [{ pid: -4412, signal: 'SIGKILL' }], 'an exited leader must not suppress SIGKILL to its still-existing process group');
assert.equal(signalChromeProcessGroup({ pid: 0, exitCode: 0, signalCode: null }), false);
const esrchProcess = { platform: 'linux', kill() { const error = new Error('gone'); error.code = 'ESRCH'; throw error; } };
const esrchSignal = new Function('process', `${harness.slice(signalStart, signalEnd)}; return signalChromeProcessGroup;`)(esrchProcess);
assert.equal(esrchSignal({ pid: 4413, exitCode: 0, signalCode: null }), false, 'a vanished process group is an expected race, not a cleanup error');
const unexpectedSignal = new Function('process', `${harness.slice(signalStart, signalEnd)}; return signalChromeProcessGroup;`)({ platform:'linux', kill() { const error = new Error('permission denied'); error.code = 'EPERM'; throw error; } });
assert.throws(() => unexpectedSignal({ pid:4414, exitCode:0, signalCode:null }), /permission denied/, 'non-ESRCH signal errors must remain visible');

const termStart = harness.indexOf('async function terminateChromeProcessGroup(child, closePromise, page = null) {');
const termEnd = harness.indexOf('\nasync function launchChrome', termStart);
assert.ok(termStart >= 0 && termEnd > termStart);
const terminateCalls = [];
const terminatedPids = [];
const terminateProcess = {
  platform: 'linux',
  kill(pid, signal) { terminateCalls.push({ pid, signal }); }
};
const terminateChromeProcessGroup = new Function('process', 'signalChromeProcessGroup', 'waitForProcessGroupExit', `${harness.slice(termStart, termEnd)}; return terminateChromeProcessGroup;`)(
  terminateProcess,
  child => {
    if (!child?.pid) return false;
    terminateProcess.kill(-child.pid, 'SIGKILL');
    return true;
  },
  async pid => { terminatedPids.push(pid); return true; }
);
let pageClosed = false;
const close = await terminateChromeProcessGroup(
  { pid: 5521, exitCode: 0, signalCode: null },
  Promise.resolve({ code: 0, signal: null }),
  { close() { pageClosed = true; } }
);
assert.deepEqual(close, { code: 0, signal: null });
assert.equal(pageClosed, true);
assert.deepEqual(terminateCalls, [{ pid: -5521, signal: 'SIGKILL' }], 'termination must signal exactly once even if Chromium leader has exited');
assert.deepEqual(terminatedPids, [5521], 'termination must still verify the process group is gone');

const killStart = harness.indexOf('async function killChrome(session) {');
const killEnd = harness.indexOf('\nasync function stopChrome', killStart);
assert.ok(killStart >= 0 && killEnd > killStart);
const killCalls = [];
const killWaited = [];
const killProcess = { platform: 'linux', kill(pid, signal) { killCalls.push({ pid, signal }); } };
const killChrome = new Function('process', 'waitForProcessGroupExit', 'signalChromeProcessGroup', 'assert', `${harness.slice(killStart, killEnd)}; return killChrome;`)(
  killProcess,
  async pid => { killWaited.push(pid); return true; },
  child => { if (!child?.pid) return false; killProcess.kill(-child.pid, 'SIGKILL'); return true; },
  assert
);
let killPageClosed = false;
const killed = await killChrome({
  page: { close() { killPageClosed = true; } },
  child: { pid: 6632, exitCode: 0, signalCode: 'SIGKILL' },
  closeInfo: { code: null, signal: 'SIGKILL' },
  closePromise: Promise.resolve({ code: null, signal: 'SIGKILL' })
});
assert.equal(killPageClosed, true);
assert.equal(killed.processGroupGone, true);
assert.deepEqual(killCalls, [{ pid: -6632, signal: 'SIGKILL' }], 'SIGKILL checkpoint must signal the process group even if the leader close event already fired');
assert.deepEqual(killWaited, [6632]);

const finalizeStart = harness.indexOf('async function finalizeFailedRunCase(');
const finalizeEnd = harness.indexOf('\nasync function waitWritable', finalizeStart);
assert.ok(finalizeStart >= 0 && finalizeEnd > finalizeStart);
const finalizeFailedRunCase = new Function('path', 'ROOT', `${harness.slice(finalizeStart, finalizeEnd)}; return finalizeFailedRunCase;`)(path, ROOT);
const tmp = await mkdtemp(path.join(os.tmpdir(), 'twodeers-phase34-cleanup-'));
try {
  const profile = path.join(tmp, 'profile');
  const artifactDir = path.join(tmp, 'artifacts');
  await mkdir(path.join(profile, 'Default', 'IndexedDB'), { recursive: true });
  await writeFile(path.join(profile, 'Default', 'IndexedDB', 'marker.bin'), 'failed-profile-marker');

  let attempts = 0;
  let copied = false;
  const retried = await finalizeFailedRunCase({
    session: { child: { pid: 1 } },
    stopChromeFn: async () => { attempts += 1; if (attempts === 1) throw new Error('simulated first process-group close timeout'); },
    profile,
    artifactDir,
    stage: 'media-inflight',
    profileMayContainTestData: true,
    preserveFailedProfileFn: async (source, destination, stage) => {
      assert.equal(source, profile);
      assert.equal(destination, artifactDir);
      assert.equal(stage, 'media-inflight');
      copied = true;
      return 'test-results/failed-profiles/media-inflight';
    }
  });
  assert.equal(attempts, 2, 'failed cleanup must retry process-group termination once');
  assert.equal(retried.browserStopped, true);
  assert.equal(retried.preserveProfile, false, 'after the closed profile has been copied into the artifact, the original temp copy must be removable');
  assert.equal(retried.failedProfileArtifactPath, 'test-results/failed-profiles/media-inflight');
  assert.equal(retried.profileRetainedPath, null);
  assert.match(retried.cleanupError, /simulated first process-group close timeout/);
  assert.equal(copied, true, 'after retry closes Chromium, the failed profile must be copied before caller cleanup');

  let preserveCalledWhileOpen = false;
  let openStopAttempts = 0;
  const unclosed = await finalizeFailedRunCase({
    session: { child: { pid: 2 } },
    stopChromeFn: async () => { openStopAttempts += 1; throw new Error('simulated persistent process-group failure'); },
    profile,
    artifactDir,
    stage: 'font-inflight',
    profileMayContainTestData: true,
    preserveFailedProfileFn: async () => { preserveCalledWhileOpen = true; throw new Error('must not be called'); }
  });
  assert.equal(openStopAttempts, 2);
  assert.equal(unclosed.browserStopped, false);
  assert.equal(unclosed.preserveProfile, true, 'an unclosed profile must never be removed');
  assert.equal(unclosed.session !== null, true);
  assert.equal(preserveCalledWhileOpen, false, 'a profile must not be copied while Chromium may still mutate it');
  assert.match(unclosed.profilePreservationError, /left in place/);

  let copyFailureCleanupCalls = 0;
  const copyFailure = await finalizeFailedRunCase({
    session: { child: { pid: 3 } },
    stopChromeFn: async () => { copyFailureCleanupCalls += 1; },
    profile,
    artifactDir,
    stage: 'committed',
    profileMayContainTestData: true,
    preserveFailedProfileFn: async () => { throw new Error('simulated artifact copy failure'); }
  });
  assert.equal(copyFailureCleanupCalls, 1);
  assert.equal(copyFailure.browserStopped, true);
  assert.equal(copyFailure.preserveProfile, true, 'if artifact copy fails, do not delete the only remaining local profile');
  assert.equal(copyFailure.profileRetainedPath, path.relative(ROOT, profile));
  assert.match(copyFailure.profilePreservationError, /simulated artifact copy failure/);

  let noSeedPreserveCalled = false;
  const beforeSeed = await finalizeFailedRunCase({
    session: null,
    stopChromeFn: async () => {},
    profile,
    artifactDir,
    stage: 'prepared',
    profileMayContainTestData: false,
    preserveFailedProfileFn: async () => { noSeedPreserveCalled = true; return 'unexpected'; }
  });
  assert.equal(beforeSeed.browserStopped, true);
  assert.equal(beforeSeed.preserveProfile, false);
  assert.equal(noSeedPreserveCalled, false, 'pre-seed failures must not upload an empty Profile');
} finally {
  await rm(tmp, { recursive: true, force: true });
}

assert.match(harness, /signalChromeProcessGroup\(child\)/, 'both graceful cleanup and SIGKILL checkpoint must signal the full group regardless of leader state');
assert.match(harness, /finalizeFailedRunCase\(/, 'scenario failure cleanup must use the retry-and-preserve finalizer');
assert.match(harness, /error\.browserSession = \{ child, closePromise, get closeInfo/, 'launch-time cleanup failure must hand the still-live child/session handles to runCase');
assert.match(harness, /if \(!session && scenarioFailure\?\.browserSession\) session = scenarioFailure\.browserSession/, 'runCase must not mistake a missing returned session for a stopped browser');
assert.match(harness, /for \(let attempt = 0; activeSession && attempt < 2; attempt \+= 1\)/);
assert.match(harness, /if \(!preserveProfile && !session\) await rm\(profile/, 'a failed or unclosed Profile must not be removed by finally');
assert.match(harness, /profiles-in-progress/, 'the original in-progress profile must be inside the CI artifact workspace');

console.log('PASS: Phase 34 Chromium process cleanup tests cover exited leader with live descendants, exactly-once group SIGKILL, group-exit verification, one cleanup retry, failed-profile retention after retry, no copy while Chromium remains live, and pre-seed empty-profile cleanup.');
