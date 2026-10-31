# Backup Repair Status

Last updated: 2026-10-31 (UTC)
Repository: `MERCYY177/twodeers`
Working branch: `repair/backup-export-readonly`

## Recovery baseline and current refs

- Original repair baseline: `18890a65a8ba75f68432444701f8a9a0ebf6b41c`
- Main HEAD re-read on 2026-10-31: `58eb499521c5f1b9e4653b07a272082d08ddc029`
- Repair branch code/test HEAD re-read on 2026-10-31 before this status update: `60873fb92bda2e9ca4496525e942d51d9d876a09`
- Repair branch comparison against the original baseline at that code/test HEAD: 45 commits ahead, 0 behind.
- Main comparison against the original baseline at the observed main HEAD: 16 commits ahead, 0 behind.
- This is a remote-state checkpoint. A separate status-only commit will follow this code/test checkpoint.
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

The repair branch comparison from the original baseline reports these 13 changed/added paths:

- `.github/workflows/android-apk.yml`
- `BACKUP-REPAIR-STATUS.md`
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

- Latest successful repair-branch Actions run: run `41187443752` (workflow run #73).
- Run URL: https://github.com/MERCYY177/twodeers/actions/runs/41187443752
- Run head SHA: `60873fb92bda2e9ca4496525e942d51d9d876a09`.
- Job ID: `124497129025`; job and workflow conclusion: `success`.
- Node test suite: 14 tests, 14 passed, 0 failed, 0 skipped.
- Playwright browser regression output: `result: passed`; verified three sticker tabs remain, builtin placeholder remains honest, PNG/GIF upload and image load, favorite toggle/empty state/persistence, referenced media protection, orphan media cleanup, sent-media backup, V4 restore, V3 import, and custom-font import.
- Android Debug APK: `BUILD SUCCESSFUL in 19s`.
- Artifact upload succeeded: `twodeers-debug-apk`, artifact ID `13037980252`, size 1,263,914 bytes. The artifact is available from the Run #73 page.
- The earlier sticker-port attempts were not successful and are retained as failure history: run `41186401148` failed because the second delete control was hidden; run `41187151238` failed because the test clicked `#emojiBtn` while the test was still on the home page and `chatPage` was hidden.
- The final passing correction changes only the browser test harness: it explicitly shows the app-level emoji panel, sets `aria-hidden=false`, waits for the delete control to be rendered and visible, and retains the orphan IndexedDB cleanup assertion.
- These CI results do not establish a successful real-device Android Storage Access Framework (SAF) save/read-back test, nor do they prove every acceptance criterion below is complete.

## Main branch changes and integration risk

Main was re-read at `58eb499521c5f1b9e4653b07a272082d08ddc029` on 2026-10-31. Compared with the original baseline, main is 16 commits ahead and 0 behind. Its changed paths are:

- `.github/workflows/android-apk.yml`
- `android-apps/app/build.gradle.kts`
- `android-apps/app/src/main/AndroidManifest.xml`
- Android launcher icon/resources under `android-apps/app/src/main/res/`
- `sticker-library.js`
- `tests/browser-smoke.mjs`

The repair branch also changes `.github/workflows/android-apk.yml` and `tests/browser-smoke.mjs`, so these remain same-file integration points. Main's `sticker-library.js` is not copied to repair: the repair branch deliberately retains the three-tab product behavior (uploads, favorites, builtin placeholder). Do not replace either complete workflow or browser test file with main's version. The required main sticker regression coverage has been surgically added to the repair test file and now passes in Run #73.

No write, merge, cherry-pick, or rebase was performed on main. The repaired browser test did not change `sticker-library.js` or other product implementation files.

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

- `.github/workflows/android-apk.yml` and `tests/browser-smoke.mjs` both differ from the common baseline on main and repair; do not overwrite either repair version wholesale.
- CI has built and uploaded a debug APK, but no real-device SAF verification is recorded here.
- Old APK signing identity has not been established; overwrite-install compatibility is unknown.
- Main's current branch SHA was revalidated, but its latest Actions state was not; do not infer its CI status from repair-branch runs.
- Run #73 confirms the 14 Node tests and browser smoke test passed; this is not a claim that the entire acceptance checklist is complete.

## Next single task

The bounded sticker-regression integration task is complete at code/test commit `60873fb92bda2e9ca4496525e942d51d9d876a09`, and Run #73 is green. Do not start a new implementation batch implicitly. On the next explicitly requested batch, first re-read both branch refs and this status file, then select one remaining acceptance item from the checklist above. Preserve the three sticker tabs and keep all writes off main.
