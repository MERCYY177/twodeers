# Twodeers Browser Recovery Acceptance Matrix

**Machine-readable source:** `docs/browser-recovery-acceptance-matrix.json`  
**Reviewed:** 2026-11-15  
**Current overall gate:** `blocked-pending-real-browser-ci`

This matrix is the acceptance contract for Phases 17–24. It separates implementation and local Node regression evidence from real Chromium, GitHub Actions, and Android evidence. A test script existing in the repository is not proof that the browser test ran.

## Current evidence state

| Evidence domain | Current status | What this means |
|---|---|---|
| Local Node regression suites | `passed` (22 suites) | The deterministic fixtures, source-level checks, workflow contracts, process-runner tests, and acceptance-matrix validator executed locally and passed. |
| Phase 17 real Chromium rehearsal | `not-run` | The complete application rehearsal has not yet produced a qualifying Chromium run. |
| Phase 18 real Chromium lifecycle rehearsal | `not-run` | Theme restore, font rollback, multi-tab handoff, and SIGKILL/relaunch recovery have not yet produced a qualifying Chromium run. |
| GitHub Actions Phase 17/18 workflows | `not-run` | The source has not been pushed to a branch/PR, so no remote workflow record exists. |
| Android APK / WebView device validation | `not-run` | No APK build or physical-device verification is claimed. |

**Release gate:** blocked until Phase 17 and Phase 18 browser workflows have successful runs with inspected artifacts, and Android runtime requirements have separate evidence. Do not promote an isolated package or write to a production application database based only on this matrix.

## Phase 17 — Isolated full-application rehearsal

**Workflow:** `.github/workflows/isolated-application-rehearsal.yml`  
**Runner command:** `node tests/run-browser-with-evidence.mjs phase17`  
**Evidence directory:** `test-results/browser-e2e/phase17/`  
**Artifact:** `twodeers-phase17-browser-evidence-{run_id}`

Expected runner steps, in order:

1. `syntax-fixtures`
2. `syntax-fixture-test`
3. `syntax-full-app-e2e`
4. `synthetic-fixture-invariants`
5. `syntax-media-send-path-test`
6. `direct-chat-send-source-regression`
7. `syntax-video-media-test`
8. `video-media-source-regression`
9. `syntax-voice-media-test`
10. `voice-media-source-regression`
11. `syntax-mailbox-circle-write-test`
12. `mailbox-circle-write-source-regression`
13. `syntax-phase25-lifecycle-test`
14. `phase25-circle-mailbox-source-regression`
15. `full-app-chromium-rehearsal`

Acceptance scenarios:

- Fresh loopback origin and isolated BrowserContext.
- Seeded localStorage, media IndexedDB, font IndexedDB and six synthetic media records.
- Real chat render, seeded chat image decode, text send, sticker-panel selection/send, reload persistence.
- Single-send composer: verify there is no batch-send control or auto-opening long-text/clipboard/card helper; send text, sticker and image separately; delete a sent picker sticker and verify future sends are blocked while the existing history image remains intact.
- Direct chat image file-picker → preview → send → reload, including actual image decode after reload.
- Three card pools and stable IDs.
- Mailbox item open and attachment decode.
- Outgoing mailbox compose with image attachment, send, reopen/decode, delete while chat retains the same media ID, and verify shared media survives.
- Circle post image file selection, preview, publish, open detail, delete, and verify the unshared Blob is reclaimed.
- Avatar and cover upload/save/decode, then clear a cover with a chat-shared media reference and verify the Blob survives.
- Circle post, avatar and cover decode.
- Custom FontFace load.
- Missing-media negative case retains the message reference and does not fabricate a Blob.
- No page errors or external-origin requests.

Required artifact evidence: `summary.json`, runner environment log, font apt logs, Playwright install log, Chromium install log, evidence-runner self-test log, and separate stdout/stderr logs for every runner step (01–15), including the mailbox/Circle source regression and full-app Chromium rehearsal.

**Pass rule:** GitHub job succeeds; `summary.json.status` is `passed`; all fifteen steps have `status=passed`, `exitCode=0`, and `timedOut=false`; all listed application assertions pass; the artifact is downloaded/inspected and required files exist.

**Current status:** fixture, direct single-send media regressions and local source checks passed; real Chromium and GitHub Actions status are `not-run`.

