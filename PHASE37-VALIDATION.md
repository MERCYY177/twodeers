# Phase 37 — Final local validation report

## Baseline

- Input archive: `twodeers-phase36-profile-media-call-integrity.zip`
- Baseline SHA-256: `87729b80dbee0a7d394468ed7315fe15b53b2302cddf162aa856d0d33f9eca21`
- Scope: five findings from the independent Phase 36 audit; local source changes only.

## Production changes

1. Android WebView microphone access now has a manifest permission and a runtime permission bridge restricted to `https://appassets.androidplatform.net` on the default/443 port, and only `RESOURCE_AUDIO_CAPTURE`. Microphone hardware remains optional. Pending requests are denied on cancellation/destruction.
2. Read-only tabs restore per-tab profile/Circle media Object URLs and the selected custom font from IndexedDB before returning from startup, without running legacy data migrations or writer-only background tasks.
3. APNG detection parses the PNG signature and chunk boundaries and requires an `acTL` chunk before `IDAT`; GIF and WebP are recognized by container bytes; SVG requires a real SVG root after permitted XML preamble. Valid originals are kept byte-for-byte, malformed declared originals are rejected, and static raster compression remains bounded.
4. Circle avatar/cover and post media share the same original-byte classifier as the main image upload flow.
5. Appearance and preference changes use snapshot/commit/rollback handling: read receipts, reply delay, typing/offline options, avatar/bubble shapes, bubble/accent/button colors, custom CSS, theme mode/palette/background/bubble style restore the prior state and rendered UI when save fails.

## Local validation results

- `node tests/*.test.mjs`: **34/34 independent test suites passed**.
- `node tools/verify-twodeers-hardening.mjs`: **passed**.
- `node --check`: **19 JavaScript files passed**.
- JSON parse: **7 project JSON files passed**.
- Android XML parse: **12 XML files passed**.
- The hardening runner verified 352 built-in sticker assets, root HTML inline-script syntax, source JavaScript syntax, Android XML, backup/restore, media, fonts, stickers, call lifecycle and Phase 17–37 acceptance/path-filter contracts.
- Baseline tree comparison: 15 existing files modified, 3 files added (`PHASE37-CHANGELOG.md`, `PHASE37-VALIDATION.md`, and `tests/phase37-audit-fixes.test.mjs`), and no baseline files removed.

## Evidence not obtained in this environment

- A real Chromium UI run for second-tab media/font hydration and actual APNG playback was not completed. The available Chromium runtime previously failed to produce DOM even for `about:blank`; source/Node tests are not a substitute for browser evidence.
- GitHub Actions was not triggered because the work is local-only and no remote branch/commit was created.
- Android APK build and physical WebView microphone permission/capture were not run: this environment has no Gradle executable, no Gradle Wrapper in the project, and no configured Android SDK. The Java/Manifest source contract is statically checked, not device-tested.

## Repository safety

- No remote `main` changes, branches, PRs, merges or deployment were made.
- The learning feature was not modified.
