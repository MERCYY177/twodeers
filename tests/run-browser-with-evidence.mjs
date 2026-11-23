#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TIMEOUT_MS = 18 * 60 * 1000;
const KILL_GRACE_MS = 4_000;

export const BROWSER_E2E_SUITES = Object.freeze({
  phase17: [
    { name: 'syntax-fixtures', args: ['--check', 'tests/isolated-application-fixtures.mjs'] },
    { name: 'syntax-fixture-test', args: ['--check', 'tests/isolated-application-fixtures.test.mjs'] },
    { name: 'syntax-full-app-e2e', args: ['--check', 'tests/isolated-application-rehearsal-e2e.mjs'] },
    { name: 'synthetic-fixture-invariants', args: ['tests/isolated-application-fixtures.test.mjs'] },
    { name: 'syntax-media-send-path-test', args: ['--check', 'tests/media-send-paths.test.mjs'] },
    { name: 'direct-chat-send-source-regression', args: ['tests/media-send-paths.test.mjs'] },
    { name: 'syntax-video-media-test', args: ['--check', 'tests/video-media-paths.test.mjs'] },
    { name: 'video-media-source-regression', args: ['tests/video-media-paths.test.mjs'] },
    { name: 'syntax-voice-media-test', args: ['--check', 'tests/voice-media-paths.test.mjs'] },
    { name: 'voice-media-source-regression', args: ['tests/voice-media-paths.test.mjs'] },
    { name: 'syntax-mailbox-circle-write-test', args: ['--check', 'tests/mailbox-circle-write-paths.test.mjs'] },
    { name: 'mailbox-circle-write-source-regression', args: ['tests/mailbox-circle-write-paths.test.mjs'] },
    { name: 'syntax-phase25-lifecycle-test', args: ['--check', 'tests/phase25-circle-mailbox-lifecycle.test.mjs'] },
    { name: 'phase25-circle-mailbox-source-regression', args: ['tests/phase25-circle-mailbox-lifecycle.test.mjs'] },
    { name: 'full-app-chromium-rehearsal', args: ['tests/isolated-application-rehearsal-e2e.mjs'] }
  ],
  phase18: [
    { name: 'syntax-fixtures', args: ['--check', 'tests/isolated-application-fixtures.mjs'] },
    { name: 'syntax-lifecycle-e2e', args: ['--check', 'tests/isolated-restore-lifecycle-e2e.mjs'] },
    { name: 'syntax-crash-worker', args: ['--check', 'tests/isolated-restore-crash-worker.mjs'] },
    { name: 'synthetic-fixture-invariants', args: ['tests/isolated-application-fixtures.test.mjs'] },
    { name: 'restore-lifecycle-chromium-rehearsal', args: ['tests/isolated-restore-lifecycle-e2e.mjs'] }
  ]
});

function safeSuiteName(value) {
  return typeof value === 'string' && Object.hasOwn(BROWSER_E2E_SUITES, value);
}