## Phase 18 — Isolated restore lifecycle rehearsal

**Workflow:** `.github/workflows/isolated-restore-lifecycle.yml`  
**Runner command:** `node tests/run-browser-with-evidence.mjs phase18`  
**Evidence directory:** `test-results/browser-e2e/phase18/`  
**Artifact:** `twodeers-phase18-restore-evidence-{run_id}`

Expected runner steps, in order:

1. `syntax-fixtures`
2. `syntax-lifecycle-e2e`
3. `syntax-crash-worker`
4. `synthetic-fixture-invariants`
5. `restore-lifecycle-chromium-rehearsal`

Acceptance scenarios:

- V4 ZIP build and restore re-applies the dark Ocean theme to actual document root and color-scheme.
- Injected post-write font failure rejects restore and rolls back exact prior storage bytes, font database, active font pointer, and light Cream theme.
- Two isolated tabs hand off writer ownership; stale tab cannot write before reload and reload sees committed latest state.
- A PREPARED journal is durably written, synthetic state is mutated, the worker process group is killed with SIGKILL, Chromium restarts using the same persistent profile, and startup recovery restores the snapshot and clears the journal.
- No page errors or external-origin requests.

Required artifact evidence: `summary.json`, runner environment log, font apt logs, Playwright install log, Chromium install log, evidence-runner self-test log, and separate stdout/stderr logs for all five runner steps, including the crash-worker/relaunch rehearsal.

**Pass rule:** GitHub job succeeds; `summary.json.status` is `passed`; all five steps have `status=passed`, `exitCode=0`, and `timedOut=false`; the crash worker is confirmed killed with SIGKILL; the verifier worker exits normally after inspecting the same profile; the artifact is inspected and required files exist.

**Current status:** local Node/source regressions passed; real Chromium and GitHub Actions status are `not-run`.

## Phase 19 — Evidence runner acceptance

**Tests:** `tests/run-browser-with-evidence.mjs`, `tests/browser-evidence-runner.test.mjs`.

Required assertions:

- Capture stdout and stderr completely before the child `close` event is reported.
- Preserve synchronous/asynchronous spawn errors and non-zero exit codes.
- Time out, signal the process group with SIGTERM, escalate to SIGKILL, and record `timed_out`.
- Kill orphan descendants that retain inherited stdio after the process-group leader exits.
- Write a terminal `failed` summary with `runnerError` and `finishedAt` if the runner itself fails.

**Current status:** local tests passed; CI execution not run.

## Phase 20 — CI bootstrap and process cleanup acceptance

**Tests:** `tests/browser-evidence-runner.test.mjs`, `tests/browser-ci-contract.test.mjs`, `tests/isolated-restore-lifecycle-e2e.mjs`.

Required assertions:

- POSIX process-group signaling is not gated on the leader's `exitCode`.
- The actual child `close` event is awaited before deleting the persistent Chromium profile.
- Descendants are terminated when the leader has exited but inherited pipes remain open.
- Phase 17/18 workflows retain environment, font, npm, Chromium and evidence-runner setup logs.
- Artifacts upload with `if: always()`; workflow token permission remains `contents: read`.
- Both `push` and `pull_request` path filters include all fixtures, E2E scripts, runner tests and matrix contract files.

**Current status:** local tests passed; CI execution not run.

## Phase 21 — Matrix integrity acceptance

**Test:** `tests/browser-recovery-acceptance-matrix.test.mjs`.

The test verifies that:

- Every source/test/workflow reference exists.
- Runner step names and order match the exported runner suite definitions.
- Phase 17/18 `push` and `pull_request` path filters include every required dependency.
- Workflow artifact names, directories, setup evidence files and pass criteria agree with the machine-readable matrix.
- Status fields do not claim real browser or Android evidence before execution.

**Current status:** passed locally; this validates the matrix definitions and triggers, not the remote browser E2E runs.

## Required evidence before claiming full acceptance

1. A successful Phase 17 GitHub Actions run and inspected `twodeers-phase17-browser-evidence-{run_id}` artifact.
2. A successful Phase 18 GitHub Actions run and inspected `twodeers-phase18-restore-evidence-{run_id}` artifact, including verified process-kill and relaunch-recovery output.
3. A separately documented Android APK build and Android WebView device test result.

