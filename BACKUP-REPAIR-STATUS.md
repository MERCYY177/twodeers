# Backup Repair Status

Last updated: 2026-10-31 (UTC)
Repository: `MERCYY177/twodeers`
Working branch: `repair/backup-export-readonly`

## Recovery baseline and current refs

- Original repair baseline: `18890a65a8ba75f68432444701f8a9a0ebf6b41c`
- Main HEAD re-read on 2026-10-31: `489a8acc09627e32c18590440c77858f25ebdc3f`
- Repair branch code/test HEAD re-read on 2026-10-31: `513dd8fb4ae17058f5f0417b3273a6e68bed46a0`
- Repair branch comparison against the original baseline: 62 commits ahead, 0 behind.
- Main comparison against the original baseline at the observed main HEAD: 19 commits ahead, 0 behind.
- Compared with task start HEAD `ce500a99a80ca11cb45376c981f90b045e976587`, this task added 16 commits and changed five paths: `backup-snapshot-coordinator.js`, `backup-v4.js`, `index.html`, `tests/backup-snapshot-coordinator.test.mjs`, and `tests/browser-smoke.mjs`.
- This is a remote-state checkpoint. The next commit updates this status document only.
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

- Latest successful repair-branch Actions run: run `41203238723` (workflow run #92).
- Run URL: https://github.com/MERCYY177/twodeers/actions/runs/41203238723
- Run head SHA: `513dd8fb4ae17058f5f0417b3273a6e68bed46a0`.
- Job ID: `124543071057`; job and workflow conclusion: `success`.
- Node test suite: 16 tests, 16 passed, 0 failed, 0 skipped.
- Playwright browser regression output: `result: passed`. Assertions include Circle save registration exactly once, failed-save rollback, timed auto-post persistence, snapshot invalidation on write, V3 full restore success and failure rollback, V4 full restore, V4 injected failure rollback for chat/localStorage/Circle/media/fonts and selected font, a snapshot waiting for V4 restore to finish, and a V4 restore entry being rejected without mutation once a snapshot is active. Existing sticker, media, V3/V4, and custom-font browser checks also remain.
- Android Debug APK: `BUILD SUCCESSFUL in 16s`.
- Artifact upload succeeded: `twodeers-debug-apk`, artifact ID `13043655275`, size 1,265,332 bytes. This is a CI build artifact, not a real-device SAF test.
- Intermediate failures on the way to this checkpoint are recorded accurately: runs `41202472563` and `41202511869` stopped at `verify-source` because the V3 branch rewrite had one extra closing brace; runs `41203089613` through `41203114528` exposed tests still using the previous `trackOperation(Promise)` interface; runs `41203141720` and `41203165496` exposed a unit-test microtask timing assumption. The branch was corrected and the final Run #92 passed all steps.
- These CI results do not establish a successful real-device Android Storage Access Framework (SAF) save/read-back test, nor do they prove every acceptance criterion below is complete.

## Main branch changes and integration risk

Main was re-read at `489a8acc09627e32c18590440c77858f25ebdc3f` on 2026-10-31. Compared with the original baseline, main is 19 commits ahead and 0 behind. Its changed paths include the Android workflow/build/manifest and launcher resources, `chat-beautify-manager.js`, `chat-beautify-presets.js`, `index.html`, `sticker-library.js`, and browser/chat-beautify tests.

The repair branch and main now both modify `.github/workflows/android-apk.yml`, `index.html`, and `tests/browser-smoke.mjs`. Main's `index.html` delta is small at the baseline comparison, but it is still a same-file integration point and must be reviewed surgically before any future integration. Main's `sticker-library.js` change is not copied to repair: the repair branch deliberately retains the three-tab product behavior (uploads, favorites, builtin placeholder). Do not replace either complete workflow, index, or browser test file with main's version.

No write, merge, cherry-pick, or rebase was performed on main. All current repairs and tests were committed only to `repair/backup-export-readonly`.

## Snapshot write-registration repair completed in this task

- Circle `save()` override now delegates once to the original save function, preserving its sole successful `noteWrite('circle', true)` registration. A failed underlying storage write records an unpersisted Circle revision instead of silently appearing clean. Circle `importState` now checks persistence success and verifies rollback storage before reconciling the revision.
- V3 import entry is registered as one pending operation before execution. The `all` path persists chat through the tracked `save()`, restores media rollback through a tracked helper, restores old chat localStorage through a helper that records success/failure, and rolls back Circle through its registered import path. The legacy `chat` and `param` branches now use guarded state/storage/media rollback rather than leaving partial changes.
- V4 restore is registered for its full asynchronous lifetime. Chat localStorage rollback, Circle rollback, media put/delete restoration, and font database rollback are each routed through the relevant tracked write paths. A restore that begins before a snapshot is drained before snapshot capture; a restore requested after the snapshot barrier is active is rejected before its callback can run.
- Whole-space reset was also placed inside the same pending-operation barrier; its chat storage removal is registered after successful removal, and media clear continues through the tracked media service.
- Browser integration coverage exercises Circle success/failure/timer paths, V3 full success/failure rollback including localStorage and IndexedDB media, V4 injected failure rollback across chat/Circle/media/font and selected-font state, and both directions of restore/snapshot interleaving.
- The static write-path audit covered repository web JS/HTML persistence sources: Circle and chat localStorage save paths; Circle/V3/chat rollback and reset paths; media IndexedDB put/delete/clear/rollback; and font IndexedDB set-current/import/delete paths. All data writes found are registered with the snapshot coordinator either directly or via `trackWrite`/the outer pending operation. The one remaining `localStorage.setItem('__chuanxun_font_signal__', ...)` is a cross-tab notification signal, not font-library snapshot data. No other unregistered web snapshot-data write path was found in the audited source files.
- Modified files for this task: `index.html`, `backup-v4.js`, `backup-snapshot-coordinator.js`, `tests/backup-snapshot-coordinator.test.mjs`, and `tests/browser-smoke.mjs`.
- Final code/test commit: `513dd8fb4ae17058f5f0417b3273a6e68bed46a0`; Run #92 is green.

## Remaining acceptance work

- Complete any remaining read-only/export-entry audit beyond the storage-write registration scope, including export flows not exercised by the current browser suite.
- Audit unified file-save routing across all relevant exports, including social-feed export.
- Extend cross-iframe Blob verification beyond the CI Chromium environment where other supported engines are required.
- Complete Android trusted-origin bridge review: main-frame/origin checks, task IDs, chunk sequencing/length limits, SHA-256, cancellation, file read-back verification, and provider limitations.
- Perform a real-device Android SAF save and read-back test when a device/provider is available. CI APK build success does not prove device/provider behavior.
- Add fixtures for any older V3 JSON variants not represented by the current full/param restore browser tests.
- Determine old APK signing identity/package/version compatibility before making any claim about in-place upgrade compatibility.

## Known risks and limitations

- `.github/workflows/android-apk.yml`, `index.html`, and `tests/browser-smoke.mjs` are integration points shared by main and repair relative to the common baseline; do not overwrite repair files wholesale.
- CI built and uploaded a debug APK, but there is no real-device Android SAF save/read-back result. Provider-specific behavior remains unverified.
- Old APK signing identity has not been established; overwrite-install compatibility is unknown.
- Main's SHA was revalidated, but no claim is made about the current main Actions status.
- The final CI proves web-source verification, 16 Node tests, Playwright Chromium browser behavior, Android debug compilation, and artifact upload. It does not prove real-device Android storage behavior or complete all remaining acceptance work.

## Next single task

The Circle/V3/V4 snapshot write-registration repair is complete at code/test commit `513dd8fb4ae17058f5f0417b3273a6e68bed46a0`, with Run #92 green. Do not start a new implementation batch implicitly. On the next explicitly requested batch, re-read both branch refs and this status file, then select one remaining acceptance item above. Preserve the three sticker tabs and keep all writes off main.
