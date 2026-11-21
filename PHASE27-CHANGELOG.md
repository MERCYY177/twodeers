# Phase 27 — Cross-module media/revision-marker failure injection

## Scope and source provenance

The prior complete Phase 27 ZIP was not present in the working container or Library during this continuation. This source reconstruction is based on the available Phase 25 ZIP and the saved Phase 26/27 changelogs; it has been locally revalidated and should not be mistaken for a byte-for-byte recovery of the missing Phase 27 archive.

## Confirmed defect and production fix

`putMediaBlob()` could successfully commit a Blob to IndexedDB, then receive `false` from `markDataChanged()` because the runtime revision marker hit quota. The page was correctly blocked, but the media writer did not roll back the just-written record. The outer caller could be prevented from cleaning it because it never received a usable media ID or the write gate had already closed.

The reconstructed production fix in `index.html`:

1. Checks `markDataChanged() === false` immediately after the Blob write.
2. Deletes that exact media record directly using the still-open database while the mutation token is still held.
3. Waits for transaction completion and reads the record back.
4. Throws a `RevisionMarkerError`, explicitly distinguishing confirmed rollback from an unconfirmed cleanup.

## Test

`tests/phase27-cross-module-faults.test.mjs` extracts and executes the production media writer and commit helper. It injects revision-marker failure after media commit, an unconfirmed rollback, and backup/export activation between Blob write and chat-message commit.

## Limits

This is a deterministic fake-IndexedDB/source-execution test. It is not real browser quota exhaustion, Chromium transaction scheduling, process termination, multi-tab browser execution or Android WebView evidence.