Until all required evidence is reviewed, the browser recovery release gate remains blocked. No production data, production origin, remote `main`, deployment or learning feature is part of this test matrix.

## Phase 22 — Direct and batch media-send coverage audit

**Tests:** `tests/media-send-paths.test.mjs`, `tests/isolated-application-rehearsal-e2e.mjs`.

The source-execution regression extracts and executes the actual `sendBatchMessages()` implementation. It verifies stale sticker revalidation against the authoritative library, all-or-nothing rollback when a stale sticker is encountered after queued text/image items, successful mixed text+image commit, and rollback when final `save()` fails. The browser rehearsal adds real UI coverage for chat image file selection/preview/send and for a batch containing text, image, and an uploaded sticker that is deleted after queue insertion.

**Not covered by this phase:** browser-level video file upload/playback, microphone permission and MediaRecorder voice capture, mailbox compose/send with attachments, Circle post creation/edit/delete, browser download/save UI for every backup format, and real quota-exhaustion behavior. Some underlying helpers have Node-level coverage, but that is not equivalent to full browser UI validation.

**Current status:** Node direct/batch media-send regression passed; browser UI scenarios are scripted but remain `not-run` until a qualifying Chromium CI artifact is inspected.


## Phase 23 · video and voice media paths

Phase 17's isolated full-app browser rehearsal now includes the following real UI scenarios:

- Synthetic WebM video: file picker → metadata preview → send → IndexedDB-backed chat message → metadata/decode/playback → reload and playback again.
- Fake microphone capture: hold-to-talk pointer flow → MediaRecorder → audio Blob and duration metadata → audio playback → reload and playback again.
- V4 backup is blocked while a voice capture is active; the browser UI rehearsal explicitly cancels a second capture and verifies no partial audio message is committed.
- Page-hide cancellation, pending permission cancellation, MediaRecorder errors, stop timeout, and overlapping stop/start races are covered by exact-source Node VM regressions; they are not counted as browser UI execution.

After Phases 22–25 were incorporated, the current Phase 17 browser runner contains fifteen ordered steps, including independent batch-send, video, voice and mailbox/Circle source regressions. The matrix requires separate stdout/stderr evidence for every step (01–15), plus the bootstrap logs. Its workflow path filters include both new test files and `tests/fixtures/**`. The real browser status remains `not-run` until a GitHub Actions artifact is inspected.


## Phase 24 — Mailbox and Circle active media writes

**Source-execution test:** `tests/mailbox-circle-write-paths.test.mjs`  
**Browser rehearsal:** `tests/isolated-application-rehearsal-e2e.mjs`  
**Runner:** Phase 17, steps 11–12 capture the exact-source Phase 24 mailbox/Circle write regression; steps 13–14 capture the Phase 25 lifecycle regression; step 15 runs the full Chromium UI rehearsal.  
**Workflow:** `.github/workflows/isolated-application-rehearsal.yml`  
**Evidence directory:** `test-results/browser-e2e/phase17/`

Exact-source Node regressions now exercise the mailbox's real `addImages()` and `send()` functions, Circle's real async media-selection handler, the real `commitPostMineWithMedia()` wrapper, `circleTransaction()`/`deletePost()`, and `saveSettings()`:

- Mailbox attachment IDs stay in the pending reference set while multiple files are being written.
- Outgoing mail is blocked for missing Blob, unsupported MIME, mismatched byte length, stale/closed composer and persistence failure; successful send preserves attachment IDs.
- Circle media selection ignores stale async file completion after composer clear and rejects concurrent file-pick races.
- Circle post publishing cleans newly-created media on pre-commit failure, but reports success after commit even when later preview refresh fails (avoids duplicate user publish attempts).
- Cancelling/closing the post composer while Blob storage is in flight invalidates the publish generation; the late Blob becomes an orphan and is cleaned, and stale media is not restored into the closed composer.
- Deleting a Circle post runs the global shared-reference check; failed Circle persistence restores the post and does not start GC.
- Avatar and cover media save as one Circle transaction; a failed transaction restores the previous references and only cleans IDs written by that attempt.

