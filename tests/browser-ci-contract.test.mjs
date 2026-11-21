import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflows = [
  {
    name: 'Phase 17',
    file: new URL('../.github/workflows/isolated-application-rehearsal.yml', import.meta.url),
    suite: 'phase17',
    requiredPaths: [
      'tests/isolated-application-rehearsal-e2e.mjs',
      'tests/media-send-paths.test.mjs',
      'tests/mailbox-circle-write-paths.test.mjs',
      'tests/video-media-paths.test.mjs',
      'tests/voice-media-paths.test.mjs',
      'tests/fixtures/**',
      'tests/isolated-application-fixtures.test.mjs',
      'tests/run-browser-with-evidence.mjs',
      'tests/browser-evidence-runner.test.mjs',
      'tests/browser-ci-contract.test.mjs'
    ]
  },
  {
    name: 'Phase 18',
    file: new URL('../.github/workflows/isolated-restore-lifecycle.yml', import.meta.url),
    suite: 'phase18',
    requiredPaths: [
      'tests/isolated-restore-lifecycle-e2e.mjs',
      'tests/isolated-restore-crash-worker.mjs',
      'tests/isolated-application-fixtures.mjs',
      'tests/isolated-application-fixtures.test.mjs',
      'tests/run-browser-with-evidence.mjs',
      'tests/browser-evidence-runner.test.mjs',
      'tests/browser-ci-contract.test.mjs'
    ]
  }
];

for (const workflow of workflows) {
  const source = await readFile(workflow.file, 'utf8');
  assert.match(source, /permissions:\s*\n\s+contents:\s*read/, `${workflow.name}: contents permission must remain read-only`);
  assert.match(source, /node-version:\s*["']22["']/, `${workflow.name}: Node runtime must be pinned to 22`);
  assert.match(source, /playwright@1\.65\.0/, `${workflow.name}: Playwright version must remain pinned`);
  assert.match(source, /Initialize browser evidence directory/, `${workflow.name}: evidence folder must exist before bootstrap`);
  assert.match(source, /00-runner-environment\.log/, `${workflow.name}: runner metadata must be captured`);
  for (const log of ['01-font-apt-update.log', '02-font-install.log', '03-playwright-npm-install.log', '04-chromium-install.log', '05-evidence-runner-self-test.log']) {
    assert.ok(source.includes(log), `${workflow.name}: missing bootstrap evidence log ${log}`);
  }
  for (const requiredPath of workflow.requiredPaths) {
    assert.ok(source.includes(requiredPath), `${workflow.name}: changes to ${requiredPath} must trigger the workflow`);
  }
  assert.match(source, new RegExp(`run-browser-with-evidence\\.mjs ${workflow.suite}`));
  assert.match(source, /actions\/upload-artifact@v4/);
  assert.match(source, /if:\s*always\(\)/);
  assert.match(source, /retention-days:\s*14/);
  assert.match(source, /concurrency:/);
  assert.match(source, /cancel-in-progress:\s*true/);
  assert.match(source, /timeout-minutes:\s*(45|50)/);
  assert.doesNotMatch(source, /gh-pages|peaceiris\/actions-gh-pages|git push|npm publish/i, `${workflow.name}: browser CI must not deploy or publish`);
}

console.log('PASS: Phase 17/18 browser workflows initialize and preserve bootstrap evidence, run the pinned browser suite, trigger on every required test dependency, upload artifacts after failures, retain read-only permissions, and contain no deploy/publish step.');
