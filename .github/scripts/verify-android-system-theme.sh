#!/usr/bin/env bash
set -euo pipefail

for flavor in Beibeilu Lu1 Lu2 Lu3; do
  echo "=== ${flavor}: Android light mode ==="
  adb shell cmd uimode night no
  gradle --no-daemon ":app:connected${flavor}DebugAndroidTest"

  echo "=== ${flavor}: Android dark mode ==="
  adb shell cmd uimode night yes
  gradle --no-daemon ":app:connected${flavor}DebugAndroidTest"
done

# Leave the emulator in light mode even after a successful run.
adb shell cmd uimode night no
