# Phase 31 — V4 strict media/font durability and in-flight transaction crash matrix

## Scope
Continue from Phase 30. This phase covers the persistence gap between the V4 recovery journal and the separate media/font IndexedDB databases, then extends the real Chromium persistent-profile matrix to kill the browser while an IndexedDB readwrite transaction is still active.

## Production change: use strict durability for V4-owned business writes

A strict `COMMITTED` recovery-journal transaction does not by itself prove that writes made in other IndexedDB databases (media and custom fonts) were requested with strict durability. Previously, V4 media writes and custom-font snapshot writes used the default transaction durability even though journal state used `durability: 'strict'`.

Changes:

- `index.html`
  - Adds a shared media readwrite transaction factory that only requests `{durability:'strict'}` when the V4 caller explicitly opts in.
  - Exposes V4-only strict media preflight and strict transaction helpers through `window.__duoMediaTransactions`.
  - Extends `putMediaBlob()` and `deleteMediaRecord()` with an optional final durability options argument. Existing non-V4 call sites retain their prior default transaction behavior.
  - A strict transaction creation error or a transaction whose `durability` does not report `strict` is aborted/rejected; there is no silent fallback.
- `custom-font-manager.js`
  - Adds strict multi-store transaction construction and an abort-only `assertImportDurability()` preflight.
  - `writeFontSnapshot()` forwards strict durability for the complete fonts + metadata transaction.
  - `importData()` passes the same strict mode to the forward snapshot and its own rollback snapshot.
- `backup-v4.js`
  - Preflights every affected media/font database before writing PREPARED or changing application data.
  - Applies strict durability to forward media/font writes, failed-restore rollback, and startup PREPARED recovery.
  - Startup recovery also checks support before its first rollback mutation; if unavailable it leaves PREPARED intact for a compatible runtime to retry.

This deliberately does not change ordinary chat image/sticker uploads or other non-V4 media writers to strict durability.

## New deterministic source-execution test

`tests/phase31-restore-strict-durability.test.mjs` executes the actual production transaction factories and font snapshot writer with controlled IndexedDB dependencies. It verifies strict transaction creation, preflight aborts, silent durability downgrade rejection, option-unsupported rejection, atomic font/meta operations, strict forward/rollback options and preservation of default durability for ordinary media writes.

## Real Chromium matrix extension

`tests/chromium-v4-restore-crash-matrix.mjs` now adds two in-flight crash points to the existing four completed-operation crash checkpoints:

1. **Media put request success, transaction still active:** intercept the actual `IDBObjectStore.prototype.put` for the exact `phase17-chat-media` row. In its success callback, queue a second request in the same transaction and notify the external controller through the DevTools Runtime binding. The controller SIGKILLs the full Chromium process group while the renderer remains blocked and the transaction has not completed.
2. **Font clear request success, transaction still active:** intercept the actual fonts-store `clear()` request in the real font snapshot transaction, queue a follow-up request, emit a DevTools binding, and kill Chromium before the transaction completes.

After relaunch, the harness first opens a seed-only page in the same persistent profile and inspects media/font IndexedDB and the PREPARED journal before navigating to the application. It then loads the app, lets startup recovery run, and verifies exact source/target media bytes, font Blob bytes, current-font pointer and journal cleanup.

The artifact is `phase31-chromium-v4-inflight-transaction-crash-matrix.json`.

## CI and audit integration

- Adds `tests/phase31-restore-strict-durability.test.mjs` and this changelog to Phase 18 workflow path filters.
- The isolated restore workflow runs the Phase 31 real Chromium matrix and uploads its evidence alongside Phase 18 artifacts.
- Adds the gate and evidence file to the machine-readable and human-readable acceptance matrix.
- Adds Phase 31 source/harness contract validation to the hardening runner.

## Local validation and limitations

The Node source-execution test and generated DevTools expression contract are deterministic local checks. The two new in-flight browser kill points are not claimed passed locally: the container-managed Chromium URL policy blocks even the loopback test origin before application navigation (`ERR_BLOCKED_BY_ADMINISTRATOR`). The matrix evidence therefore records a blocked attempt with no executed stages. GitHub Actions has not run because no remote source was pushed. No real browser process-kill result, power-loss guarantee or Android WebView/device result is claimed.
