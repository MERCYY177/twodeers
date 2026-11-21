import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_E2E_SUITES } from './run-browser-with-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MATRIX_PATH = 'docs/browser-recovery-acceptance-matrix.json';
const DOC_PATH = 'docs/BROWSER-RECOVERY-ACCEPTANCE-MATRIX.md';
const matrix = JSON.parse(await readFile(path.join(ROOT, MATRIX_PATH), 'utf8'));
const markdown = await readFile(path.join(ROOT, DOC_PATH), 'utf8');

async function assertFile(relativePath, label = relativePath) {
  try {
    await access(path.join(ROOT, relativePath));
  } catch {
    assert.fail(`${label}: referenced file does not exist: ${relativePath}`);
  }
}

function extractPathFilters(source, eventName, workflowName) {
  const eventPattern = new RegExp(`^  ${eventName}:\\s*\\n([\\s\\S]*?)(?=^  [a-z_]+:\\s*$|^permissions:|\\Z)`, 'm');
  const eventMatch = source.match(eventPattern);
  assert.ok(eventMatch, `${workflowName}: missing ${eventName} trigger block`);
  const pathsMatch = eventMatch[1].match(/^    paths:\s*\n((?:^      - .*\n?)+)/m);
  assert.ok(pathsMatch, `${workflowName}: missing ${eventName}.paths`);
  return new Set([...pathsMatch[1].matchAll(/^      - ["']?([^"'\n]+)["']?\s*$/gm)].map(match => match[1]));
}

function includesAll(actual, expected, label) {
  const missing = expected.filter(item => !actual.has(item));
  assert.deepEqual(missing, [], `${label}: missing path filters: ${missing.join(', ')}`);
}

assert.equal(matrix.format, 'twodeers-browser-recovery-acceptance-matrix');
assert.equal(matrix.version, 1);
assert.equal(matrix.policy.localNodeRegressionStatus, 'passed');
const actualNodeTestSuiteCount = (await readdir(path.join(ROOT, 'tests'))).filter(name => name.endsWith('.test.mjs')).length;
assert.equal(matrix.policy.localNodeTestSuites, actualNodeTestSuiteCount, 'matrix local Node suite count must match tests/*.test.mjs');
assert.equal(matrix.policy.realChromiumE2EStatus, 'not-run');
assert.equal(matrix.policy.githubActionsStatus, 'not-run');
assert.equal(matrix.policy.androidApkAndWebViewStatus, 'not-run');
assert.equal(matrix.policy.overallReleaseGate, 'blocked-pending-real-browser-ci');
assert.equal(matrix.releaseGates.every(gate => gate.status === 'blocked'), true);
assert.match(markdown, /real Chromium.*`not-run`/i);
assert.match(markdown, /Android.*`not-run`/i);
assert.match(markdown, /blocked/i);

