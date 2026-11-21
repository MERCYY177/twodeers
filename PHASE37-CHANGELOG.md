# Phase 37 — Audit-confirmed media, read-only hydration, appearance transactions and Android audio permission

## Baseline and scope

Baseline: `twodeers-phase36-profile-media-call-integrity.zip` (SHA-256 recorded in the Phase 36 delivery). This phase applies the five concrete findings from the independent Phase 36 audit. It modifies local project files only. It does not modify remote `main`, create a PR, deploy Pages, or alter the learning feature.

## Production fixes

### 1. Android WebView microphone permission bridge

- Added `android.permission.RECORD_AUDIO` to the Android manifest.
- Declared `android.hardware.microphone` as optional, so devices without microphone hardware can still install and use chat, letters, stickers and other non-recording features.
- Added a `WebChromeClient.onPermissionRequest()` handler that accepts only the exact HTTPS WebViewAssetLoader origin (`appassets.androidplatform.net`, default/443 port only) and only the single `RESOURCE_AUDIO_CAPTURE` resource.
- Denies requests from any other origin, requests that combine audio with camera/other resources, requests after Activity destruction, and overlapping pending requests.
- Requests the Android runtime `RECORD_AUDIO` permission when necessary, validates the returned permission name/result and rechecks the page/request origin before granting the WebView resource.
- Handles WebView cancellation, permission-request exceptions and Activity destruction by clearing/denying a pending request. No camera permission or camera resource is granted.

### 2. Read-only tab media and font hydration

- The read-only startup branch now reconstructs profile-media Blob URLs, Circle media Blob URLs and the selected custom `FontFace` from IndexedDB before returning.
- The read-only branch does not call profile legacy migration or Circle legacy migration, does not start call/post/mailbox background tasks, and keeps persistence paths closed.
- Failed/missing rows are logged and do not trigger fabricated replacement media. Successful independent media slots can still render.

### 3. APNG/GIF/WebP/SVG source classification and preservation

- Replaced filename/MIME-only animation classification with container/signature inspection.
- APNG detection parses the PNG signature and chunk headers, requiring a valid eight-byte `acTL` control chunk before `IDAT`. Therefore a normal `.png` file with `image/png` MIME but APNG bytes is recognized as animated.
- GIF detection uses the GIF87a/GIF89a byte signature.
- WebP detection verifies RIFF/WEBP structure, walks chunk boundaries and checks `ANIM`/`ANMF` plus the VP8X animation flag; arbitrary `ANIM` text in a payload is not sufficient.
- SVG detection skips XML declarations/comments/DOCTYPE and validates that the document root is an `svg` element (including a namespaced root). SVG hints or a `.svg` filename alone do not cause unrelated markup to be classified as SVG.
- The main `fileToDataURL()` rejects malformed declared GIF/APNG/SVG/WebP files instead of silently flattening or mislabelling them. Valid APNG, GIF, WebP and SVG source bytes are retained; ordinary static raster images continue through bounded Canvas compression.
- Circle avatar/cover upload and Circle post-media upload now use the same `requiresOriginalImageBytes()` classifier as the main image path. Vector preservation is separate from animation detection.

### 4. Transactional appearance/preferences persistence

- Added a shared `commitAppearanceState()` helper which snapshots state, applies the requested UI update, checks `save()`, and restores both state and visible controls/styles when persistence fails.
- Applied it to reply timing, read-receipt style, typing indicator state/text, offline chat settings, avatar shape, bubble shape, bubble colors, accent/button colors and custom CSS.
- Custom CSS now shows the success notification only after `save()` succeeds. Failed saves restore the previous stylesheet and input.
- The separate theme manager exposes `setSetting()`; palette, display mode, page background and bubble style update the rendered theme, commit state and roll back the state and rendered theme if saving fails or the value is invalid.
- Existing Enter-to-send and call-settings save paths retain their own explicit rollback handling.

## Regression tests and CI contracts

Added `tests/phase37-audit-fixes.test.mjs`. It executes the production media classifier, the actual main image conversion function, the actual read-only startup branch, the shared appearance transaction helper and the actual theme-manager setter. It also checks the Android Manifest and WebChromeClient permission contract.

The test covers:

- APNG named `.png` with `image/png` MIME; byte-for-byte preservation.
- Static PNG compression classification, GIF signatures, animated/static WebP, valid SVG preambles and rejection of fake SVG markup.
- SVG byte-for-byte preservation and rejection of malformed `.svg` declarations.
- Shared Circle upload use of original-byte classification.
- Read-only profile/Circle/font hydration without invoking legacy migrations.
- State/UI rollback on a failed appearance save and successful commit behavior.
- Failed and successful palette change behavior, including rendered palette rollback.
- Android exact-origin/audio-only permission restrictions, OS runtime permission validation, pending-request cleanup and optional microphone feature declaration.

The test is wired into `tools/verify-twodeers-hardening.mjs`, the machine-readable Phase 17–37 acceptance matrix, and relevant push/pull_request path filters.

## Evidence and limitations

- Local Phase 37 exact-source regression: passed.
- Full local `tests/*.test.mjs`: 34/34 independent test suites passed.
- `node tools/verify-twodeers-hardening.mjs`: passed, including HTML inline-script syntax, root JavaScript syntax, Android XML parsing, 352 sticker assets and Phase 17–37 contracts.
- Additional syntax/data checks: 19 JavaScript files passed `node --check`; all 7 project JSON files parsed; all 12 Android XML files parsed successfully.
- Real Chromium second-tab hydration and actual file-input APNG animation playback remain browser-E2E evidence items; the current container's Chromium fails to produce DOM even for `about:blank`.
- GitHub Actions has not been triggered because this work remains local-only.
- Android Gradle APK build, WebView permission prompt and physical microphone capture have not been run in a device/CI environment. The source contract is covered; this is not device-pass evidence.
