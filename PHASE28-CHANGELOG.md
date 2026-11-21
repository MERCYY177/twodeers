# Phase 28 — V4 restore journal and multi-store combined failure safety

## Source baseline note

The prior Phase 27 complete ZIP was unavailable locally. Phase 28 continues from the available Phase 25 ZIP, reconstructs Phase 26/27 changes from their saved change records, and then applies and validates the Phase 28 V4 restore hardening. This is an explicitly reconstructed baseline, not a byte-for-byte continuation from an inaccessible Phase 27 archive.

## Confirmed failure edges

1. A restore failure could successfully roll back old business data but fail to remove the PREPARED journal. If the current page then accepted writes, the next startup could replay the retained old snapshot over those new writes.
2. A PREPARED journal write could throw after the record may already have reached durable storage. The old call site sat outside the main rollback `try`, so an ambiguous journal state did not itself block the current page.
3. Interrupted startup recovery needed strict post-write checks for module importers that might silently return `false` or fail after a partial write.

## Production changes in `backup-v4.js`

- Resolve ambiguous PREPARED journal creation by attempting read-back. If the journal may exist or read-back itself fails, block the current page and stop before destructive writes.
- If business rollback is incomplete, retain PREPARED and block the current page.
- If business rollback succeeds but clearing PREPARED fails, retain the journal and still block the current page. This prevents new writes that could later be overwritten by startup replay.
- During interrupted startup recovery, reject `false` from sticker/mailbox/card/font restoration and compare the restored snapshots with read-back data. Media records are verified after restore/delete. Circle media references are checked before clearing PREPARED.
- PREPARED, COMMITTED and journal deletion now use IndexedDB `durability: 'strict'` transactions. The coordinator checks `tx.durability` so engines that silently ignore the option fail closed, and verifies the saved journal after each write transaction. Journal reads also wait for the readonly transaction to complete, rather than trusting request success before the transaction finishes.
- A COMMITTED transaction can complete even when its follow-up read-back is unavailable or inconsistent. That result is explicitly flagged as `journalCommitUncertain`; the restore page is blocked without attempting an opposite rollback, and old-media garbage collection is not reached.
- Mark COMMITTED only after the imported state, module data, media and Circle verification succeed. Old media cleanup remains after the confirmed commit marker; a committed journal is cleanup-only on next startup.

## Tests

- Extended `tests/backup-atomicity.test.mjs` with ambiguous journal-write read-back failure, simultaneous UI/media/font rollback failure, rollback-success/journal-cleanup-failure, and startup module import returning `false`.
- Added `tests/phase28-restore-combined-failures.test.mjs` to execute the real production-source fixture and assert PREPARED/COMMITTED ordering, rollback/read-back requirements, fail-closed journal retention and startup clear ordering.
- Extended `tests/runtime-recovery.test.mjs` to verify strict durability on PREPARED/COMMITTED/delete transactions, reject an engine that ignores strict durability, and simulate a durable COMMITTED record with inconsistent read-back.
- Added Phase 26–28 suites to the local hardening runner and relevant workflow path filters.
- Updated the human-readable and machine-readable acceptance matrix and coverage-gap audit.

## Validation boundary

Node VM fault injection and source-order contracts are local deterministic evidence. The `durability: 'strict'` option is an explicit browser transaction request whose accepted mode is checked; it is not a claim that this run proved physical-device flush behavior or survives every OS/filesystem/power-loss scenario. These tests do not replace actual Chromium restore UI/file-picker, persistent-profile crash/SIGKILL, actual browser quota exhaustion, remote GitHub Actions execution, Android APK build or Android WebView device validation. These remain `not-run` unless their artifacts are actually executed and inspected.
