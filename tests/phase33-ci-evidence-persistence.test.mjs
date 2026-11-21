import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harness = await readFile(path.join(ROOT, 'tests/chromium-v4-restore-crash-matrix.mjs'), 'utf8');
const workflow = await readFile(path.join(ROOT, '.github/workflows/isolated-restore-lifecycle.yml'), 'utf8');
const matrix = JSON.parse(await readFile(path.join(ROOT, 'docs/browser-recovery-acceptance-matrix.json'), 'utf8'));

const writerStart = harness.indexOf('async function writeJsonAtomic(file, value) {');
const writerEnd = harness.indexOf('\nasync function terminateChromeProcessGroup', writerStart);
assert.ok(writerStart >= 0 && writerEnd > writerStart, 'atomic evidence writer must remain a small independently testable helper');
const writerFactory = new Function('writeFile', 'rename', 'process', `${harness.slice(writerStart, writerEnd)}; return writeJsonAtomic;`);
const tmp = await mkdtemp(path.join(os.tmpdir(), 'twodeers-phase33-evidence-'));
try {
  const file = path.join(tmp, 'matrix.json');
  await writeFile(file, JSON.stringify({ status: 'preflight-old' }));
  const writeJsonAtomic = writerFactory(writeFile, rename, process);
  await writeJsonAtomic(file, { status: 'running', currentStage: 'prepared', stages: [] });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { status: 'running', currentStage: 'prepared', stages: [] }, 'atomic writer must replace the previous complete JSON snapshot');
  assert.deepEqual(await readdir(tmp), ['matrix.json'], 'atomic writer must not leave a temporary JSON file after successful rename');

  let renameCalled = false;
  const failingWriter = writerFactory(async () => { throw new Error('injected evidence filesystem failure'); }, async () => { renameCalled = true; }, process);
  await assert.rejects(failingWriter(file, { status: 'must-not-replace' }), /injected evidence filesystem failure/);
  assert.equal(renameCalled, false, 'failed temporary write must not rename over the last complete evidence snapshot');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { status: 'running', currentStage: 'prepared', stages: [] }, 'a failed evidence write must preserve the last complete JSON file');
} finally {
  await rm(tmp, { recursive: true, force: true });
}

const preserveStart = harness.indexOf('async function preserveFailedProfile(profile, artifactDir, stage) {');
const preserveEnd = harness.indexOf('\nasync function terminateChromeProcessGroup', preserveStart);
assert.ok(preserveStart >= 0 && preserveEnd > preserveStart, 'failed-profile copy helper must remain independently testable');
const preserveFactory = new Function('cp', 'mkdir', 'rm', 'path', 'ROOT', `${harness.slice(preserveStart, preserveEnd)}; return preserveFailedProfile;`);
const preserveTmp = await mkdtemp(path.join(os.tmpdir(), 'twodeers-phase33-profile-'));
try {
  const sourceProfile = path.join(preserveTmp, 'closed-source-profile');
  const outputDir = path.join(preserveTmp, 'artifact-output');
  await mkdir(path.join(sourceProfile, 'Default', 'IndexedDB'), { recursive: true });
  await writeFile(path.join(sourceProfile, 'Default', 'IndexedDB', 'synthetic-idb.log'), 'synthetic forensic marker');
  const preserveFailedProfile = preserveFactory(cp, mkdir, rm, path, ROOT);
  const artifactPath = await preserveFailedProfile(sourceProfile, outputDir, 'prepared');
  const copiedMarker = path.join(outputDir, 'failed-profiles', 'prepared', 'Default', 'IndexedDB', 'synthetic-idb.log');
  assert.equal(await readFile(copiedMarker, 'utf8'), 'synthetic forensic marker', 'failed profile copy must retain nested IndexedDB forensic data');
  assert.equal(artifactPath, path.relative(ROOT, path.join(outputDir, 'failed-profiles', 'prepared')));
} finally {
  await rm(preserveTmp, { recursive: true, force: true });
}