The Phase 17 Playwright rehearsal additionally performs mailbox compose → image selection → send → reopen/decode → delete while chat keeps the same media ID, Circle post image selection → preview → publish → detail → delete, and profile avatar/cover upload → save → decode → clear shared cover while chat still references it.

**Current status:** source-execution Node tests passed locally; the real Playwright UI extension remains scripted and `not-run` until a qualifying GitHub Actions artifact is inspected. Video, physical microphone and Android device status are unchanged. Learning functionality remains out of scope.


## Phase 25 — Circle editing, mailbox auto-reply and shared profile media

**Source-execution test:** `tests/phase25-circle-mailbox-lifecycle.test.mjs`  
**Browser rehearsal:** `tests/isolated-application-rehearsal-e2e.mjs`  
**Runner:** Phase 17, steps 13–14 capture syntax and exact-source lifecycle regressions; step 15 performs the full Chromium UI rehearsal.  
**Workflow:** `.github/workflows/isolated-application-rehearsal.yml`

The exact-source test executes the actual owned-post editing function, mailbox `send()` / `processDue()` paths, Circle shared-media collection and cleanup, and profile `saveSettings()` transaction:

- Editing a post preserves its stable ID, author, timestamp, privacy, likes, comments and pending interactions. A failed save restores original text/media. Other users' and deleted posts cannot be edited.
- Mailbox auto-reply scheduling is deferred without consuming recent-card history when the usage outbox is full. A reply cannot be sent after its incoming source is deleted. Evicting a source letter removes its pending auto-reply task in the same commit.
- Shared avatar/cover IDs remain reachable while any profile still references them. Circle object URLs are released only after the final persisted reference is removed and the underlying media record was deleted.
- Profile settings save is single-flight while migration and asset writes are pending. Partial multi-asset failure restores old references, preserves retryable previews and cleans only files created by the failed save.

The Phase 17 Playwright rehearsal additionally edits an owned post through the detail UI, replaces its media while preserving post identity, processes an auto-reply and verifies the resulting `replyToId`, deletes a source letter before its task is due, and clears one profile's shared avatar while the other profile continues referencing the same Blob.

**Current status:** exact-source Node tests passed locally; browser UI scenarios are scripted but remain `not-run` until a qualifying Chromium CI artifact is inspected. Learning functionality remains out of scope.


## Phase 26–28 — Storage and restore combined-failure gates

The machine-readable matrix now tracks three additional exact-source Node VM gates. They are deliberately separate from the Playwright browser evidence and do not upgrade real Chromium, GitHub Actions or Android status.

### Phase 26 — Revision-marker quota and background task fencing

- `tests/storage-quota-background.test.mjs` executes the production `markDataChanged()` function with a deterministic localStorage quota failure and verifies the current-page write fence plus `revision-unreliable` broadcast.
- The same suite executes the production mailbox and Circle timer callbacks and verifies hidden, restore-paused and readonly tabs do not plan or commit background work.
- Lease-release and fallback lease-loss invalidation remain source-contract assertions; they are not a multi-tab browser run.

### Phase 27 — Media write and revision-marker combined failure

- `tests/phase27-cross-module-faults.test.mjs` extracts and executes the production `putMediaBlob()` and `commitChatMediaBlob()` helpers.
- It injects a successful IndexedDB Blob commit followed by revision-marker failure, an unconfirmed cleanup failure, and a backup/export start between media write and chat commit.
- It asserts rollback confirmation/read-back, explicit uncertainty when cleanup cannot be confirmed, no dangling chat message, no timestamp change, no premature object URL and mutation-token release.

### Phase 28 — V4 PREPARED/COMMITTED multi-store restore failure

