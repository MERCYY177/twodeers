# Phase 30 — V4 crash matrix checkpoint and byte-level evidence hardening

## Scope

Audit the Phase 29 persistent-profile Chromium crash harness itself for false-positive conditions. This phase changes test infrastructure, acceptance contracts and documentation; it does not modify production restore code.

## Confirmed evidence weakness 1 — media checkpoint was coupled to fixture ordering

The Phase 29 hook paused after the first successful `putMediaBlob()` call but did not record or assert the media ID. The post-restart assertion examined `phase17-chat-media`. The current fixture happened to put that record first, but a later fixture reorder could have caused the process to be killed after another media ID was written while the test still passed based on an untouched chat-media record.

### Fix

- The harness now pauses only after the actual production `putMediaBlob(blob, kind, name, 'phase17-chat-media')` call returns.
- It reads the same record back before SIGKILL and persists the exact ID, Blob bytes, MIME type and size in checkpoint detail.
- The media-stage assertion requires the target backup bytes to be present before the process is killed.
- After restart, all six media records from the `all` backup fixture are checked byte-for-byte. PREPARED recovery must retain the source variant for chat media and target-seed bytes for the other five; COMMITTED must retain target bytes for all six.

## Confirmed evidence weakness 2 — old and target font bytes were identical

The Phase 29 harness initialized the target font from `sourceFontBase64`, then mutated the source font using the same `sourceFontBase64`. The font IDs differed, but the actual bytes did not. This could verify the ID pointer but could not detect a wrong binary being restored under the expected ID.

### Fix

- The harness now reads two distinct real TTF files: DejaVu Sans for the target archive and DejaVu Serif for the mutated source (with deterministic candidate fallbacks).
- It asserts the target and source byte strings differ before starting the browser cases.
- The evidence JSON records both fixture paths, byte lengths and SHA-256 hashes.
- PREPARED checkpoint inspection verifies that the journal actually contains the source font bytes.
- Font checkpoint inspection verifies the target current-font ID, ID list and exact imported target Blob bytes before SIGKILL.
- Post-restart verification compares the exact font Blob bytes in addition to IDs and sizes.

## Additional hardening

- Replaced the Phase 29 seven-byte `image/png` placeholder with a valid deterministic 1×1 RGBA PNG. Its IHDR/IDAT/IEND chunks, CRCs, compressed pixel payload and image dimensions are verified by the contract test; the browser mutation uses the same byte list, so a media decode failure cannot be confused with a restore failure.

- Each checkpoint now writes an inspectable detail record to the same persistent browser profile before pausing. The record includes the committed journal phase and the relevant real store readback.
- COMMITTED checkpoint detail verifies the committed journal, target chat state, Circle state, media bytes and target font bytes before process termination.
- Before restore starts, the harness independently reopens the generated archive through the production ZIP parser and checks the full expected media-ID set and exact target-font bytes.
- After SIGKILL, the harness checks that the entire browser process group is gone before reusing the same profile; startup failures that explicitly report a blocked state fail immediately instead of waiting for the generic timeout.
- External-origin requests and uncaught page exceptions are checked for both the initial restore session and the restarted recovery session.
- Renamed the output artifact to `phase30-chromium-v4-restore-crash-matrix.json`.
- Updated the isolated restore workflow, hardening contract, machine-readable acceptance matrix and coverage audit.

## Validation boundary

The contract and source-level regressions run locally. The actual Chromium navigation path remains blocked by the container's managed URL policy (`ERR_BLOCKED_BY_ADMINISTRATOR`), so the four real process-kill/relaunch scenarios remain `not-run` locally. GitHub Actions remains `not-run` because no remote push or workflow execution was authorized. This phase does not claim real-browser recovery success.

The harness still kills Chromium after a selected IndexedDB/font operation has completed; killing a process in the interior of a single IndexedDB transaction, physical-device power loss and Android WebView recovery remain separate gaps.

## Final local validation

- 27 `tests/*.test.mjs` suites passed.
- `node tools/verify-twodeers-hardening.mjs` passed, including the Phase 17–30 acceptance contract.
- 54 JS/MJS files passed `node --check`; 2 HTML files, 12 Android XML files, 15 workflow YAML files and 2 JSON files parsed successfully.
- A final real Chromium attempt started Chromium 144 but was blocked before the seed page loaded by the managed URL policy (`ERR_BLOCKED_BY_ADMINISTRATOR`). Evidence status is `blocked` with `stages: []`; no real crash checkpoint is reported as executed.

No production business code, learning feature, remote branch, PR, deployment or `main` branch was changed.
