# Phase 26 — Storage quota and long-background lifecycle protection

## Scope

Continue from the Phase 25 source archive. This phase reconstructs the previously recorded Phase 26 hardening work for cross-tab revision tracking and background task gating. It does not claim real browser quota exhaustion or Android device evidence.

## Production changes

- `runtime-coordinator.js`
  - A failure to read or write the cross-tab revision marker makes the current page permanently readonly and reports that the preceding business write may already have committed.
  - A `revision-unreliable` BroadcastChannel message fences already-loaded tabs.
  - A page that actually releases its lease invalidates in-memory revision reliability and must reload before taking over; fallback lease loss also invalidates reliability.
- `mailbox-manager.js`
  - `processDue()` returns before planning, consuming card recency or persisting while the page is hidden, readonly or restore-paused.
- `index.html`
  - Circle pending-interaction processing is restricted to visible, writable pages that are not paused for restore.

## Test

`tests/storage-quota-background.test.mjs` executes the exact production revision-marker function and mailbox/Circle timer callbacks with injected quota/visibility conditions. It verifies the write fence, cross-tab broadcast and no background mutations in hidden/readonly/paused states.

## Limits

The quota error is injected in Node VM; it is not a real Chromium/Edge origin quota exhaustion test. The task gates are deterministic callback execution, not a real mobile OS background/suspension test.