- `tests/backup-atomicity.test.mjs` now injects ambiguous PREPARED journal persistence, simultaneous UI/media/font rollback faults, and PREPARED journal cleanup failure after the application stores have rolled back. It also rejects a startup mailbox importer that silently returns `false`.
- `tests/phase28-restore-combined-failures.test.mjs` runs that real production-source fixture and checks ordering contracts: PREPARED before destructive writes; COMMITTED after import/media/UI verification; old-media cleanup only after COMMITTED; and startup PREPARED clearing only after restored module/media verification.
- PREPARED, COMMITTED and journal deletion each use IndexedDB `durability: 'strict'` transactions and verify their post-transaction read-back. A browser that silently ignores the option is rejected before writing a recovery journal.
- If the COMMITTED transaction completes but read-back is unavailable or inconsistent, the coordinator marks the commit state uncertain. The restore blocks the current page without attempting an opposite rollback, and old-media garbage collection is not reached.
- Failure to establish or clear a PREPARED journal, or any unconfirmed rollback, closes the current tab's write gate and retains the journal for startup retry.
- A confirmed COMMITTED journal is cleanup-only: it must not roll back the completed new state. If the process stops before regular old-media cleanup, startup clears the committed journal without rolling back; any obsolete Blob is left for the existing conservative orphan audit/grace-period cleanup.
- `durability: 'strict'` is requested and the accepted transaction mode is checked, but local VM tests do not prove physical disk flush or all OS/filesystem/power-loss behavior.

**Local Node suite count:** 26 test files. **Real Chromium E2E:** `not-run`. **GitHub Actions:** `not-run` (the updated workflows have not been pushed or executed). **Android APK/WebView:** `not-run`. The overall release gate remains blocked pending actual browser CI artifacts and Android validation.


## Phase 29 — Real Chromium V4 restore crash checkpoints

**Harness:** `tests/chromium-v4-restore-crash-matrix.mjs`  
**Contract test:** `tests/chromium-v4-restore-crash-matrix.test.mjs`  
**Workflow:** `.github/workflows/isolated-restore-lifecycle.yml`  
**Evidence file:** `test-results/browser-e2e/phase18/phase30-chromium-v4-restore-crash-matrix.json`

Unlike the earlier Phase 18 crash worker, which wrote a synthetic PREPARED record directly, the Phase 29 harness builds a real V4 ZIP in Chromium and invokes the production `window.__duoBackupV4.restore()` entrypoint. It then pauses at four checkpoints after the underlying production operation has completed:

1. `PREPARED` journal write and verification.
2. The first production `putMediaBlob()` write has completed and returned.
3. The real font-library `importData(..., { replace: true })` has completed.
4. The real `markRecoveryCommitted()` strict journal transaction has completed.

For each checkpoint, the harness kills the Chromium process group with `SIGKILL`, relaunches Chromium against the same persistent profile, and verifies the journal, main state, Circle state, media Blob bytes/type and font-library identity. PREPARED crashes must restore the pre-restore source snapshot; a COMMITTED crash must retain the imported target snapshot and perform cleanup without an opposite rollback. The harness writes a JSON evidence file containing the browser version and per-checkpoint outcomes.

**Local status:** the harness and its contract test are syntax/source checked. An actual local Chromium attempt was blocked before page load by the container's managed URL policy (`ERR_BLOCKED_BY_ADMINISTRATOR` on the loopback test URL); no policy was modified or bypassed. **Real Chromium execution: `not-run`. GitHub Actions: `not-run`.** The Phase 29 browser gate cannot be claimed passed until the workflow produces an artifact and its four restart cases are inspected.


## Phase 30 — Byte-level checkpoint integrity for the real Chromium crash matrix

Phase 30 audits the Phase 29 harness for false positives and strengthens the evidence recorded at each production restore checkpoint. It does not change the production restore implementation.

**Harness:** `tests/chromium-v4-restore-crash-matrix.mjs`  
**Contract test:** `tests/chromium-v4-restore-crash-matrix.test.mjs`  
**Evidence file:** `test-results/browser-e2e/phase18/phase30-chromium-v4-restore-crash-matrix.json`

Two weaknesses were removed:

1. The media checkpoint previously paused after whichever media happened to be first. It now waits for the actual production write of `phase17-chat-media`, reads that exact record back, and proves its bytes equal the archive target before sending SIGKILL. After relaunch, all six media records are checked byte-for-byte.
2. The previous target and source font fixtures used identical bytes with different IDs. The new matrix uses distinct real TTF files (DejaVu Sans and DejaVu Serif), records each file's SHA-256, proves the PREPARED journal contains the source bytes, proves the target font importer committed the target bytes before SIGKILL, and checks the exact font Blob bytes after restart.

