#!/usr/bin/env bash

set -euo pipefail

package_root="${1:?Usage: smoke-test-tauri-macos-app.sh <mounted-package-directory>}"
smoke_seconds="${CLAWCHAT_APP_SMOKE_SECONDS:-10}"
app_path="$(find "$package_root" -maxdepth 1 -name '*.app' -type d -print -quit)"

if [[ -z "$app_path" ]]; then
  echo "No macOS app bundle was found in $package_root" >&2
  exit 1
fi

executable_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app_path/Contents/Info.plist")"
app_binary="$app_path/Contents/MacOS/$executable_name"
log_directory="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
app_log="$log_directory/clawchat-app-startup.log"
app_pid=''

cleanup() {
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

RUST_BACKTRACE=1 "$app_binary" >"$app_log" 2>&1 &
app_pid=$!

for ((second = 0; second < smoke_seconds; second += 1)); do
  sleep 1
  if ! kill -0 "$app_pid" 2>/dev/null; then
    set +e
    wait "$app_pid"
    exit_code=$?
    set -e
    app_pid=''
    echo "ClawChat exited during the macOS startup smoke test (exit code $exit_code)." >&2
    cat "$app_log" >&2
    exit 1
  fi
done

kill "$app_pid"
wait "$app_pid" 2>/dev/null || true
app_pid=''
echo "ClawChat remained running for ${smoke_seconds}s; macOS startup smoke test passed."
