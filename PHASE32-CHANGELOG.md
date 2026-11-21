# Phase 32 — V4 pre-startup crash-state inspection across all checkpoints

## Scope
Audit and strengthen the Phase 31 real Chromium SIGKILL harness. No new production restore code was changed because this phase identified an evidence-ordering gap rather than a confirmed production defect.

## Confirmed harness gap
The Phase 31 restart path opened a seed-only page before application startup only for `media-inflight` and `font-inflight`. For `prepared`, completed `media`, completed `font`, and `committed`, it loaded the application immediately after relaunch. Startup recovery could therefore alter or clean the persisted state before the test recorded what actually survived process termination.

## Changes
- Every one of the six stages now relaunches the same persistent Chromium profile and opens the seed-only page before `index.html`.
- The raw inspector reads main localStorage, Circle state, all six media Blob rows, font rows/current-font pointer in one readonly transaction, and the recovery journal. It also verifies the journal retains the exact old main/Circle snapshots and old media/font Blob bytes at each checkpoint. Readonly IDB operations resolve only after `transaction.oncomplete`.
- `assertPreStartupProfile()` encodes the real per-stage restore ordering. In particular, Circle/media/font can already contain target data at the completed-font checkpoint while the main localStorage state remains source data until the later main-state commit. COMMITTED must have all target state and a committed journal before startup cleanup.
- The Node contract extracts and executes the actual assertion function against all six synthetic snapshots and negative corrupt media/font/journal cases.
- Chromium launch, navigation and scenario failures share one cleanup path that kills the full process group and waits for it to disappear, including failures before a session object can be returned.
- The evidence artifact is renamed to `phase32-chromium-v4-prestartup-state-matrix.json`, and the restore workflow uploads the Phase 32 artifact directory.

## Validation boundary
The source contract and local Node tests can validate the assertion function and generated browser checkpoint scripts. The local Chromium URL policy still blocks loopback navigation before page load, so no real SIGKILL stage ran. GitHub Actions remains not-run; no Android WebView or physical power-loss result is claimed.

No remote repository changes, pushes, PRs, deployments or merges were performed. The learning feature was not modified.