The source-side chat-media fixture is now a valid, deterministic 1×1 RGBA PNG rather than a seven-byte placeholder mislabeled as `image/png`; the contract test verifies its PNG signature, chunk sequence, CRCs and decompressed pixel bytes, and confirms the browser mutation uses that exact byte list. Before source mutation, the harness reopens the generated ZIP through the production unzip/manifest parser and verifies all six media resource IDs plus the exact target-font bytes. Each checkpoint also records inspectable detail in the persistent profile, including the actual journal phase and operation-specific store readback. The matrix proves the Chromium process group is fully gone before profile reuse, and checks external requests and uncaught page exceptions in both the initial restore session and restarted recovery session.

**Local status:** source/contract checks passed. **Real Chromium execution:** still blocked before page load by the container-managed URL policy (`ERR_BLOCKED_BY_ADMINISTRATOR`). **GitHub Actions:** `not-run`. No browser recovery pass is claimed until the Phase 30 evidence artifact contains all four completed kill/relaunch scenarios.

**Remaining gaps:** SIGKILL still occurs after a selected transaction has completed, not inside the transaction; physical power loss, real storage quota exhaustion and Android WebView recovery remain unverified.

## Phase 31 — Strict durability across V4 media/font databases and in-flight transaction crashes

Phase 31 closes a cross-database durability gap. The V4 recovery journal already requests `durability: 'strict'`, but the independent media database and custom-font database previously used their default transaction durability during forward restore and PREPARED rollback. A strict COMMITTED journal alone does not establish that writes in those separate databases also requested strict durability.

`index.html` now exposes V4-only strict media transaction/preflight helpers. `putMediaBlob()` and `deleteMediaRecord()` accept an optional final durability argument, while every pre-existing ordinary call keeps the original default. `custom-font-manager.js` adds a strict durability preflight and uses strict mode for the complete fonts + current-font metadata transaction when requested; the internal importer rollback uses the same mode. `backup-v4.js` checks affected media/font databases before writing PREPARED or beginning startup rollback, then uses strict transactions for forward media writes, font import, media rollback and startup recovery. If an engine throws for the strict options or reports another durability mode, recovery stops before changing business data and leaves the recovery journal retryable.

`tests/phase31-restore-strict-durability.test.mjs` executes the production media transaction factory and production font snapshot writer with controlled IndexedDB dependencies. It checks that preflight requests and aborts strict readwrite transactions, silent downgrades and unsupported options are rejected, font rows and current-font metadata remain in one atomic transaction, and ordinary media calls still use their prior default mode.

The persistent Chromium matrix now has six checkpoints. In addition to the Phase 29 completed-operation boundaries, it adds two in-flight request boundaries:

1. **Media in-flight:** the actual `phase17-chat-media` `put` request fires `success`; the harness then queues a second request in the same `readwrite` transaction, reports the live transaction's `durability`, and holds the renderer event loop while the external controller kills the full Chromium process group before transaction completion.
2. **Font in-flight:** the actual fonts-store `clear` request fires `success` inside the real atomic font + metadata transaction; a follow-up request is queued in that same transaction, then the browser process group is killed before completion.

After relaunch with the same persistent profile, the harness opens a seed-only page and inspects IndexedDB and the PREPARED journal before loading the application. These evidence reads resolve only after the readonly transaction's `oncomplete`, not merely its request `onsuccess`; the fonts rows and current-font pointer are read in one readonly transaction. The inspector uses `indexedDB.databases()` to reject a missing evidence database rather than accidentally creating an empty database while inspecting it. The media in-flight case must still contain the source media bytes. The font in-flight case must still contain the original font row, exact Blob bytes and current-font pointer, proving the multi-store transaction was atomic. Only then does the application startup recovery run; it must restore the whole source snapshot and clear PREPARED.

**Local status:** the strict media/font production-source test and generated DevTools script contract pass. A local browser execution attempt remains blocked before page load by the container-managed Chromium URL policy (`ERR_BLOCKED_BY_ADMINISTRATOR`); no Phase 31 in-flight stage ran locally. **GitHub Actions: `not-run`.** The Phase 31 evidence artifact is `phase31-chromium-v4-inflight-transaction-crash-matrix.json`; the browser status stays blocked until an actual CI artifact is inspected. No physical power-loss, filesystem flush, or Android WebView guarantee is claimed.


## Phase 32 — Inspect crash-time persisted state before startup recovery for all six checkpoints

