# Phase 29 — Real Chromium V4 restore crash checkpoints

## Scope

Close the evidence gap between a synthetic PREPARED journal startup test and an actual crash during the production `restoreV4()` flow. This phase adds a four-checkpoint persistent-profile Chromium rehearsal.

## New browser harness

`tests/chromium-v4-restore-crash-matrix.mjs` uses Chromium's DevTools Protocol directly (with optional Playwright package discovery only to locate a Playwright-installed browser binary). It does not replace browser storage or reimplement restore logic. For each isolated profile it:

1. Seeds synthetic localStorage, media IndexedDB and font IndexedDB.
2. Loads the actual Twodeers application and builds a real V4 `all` ZIP using `window.__duoBackupV4.build('all')`.
3. Changes the current source state, Circle post, media Blob and font library so source-versus-target recovery is distinguishable.
4. Invokes the production `window.__duoBackupV4.restore()` and pauses after one of four actual production operations: durable PREPARED journal save, first `putMediaBlob()` completion, font library import completion, or durable COMMITTED marker completion.
5. Sends SIGKILL to the complete Chromium process group.
6. Launches a fresh Chromium process using the same persistent profile directory and lets the real application startup recovery run.
7. Verifies writer status, state/Circle contents, media bytes/type, font IDs and recovery-journal removal.

PREPARED interruptions must restore the pre-restore source snapshot; COMMITTED interruption must retain the imported target archive and must not replay the old snapshot. A JSON artifact records browser version, each checkpoint's journal phase, kill signal and post-relaunch results.

## CI integration

- Added `tests/chromium-v4-restore-crash-matrix.mjs` and its structural contract test to `.github/workflows/isolated-restore-lifecycle.yml`.
- The workflow already installs pinned Playwright and Chromium; the new harness discovers that browser executable and runs after the existing Phase 18 rehearsal.
- Added the new files and `PHASE29-CHANGELOG.md` to push/pull_request path filters in the restore-lifecycle and matrix workflows.
- Added the harness contract to `tools/verify-twodeers-hardening.mjs`.
- Updated the machine-readable and human-readable acceptance matrix and coverage-gap audit.

## Validation performed

- `node --check` passes for the new browser harness and contract test.
- The local browser attempt launched Chromium 144, but Chromium refused navigation to the isolated loopback HTTP URL with `net::ERR_BLOCKED_BY_ADMINISTRATOR`. The managed policy has a blanket URL block. No system policy was modified or bypassed.
- Consequently the actual four browser crash/relaunch cases remain `not-run` locally; this phase does not claim browser evidence passed.
- GitHub Actions remains `not-run` because no source was pushed.
- The Phase 29 structural contract test, complete local Node regression suites and hardening gate are required to pass before packaging.

## Explicit limitations

The new matrix kills Chromium immediately after each selected production operation has completed; it does not kill the renderer in the middle of an individual IndexedDB transaction. Physical device power-loss, browser quota exhaustion, Android WebView and real remote CI evidence remain open.

No remote branch, PR, deployment or `main` branch was changed. No learning feature or production data was used.