const expectedSuiteIds = ['phase17-full-application', 'phase18-restore-lifecycle'];
assert.deepEqual(matrix.browserSuites.map(item => item.id), expectedSuiteIds);
for (const suite of matrix.browserSuites) {
  assert.ok(Object.hasOwn(BROWSER_E2E_SUITES, suite.runnerSuite), `${suite.id}: unknown evidence-runner suite`);
  assert.deepEqual(
    BROWSER_E2E_SUITES[suite.runnerSuite].map(step => step.name),
    suite.expectedRunnerSteps,
    `${suite.id}: expected runner steps do not match the actual runner definition/order`
  );
  assert.ok(suite.expectedRunnerSteps.length > 0);
  assert.ok(suite.passCriteria.length >= 4);
  if (suite.runnerSuite === 'phase17') {
    assert.ok(suite.passCriteria.some(item => item.includes('all fifteen runner steps')), 'Phase 17 pass criteria must match the 15-step runner');
    for (let index = 0; index < suite.expectedRunnerSteps.length; index++) {
      const prefix = `${String(index + 1).padStart(2, '0')}-${suite.expectedRunnerSteps[index]}`;
      assert.ok(suite.requiredEvidenceFiles.includes(`${prefix}.stdout.log`), `missing stdout evidence for ${prefix}`);
      assert.ok(suite.requiredEvidenceFiles.includes(`${prefix}.stderr.log`), `missing stderr evidence for ${prefix}`);
    }
  }
  assert.equal(suite.realBrowserStatus, 'not-run');
  assert.equal(suite.githubActionsStatus, 'not-run');
  assert.ok(suite.evidenceDirectory.startsWith('test-results/browser-e2e/'));
  assert.ok(suite.artifactNamePattern.includes('{run_id}'));
  await assertFile(suite.workflow);
  for (const file of suite.supportingTests) await assertFile(file);
  for (const file of suite.requiredPathFilters) {
    if (!file.includes('*')) await assertFile(file);
  }
  const workflowSource = await readFile(path.join(ROOT, suite.workflow), 'utf8');
  assert.match(workflowSource, new RegExp(`run-browser-with-evidence\\.mjs ${suite.runnerSuite}`), `${suite.id}: wrong runner invocation`);
  assert.ok(workflowSource.includes(`TWODEERS_E2E_ARTIFACT_DIR: ${suite.evidenceDirectory}`), `${suite.id}: evidence directory mismatch`);
  assert.ok(workflowSource.includes(`name: ${suite.artifactNamePattern.replace('{run_id}', '${{ github.run_id }}')}`), `${suite.id}: artifact name mismatch`);
  assert.match(workflowSource, /actions\/upload-artifact@v4/);
  assert.match(workflowSource, /if:\s*always\(\)/);
  assert.match(workflowSource, /retention-days:\s*14/);
  assert.match(workflowSource, /permissions:\s*\n\s+contents:\s*read/);
  assert.doesNotMatch(workflowSource, /gh-pages|peaceiris\/actions-gh-pages|git push|npm publish/i);

  for (const eventName of ['push', 'pull_request']) {
    const filters = extractPathFilters(workflowSource, eventName, suite.workflow);
    includesAll(filters, suite.requiredPathFilters, `${suite.id} ${eventName}`);
  }
  for (const evidenceFile of suite.requiredEvidenceFiles) {
    assert.ok(typeof evidenceFile === 'string' && evidenceFile.length > 0);
  }
}