Phase 31 only opened the seed-only page before application startup for the two in-flight transaction crashes. The other four checkpoints navigated directly to the app, allowing startup recovery to run before the raw on-disk state was recorded. That left a blind spot: a faulty startup recovery could partially repair or overwrite evidence before the harness captured what actually survived SIGKILL.

Phase 32 fixes the harness, not the production restore implementation:

- After every crash stage (`prepared`, `media`, `media-inflight`, `font`, `font-inflight`, `committed`), the restarted Chromium reuses the same persistent profile and first navigates to the seed-only page. It does not load `index.html` until the raw persisted state has been inspected and asserted.
- The pre-startup inspector reads the main localStorage state and Circle state, all six media Blob rows, font rows plus current-font pointer in one readonly transaction, and the recovery journal. It also checks that the journal still contains the old main/Circle snapshots and the exact old chat-media/font Blob bytes; a `PREPARED` phase string alone is not enough to prove rollback is possible. IndexedDB reads wait for transaction `oncomplete`; missing databases are rejected instead of being created by the inspection routine.
- Stage-specific assertions encode the real restore order: media writes precede Circle/font/state finalization; Circle and font may already be target data while main localStorage is still source data; the COMMITTED point must show target state and a committed journal before startup clears it. The two in-flight transaction stages must show the prior atomic media/font state after SIGKILL.
- The Node contract extracts and executes the production harness assertion function against six synthetic intermediate profiles and negative corrupt media/font/journal cases, proving that incorrect early/partial state is rejected. This validates the assertion logic, not Chromium behavior.
- Chromium launch failures before DevTools setup, navigation failures and ordinary scenario cleanup all terminate the process group and wait for it to disappear, so early failures do not leave a browser process attached to a reused profile.

The new evidence artifact is `phase32-chromium-v4-prestartup-state-matrix.json`. Local source/Node status is `passed`; the container Chromium URL policy still blocks loopback navigation before page load, so browser status remains `blocked-local-admin-policy`. GitHub Actions remains `not-run` until source is pushed under an explicitly authorized workflow. No claim of real-browser recovery, physical power-loss durability or Android WebView recovery is made.

## Phase 33 — Independent CI scheduling and durable crash evidence

Phase 33 audits the workflow and artifact lifecycle, not V4 production recovery logic. The six-stage Chromium SIGKILL matrix previously ran as a later step in the same `isolated-restore-lifecycle` job as the Phase 18 browser rehearsal. If Phase 18 failed or timed out, GitHub Actions would skip the V4 matrix entirely. The matrix is now moved into an independent `v4-restore-crash-matrix` job with its own Node 22, pinned Playwright 1.65.0, Chromium/system dependency and deterministic font-fixture setup. It has no `needs` dependency on Phase 18, so the two browser suites can report independently.

The matrix now writes a valid preflight evidence JSON before looking up or launching Chromium. Evidence updates are written to a temporary file and atomically renamed over the previous complete snapshot. Every stage persists its start state and progress, including the exact checkpoint detail before SIGKILL, confirmed browser process-group exit, pre-startup raw profile snapshot, and completed startup-recovery result. An interrupted job therefore leaves the last complete JSON file rather than having no evidence or truncated JSON.

When a stage fails after the test may have written synthetic application data and Chromium has been stopped, the exact persistent Profile is copied under `failed-profiles/<stage>` before temporary cleanup. Failures before fixture seeding do not upload an empty browser profile. Successful profiles are deleted after verification. The independent job uploads its whole evidence directory with `if: always()`, including runner environment, distinct font SHA-256 values, dependency installation logs, contract output, actual browser stdout, JSON evidence, hardening output and failed profiles when available.

`tests/phase33-ci-evidence-persistence.test.mjs` injects an evidence-file write failure and verifies that a failed temporary write cannot replace the last complete JSON file. It also verifies workflow independence, dependency installation, artifact upload, path filters and explicit local/CI status separation.

**Local evidence:** Phase 33 source/CI contract passes. The actual local Chromium attempt is still blocked by the container-managed URL policy before loopback page navigation, so local browser status remains `blocked-local-admin-policy`. **GitHub Actions:** not run because no code was pushed and no PR was opened. The new independent job is ready, but it is not browser-pass evidence until its run artifact is inspected.

