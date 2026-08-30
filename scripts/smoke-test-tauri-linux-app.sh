#!/usr/bin/env bash

set -euo pipefail

appimage_path="${1:?Usage: smoke-test-tauri-linux-app.sh <appimage-path>}"
smoke_seconds="${CLAWCHAT_APP_SMOKE_SECONDS:-75}"
runtime_root="$(mktemp -d)"
data_root="$runtime_root/data"
config_root="$runtime_root/config"
app_log="$runtime_root/app.log"
startup_log="$data_root/com.clawchat.desktop/startup.log"
launcher_pid=''
server_pid=''

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill -TERM "$server_pid" 2>/dev/null || true
  fi
  if [[ -n "$launcher_pid" ]] && kill -0 "$launcher_pid" 2>/dev/null; then
    kill -TERM "$launcher_pid" 2>/dev/null || true
    wait "$launcher_pid" 2>/dev/null || true
  fi
  rm -rf "$runtime_root"
}
trap cleanup EXIT INT TERM

mkdir -p "$data_root" "$config_root"
APPIMAGE_EXTRACT_AND_RUN=1 \
  XDG_DATA_HOME="$data_root" \
  XDG_CONFIG_HOME="$config_root" \
  xvfb-run -a "$appimage_path" >"$app_log" 2>&1 &
launcher_pid=$!

for ((second = 0; second < smoke_seconds; second += 1)); do
  sleep 1
  if ! kill -0 "$launcher_pid" 2>/dev/null; then
    set +e
    wait "$launcher_pid"
    exit_code=$?
    set -e
    launcher_pid=''
    echo "ClawChat exited during the Linux startup smoke test (exit code $exit_code)." >&2
    cat "$app_log" >&2
    [[ ! -f "$startup_log" ]] || cat "$startup_log" >&2
    exit 1
  fi
  if [[ -f "$startup_log" ]] && grep -Fq '[clawchat] local server ready on port' "$startup_log"; then
    pid_path="$data_root/com.clawchat.desktop/server.pid"
    if [[ ! -f "$pid_path" ]]; then
      echo "ClawChat reported ready without a server PID file." >&2
      exit 1
    fi
    server_pid="$(tr -d '[:space:]' < "$pid_path")"
    app_pid="$(ps -o ppid= -p "$server_pid" | tr -d '[:space:]')"
    if [[ -z "$app_pid" ]] || ! kill -0 "$app_pid" 2>/dev/null; then
      echo "Could not resolve the desktop parent for server PID $server_pid." >&2
      exit 1
    fi

    kill -TERM "$app_pid"
    for _ in $(seq 1 60); do
      if ! kill -0 "$server_pid" 2>/dev/null; then
        wait "$launcher_pid" 2>/dev/null || true
        launcher_pid=''
        server_pid=''
        echo "ClawChat opened its bundled workspace and cleaned up after SIGTERM; Linux startup smoke test passed."
        exit 0
      fi
      sleep 0.25
    done
    echo "Bundled server PID $server_pid survived desktop SIGTERM." >&2
    cat "$startup_log" >&2
    exit 1
  fi
done

echo "ClawChat did not open its local workspace within ${smoke_seconds}s." >&2
cat "$app_log" >&2
[[ ! -f "$startup_log" ]] || cat "$startup_log" >&2
exit 1