assert.ok(matrix.browserSuites[0].supportingTests.includes('tests/media-send-paths.test.mjs'), 'Phase 17 must include the batch/direct media-send regression');
assert.ok(matrix.browserSuites[0].requiredPathFilters.includes('tests/media-send-paths.test.mjs'), 'Phase 17 workflow must trigger when media-send coverage changes');
assert.ok(matrix.browserSuites[0].supportingTests.includes('tests/video-media-paths.test.mjs'));
assert.ok(matrix.browserSuites[0].supportingTests.includes('tests/voice-media-paths.test.mjs'));
assert.ok(matrix.browserSuites[0].supportingTests.includes('tests/mailbox-circle-write-paths.test.mjs'));
assert.ok(matrix.browserSuites[0].supportingTests.includes('tests/phase25-circle-mailbox-lifecycle.test.mjs'));
assert.ok(matrix.browserSuites[0].requiredPathFilters.includes('tests/phase25-circle-mailbox-lifecycle.test.mjs'));
assert.ok(matrix.browserSuites[1].supportingTests.includes('tests/phase28-restore-combined-failures.test.mjs'));
assert.ok(matrix.browserSuites[1].supportingTests.includes('tests/phase31-restore-strict-durability.test.mjs'));
assert.ok(matrix.browserSuites[1].requiredPathFilters.includes('tests/phase31-restore-strict-durability.test.mjs'));
assert.ok(matrix.browserSuites[1].requiredPathFilters.includes('PHASE31-CHANGELOG.md'));
assert.ok(matrix.browserSuites[1].requiredPathFilters.includes('PHASE32-CHANGELOG.md'));
assert.ok(matrix.browserSuites[1].supportingTests.includes('tests/phase33-ci-evidence-persistence.test.mjs'));
assert.ok(matrix.browserSuites[1].supportingTests.includes('tests/phase34-chromium-process-group-cleanup.test.mjs'));
assert.deepEqual(matrix.browserSuites[1].independentCrashMatrixContractSteps, ['crash-matrix-contract', 'process-group-cleanup-contract']);
assert.ok(matrix.browserSuites[1].requiredEvidenceFiles.includes('05-process-group-cleanup-contract.log'));
assert.ok(matrix.browserSuites[1].requiredEvidenceFiles.includes('profiles-in-progress/**'));
const phase34Gate = matrix.crossCuttingGates.find(gate => gate.id === 'phase34-chromium-process-group-cleanup');
assert.ok(phase34Gate?.requiredAssertions.some(item => item.includes('removing the original temp profile')));
assert.ok(phase34Gate?.requiredAssertions.some(item => item.includes('profiles-in-progress/')));
assert.ok(matrix.browserSuites[1].requiredPathFilters.includes('tests/phase34-chromium-process-group-cleanup.test.mjs'));
assert.ok(matrix.browserSuites[1].requiredPathFilters.includes('PHASE34-CHANGELOG.md'));
assert.ok(matrix.browserSuites[1].requiredPathFilters.includes('tests/phase33-ci-evidence-persistence.test.mjs'));
assert.equal(matrix.browserSuites[1].independentCrashMatrixJob, 'v4-restore-crash-matrix');
assert.equal(matrix.browserSuites[1].independentCrashMatrixArtifactNamePattern, 'twodeers-v4-crash-matrix-evidence-{run_id}');
assert.ok(matrix.browserSuites[1].requiredEvidenceFiles.includes('phase33-chromium-v4-ci-independent-matrix.json'));
assert.ok(matrix.browserSuites[1].requiredEvidenceFiles.includes('failed-profiles/**'));

