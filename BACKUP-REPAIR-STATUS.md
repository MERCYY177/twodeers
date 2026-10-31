# Backup Repair Status

Last updated: 2026-10-31 (UTC)
Repository: `MERCYY177/twodeers`
Working branch: `repair/backup-export-readonly`

## Recovery baseline and current refs

- Original repair baseline: `18890a65a8ba75f68432444701f8a9a0ebf6b41c`
- Main HEAD observed immediately before this checkpoint: `203936bc02a0ff47ae601863b209c4fd616b2d34`
- Repair branch HEAD immediately before this checkpoint: `3bedc4b50f0eef94c750a95ef546110bf9652db6`
- Repair branch comparison against baseline: 41 commits ahead, 0 behind.
- Main comparison against baseline: 8 commits ahead, 0 behind.
- This document is being created as a single-file checkpoint commit. Its resulting commit SHA becomes the repair branch HEAD after creation; read the branch ref to obtain that SHA.
- The file did not exist on the repair branch immediately before this checkpoint.
- This record reflects GitHub remote state only. It does not claim inspection of any developer's local uncommitted working tree.

## Scope and safety rules

- Continue work only on `repair/backup-export-readonly`.
- Do not write to `main`.
- Do not merge or rebase main as part of routine recovery.
- Do not force-push, reset, recreate, or overwrite the repair branch.
- Work in one bounded batch at a time; test, commit, read back the result, and record the resulting SHA.
- After interruption, re-read GitHub branch refs, relevant commits, Actions runs, and this file before continuing.

## Completed implementation milestones on the repair branch

The following milestone commits are present in the repair branch history:

| Milestone | Commit |
| --- | --- |
| Read-only snapshot coordinator | `7d9cc66d12158dc238b4df47ec8959ecd2d50a40` |
| Chat/Circle/media write tracking | `6ce6d60a8b4336c99de3c923f28b98dea6edb9ac` |
| Atomic read-only font-library snapshot | `fb41ab54a8bf1af19d209e1b4186e727c912a28e` |
| Unified file-save service | `cf0240cd8f5dfb6daa2a3459033376093799478e` |
| Android trusted-origin chunk bridge | `115e94a3eb79715e01577078e7779ec78164dac9` |
| V4 snapshot integration and resource tests | `4c5cb0f4e397b5abbec40f0c274375485dff59e4` |
| Android save cancellation feedback | `89f81d80d0e575eee8b39dcd64b4ece3ad51a3d1` |
| Native save completion propagation | `9cd2d2f09eed27f71de0e3f3c04c5ab887be5430` |
| Backup-time storage write audit | `92695c25113af40f6b40c36eea6a71744552677a` |
| Browser downloaded-file read-back test | `3bedc4b50f0eef94c750a95ef546110bf9652db6` |

The branch comparison from the original baseline reports these 12 changed/added paths:

- `.github/workflows/android-apk.yml`
- `android-apps/app/src/main/java/com/mercyy/twodeers/MainActivity.java`
- `backup-file-service.js`
- `backup-snapshot-coordinator.js`
- `backup-v4.js`
- `custom-font-manager.js`
- `index.html`
- `tests/backup-file-service.test.mjs`
- `tests/backup-snapshot-coordinator.test.mjs`
- `tests/backup-v4.test.mjs`
- `tests/browser-smoke.mjs`
- `tools/verify-source.mjs`

## Latest confirmed CI evidence

- Latest successful repair-branch Actions run observed: run `41184758244`.
- Run head SHA: `3bedc4b50f0eef94c750a95ef546110bf9652db6`.
- Job ID: `124489307909`.
- Recorded job result: success.
- Job log reported 14 tests passed, 0 failed; Playwright browser regression step succeeded; Android debug APK build reported `BUILD SUCCESSFUL`; artifact upload succeeded.
- The tested areas include unified save handling for same-realm and cross-realm Blob-like values, awaiting native save completion, cancellation/error propagation, pending-write draining and persisted revisions, snapshot invalidation/release behavior, hash/CRC vectors, V4 ZIP/manifest/resource handling, media blobs, and corrupt ZIP hash rejection.
- These CI results do not establish a successful real-device Android Storage Access Framework (SAF) save/read-back test, nor do they prove every acceptance criterion below is complete.

## Main branch changes and integration risk

At the time of this checkpoint, main is `203936bc02a0ff47ae601863b209c4fd616b2d34`.

Compared with the common baseline, main has 8 commits and changes two paths:

- `sticker-library.js`
- `tests/browser-smoke.mjs`

The repair branch also changes `tests/browser-smoke.mjs`. Main's recent changes include sticker upload/favorite/delete regression coverage and a test interaction adjustment; the repair branch adds backup snapshot/write-audit, font Blob, V4 restore, and unified-save download/read-back coverage. Treat this as a same-file integration point. Do not replace either complete file with the other branch's version. Review and port only the required test changes surgically, then run the full browser regression suite.

No direct overlap was reported for the main changes with the repair branch's backup implementation files (`backup-v4.js`, `custom-font-manager.js`, `index.html`, or `MainActivity.java`) in the baseline comparison.

## Remaining acceptance work

- Complete a systematic source audit of all backup/export entry points and confirm snapshot reads do not invoke mutating save/flush/fallback paths.
- Verify cross-module read-only snapshots, revision/persistedRevision checks, pending-write draining, and snapshot/event barrier release under success and failure.
- Audit complete font-library import/export fidelity and selected-font restoration.
- Audit unified file-save routing across all relevant exports, including social-feed export.
- Verify cross-iframe Blob handling in supported browsers.
- Complete Android trusted-origin bridge review: main-frame/origin checks, task IDs, chunk sequencing/length limits, SHA-256, cancellation, file read-back verification, and provider limitations.
- Perform a real-device Android SAF save and read-back test when a device/provider is available.
- Verify old JSON/V3 import compatibility.
- Re-run Android build and browser tests after subsequent integration changes.
- Determine old APK signing identity/package/version compatibility before making any claim about in-place upgrade compatibility.

## Known risks and limitations

- `tests/browser-smoke.mjs` has changes on both main and the repair branch; surgical integration is required.
- CI has built a debug APK, but no real-device SAF verification is recorded here.
- Old APK signing identity has not been established; overwrite-install compatibility is unknown.
- The latest main Actions state was not revalidated in this checkpoint; do not infer its current status from earlier runs.
- The 14 passing tests are the logged test count for the latest successful repair run, not a claim that the entire acceptance checklist is complete.

## Next single task

Review the exact main-vs-repair diff for `tests/browser-smoke.mjs` and prepare a minimal, surgical integration plan for the main-only sticker regression changes. Do not edit source in that review task. After review, implement only that test-file integration in a separate bounded batch, then run the browser regression suite and record its commit and Actions run here.
