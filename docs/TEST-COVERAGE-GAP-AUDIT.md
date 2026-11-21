# Twodeers test coverage gap audit — Phase 31

Reviewed: 2026-11-17  
Scope: existing test sources and browser rehearsals through Phase 33.  
Production data and the learning feature are out of scope.

## Coverage model

The audit distinguishes four evidence levels:

- **Source-execution test:** Node VM executes an extracted real application function with controlled dependencies. Useful for deterministic transaction/failure paths, but not a browser UI test.
- **Browser UI rehearsal scripted:** Playwright script performs actual DOM/file-picker/button interaction in a fresh origin. It is not passed until a real Chromium run and artifact are inspected.
- **Seeded read/render:** existing records are loaded and rendered from isolated storage. It does not prove the corresponding upload/compose path.
- **Not covered:** no dedicated automated test currently exercises that full path end-to-end.

## Key-path coverage matrix

| Module / user path | Existing evidence before Phase 22 | Gap found | Phase 22 action | Remaining status |
|---|---|---|---|---|
| Chat text send | Phase 17 scripted real send + reload | No specific gap found for the normal send button | Retained | Browser script not run locally/CI |
| Direct uploaded sticker send | Phase 17 picker click + persisted message + reload; Phase 6 URL ownership source test | Historical message after library deletion was not in E2E | Added long-press delete after send; verify tombstone, old history still decodes after reload | Browser script not run locally/CI |
| Chat image read | Phase 17 seeded message media decode | Read path did not prove a new file-picker upload and preview/send | Added `chatImageUploader` → preview → `mediaPreviewSend` → reload | Browser script not run locally/CI |
| Batch text + image + sticker | Phase 2/3 source-hardening checks only; no targeted test executed the real batch function | No late stale-sticker test, no all-or-nothing rollback assertion in dedicated coverage | Added a source-execution test for actual `sendBatchMessages()` plus full UI scenario | Node test passed; browser script not run |
| Batch persistence failure | No dedicated direct assertion for a final `save() === false` after all queue entries stage | Potential partial write regression could be missed | Injected final save failure; assert history, timestamp, media and URL rollback | Node test passed; browser test supplements it |
| Chat video upload/send/playback | `commitChatMediaBlob()` helper coverage exists for the shared media commit path | No full browser file-picker/preview/video decode test | Documented as open gap; not added due to need for valid deterministic WebM fixture and browser codec verification | Not covered end-to-end |
| Voice recording / MediaRecorder | Shared audio commit helper has source-execution coverage | Actual microphone permission, stream lifecycle, MediaRecorder chunks and playback not exercised in browser | Documented as open gap | Not covered end-to-end |
| Mailbox incoming/outgoing letter + image attachment | Phase 17 seeded letter open and attachment decode | Incoming reply/auto-reply paths and multiple simultaneous attachment owners remain incomplete | Added outgoing compose/file-picker/send/reopen/delete browser script and exact-source attachment, MIME/size, pending-reference, generation and persistence-failure regressions | Node source test passed; browser script remains not-run |
| Circle post/avatar/cover media read and writes | Phase 17 seeded IDB media refs and DOM decoding | Existing-post edit and other-person profile asset paths remain incomplete | Added post upload/preview/publish/delete, avatar/cover save/decode, shared-reference retention and exact-source transaction/cancellation tests | Node source test passed; browser script remains not-run |
| Circle legacy DataURL migration | Phase 7 Node migration/rollback tests | Real browser IndexedDB migration with an existing persisted legacy Circle state is not exercised by the full-app E2E | Documented as open gap | Source-level tests only |
| V4 all-module restore + theme | Phase 18 direct public API build/restore in browser rehearsal | Browser UI file picker/import confirmation is bypassed by direct API call | Documented as an integration boundary | Browser script not run |
| V4 font post-write failure rollback | Phase 18 injects a post-write font import failure and asserts database, pointer, theme and main storage rollback | Uses monkeypatch around `importData`; not a real disk/quota failure | Retained; document quota fault separately | Browser script not run |
| Legacy JSON export/import UI | Legacy appearance paths and data helpers tested in Node | No complete browser download → file selection → restore interaction | Documented as open gap | Not covered end-to-end |
| Browser quota exhaustion | Node fault-injection and quota messaging/source paths | No actual browser storage-pressure/QuotaExceeded scenario | Documented as open gap | Not covered end-to-end |
| Multi-tab writer handoff | Phase 18 browser script covers two tabs and stale-tab fencing | Script still awaits real Chromium CI evidence | Retained | Browser script not run |
| PREPARED crash recovery | Phase 18 worker/Chromium SIGKILL/relaunch script | Script still awaits real Chromium CI evidence | Retained | Browser script not run |