assert.ok(matrix.browserSuites[1].requiredPathFilters.includes('tests/phase28-restore-combined-failures.test.mjs'));
assert.ok(matrix.browserSuites[1].supportingTests.includes('tests/chromium-v4-restore-crash-matrix.mjs'));
assert.ok(matrix.browserSuites[1].supportingTests.includes('tests/chromium-v4-restore-crash-matrix.test.mjs'));
assert.ok(matrix.browserSuites[1].requiredPathFilters.includes('tests/chromium-v4-restore-crash-matrix.mjs'));
assert.ok(matrix.browserSuites[1].requiredEvidenceFiles.includes('phase30-chromium-v4-restore-crash-matrix.json'));
assert.ok(matrix.browserSuites[1].requiredEvidenceFiles.includes('phase31-chromium-v4-inflight-transaction-crash-matrix.json'));
assert.ok(matrix.browserSuites[1].requiredEvidenceFiles.includes('phase32-chromium-v4-prestartup-state-matrix.json'));
assert.ok(matrix.browserSuites[1].browserScenarios.some(item => item.includes('durable PREPARED') && item.includes('durable COMMITTED')));
assert.ok(matrix.crossCuttingGates.some(gate=>gate.id==='phase26-storage-quota-background-safety'&&gate.localStatus==='passed'));
assert.ok(matrix.crossCuttingGates.some(gate=>gate.id==='phase27-media-revision-marker-combined-failure'&&gate.localStatus==='passed'));
assert.ok(matrix.crossCuttingGates.some(gate=>gate.id==='phase28-v4-restore-combined-failures'&&gate.localStatus==='passed'));
assert.ok(matrix.crossCuttingGates.some(gate=>gate.id==='phase29-real-v4-restore-crash-matrix'&&gate.localStatus==='passed'&&gate.browserExecutionStatus==='blocked-local-admin-policy'&&gate.ciExecutionStatus==='not-run'));
assert.ok(matrix.crossCuttingGates.some(gate=>gate.id==='phase30-v4-crash-checkpoint-integrity'&&gate.localStatus==='passed'&&gate.browserExecutionStatus==='blocked-local-admin-policy'&&gate.ciExecutionStatus==='not-run'));
assert.ok(matrix.crossCuttingGates.some(gate=>gate.id==='phase31-v4-inflight-transaction-durability'&&gate.localStatus==='passed'&&gate.browserExecutionStatus==='blocked-local-admin-policy'&&gate.ciExecutionStatus==='not-run'));
assert.ok(matrix.crossCuttingGates.some(gate=>gate.id==='phase32-v4-prestartup-state-before-recovery'&&gate.localStatus==='passed'&&gate.browserExecutionStatus==='blocked-local-admin-policy'&&gate.ciExecutionStatus==='not-run'));
assert.ok(matrix.crossCuttingGates.some(gate=>gate.id==='phase33-independent-v4-crash-matrix-evidence'&&gate.localStatus==='passed'&&gate.browserExecutionStatus==='blocked-local-admin-policy'&&gate.ciExecutionStatus==='not-run'));
assert.ok(matrix.crossCuttingGates.some(gate=>gate.id==='phase34-chromium-process-group-cleanup'&&gate.localStatus==='passed'&&gate.browserExecutionStatus==='blocked-local-admin-policy'&&gate.ciExecutionStatus==='not-run'));
const phase37Gate = matrix.crossCuttingGates.find(gate => gate.id === 'phase37-audit-fixes');
assert.ok(phase37Gate?.localStatus === 'passed');
assert.ok(phase37Gate.tests.includes('tests/phase37-audit-fixes.test.mjs'));
assert.ok(phase37Gate.requiredAssertions.some(item => item.includes('APNG')));
assert.ok(phase37Gate.requiredAssertions.some(item => item.includes('read-only tabs')));
assert.ok(matrix.browserSuites[0].supportingTests.includes('tests/phase37-audit-fixes.test.mjs'));
assert.ok(matrix.browserSuites[0].requiredPathFilters.includes('PHASE37-CHANGELOG.md'));
assert.ok(matrix.browserSuites[0].browserScenarios.some(item => item.includes('second read-only tab')));
const phase36Gate = matrix.crossCuttingGates.find(gate => gate.id === 'phase36-profile-media-call-beautify');
assert.ok(phase36Gate?.localStatus === 'passed');
assert.ok(phase36Gate.tests.includes('tests/phase36-call-transition-integrity.test.mjs'));
assert.ok(phase36Gate.requiredAssertions.some(item => item.includes('due timestamp before arming a timer')));
assert.ok(phase36Gate.requiredAssertions.some(item => item.includes('reject, missed-call')));
assert.ok(matrix.browserSuites[1].requiredEvidenceFiles.includes('phase30-chromium-v4-restore-crash-matrix.json'));
assert.ok(matrix.browserSuites[1].requiredEvidenceFiles.includes('phase31-chromium-v4-inflight-transaction-crash-matrix.json'));
assert.ok(matrix.browserSuites[1].requiredEvidenceFiles.includes('phase32-chromium-v4-prestartup-state-matrix.json'));
assert.ok(matrix.browserSuites[1].requiredPathFilters.includes('PHASE30-CHANGELOG.md'));
assert.ok(matrix.browserSuites[0].browserScenarios.some(item=>item.includes('owned Circle post')));
assert.ok(matrix.crossCuttingGates.some(gate=>gate.id==='phase25-circle-mailbox-lifecycle'&&gate.localStatus==='passed'));
assert.ok(matrix.browserSuites[0].requiredPathFilters.includes('tests/mailbox-circle-write-paths.test.mjs'));
assert.ok(matrix.browserSuites[0].browserScenarios.some(item=>item.includes('outgoing mailbox letter')));
assert.ok(matrix.browserSuites[0].browserScenarios.some(item=>item.includes('actual post composer')));
assert.ok(matrix.crossCuttingGates.some(gate=>gate.id==='phase24-mailbox-circle-write-paths'&&gate.localStatus==='passed'));
assert.ok(matrix.browserSuites[0].requiredPathFilters.includes('tests/fixtures/**'));
assert.ok(matrix.browserSuites[0].browserScenarios.some(item=>item.includes('WebM')));
assert.ok(matrix.browserSuites[0].browserScenarios.some(item=>item.includes('fake microphone')));
for (const gate of matrix.crossCuttingGates) {
  assert.ok(gate.id && gate.title);
  assert.ok(['passed', 'pending-this-phase'].includes(gate.localStatus), `${gate.id}: unexpected local status`);
  for (const file of gate.tests) await assertFile(file);
  assert.ok(gate.requiredAssertions.length >= 3);
}

