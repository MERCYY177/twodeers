# Phase 35 — Business persistence and legacy image-upload repairs

## Baseline and scope

- Baseline: `twodeers-phase34-chromium-process-cleanup.zip`.
- This phase changes production business code; it is not another Chromium-harness-only phase.
- No changes were made to the learning module, remote branches, `main`, deployment, or release configuration.
- The original `kkk35g1` project remains outside the write scope.

## Production defects repaired

1. **Legacy avatar/background/home-cover/icon uploads were unbounded.** The old `FileReader` path converted arbitrary image files directly into localStorage Data URLs. It now rejects empty/non-image files and inputs above 20 MB; preserves GIF, APNG, WebP and SVG source bytes instead of flattening animation/vector content; limits preserved animated/vector assets; and compresses ordinary raster images to a 1920-pixel maximum edge and 2.5 MB output ceiling. If compression is unavailable, oversized files are rejected rather than written unchecked. The existing DataURL state format is retained for compatibility; this phase does not claim a full migration of these profile assets to IndexedDB.
2. **Clearing a profile/icon image could report success after persistence failed.** The clear handler now checks `save()`, restores the previous state and rendered image on failure, and emits only a failure message.
3. **Chat, Circle, Moments, sticker-index, card and mailbox persistence ignored a false cross-tab revision marker in several paths.** The affected writers now detect the failure. Where possible, they restore the previous localStorage snapshot and report rollback status. Circle/media deletion and media-database clearing restore the prior IndexedDB records and verify them when the revision marker fails. Font operations reject with an explicit `RevisionMarkerError` and `dataCommitted=true` because their IndexedDB transaction has already committed; the runtime coordinator has already locked the page, so callers are told to reload and inspect rather than being told the operation was a normal success.
4. **Custom-font import referenced an undeclared `options` variable in `saveFontRecord()`.** It now passes the default transaction options explicitly (`null`), so the ordinary user font-import write path no longer throws a `ReferenceError` before committing.

## Tests added or updated

- `tests/phase35-business-write-integrity.test.mjs` executes the production legacy image conversion function with browser API fixtures, checks animation preservation and file-size limits, exercises the actual clear-button callback with a failed save, and executes the production font-record writer.
- `tests/phase31-restore-strict-durability.test.mjs` now covers the extra read-before-delete verification transaction and confirms that a failed revision marker restores the deleted media record and releases the mutation token.
- `tools/verify-twodeers-hardening.mjs` runs the new Phase 35 test.
- `docs/browser-recovery-acceptance-matrix.json` now records 31 local Node test suites.

## Validation performed

- All 31 `tests/*.test.mjs` suites passed locally.
- `node tools/verify-twodeers-hardening.mjs` passed in full, including JavaScript syntax, HTML, Android XML, workflow contracts, V4 restore tests and the new Phase 35 business tests.
- The targeted Phase 31 and Phase 35 tests passed independently.

## Remaining validation limits

- The real Chromium crash/relaunch matrix remains unverified: this environment's managed Chromium policy previously blocked navigation to the local fixture (`ERR_BLOCKED_BY_ADMINISTRATOR`). The local test suite does not replace that evidence.
- Android Gradle/device/WebView validation was not run in this environment; no Gradle wrapper or installed Gradle executable is present here.
- Real-device image decoding/compression and visual inspection of every profile icon/avatar/background are not claimed as completed.
- Full migration of legacy profile DataURLs to IndexedDB remains intentionally out of scope for this corrective patch because it requires a coordinated state-schema, URL hydration, garbage-collection, JSON backup and V4 backup/restore migration. The current patch bounds and verifies the legacy path without risking existing saved profile data.
- Call lifecycle and all chat-beautify presets still require separate real-browser functional/visual acceptance; no defect was invented or changed without evidence.

## Safety boundary

No remote push, pull request, merge, deployment, or `main` modification was performed. Existing project files and user data formats were preserved except for the bounded conversion of newly selected static raster images.
