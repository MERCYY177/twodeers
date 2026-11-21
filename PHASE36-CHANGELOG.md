# Phase 36 — Profile media, call lifecycle and appearance write integrity

## Scope

Continue from the Phase 35 business-integrity repair package. This phase changes only the Twodeers local project source, its exact-source regression tests, acceptance metadata and documentation. It does not modify remote `main`, create a PR, deploy Pages, or alter the learning feature.

## Production changes

### Profile image storage and recovery

- Profile avatar, chat background, home cover and custom home-icon Data URLs are migrated to the shared IndexedDB media store.
- Identical legacy Data URLs are deduplicated across all migrated slots. The legacy Data URL remains in state until every new Blob has been written and read back through the media manager.
- Main-state save and post-save readback are checked. A failure restores the previous in-memory state and exact localStorage snapshot, releases newly-created object URLs and attempts to delete only the new unreferenced media records. If rollback cannot be confirmed, the runtime recovery coordinator is locked rather than silently continuing.
- Startup hydration recreates runtime-only Blob URLs for already-persisted `idb-media:` references after reload. Missing records are reported; the application does not fabricate replacement media.
- Profile media references participate in global reachability and backup media manifests. Chat backups include chat-relevant avatars/background; parameter backups include personal UI images/icons and Circle profile media; complete backups include all referenced media.
- The shared Circle media manager now exports `ensureRefs()` for profile upload, hydration and backup restore. It retries prior missing-cache entries, counts invalid/missing references, and prevents a stale asynchronous load from publishing an object URL after cache invalidation.
- APNG and SVG Data URL validation is consistent between profile upload and the shared media manager. SVG and animated image byte streams are preserved rather than rasterized by the profile-image path.

### Call lifecycle and scheduling

- The call panel explicitly labels itself as a simulation with no real microphone/camera stream; the inert mute action was removed instead of being presented as a working microphone control.
- Wake Lock requests are token-fenced. A late grant after hang-up/pagehide is released and cannot resurrect a lock for a completed call.
- Outgoing start, incoming ring, answer, reject, missed call, minimize, restore and hang-up paths preserve the previous state and matching panel when the main-state save fails.
- Incoming-call scheduling now saves its due timestamp before arming a timeout. A failed schedule replacement restores the previous timestamp and timer. If persisting the due-time clear fails when a timer fires, the pending call is not shown; the due timestamp is retained and retried after a bounded five-second delay.

### Chat beautify persistence

- Applying a preset or restoring the default checks the actual `save()` result. On failure, the prior selected ID and CSS classes are restored, and the UI does not show a success notification.
- Legacy `carbon-glass` migration and invalid preset cleanup no longer claim an unsaved migration succeeded.

## Regression tests

- `tests/phase36-profile-media-call-beautify.test.mjs` executes the production media manager API, profile-image writer/migration, profile media reference collection, beautify application/reset and Wake Lock race handling.
- `tests/phase36-call-transition-integrity.test.mjs` executes the production call transition and scheduler functions with save-failure injection. It covers outgoing and incoming flows, answer, reject, missed call, minimize, restore, hang-up, commit-before-timer scheduling, restoration of an earlier schedule after a failed replacement, and bounded retry after a failed due-time commit.
- `tests/circle-media-migration.test.mjs` and `tests/phase25-circle-mailbox-lifecycle.test.mjs` retain the existing shared-media/backup lifecycle assertions with the new profile reference collector included in their test fixtures.
- Both Phase 36 tests are invoked by `tools/verify-twodeers-hardening.mjs`; the browser/restore workflows and the machine-readable acceptance matrix include their paths so future changes trigger the proper CI gates.

## Local validation status

- 33 individual `tests/*.test.mjs` suites: passed.
- `node tools/verify-twodeers-hardening.mjs`: passed.
- JavaScript syntax, inline HTML script syntax, Android XML parsing, backup/restore contracts and existing regression suites: passed through the hardening runner.
- ZIP structure and SHA integrity are validated when the final package is built.

## Evidence limits

- This environment's Chromium process did not produce DOM output even for `about:blank`; the smoke process timed out with D-Bus/zygote startup errors. Therefore real Chromium UI execution remains `not-run`/environment-blocked, not passed.
- GitHub Actions has not been run for this local-only work. No remote push/PR was made.
- Android Gradle build, Android WebView and physical-device validation remain `not-run`.
- The 33 local suites are Node/VM and source-contract evidence. They do not prove pixel-level layout or actual Android runtime behavior.