## Phase 22 additions

1. `tests/media-send-paths.test.mjs` extracts and executes the actual `sendBatchMessages()` function from `index.html`.
2. It covers three deterministic cases:
   - Deleted-after-queue sticker rejects the batch and rolls back earlier text/image inserts, new media Blob, newly-created chat object URL, card-usage events and timestamp; the failed queue remains for user review.
   - Mixed text+image batch succeeds and retains its media record.
   - Final persistence (`save()`) failure rolls back all staged messages/media and releases the sending lock.
3. Phase 17's Playwright rehearsal now additionally:
   - Sends an uploaded sticker, queues text + image + sticker, deletes the sticker through the actual picker long-press/delete UI, and checks the stale sticker forces whole-batch rollback.
   - Confirms the previously-sent sticker history message still loads after library deletion.
   - Removes the stale queue row and confirms the remaining text+image batch commits.
   - Uploads a new chat image via file picker, previews it, sends it, and verifies persistence after reload.
4. The Phase 17 evidence runner captures the media-send source regression as its own step. The matrix, workflow path filters, CI contract and hardening runner reference the new test.

## Unresolved priority order

1. **Video upload/send/playback:** add a deterministic valid WebM/MP4 fixture and verify preview metadata, persisted media MIME/size, playback metadata and reload.
2. **Voice recording:** use Playwright fake media devices and microphone permission to exercise actual `MediaRecorder` start/stop/cancel/error paths.
3. **Mailbox compose/send:** choose attachment, persist the outbox/letter, reopen and decode attachment; inject post-media-write failure.
4. **Circle write flows:** avatar/cover and post media file pickers, publish/edit/delete, and legacy DataURL migration in a real browser profile.
5. **Backup UI boundaries:** V4 and legacy JSON download/file selection/confirmation/cancel paths, not only public API calls.
6. **Real quota pressure:** browser-origin storage exhaustion and rollback; this must be bounded and isolated to disposable BrowserContexts.

## Release interpretation

The Phase 22 Node batch-send source-execution tests passed locally. The Phase 17 Playwright additions are only **scripted**, not executed, because the current local environment does not provide a usable Playwright/Chromium navigation path. Do not upgrade real-browser status until the corresponding GitHub Actions artifact is downloaded and inspected. Android WebView and APK status remain unchanged.

## Phase 23 additions — video and voice capture paths

Phase 23 closes the prior source-execution and browser-script gaps for video preview/commit and MediaRecorder control paths, while keeping the browser execution status honest.

| Module / path | Phase 23 coverage | Evidence level | Remaining limitation |
|---|---|---|---|
| Video file validation | Empty file, unsupported kind, MIME mismatch, size limit and generic MIME + known extension fallback | Exact-source Node VM test | Browser file picker not executed locally |
| Video preview lifecycle | Object URL creation failure handling, preview URL release, preview closed during async write | Exact-source Node VM test | Browser UI remains scripted pending CI |
| Video message commit | Preserves MIME/name/size; aborts if preview becomes stale or backup starts mid-write | Exact-source Node VM test | Real device codec and storage pressure not tested |
| Video playback | Synthetic valid VP8 WebM selected through UI; metadata, playback progression and reload playback asserted | Browser UI rehearsal scripted | No qualifying Chromium CI artifact yet; Android codec coverage unverified |
| Voice permission / start | MediaRecorder availability, getUserMedia success/denial, pending permission cancellation | Exact-source Node VM test | Real permission prompt not tested on physical device |
| Voice recording chunks | Capture-local chunk ownership prevents concurrent recorder contamination | Exact-source Node VM test | Actual hardware codec behavior unverified |
| Voice cancel / error / timeout | Explicit cancel, pointer-capture loss, page hidden/pagehide, recorder error, missing stop event timeout | Exact-source Node VM test | Browser event ordering still requires real Chromium execution |
| Voice backup/reset interaction | V4 and legacy backup operations plus destructive reset refuse while capture is pending/active/finishing | Exact-source test + browser UI rehearsal scripted | Real browser E2E not yet executed |
| Voice send/playback | Fake microphone MediaRecorder sends audio, playback and reload are asserted | Browser UI rehearsal scripted | CI artifact not yet inspected; physical microphone not tested |

