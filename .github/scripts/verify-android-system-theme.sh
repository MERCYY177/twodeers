#!/usr/bin/env bash
set -euo pipefail

DIAGNOSTICS_DIR="../android-test-diagnostics"
mkdir -p "$DIAGNOSTICS_DIR"

collect_diagnostics() {
  local exit_code=$?
  trap - EXIT
  set +e

  echo "Collecting Android test diagnostics (exit code: $exit_code)"
  adb devices -l > "$DIAGNOSTICS_DIR/adb-devices.txt" 2>&1
  adb logcat -d -b all -v threadtime > "$DIAGNOSTICS_DIR/logcat.txt" 2>&1
  adb shell pm list instrumentation > "$DIAGNOSTICS_DIR/instrumentation.txt" 2>&1
  adb shell dumpsys webviewupdate > "$DIAGNOSTICS_DIR/webview-provider.txt" 2>&1
  adb shell dumpsys activity exit-info > "$DIAGNOSTICS_DIR/process-exit-info.txt" 2>&1
  adb shell getprop > "$DIAGNOSTICS_DIR/device-properties.txt" 2>&1

  if [ -d app/build/reports/androidTests ]; then
    cp -R app/build/reports/androidTests "$DIAGNOSTICS_DIR/android-test-reports"
  fi

  exit "$exit_code"
}
trap collect_diagnostics EXIT

adb wait-for-device
adb shell getprop sys.boot_completed | grep -q '^1$'
adb logcat -c

ANDROID_TEST_TASKS=(
  :app:connectedBeibeiluDebugAndroidTest
  :app:connectedLu1DebugAndroidTest
  :app:connectedLu2DebugAndroidTest
  :app:connectedLu3DebugAndroidTest
)

echo "=== All four app variants: Android light mode ==="
adb shell cmd uimode night no
gradle --no-daemon --max-workers=1 --stacktrace "${ANDROID_TEST_TASKS[@]}"

echo "=== All four app variants: Android dark mode ==="
adb shell cmd uimode night yes
gradle --no-daemon --max-workers=1 --stacktrace "${ANDROID_TEST_TASKS[@]}"

# Leave the emulator in light mode after a successful run.
adb shell cmd uimode night no
