# Phase 33 — Independent Chromium crash-matrix CI and durable forensic artifacts

## Scope
Audit the Phase 32 V4 crash-matrix workflow and failure-evidence lifecycle. No V4 production recovery logic was changed.

## Confirmed CI orchestration defect
The six-stage V4 SIGKILL matrix previously ran as a later step in the same job as the Phase 18 isolated browser rehearsal. If Phase 18 failed or timed out, the V4 crash matrix was skipped entirely. The workflow now defines an independent `v4-restore-crash-matrix` job with no `needs` dependency on Phase 18, its own 60-minute timeout, Node 22, deterministic TTF setup, pinned Playwright 1.65.0 and Chromium plus OS dependencies.

## Confirmed evidence gaps
- The harness did not write its JSON file until the first stage completed or failed. A runner/job interruption during a live stage could leave no evidence artifact.
- Stage progress was only retained in memory until the full scenario returned.
- A failed scenario's persistent Chromium Profile was deleted in `finally`, removing the most useful IndexedDB/Local Storage evidence.

## Changes
- `tests/chromium-v4-restore-crash-matrix.mjs`
  - Creates `phase33-chromium-v4-ci-independent-matrix.json` in `preflight` state before Chromium lookup/launch.
  - Writes JSON updates with a temporary file and atomic rename.
  - Persists each stage status and progress, including checkpoint details before SIGKILL, process-group termination, raw pre-startup snapshot, and post-startup recovery result.
  - Copies a failed scenario's stopped synthetic Chromium Profile to `failed-profiles/<stage>` only when the synthetic application fixture may have written data; pre-seed environment blocks do not upload an empty browser Profile. Successful profiles continue to be deleted.
- `.github/workflows/isolated-restore-lifecycle.yml`
  - Keeps Phase 18 lifecycle rehearsal independent from a new `v4-restore-crash-matrix` CI job.
  - Installs fonts, pinned Playwright/Chromium and system dependencies in the new job.
  - Uploads its evidence and failed profiles with `if: always()`.
- `tests/phase33-ci-evidence-persistence.test.mjs`
  - Executes the actual atomic JSON writer under successful and injected filesystem-failure cases.
  - Verifies job independence, install steps, always-upload behavior, artifact path and push/PR path filters.
- Updates the hardening gate, machine-readable acceptance matrix, browser recovery acceptance document and coverage-gap audit.

## Local validation boundary
The Phase 33 Node contract is expected to pass locally. The actual Chromium run remains blocked in this container by the managed URL policy before loopback navigation; its status must remain `blocked-local-admin-policy`. No GitHub Actions run has been performed because no source was pushed and no PR was opened. The independent CI job is ready but is not browser-pass evidence until its run and uploaded artifact are inspected.

No remote repository changes, pushes, PRs, merges or deployments were performed. The learning feature was not modified.