## Phase 34 — Chromium process-group cleanup and failed-profile lifecycle

Phase 34 found and corrected defects in the crash-test executor, not the V4 production restore code:

- The browser process leader can exit before all Chromium descendants. Cleanup now sends SIGKILL to the POSIX process group regardless of the leader's exit/close state, treats `ESRCH` as an already-gone group, surfaces other signal failures, and confirms the whole group is gone.
- A failed case now runs a dedicated finalizer with one cleanup retry. If the retry closes Chromium, the profile is copied into `failed-profiles/<stage>` before the temporary source is removed. Successful copying no longer leaves the original temp copy behind.
- If artifact copying fails, the only remaining closed source profile is retained. If Chromium remains alive after both shutdown attempts, the profile is not copied or removed while it may still be changing; its in-progress directory is inside the artifact workspace and the evidence records the path/error. Launch-time cleanup failures also hand the child handles to the shared finalizer so they receive the same retry logic.
- Profiles now start under `profiles-in-progress/` inside the evidence directory, ensuring an unresolved cleanup case is not outside the Artifact upload root. When a closed failed profile has been copied successfully, its source temp directory is now deleted; if the copy fails, the source is retained.
- The Phase 34 exact-source test is run in the independent crash-matrix contract step before the six real Chromium scenarios and is also part of the complete hardening gate.

**Local status:** the process-group and profile lifecycle fault-injection tests pass. **Real Chromium:** still `blocked-local-admin-policy` before the loopback seed page loads. **GitHub Actions:** `not-run` until an authorized remote workflow run is performed and its evidence artifact is inspected. This phase does not claim that the six crash/relaunch checkpoints passed in a real browser.


## Phase 36 — Profile image storage, complete call lifecycle and chat beautify persistence

Legacy avatar, other-user avatar, chat background, home cover and custom home icons are migrated from Data URLs in the main state to the shared IndexedDB media store. Repeated Data URLs are deduplicated. Migration writes and reads back every new Blob before replacing the persisted references, checks the new main-state snapshot after save, and restores the original state/storage snapshot on failure. New uploads use the same readback-before-replace contract. Startup hydration rebuilds Blob URLs from persisted `idb-media:` references after every reload. These profile references are included in global reachability scanning and in the appropriate chat/parameter/complete backup manifests. The media manager now exposes `ensureRefs()` and accepts the same APNG/SVG profile formats as the upload pipeline.

Chat beautify application/reset and legacy preset migration now check persistence. If saving fails, the prior selected preset and CSS class are restored and success feedback is suppressed.

The call panel is explicitly labelled as a simulation with no actual microphone/camera stream; the inert mute button was removed. Wake Lock acquisition is token-fenced against hang-up/pagehide. The real call transition functions are exercised for failed and successful outgoing start, incoming ring, answer, reject, missed call, minimize, restore and hang-up writes. The incoming-call scheduler now persists due timestamps before arming timers, restores previous schedules after failed replacement, and retries due-time commit failures without showing a call before persistence succeeds.

`tests/phase36-profile-media-call-beautify.test.mjs` and `tests/phase36-call-transition-integrity.test.mjs` are included in the 33 local Node test suites and `tools/verify-twodeers-hardening.mjs`. These are exact-source Node/VM regressions, not real-browser visual or device evidence. In this environment Chromium did not return DOM output even for `about:blank` due process startup errors; real Chromium execution remains unverified. GitHub Actions and Android WebView/device validation also remain `not-run`, so the release gates remain blocked.


## Phase 37 — Audit-confirmed media, read-only and appearance fixes

Phase 37 adds exact-source Node coverage for binary APNG detection in PNG containers, SVG root validation, shared original-byte preservation across main and Circle upload paths, per-tab read-only hydration of personal media/Circle media/custom fonts, transactional rollback for all appearance and preference controls, and Android WebView RECORD_AUDIO permission bridging restricted to the app asset origin. The microphone hardware feature is optional at install time so devices without a microphone can still use the rest of the application.

**Local evidence:** `tests/phase37-audit-fixes.test.mjs` and the full hardening runner passed locally. **Real browser multi-tab execution, GitHub Actions and Android APK/WebView/device microphone validation remain `not-run` until corresponding CI/device evidence is produced and inspected.** The release gate remains blocked.
