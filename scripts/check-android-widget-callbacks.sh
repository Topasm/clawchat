#!/usr/bin/env bash
# Inspect the optimized APK, since debug unit tests do not exercise R8.
set -euo pipefail

apk="${1:?Usage: bash scripts/check-android-widget-callbacks.sh path/to/release.apk}"
analyzer="${APKANALYZER:-apkanalyzer}"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

# ToggleTodoAction must survive for widgets rendered before the callback rename.
for callback in CompleteTodoAction RefreshTodosAction ToggleTodoAction; do
  class="com.clawchat.android.widget.tracking.$callback"
  "$analyzer" dex code --class "$class" "$apk" > "$scratch/callback.smali"
  if ! grep -Eq '^\.method public constructor <init>\(\)V[[:space:]]*$' "$scratch/callback.smali"; then
    echo "Missing public no-argument constructor for $class in $apk" >&2
    exit 1
  fi
  echo "Verified widget callback: $class"
done