Phase 23 added `tests/video-media-paths.test.mjs`, `tests/voice-media-paths.test.mjs` and the valid synthetic fixture `tests/fixtures/phase23-video.webm`. The Phase 17 browser runner now executes the video and voice source regressions as separate evidence steps before the full Chromium rehearsal. Its path filters and acceptance matrix include these test files and the fixture directory.

### New production safety details

- A voice recorder finishing after `isRecording` becomes false is still considered active. `voiceFinishing` and `voiceFinishPromise` prevent a second recorder from starting before the first recorder's stop event and microphone release complete.
- Each MediaRecorder instance owns its own chunk array; chunks from adjacent recordings cannot share a replaceable global array.
- Recorder errors and a missing `stop` event fail closed. The stop wait is bounded at 5 seconds; no partial audio message is committed and microphone tracks are stopped.
- Pending permission requests and active recordings are cancelled on pointer-capture loss and document hidden; the `pagehide` handler forces cancellation even if `document.hidden` has not updated first.
- V4 and legacy backup operations, plus destructive reset, are blocked while voice capture is pending, active or finishing.

### Updated remaining coverage gaps

1. **Physical microphone and Android WebView:** real permission prompts, MediaRecorder implementation differences, AAC/Opus/WebM/MP4 behavior and speaker playback on actual devices.
2. **Codec matrix:** other browsers/platforms and real user videos such as MP4/H.264, MOV, WebM/VP9/AV1, very long clips and corrupted containers.
3. **Video quota/large-file failure:** real browser-origin storage quota exhaustion, IndexedDB quota failure and memory pressure under large video selection.
4. **Mailbox compose/send:** attachment selection, send, persistence, reopening and attachment decode as one full browser user flow.
5. **Circle write flows:** new post image upload/publish/edit/delete and avatar/cover file-picker workflows.
6. **Backup UI boundaries:** actual download, file selection, confirmation and cancellation for V4 and legacy JSON, rather than public API invocation alone.
7. **Real-browser evidence:** Phase 17 and Phase 18 Playwright suites remain scripted but `not-run` until a GitHub Actions run and its evidence artifact are inspected.
8. **Android validation:** APK build and WebView device tests remain not-run.

Local validation for Phase 23: all 21 Node test suites passed, and `tools/verify-twodeers-hardening.mjs` passed. This does not upgrade the real Chromium or Android evidence status.


## Phase 24 additions — mailbox and Circle write-path coverage

The new `tests/mailbox-circle-write-paths.test.mjs` extracts and executes real production functions, not substitute implementations:

1. **Mailbox attachment persistence:** while multiple attachments are written sequentially, IDs already written remain visible in `pendingComposeMediaIds` and therefore in the global reference set until the full attachment list is committed.
2. **Mailbox send preflight:** the real `send()` rejects missing Blob, unsupported image MIME, byte-size mismatch, a composer generation change during async reads, and persistence failure. It does not create an outgoing letter with dangling IDs; the mutation lock and send-button state are released.
3. **Circle media picker races:** `handlePostMediaFilesWithGeneration()` ignores late file processing after `clearPostMedia()` invalidates the selection, revokes the late preview URL, and prevents a second concurrent picker task from racing the first.
4. **Circle publish transaction:** `commitPostMineWithMedia()` cleans new media if storage or the Circle transaction fails; if Circle state is already committed and a later preview refresh fails, it returns success and warns rather than making the UI invite a duplicate post.
5. **Post-cancel race fixed:** while `storeBlob()` is pending, closing/clearing the composer increments `postMediaSelectionGeneration`; the publish wrapper now checks the token after migration and each async media write. A late write is cleaned as an orphan, no post is committed, and stale preview data is not restored into the closed composer.
6. **Circle deletion/shared media:** the real `circleTransaction()` and `deletePost()` are executed together. A committed delete invokes global reference scanning; shared media is retained, while a failed state persist restores the post and never starts media GC.
7. **Avatar/cover write transaction:** the real `saveSettings()` is executed with two staged image Blobs. Tests verify successful IDB references, whole-transaction rollback, and cleanup of an avatar written before a cover storage error while preserving both old profile references.

