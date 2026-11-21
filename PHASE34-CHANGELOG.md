# Phase 34 — Chromium process-group shutdown and failed-profile lifecycle

## Scope

Audit and harden the real-Chromium crash-matrix test executor. No V4 production restore implementation was changed in this phase.

## Confirmed harness defects

1. **Leader exit was mistaken for process-group exit.** `terminateChromeProcessGroup()` and `killChrome()` skipped sending SIGKILL once the Node child handle reported exit or `closeInfo` existed. Chromium descendants can outlive the browser leader inside the detached POSIX process group. The old code then waited for the group to disappear without first signaling those descendants. If launch-time cleanup failed before a session was returned, the caller also lacked the child handles needed for a unified retry.
2. **A cleanup retry could delete a failed profile.** The catch handler tried to stop Chromium and preserve the profile. If that first stop attempt failed, `finally` retried; if the retry succeeded, the old `preserveProfile` flag was still false and `finally` deleted the profile instead of copying it.
3. **Successful profile copying leaked the original temp profile.** The old code set `preserveProfile=true` after copying the profile to the artifact directory. That prevented the source temp profile from being removed, leaving a second copy in `/tmp`.
4. **A failed artifact copy could delete the only remaining source profile.** The old preservation branch did not set a retain-source flag if `cp()` failed, so final cleanup could remove the original profile after the artifact copy failed.
5. **An unclosed profile could sit outside the uploaded artifact root.** Profiles were created under `os.tmpdir()`, so if two cleanup attempts failed, the original path would not be inside the job's uploaded evidence directory.

## Changes

- Added `signalChromeProcessGroup()` and made POSIX cleanup signal the detached process group even if the child leader already exited. `ESRCH` is treated as an already-gone group; other signal errors remain visible.
- Both explicit SIGKILL checkpoints and ordinary cleanup now call the same group-signal helper, then wait for the complete process group to disappear. Launch-time cleanup errors return the still-live session handles to `runCase()` so the shared finalizer can retry.
- Added `finalizeFailedRunCase()`: it retries process-group cleanup once before profile disposition.
- If retry succeeds, copy the closed profile to `failed-profiles/<stage>` first, then remove the temporary source copy. If the artifact copy fails, keep the source profile. If Chromium remains alive after both attempts, do not copy or delete a potentially changing profile; retain it under `profiles-in-progress/` inside the artifact workspace and record the path/error.
- Place the in-progress profile under the CI artifact directory (`profiles-in-progress/`) so an unclosed or uncopyable profile remains inside the artifact workspace. Successful profiles are removed; copied failed profiles are uploaded under `failed-profiles/`.
- Added `tests/phase34-chromium-process-group-cleanup.test.mjs`, which executes extracted production harness helpers with controlled process signals and injected close failures.
- The CI crash-matrix contract step now runs the Phase 34 test before the six real Chromium kill/relaunch scenarios. The hardening runner, both workflow path filters, machine acceptance matrix and human audit are updated.

## Tests

The new exact-source test covers:

- A Chromium leader whose child handle already reports exit while the POSIX process group still needs SIGKILL.
- Exactly one group signal per cleanup attempt and explicit process-group disappearance verification.
- `ESRCH` as a harmless race and non-`ESRCH` errors as visible failures.
- A first cleanup failure followed by a successful retry; the closed profile is copied before the caller removes the source.
- Two failed cleanup attempts; the profile is neither copied while live nor removed.
- Artifact-copy failure; the source profile remains available.
- Failure before fixture seeding; no empty profile is retained.

## Evidence boundary

All local Node tests and the complete hardening runner are executed locally. The local managed Chromium URL policy still prevents the browser harness from loading its loopback seed page, and GitHub Actions has not been run because no branch was pushed and no PR/workflow dispatch was authorized. This phase establishes process cleanup and profile-retention behavior under deterministic injected dependencies; it does not upgrade the six real Chromium SIGKILL scenario status. Android WebView and physical power-loss validation remain open.

No remote branch, PR, deployment or `main` branch was changed. The learning feature remains out of scope.