assert.match(harness, /profileMayContainTestData = true/);
assert.match(harness, /if \(browserStopped && artifactDir && profileMayContainTestData\)/, 'profiles must be preserved only after Chromium stops and the fixture may have written application data');
assert.match(harness, /preserveFailedProfileFn\(profile, artifactDir, stage\)/);
assert.match(harness, /finalizeFailedRunCase/, 'failed-case cleanup must retry process-group termination before deciding whether a Profile can be copied');
assert.match(harness, /status: 'preflight'/, 'the artifact must exist before Chromium lookup or first stage startup');
assert.match(harness, /const persistEvidence = async \(\) => writeJsonAtomic\(/);
assert.match(harness, /await persistEvidence\(\);\s*try \{\s*const binary = await findChromium\(\)/, 'preflight evidence must be persisted before launching Chromium');
assert.match(harness, /currentStage = stage/);
assert.match(harness, /await report\('checkpoint-reached'/, 'the checkpoint must be persisted before the browser is killed');
assert.match(harness, /await report\('chromium-sigkill-confirmed'/, 'SIGKILL and process-group exit must become durable evidence');
assert.match(harness, /await report\('pre-startup-profile-captured'/, 'raw pre-startup profile state must be persisted before assertions or app startup');
assert.match(harness, /await report\('recovery-verified'/, 'post-startup recovery completion must be durably recorded');
assert.match(harness, /await report\('recovery-browser-process-group-closed'/, 'successful restarted profiles must be closed before cleanup');
assert.match(harness, /await stopChrome\(session\);\s*session = null;\s*await report\('recovery-browser-process-group-closed'/, 'post-recovery shutdown failures must enter the scenario failure path and preserve the profile');
assert.match(harness, /failed-profiles/);
assert.match(harness, /await cp\(profile, preserved, \{ recursive:true, force:true \}\)/, 'failed Chromium profiles must be copied into the uploaded artifact before temporary cleanup');
assert.match(harness, /failedProfileArtifactPath/);
assert.match(harness, /await rename\(temporary, file\)/, 'evidence JSON updates must use atomic rename');
assert.match(harness, /async function runCase\([^]*?onProgress[^]*?\)/, 'each scenario must publish progress to the evidence writer');

const phase18JobStart = workflow.indexOf('  isolated-restore-lifecycle:');
const crashJobStart = workflow.indexOf('  v4-restore-crash-matrix:');
assert.ok(phase18JobStart >= 0 && crashJobStart > phase18JobStart, 'workflow must define both lifecycle and independent crash-matrix jobs');
const phase18Job = workflow.slice(phase18JobStart, crashJobStart);
const crashJob = workflow.slice(crashJobStart);
assert.doesNotMatch(phase18Job, /node tests\/chromium-v4-restore-crash-matrix\.mjs/, 'Phase 18 must not serialize or gate the six-point V4 crash matrix');
assert.doesNotMatch(crashJob, /\n    needs:/, 'the V4 crash matrix job must not depend on Phase 18');
assert.match(crashJob, /timeout-minutes: 60/);
assert.match(crashJob, /node-version: "22"/);
assert.match(crashJob, /fonts-dejavu-core/);
assert.match(crashJob, /playwright@1\.65\.0/);
assert.match(crashJob, /playwright install --with-deps chromium/);
assert.match(crashJob, /node tests\/chromium-v4-restore-crash-matrix\.test\.mjs/);
assert.match(crashJob, /node tests\/chromium-v4-restore-crash-matrix\.mjs/);
assert.match(crashJob, /if: \$\{\{ always\(\) && steps\.install_chromium\.outcome == 'success' && steps\.crash_matrix_contract\.outcome == 'success' \}\}/);
assert.match(crashJob, /name: twodeers-v4-crash-matrix-evidence-\$\{\{ github\.run_id \}\}/);
assert.match(crashJob, /path: test-results\/browser-e2e\/phase33\//);
assert.match(crashJob, /if: always\(\)/);
assert.match(crashJob, /retention-days: 14/);

const pushPaths = workflow.split('  pull_request:')[0];
const pullRequestPaths = workflow.split('  pull_request:')[1].split('  workflow_dispatch:')[0];
for (const [label, section] of [['push', pushPaths], ['pull_request', pullRequestPaths]]) {
  assert.ok(section.includes('tests/phase33-ci-evidence-persistence.test.mjs'), `${label} path filters must trigger the Phase 33 contract`);
  assert.ok(section.includes('PHASE33-CHANGELOG.md'), `${label} path filters must trigger on the Phase 33 record`);
}

const suite = matrix.browserSuites.find(item => item.id === 'phase18-restore-lifecycle');
assert.ok(suite?.supportingTests?.includes('tests/phase33-ci-evidence-persistence.test.mjs'));
assert.equal(suite.independentCrashMatrixJob, 'v4-restore-crash-matrix');
assert.equal(suite.independentCrashMatrixArtifactNamePattern, 'twodeers-v4-crash-matrix-evidence-{run_id}');
assert.ok(suite.requiredEvidenceFiles.includes('phase33-chromium-v4-ci-independent-matrix.json'));
assert.ok(suite.requiredEvidenceFiles.includes('failed-profiles/**'));
const gate = matrix.crossCuttingGates.find(item => item.id === 'phase33-independent-v4-crash-matrix-evidence');
assert.ok(gate, 'Phase 33 independent CI evidence gate must be represented');
assert.equal(gate.localStatus, 'passed');
assert.equal(gate.browserExecutionStatus, 'blocked-local-admin-policy');
assert.equal(gate.ciExecutionStatus, 'not-run');

console.log('PASS: Phase 33 evidence persistence contract verifies atomic preflight/progress JSON, failure-profile preservation, independent CI job scheduling, Chromium/font installation, artifact upload, path filters and explicit local/CI execution states.');