The Phase 17 browser rehearsal has been expanded with UI-level scenarios for a newly composed outgoing letter with attachment, shared-media retention after letter deletion, Circle post upload/preview/publish/delete, and avatar/cover upload/save/decode plus shared-cover retention. The evidence runner adds two separately captured Phase 17 steps (`syntax-mailbox-circle-write-test` and `mailbox-circle-write-source-regression`). Both `push` and `pull_request` path filters now include the new source test.

### Remaining gaps after Phase 24

1. Actual Chromium execution of the expanded Phase 17 UI (still blocked locally by missing Playwright and managed browser navigation policy; wait for a real CI artifact).
2. Circle edit-existing-post flow is not yet covered as a full browser interaction.
3. Other profile assets (other person's avatar/cover) have existing common save logic but are not individually browser-exercised in this phase.
4. Mailbox incoming-reply, auto-reply scheduling and attachment deletion with multiple simultaneous owners need additional UI cases beyond the outgoing letter/shared-chat test.
5. Browser-origin real `QuotaExceededError`, long-running multiple large attachments and 24 MB mailbox aggregate limit pressure remain untested on device.
6. Android WebView/APK and real file picker behavior remain untested.

**Phase 24 local status:** the new source-execution test passed, and the test is wired into the hardening script and Phase 17 evidence runner. This does not upgrade real Chromium, GitHub Actions or Android status.


## Phase 25 additions — Circle edit, mailbox auto-reply and cross-profile media references

Phase 25 adds `tests/phase25-circle-mailbox-lifecycle.test.mjs` and a corresponding Phase 17 evidence-runner source regression:

1. **Owned Circle post editing:** only the current user's existing post can be edited. Text/media changes preserve stable post ID, author, timestamp, privacy, likes, comments and pending interactions. Empty, missing, non-owned posts are rejected; failed persistence restores original content/media.
2. **Edit media lifecycle:** the detail sheet exposes an edit entry; the editor loads existing media references, preserves the post identity, replaces media using the existing media transaction, and differentiates edit fingerprints from new-post fingerprints.
3. **Mailbox auto-reply planning:** if usage-outbox capacity is full, due reply work remains pending and `recentCardKeys` is restored so no card usage is consumed by a deferred task.
4. **Mailbox reply source validity:** a reply cannot be sent if the incoming source letter was deleted while the compose window was open.
5. **Mailbox queue eviction:** when the bounded 5,000-letter mailbox evicts source letters, auto-reply tasks referencing those source IDs are pruned in the same committed state.
6. **Shared profile media:** media IDs shared across `myAvatar`, `otherAvatar`, `myCover`, and `otherCover` remain reachable while any profile references them. The root Circle transaction compares pre/post media reachability and releases the Circle object URL only after the global `deleteIfUnreferenced()` check confirms the Blob record was removed; the post wrapper does not run a duplicate cleanup.
7. **Profile save concurrency:** settings save is single-flight across media migration and asset jobs; controls are temporarily disabled and restored to their previous states; partial multi-asset failure retains old persisted references and retryable previews while cleaning only newly created records.

The Phase 17 browser rehearsal now includes owned-post edit with replacement media, mailbox auto-reply creation/processing, pending-reply cancellation after source deletion, and shared avatar retention when the other profile still references the same media ID.

### Remaining gaps after Phase 25

1. Real Chromium execution of Phase 17 UI scenarios remains `not-run` until a CI artifact is inspected.
2. Circle edit UI has source-level and scripted browser coverage, but not an executed browser result.
3. Other-profile avatar/cover selection and save are not individually exercised through every physical file-picker route.
4. Mailbox auto-reply timing is source-execution tested and scripted in browser E2E; long-duration timer throttling and cross-tab scheduling still need real-browser evidence.
5. Real browser quota exhaustion and simultaneous cross-profile edits remain untested on-device.
6. Android WebView/APK, real file pickers and media decoding remain untested.

**Phase 25 local status:** 23 Node test suites and the complete hardening script passed locally. This does not upgrade real Chromium, GitHub Actions or Android status.


## Phase 26 — Revision-marker quota and long-background lifecycle

`tests/storage-quota-background.test.mjs` extracts the production coordinator marker function, mailbox `processDue()` and Circle pending callback. It verifies localStorage quota failure fences the page and notifies loaded tabs; hidden, readonly and restore-paused background tasks do not mutate state. The source checks also cover lease-release/fallback-loss invalidation. This is deterministic Node VM evidence, not real storage exhaustion or mobile OS suspension.

## Phase 27 — Media commit / revision marker / backup-start race

`tests/phase27-cross-module-faults.test.mjs` executes the production `putMediaBlob()` and `commitChatMediaBlob()` helpers. It covers: (1) IDB media commit then `markDataChanged() === false`; (2) rollback deletion whose success cannot be confirmed; and (3) backup/export beginning after the media write but before message commit. Confirmed cleanup is verified by read-back; uncertain cleanup is surfaced as such; no dangling chat message or timestamp update is allowed. The fake IndexedDB harness does not prove Chromium transaction scheduling or real quota pressure.

## Phase 28 — V4 recovery journal and multi-store combined failure

The V4 restore audit confirms three separate journal states and their allowed behavior. `runtime-coordinator.js` now creates PREPARED, COMMITTED and deletion transactions with `durability: 'strict'`, checks `IDBTransaction.durability` so silent option ignoring fails closed, and performs a read-back after each write transaction. Read-only journal reads also wait for the read transaction to complete, rejecting if the transaction aborts after request success. If COMMITTED transaction completion is followed by an unavailable or inconsistent read-back, it reports `journalCommitUncertain`; `backup-v4.js` blocks the page without attempting a contradictory rollback, and old-media GC is not reached.

| Failure edge | Required safe behavior | Local evidence |
|---|---|---|
| PREPARED save throws after the write may already have reached storage | Read back the journal; if existence/read state is uncertain, stop before destructive writes and block the current page | `backup-atomicity.test.mjs` |
| Restore partially applies main state, media, Circle, mailbox, cards, stickers or fonts, then import/UI verification fails | Roll back old snapshots; validate read-back; retain PREPARED and block the page if any rollback is incomplete | `backup-atomicity.test.mjs` |
| Business rollback succeeds but PREPARED journal deletion fails | Keep the journal and block the current page; otherwise later writes could be overwritten on the next startup replay | `backup-atomicity.test.mjs` |
| Startup PREPARED recovery sees importer false, media write/read-back error, or module mismatch | Stop recovery, retain PREPARED, block the writer; next startup can retry idempotently | `backup-atomicity.test.mjs` + production-source contracts |
| New application state validates and COMMITTED is durable, but journal cleanup fails | Treat restore as committed; never replay old snapshot; cleanup-only on next startup | Existing commit-order contracts |
| COMMITTED write transaction completes but its read-back is unavailable or inconsistent | Mark commit status uncertain, block the page, do not attempt opposite rollback, and do not reclaim old media | `runtime-recovery.test.mjs` + `backup-atomicity.test.mjs` |
| Browser silently ignores `durability: 'strict'` | Abort the write transaction and stop restore rather than silently falling back to default durability | `runtime-recovery.test.mjs` |

`tests/phase28-restore-combined-failures.test.mjs` runs the injected V4 fault fixture and checks the ordering/retention invariants directly against `backup-v4.js`. The test includes simultaneous media + font rollback failure and a distinct successful-rollback / failed-journal-cleanup case.

### Remaining unproven evidence after Phase 28

1. Real Chromium browser UI import, restore overlay, file picker, and reload after an interrupted restore have not been executed locally; the Phase 18 workflow remains only scripted until its GitHub artifact is inspected.
2. Real process termination during font IndexedDB transaction, multi-store writes, or `clearRecoveryJournal()` is not run locally.
3. No actual browser-origin QuotaExceeded run, browser storage pressure, concurrent multi-tab restore race, or Android WebView storage failure was executed.
4. The reconstructed source baseline for this local continuation is Phase 25 plus the saved Phase 26/27 change records; the Phase 27 complete ZIP was not present in the working container or Library. Phase 26/27 changes were reconstructed from the saved records and revalidated locally, not copied from the missing final archive.

**Evidence status:** Node source-execution suites are local and deterministic. Real Chromium E2E, remote GitHub Actions, Android APK/device tests and deployment remain `not-run`.


### Phase 28 evidence qualification

The local strict-durability test proves that production code requests an IndexedDB `strict` transaction and refuses engines that do not report that mode; it does not prove physical-device flush, power-loss survival, or process-kill recovery. A confirmed COMMITTED journal is startup cleanup-only and must not roll back the new state. If shutdown happens before the normal old-media reclamation pass, unreferenced old blobs are left for the existing conservative orphan audit/grace-period cleanup. Real persistent-profile Chromium crash/relaunch and Android WebView evidence remain open.


## Phase 29 — Actual V4 restore kill points in persistent Chromium profiles

The older Phase 18 crash worker directly constructed a `prepared` journal, then killed Chromium. That validates startup handling of an existing PREPARED snapshot but does not validate that the normal restore entrypoint leaves a correct journal at each real production boundary. Phase 29 adds a distinct harness that builds a V4 archive through `window.__duoBackupV4.build('all')`, mutates the currently persisted source snapshot, and invokes `window.__duoBackupV4.restore()` itself.

The harness intercepts only to pause after the real operation has completed: `saveRecoveryJournal(PREPARED)`, first production `putMediaBlob()`, actual font `importData(..., {replace:true})`, or `markRecoveryCommitted()`. It kills the complete Chromium process group, starts a new Chromium process with the exact same profile directory and validates post-startup main state, Circle post, media Blob bytes, font IDs, writer status and journal removal. The expected result differs by journal phase: PREPARED restores the pre-restore source snapshot; COMMITTED retains the imported target archive and only clears the journal.

**Local contract evidence:** `tests/chromium-v4-restore-crash-matrix.test.mjs` passed. **Real Chromium execution:** attempted but blocked before the test page loaded because the container-managed Chromium policy returned `net::ERR_BLOCKED_BY_ADMINISTRATOR` for the local loopback URL. The policy was not changed or bypassed. **GitHub Actions:** not run; no remote code was pushed. This is not browser-pass evidence.

### Remaining evidence gaps after Phase 29

1. The four real process-kill/relaunch checkpoints still need a successful CI run and inspection of `phase30-chromium-v4-restore-crash-matrix.json`.
2. A process kill during the interior of a single IndexedDB transaction (rather than immediately after that transaction completes) remains outside this four-checkpoint matrix.
3. Real storage quota exhaustion, long-lived multi-tab restore contention, physical-device power-loss behavior and Android WebView restoration remain unverified.


## Phase 30 — Crash-matrix false-positive audit

Phase 30 found two test-harness weaknesses, not a new production restore defect:

- The prior media hook accepted the first `putMediaBlob()` completion without asserting its ID, while post-restart verification examined only `phase17-chat-media`. A future fixture reorder could have killed the browser after an unrelated media write and still asserted an unchanged chat Blob. The hook now pauses only after the exact `phase17-chat-media` write, reads its target bytes before SIGKILL, and post-restart checks every one of the six media records.
- The prior archive font and mutated source font came from the same TTF bytes under different IDs. ID-only checks could not prove binary restoration. The new test uses distinct target/source TTF files, hashes both, reads source bytes from the PREPARED journal, reads target bytes after font import and checks exact bytes after restart.

The source-side media fixture was also corrected from a seven-byte invalid PNG placeholder to a valid 1×1 RGBA PNG. The contract test validates PNG chunk CRCs and decoded pixel bytes, and asserts that the browser mutation uses the same bytes. The harness also reopens the real archive using the production ZIP parser before mutation, records per-checkpoint evidence details, verifies the complete browser process group has exited before profile reuse, fails fast on an explicitly blocked startup, and checks external requests/page exceptions in both browser sessions. Local contract/hardening tests can validate that these assertions exist and execute, but the managed Chromium policy still blocks local navigation. The four real Chromium crash/restart scenarios remain `not-run` until a GitHub Actions artifact is produced and inspected.

### Remaining gaps after Phase 30

1. Actual SIGKILL/relaunch execution of all four checkpoints in GitHub Actions.
2. Termination in the interior of a single IndexedDB transaction rather than immediately after a completed media/font/journal operation.
3. Physical device power loss, browser-origin quota exhaustion and Android WebView recovery.


## Phase 31 — V4 media/font strict durability and transaction-interior interruption

The Phase 28 strict recovery journal did not automatically prove strict persistence for writes in the separate media and custom-font IndexedDB databases. Phase 31 now requests `durability: 'strict'` for V4-owned media writes/deletes and the font snapshot's multi-store transaction, including rollback and startup recovery. It preflights both databases before PREPARED or before the first startup rollback write. If strict transactions are unsupported or silently downgraded, the operation rejects before business data is changed. Ordinary non-V4 media writers continue using the browser default.

Local evidence:

- `tests/phase31-restore-strict-durability.test.mjs` executes the actual production helper and font snapshot writer. It validates preflight aborts, strict options, unsupported/downgraded-engine refusal, atomic font/meta store operations, strict rollback behavior and unchanged default durability for ordinary media writes.
- `tests/chromium-v4-restore-crash-matrix.test.mjs` validates all six generated Chromium checkpoint scripts, including media `put` and font `clear` success callbacks that queue another request in the same still-active strict transaction and signal the external controller through CDP Runtime binding. It also requires raw pre-/post-startup IndexedDB inspection to wait for transaction `oncomplete`, read font rows and current-font metadata in one readonly transaction, and avoid creating missing databases during inspection.
- `tests/chromium-v4-restore-crash-matrix.mjs` adds two real persistent-profile SIGKILL cases. The restarted browser reads the same profile on a seed-only page before application startup to inspect the raw media/font rows and PREPARED journal, then loads the app and validates startup recovery.

### Remaining evidence limits after Phase 31

1. The container-managed Chromium URL policy still blocks localhost navigation before the browser harness can load. Therefore the new in-flight transaction SIGKILL scenarios are not locally executed, despite their source/contract checks passing.
2. The real Phase 31 matrix needs a successful Linux GitHub Actions run and artifact inspection. No code was pushed during this phase, so remote CI remains `not-run`.
3. Killing a browser process during an IDB request-success callback tests transaction atomicity under process termination, but does not prove a physical device power-loss or storage-controller flush guarantee.
4. Real browser-origin quota exhaustion, long-running multi-tab restore contention and Android WebView recovery are still unverified.


## Phase 32 — Raw pre-startup state assertions for all V4 crash points

Phase 31 inspected the raw profile before app startup only for `media-inflight` and `font-inflight`. PREPARED, completed media, completed font and COMMITTED stages navigated directly to the app first. Startup recovery could therefore change the database before the test recorded the crash-time state.

Phase 32 updates `tests/chromium-v4-restore-crash-matrix.mjs` so all six stages restart the same profile on a seed-only page, then read the raw main localStorage state, Circle state, all six media Blob records, the font rows/current pointer in a single readonly transaction, and the recovery journal. It also verifies the journal retains the exact old main/Circle snapshots and old media/font Blob bytes at every stage. Only after `assertPreStartupProfile()` confirms the exact intermediate state does the harness load the application and test startup recovery.

The test contract extracts and executes that actual assertion function against all six synthetic snapshots and verifies negative corruption cases fail. The phase-specific ordering assertions account for the real production restore order: the main localStorage state is committed after Circle/media/font, so it remains the old source state at the completed-font checkpoint even though those other modules have already moved to target data. At COMMITTED, every target data set and the committed journal must exist before startup cleanup.

**Evidence boundary:** local contract and Node suite pass; the real Chromium navigation attempt is still blocked by the container's administrator URL policy, and no GitHub Actions run has been performed. These are harness/contract checks, not a real browser crash result.


## Phase 33 — CI independence and forensic evidence durability

Phase 33 confirmed a CI orchestration gap: the six-point V4 crash matrix was executed after the Phase 18 lifecycle rehearsal in the same job. A failure or timeout in the earlier suite would skip the crash matrix before any V4-specific Chromium execution. The matrix now runs in a separate `v4-restore-crash-matrix` job, with its own checkout, Node 22, deterministic DejaVu font installation, pinned Playwright/Chromium setup, 60-minute timeout and always-uploaded artifact. It does not depend on Phase 18.

The test harness now writes an initial `preflight` evidence file before Chromium lookup, then uses atomic temporary-write + rename for all progress updates. Each stage has a persisted `running` record and checkpoint transitions are written before SIGKILL, before app startup after relaunch, and after recovery verification. If the CI process itself is terminated mid-stage, the last complete JSON evidence remains available. A failed stage copies the closed synthetic Chromium profile to `failed-profiles/<stage>` before deleting the temporary profile; successful profiles are cleaned up normally.

`tests/phase33-ci-evidence-persistence.test.mjs` executes the actual evidence writer with both successful and failing filesystem dependencies. It asserts that a failed temporary write leaves the previous valid JSON unchanged, and checks the independent workflow job, upload-always behavior, dependency setup, artifact path and required push/PR filters.

**Phase 33 local status:** evidence-persistence and workflow contract passed. The local six-point Chromium execution remains blocked by managed URL policy. GitHub Actions is still `not-run`; no remote source was pushed. The next evidence step is to run/inspect the independent CI job and its JSON/profile artifact, not add more synthetic substitutes for browser execution.


## Phase 34 — Crash-harness process cleanup and profile retention

The Phase 33 crash-harness audit had two concrete lifecycle problems. First, it only signaled the POSIX process group while the Chromium leader child handle was still active. A closed leader does not prove its descendants are gone, so the harness could time out waiting for the group without sending a kill to remaining children. Second, a failed scenario used one `preserveProfile` flag for two different meanings: “the source profile has been copied to the artifact” and “the original profile must not be removed.” That caused successful artifact copies to leak their temporary source profiles, and a cleanup retry could remove a failed profile without first copying it.

Phase 34 adds `signalChromeProcessGroup()` and `finalizeFailedRunCase()`. POSIX cleanup signals the group even after leader exit, waits for group disappearance, and surfaces unexpected signal failures. Failed cases retry shutdown once. A successful retry copies the closed profile to `failed-profiles/<stage>` before deleting the temp source. A failed artifact copy retains the only source copy; a still-live browser profile is neither copied nor removed and is retained under `profiles-in-progress/` inside the Artifact workspace with an explicit cleanup error. Launch-time cleanup failures now pass the child handles back to the shared finalizer. Successful copies remove the original temporary directory, preventing duplicate Profile leakage.

`tests/phase34-chromium-process-group-cleanup.test.mjs` executes the actual harness helper functions with deterministic process-group and copy-failure dependencies. It tests exited leaders, SIGKILL count, ESRCH/EPERM behavior, retry-then-copy, no-copy-while-live, source retention after copy failure, and no empty-profile retention before seeding.

Evidence status remains separate: local helper tests and hardening pass; actual Chromium loopback navigation remains blocked by the container's administrator URL policy; remote GitHub Actions is still not run. No V4 production restoration defect was demonstrated or modified in this phase.


## Phase 36 — Profile media, call transitions and appearance persistence

Closed local source-level gaps: legacy profile Data URL migration and deduplication, exact state rollback after failed save/readback, refresh-time Blob URL hydration, profile-media reachability/backup inclusion, missing media-manager `ensureRefs()` API, upload/manager APNG+SVG allowlist mismatch, chat beautify save-failure rollback, late Wake Lock grants, full call-transition save rollback, and incoming-call scheduler commit-before-timer behavior. The Phase 36 production functions are executed in Node VM fault-injection tests. Real Chromium visual execution and Android WebView/device verification remain open evidence gaps and are not counted as closed.


## Phase 37 audit closure (local source-level)

The Phase 36 independent audit identified four concrete production gaps plus one wider persistence issue: Android microphone capture lacked its runtime permission bridge; a read-only second tab returned before reconstructing its own IndexedDB-backed personal/Circle media URLs and selected FontFace; APNG files reported as `image/png` with a `.png` filename could be flattened through Canvas; Circle SVG profile/post uploads did not share the main upload preservation decision; and multiple non-preset appearance controls ignored `save()` failure.

Phase 37 adds: exact WebView origin/resource permission gating with Android runtime RECORD_AUDIO permission and pending-request denial on Activity destruction; read-only per-tab media/font hydration; binary container-based APNG/GIF/WebP/SVG classification with malformed SVG/MIME mismatch rejection; shared original-byte retention for Circle avatar/cover/post media; and a rollback helper applied to reply/read-receipt/typing/offline/avatar-shape/bubble-shape/color/theme/custom-CSS settings plus the separate theme manager. `tests/phase37-audit-fixes.test.mjs` executes the production classifiers, upload conversion, read-only startup branch and save rollback helpers, and checks the Android permission contract.

The real second-tab Chromium scenario, Android APK build, WebView permission prompt and physical microphone capture remain unverified in this local environment. These fixes close source-level defects but do not change the browser/Android evidence status or release gate.