function processGroupSignal(child, signal) {
  if (!child?.pid) return false;
  try {
    // On POSIX, the detached child's process group can outlive its leader.
    // Do not gate group signaling on exitCode/signalCode: descendants may
    // still hold inherited stdio pipes open and keep the ChildProcess 'close'
    // event pending after the leader has already exited.
    if (process.platform !== 'win32') {
      process.kill(-child.pid, signal);
      return true;
    }
    if (child.exitCode !== null || child.signalCode !== null) return false;
    child.kill(signal);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function trackClose(child) {
  let settled = false;
  let result = null;
  let resolveClose;
  const promise = new Promise(resolve => { resolveClose = resolve; });
  child.once('close', (code, signal) => {
    settled = true;
    result = { code, signal };
    resolveClose(result);
  });
  return {
    promise,
    get settled() { return settled; },
    get result() { return result; }
  };
}

function waitForClose(closeTracker, timeoutMs) {
  if (closeTracker.settled) return Promise.resolve(closeTracker.result);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child process did not close within ${timeoutMs} ms`)), timeoutMs);
    closeTracker.promise.then(value => {
      clearTimeout(timer);
      resolve(value);
    }, error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function runCommandWithEvidence({
  command = process.execPath,
  args = [],
  cwd = ROOT,
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  killGraceMs = KILL_GRACE_MS,
  stdoutPath,
  stderrPath
}) {
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0, 'timeoutMs must be a positive integer');
  assert.ok(Number.isInteger(killGraceMs) && killGraceMs >= 0, 'killGraceMs must be a non-negative integer');
  await mkdir(path.dirname(stdoutPath), { recursive: true });
  await mkdir(path.dirname(stderrPath), { recursive: true });
  const stdout = createWriteStream(stdoutPath, { flags: 'w' });
  const stderr = createWriteStream(stderrPath, { flags: 'w' });
  const startedAt = new Date().toISOString();
  const started = Date.now();
  let child = null;
  let spawnError = null;
  try {
    child = spawn(command, args, {
      cwd,
      env: { ...env, CI: 'true' },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
  } catch (error) {
    spawnError = error?.message || String(error);
  }
  if (!child) {
    stdout.end();
    stderr.end();
    await Promise.all([finished(stdout), finished(stderr)]);
    return {
      startedAt,
      durationMs: Date.now() - started,
      command,
      args,
      cwd,
      exitCode: null,
      signal: null,
      timedOut: false,
      spawnError,
      status: 'failed',
      stdoutPath,
      stderrPath
    };
  }

  // Attach the close listener immediately after spawn. The 'exit' event may
  // precede stdio closure, especially when descendants inherit the pipes.
  const closeTracker = trackClose(child);
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);

  let timedOut = false;
  child.once('error', error => { spawnError = error.message; });
  const closePromise = waitForClose(closeTracker, timeoutMs + killGraceMs + 10_000);
  let timeoutHandle = null;
  let graceHandle = null;
  let exit;
  try {
    const timeoutPromise = new Promise(resolve => {
      timeoutHandle = setTimeout(() => resolve(null), timeoutMs);
    });
    exit = await Promise.race([closePromise, timeoutPromise]);
    if (exit === null) {
      timedOut = true;
      processGroupSignal(child, 'SIGTERM');
      const gracePromise = new Promise(resolve => {
        graceHandle = setTimeout(() => resolve(null), killGraceMs);
      });
      exit = await Promise.race([closePromise, gracePromise]);
      if (exit === null) {
        processGroupSignal(child, 'SIGKILL');
        exit = await closePromise;
      }
    }
  } finally {
    clearTimeout(timeoutHandle);
    clearTimeout(graceHandle);
    stdout.end();
    stderr.end();
    await Promise.all([finished(stdout), finished(stderr)]);
  }

  const durationMs = Date.now() - started;
  const result = {
    startedAt,
    durationMs,
    command,
    args,
    cwd,
    exitCode: exit?.code ?? child.exitCode,
    signal: exit?.signal ?? child.signalCode,
    timedOut,
    spawnError,
    status: timedOut ? 'timed_out' : (spawnError || (exit?.code ?? child.exitCode) !== 0 ? 'failed' : 'passed'),
    stdoutPath,
    stderrPath
  };
  return result;
}

async function writeJsonAtomic(filePath, value) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, filePath);
}

async function main() {
  const [suiteName] = process.argv.slice(2);
  if (!safeSuiteName(suiteName)) {
    throw new Error(`usage: node tests/run-browser-with-evidence.mjs <${Object.keys(BROWSER_E2E_SUITES).join('|')}>`);
  }

  const artifactRoot = path.resolve(process.env.TWODEERS_E2E_ARTIFACT_DIR || path.join(ROOT, 'test-results', 'browser-e2e', suiteName));
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });
  const summary = {
    format: 'twodeers-browser-e2e-evidence',
    version: 1,
    suite: suiteName,
    startedAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch, release: os.release() },
    steps: [],
    status: 'running'
  };
  const summaryPath = path.join(artifactRoot, 'summary.json');
  await writeJsonAtomic(summaryPath, summary);

  for (let index = 0; index < BROWSER_E2E_SUITES[suiteName].length; index++) {
    const step = BROWSER_E2E_SUITES[suiteName][index];
    const result = await runCommandWithEvidence({
      args: step.args,
      timeoutMs: step.name.includes('chromium') || step.name.includes('rehearsal') ? DEFAULT_TIMEOUT_MS : 60_000,
      stdoutPath: path.join(artifactRoot, `${String(index + 1).padStart(2, '0')}-${step.name}.stdout.log`),
      stderrPath: path.join(artifactRoot, `${String(index + 1).padStart(2, '0')}-${step.name}.stderr.log`)
    });
    summary.steps.push({ name: step.name, ...result });
    summary.status = result.status === 'passed' ? 'running' : 'failed';
    summary.updatedAt = new Date().toISOString();
    await writeJsonAtomic(summaryPath, summary);
    console.log(`[${result.status.toUpperCase()}] ${step.name} (${result.durationMs} ms)`);
    if (result.status !== 'passed') {
      summary.status = 'failed';
      summary.failedStep = step.name;
      summary.finishedAt = new Date().toISOString();
      await writeJsonAtomic(summaryPath, summary);
      process.exitCode = 1;
      return;
    }
  }

  summary.status = 'passed';
  summary.finishedAt = new Date().toISOString();
  await writeJsonAtomic(summaryPath, summary);
  console.log(`PASS: ${suiteName} browser rehearsal steps completed; evidence saved to ${artifactRoot}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async error => {
    const suite = process.argv[2] || 'unknown';
    const artifactRoot = path.resolve(process.env.TWODEERS_E2E_ARTIFACT_DIR || path.join(ROOT, 'test-results', 'browser-e2e', suite));
    const now = new Date().toISOString();
    await mkdir(artifactRoot, { recursive: true });
    const runnerError = {
      message: error?.message || String(error),
      stack: error?.stack || null,
      timestamp: now
    };
    await writeJsonAtomic(path.join(artifactRoot, 'runner-error.json'), runnerError).catch(() => {});
    const summaryPath = path.join(artifactRoot, 'summary.json');
    let summary = null;
    try { summary = JSON.parse(await readFile(summaryPath, 'utf8')); } catch {}
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
      summary = {
        format: 'twodeers-browser-e2e-evidence',
        version: 1,
        suite,
        startedAt: now,
        environment: { node: process.version, platform: process.platform, arch: process.arch, release: os.release() },
        steps: []
      };
    }
    summary.status = 'failed';
    summary.finishedAt = now;
    summary.runnerError = runnerError;
    await writeJsonAtomic(summaryPath, summary).catch(() => {});
    console.error(error);
    process.exitCode = 1;
  });
}
