#!/usr/bin/env bash

set -euo pipefail

package_root="${1:?Usage: smoke-test-tauri-macos-app.sh <mounted-package-directory>}"
# The native supervisor allows a full 60 seconds for first-run database
# creation. Leave the outer app smoke enough time to observe its final log.
smoke_seconds="${CLAWCHAT_APP_SMOKE_SECONDS:-75}"
app_path="$(find "$package_root" -maxdepth 1 -name '*.app' -type d -print -quit)"

if [[ -z "$app_path" ]]; then
  echo "No macOS app bundle was found in $package_root" >&2
  exit 1
fi

executable_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app_path/Contents/Info.plist")"
bundle_identifier="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_path/Contents/Info.plist")"
icon_file="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$app_path/Contents/Info.plist")"
if [[ "$icon_file" != *.icns ]]; then
  icon_file="${icon_file}.icns"
fi
app_icon="$app_path/Contents/Resources/$icon_file"
log_directory="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
app_log="$log_directory/clawchat-app-startup.log"
port_blocker_log="$log_directory/clawchat-port-blocker.log"
startup_log="${HOME}/Library/Application Support/${bundle_identifier}/startup.log"
startup_log_offset=0
icon_temp_root="$(mktemp -d)"
launch_waiter_pid=''
port_blocker_pid=''

stop_app() {
  /usr/bin/osascript -e "tell application id \"$bundle_identifier\" to quit" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5; do
    if [[ -z "$launch_waiter_pid" ]] || ! kill -0 "$launch_waiter_pid" 2>/dev/null; then
      return
    fi
    sleep 1
  done
  pkill -TERM -x "$executable_name" 2>/dev/null || true
}

cleanup() {
  stop_app
  if [[ -n "$port_blocker_pid" ]] && kill -0 "$port_blocker_pid" 2>/dev/null; then
    kill "$port_blocker_pid" 2>/dev/null || true
    wait "$port_blocker_pid" 2>/dev/null || true
  fi
  if [[ -n "$launch_waiter_pid" ]] && kill -0 "$launch_waiter_pid" 2>/dev/null; then
    kill "$launch_waiter_pid" 2>/dev/null || true
    wait "$launch_waiter_pid" 2>/dev/null || true
  fi
  rm -rf "$icon_temp_root"
}
trap cleanup EXIT INT TERM

if [[ ! -f "$app_icon" ]]; then
  echo "Packaged macOS icon is missing: $app_icon" >&2
  exit 1
fi
iconset_directory="$icon_temp_root/ClawChat.iconset"
/usr/bin/iconutil -c iconset "$app_icon" -o "$iconset_directory"
for required_icon in icon_16x16.png icon_128x128@2x.png icon_512x512@2x.png; do
  if [[ ! -f "$iconset_directory/$required_icon" ]]; then
    echo "Packaged macOS icon is missing required size: $required_icon" >&2
    exit 1
  fi
done

if [[ -f "$startup_log" ]]; then
  startup_log_offset="$(wc -c < "$startup_log" | tr -d ' ')"
fi

# Reproduce the common upgrade case where an older process or development
# server still owns the default wildcard port. The packaged app must move its
# local workspace to another loopback port instead of showing the login page.
python3 -m http.server 8000 --bind 0.0.0.0 >"$port_blocker_log" 2>&1 &
port_blocker_pid=$!
sleep 1
if ! kill -0 "$port_blocker_pid" 2>/dev/null; then
  echo "Could not reserve port 8000 for the macOS collision smoke test." >&2
  cat "$port_blocker_log" >&2
  exit 1
fi

RUST_BACKTRACE=1 /usr/bin/open -n -W "$app_path" >"$app_log" 2>&1 &
launch_waiter_pid=$!

for ((second = 0; second < smoke_seconds; second += 1)); do
  sleep 1
  if ! kill -0 "$launch_waiter_pid" 2>/dev/null; then
    set +e
    wait "$launch_waiter_pid"
    exit_code=$?
    set -e
    launch_waiter_pid=''
    failure_message="ClawChat exited during the macOS startup smoke test (exit code $exit_code)."
    echo "$failure_message" >&2
    cat "$app_log" >&2
    if [[ -f "$startup_log" ]]; then
      cat "$startup_log" >&2
    fi
    if [[ "${GITHUB_ACTIONS:-}" == 'true' ]]; then
      diagnostic="$(tail -c 2000 "$app_log")"
      if [[ -f "$startup_log" ]]; then
        diagnostic+="$(tail -c 2000 "$startup_log")"
      fi
      diagnostic="${diagnostic//'%'/'%25'}"
      diagnostic="${diagnostic//$'\r'/'%0D'}"
      diagnostic="${diagnostic//$'\n'/'%0A'}"
      echo "::error title=macOS app startup smoke failed::${failure_message} ${diagnostic}" >&2
    fi
    exit 1
  fi
  if [[ -f "$startup_log" ]] && tail -c "+$((startup_log_offset + 1))" "$startup_log" \
      | grep -Fq '[clawchat] local server ready on port'; then
    ready_line="$(tail -c "+$((startup_log_offset + 1))" "$startup_log" \
      | grep -F '[clawchat] local server ready on port' | tail -1)"
    if [[ "$ready_line" == *"port 8000 "* ]]; then
      echo "ClawChat reused the occupied default port instead of selecting a safe fallback." >&2
      tail -c "+$((startup_log_offset + 1))" "$startup_log" >&2
      exit 1
    fi
    if tail -c "+$((startup_log_offset + 1))" "$startup_log" \
        | grep -Fq 'system tray is unavailable'; then
      echo "Packaged macOS tray icon failed to initialize." >&2
      tail -c "+$((startup_log_offset + 1))" "$startup_log" >&2
      exit 1
    fi
    stop_app
    wait "$launch_waiter_pid" 2>/dev/null || true
    launch_waiter_pid=''
    echo "ClawChat opened its bundled local workspace; macOS startup smoke test passed."
    exit 0
  fi
done

if [[ -f "$startup_log" ]] && tail -c "+$((startup_log_offset + 1))" "$startup_log" \
    | grep -Fq 'system tray is unavailable'; then
  echo "Packaged macOS tray icon failed to initialize." >&2
  cat "$startup_log" >&2
  exit 1
fi

echo "ClawChat did not open its local workspace within ${smoke_seconds}s." >&2
cat "$app_log" >&2
if [[ -f "$startup_log" ]]; then
  tail -c "+$((startup_log_offset + 1))" "$startup_log" >&2
fi
exit 1
