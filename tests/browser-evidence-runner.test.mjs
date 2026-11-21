import assert from 'node:assert/strict';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runCommandWithEvidence } from './run-browser-with-evidence.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'twodeers-e2e-evidence-'));
try {
  const success = await runCommandWithEvidence({
    args: ['-e', 'console.log("runner-stdout-marker"); console.error("runner-stderr-marker");'],
    timeoutMs: 5_000,
    stdoutPath: path.join(temp, 'success.stdout.log'),
    stderrPath: path.join(temp, 'success.stderr.log')
  });
  assert.equal(success.status, 'passed');
  assert.equal(success.exitCode, 0);
  assert.equal((await readFile(success.stdoutPath, 'utf8')).includes('runner-stdout-marker'), true);
  assert.equal((await readFile(success.stderrPath, 'utf8')).includes('runner-stderr-marker'), true);

  const completeOutput = 'a'.repeat(512 * 1024);
  const drained = await runCommandWithEvidence({
    args: ['-e', `process.stdout.write(Buffer.alloc(${completeOutput.length}, 97), () => process.exit(0));`],
    timeoutMs: 5_000,
    stdoutPath: path.join(temp, 'drained.stdout.log'),
    stderrPath: path.join(temp, 'drained.stderr.log')
  });
  assert.equal(drained.status, 'passed');
  assert.equal(await readFile(drained.stdoutPath, 'utf8'), completeOutput, 'all inherited output must be drained before the runner reports close');

  const missingCommand = await runCommandWithEvidence({
    command: path.join(temp, 'does-not-exist'),
    args: [],
    timeoutMs: 2_000,
    stdoutPath: path.join(temp, 'spawn-error.stdout.log'),
    stderrPath: path.join(temp, 'spawn-error.stderr.log')
  });
  assert.equal(missingCommand.status, 'failed');
  assert.match(missingCommand.spawnError || '', /ENOENT/);

  const invalidSpawn = await runCommandWithEvidence({
    command: null,
    args: [],
    timeoutMs: 2_000,
    stdoutPath: path.join(temp, 'invalid-spawn.stdout.log'),
    stderrPath: path.join(temp, 'invalid-spawn.stderr.log')
  });
  assert.equal(invalidSpawn.status, 'failed');
  assert.match(invalidSpawn.spawnError || '', /command|path|argument/i);

  const failure = await runCommandWithEvidence({
    args: ['-e', 'console.error("intentional-runner-failure"); process.exit(7);'],
    timeoutMs: 5_000,
    stdoutPath: path.join(temp, 'failure.stdout.log'),
    stderrPath: path.join(temp, 'failure.stderr.log')
  });
  assert.equal(failure.status, 'failed');
  assert.equal(failure.exitCode, 7);
  assert.equal((await readFile(failure.stderrPath, 'utf8')).includes('intentional-runner-failure'), true);

  if (process.platform !== 'win32') {
    const timeout = await runCommandWithEvidence({
      args: ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); console.log("timeout-worker-ready");'],
      timeoutMs: 250,
      killGraceMs: 150,
      stdoutPath: path.join(temp, 'timeout.stdout.log'),
      stderrPath: path.join(temp, 'timeout.stderr.log')
    });
    assert.equal(timeout.status, 'timed_out');
    assert.equal(timeout.timedOut, true);
    assert.equal(timeout.signal, 'SIGKILL', 'timeout must escalate from SIGTERM to SIGKILL');
    assert.equal((await readFile(timeout.stdoutPath, 'utf8')).includes('timeout-worker-ready'), true);

    // Regression: the direct parent exits 0 but its descendant inherits the
    // pipes and ignores SIGTERM. The runner must still signal the detached
    // process group even though child.exitCode is already non-null.
    const parentExitsFirstSource = `
      const { spawn } = require('node:child_process');
      const fs = require('node:fs');
      const grandchildSource = 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);';
      const grandchild = spawn(process.execPath, ['-e', grandchildSource], { stdio: 'inherit' });
      fs.writeFileSync(${JSON.stringify(path.join(temp, 'orphan-grandchild.pid'))}, String(grandchild.pid));
      console.log('phase20-parent-exits-before-grandchild');
      process.exit(0);
    `;
    const orphanedGroup = await runCommandWithEvidence({
      args: ['-e', parentExitsFirstSource],
      timeoutMs: 350,
      killGraceMs: 120,
      stdoutPath: path.join(temp, 'orphan-group.stdout.log'),
      stderrPath: path.join(temp, 'orphan-group.stderr.log')
    });
    assert.equal(orphanedGroup.status, 'timed_out', 'timeout must terminate descendants even after the leader exits');
    assert.equal(orphanedGroup.timedOut, true);
    assert.equal(orphanedGroup.exitCode, 0, 'the leader is expected to have exited normally before group cleanup');
    assert.equal(orphanedGroup.signal, null);
    assert.equal((await readFile(orphanedGroup.stdoutPath, 'utf8')).includes('phase20-parent-exits-before-grandchild'), true);
  }

  const runnerPath = fileURLToPath(new URL('./run-browser-with-evidence.mjs', import.meta.url));
  const cliArtifacts = path.join(temp, 'runner-cli-error');
  const cliFailure = spawnSync(process.execPath, [runnerPath, 'unknown-suite'], {
    encoding: 'utf8',
    env: { ...process.env, TWODEERS_E2E_ARTIFACT_DIR: cliArtifacts }
  });
  assert.equal(cliFailure.status, 1);
  const cliSummary = JSON.parse(await readFile(path.join(cliArtifacts, 'summary.json'), 'utf8'));
  assert.equal(cliSummary.status, 'failed', 'runner-level errors must not leave a summary stuck at running');
  assert.ok(cliSummary.runnerError?.message);

  console.log('PASS: browser evidence runner captures complete stdout/stderr, spawn failures, non-zero exits, timeout escalation, orphan descendants after leader exit, and terminal runner-error summaries.');
} finally {
  await rm(temp, { recursive: true, force: true });
}