const matrixWorkflowPath = '.github/workflows/browser-recovery-acceptance-matrix.yml';
await assertFile(matrixWorkflowPath);
const matrixWorkflow = await readFile(path.join(ROOT, matrixWorkflowPath), 'utf8');
assert.match(matrixWorkflow, /node tests\/browser-recovery-acceptance-matrix\.test\.mjs/);
assert.match(matrixWorkflow, /permissions:\s*\n\s+contents:\s*read/);
assert.doesNotMatch(matrixWorkflow, /gh-pages|peaceiris\/actions-gh-pages|git push|npm publish/i);
for (const eventName of ['push', 'pull_request']) {
  const filters = extractPathFilters(matrixWorkflow, eventName, matrixWorkflowPath);
  includesAll(filters, [MATRIX_PATH, DOC_PATH, 'tests/browser-recovery-acceptance-matrix.test.mjs', 'tests/run-browser-with-evidence.mjs', 'tests/browser-evidence-runner.test.mjs', 'tests/isolated-application-rehearsal-e2e.mjs', 'tests/isolated-application-fixtures.mjs', 'tests/isolated-application-fixtures.test.mjs', 'tests/isolated-restore-lifecycle-e2e.mjs', 'tests/isolated-restore-crash-worker.mjs', 'tests/phase25-circle-mailbox-lifecycle.test.mjs', 'tests/storage-quota-background.test.mjs', 'tests/phase27-cross-module-faults.test.mjs', 'tests/phase28-restore-combined-failures.test.mjs', 'tests/phase31-restore-strict-durability.test.mjs', 'tests/chromium-v4-restore-crash-matrix.mjs', 'tests/chromium-v4-restore-crash-matrix.test.mjs', 'tests/backup-atomicity.test.mjs', 'PHASE26-CHANGELOG.md', 'PHASE27-CHANGELOG.md', 'PHASE28-CHANGELOG.md', 'PHASE29-CHANGELOG.md', 'PHASE31-CHANGELOG.md', 'PHASE32-CHANGELOG.md', 'tests/phase33-ci-evidence-persistence.test.mjs', 'PHASE33-CHANGELOG.md', 'tests/phase34-chromium-process-group-cleanup.test.mjs', 'PHASE34-CHANGELOG.md', 'tests/phase36-profile-media-call-beautify.test.mjs', 'tests/phase36-call-transition-integrity.test.mjs', 'PHASE36-CHANGELOG.md', 'tests/phase37-audit-fixes.test.mjs', 'PHASE37-CHANGELOG.md', 'android-apps/app/src/main/AndroidManifest.xml', 'android-apps/app/src/main/java/com/mercyy/twodeers/MainActivity.java', '.github/workflows/isolated-application-rehearsal.yml', '.github/workflows/isolated-restore-lifecycle.yml'], `${matrixWorkflowPath} ${eventName}`);
}

console.log('PASS: Phase 17-37 acceptance matrix matches the actual browser runner suites, workflow artifacts and push/pull_request path filters; local and remote evidence states remain truthful; release gates remain blocked pending real Chromium CI and Android validation.');
