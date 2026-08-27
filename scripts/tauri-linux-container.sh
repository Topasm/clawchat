#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
image_name="localhost/clawchat-tauri-linux:rust-1.97.1"
containerfile="$repo_root/tools/tauri-linux.Containerfile"
containerfile_sha=$(sha256sum "$containerfile" | awk '{print $1}')
podman_root="/tmp/clawchat-podman-overlay-storage"
podman_runroot="/tmp/clawchat-podman-overlay-run"
podman_cmd=(
  podman
  --storage-driver=overlay
  --storage-opt ignore_chown_errors=true
  --storage-opt mount_program=/usr/bin/fuse-overlayfs
  --root "$podman_root"
  --runroot "$podman_runroot"
)

if ! command -v podman >/dev/null 2>&1; then
  echo "podman is required for the containerized Tauri Linux build" >&2
  exit 1
fi

image_containerfile_sha=""
if "${podman_cmd[@]}" image exists "$image_name"; then
  image_containerfile_sha=$(
    "${podman_cmd[@]}" image inspect "$image_name" \
      --format '{{ index .Labels "com.clawchat.containerfile-sha256" }}' 2>/dev/null || true
  )
fi

if [[ "$image_containerfile_sha" != "$containerfile_sha" ]]; then
  "${podman_cmd[@]}" build \
    --file "$containerfile" \
    --label "com.clawchat.containerfile-sha256=$containerfile_sha" \
    --tag "$image_name" \
    "$repo_root"
fi

if [[ $# -eq 0 ]]; then
  set -- bash -lc 'cargo check --locked --manifest-path src-tauri/Cargo.toml'
fi

exec "${podman_cmd[@]}" run --rm \
  --security-opt label=disable \
  --volume "$repo_root:/workspace" \
  --volume clawchat-cargo-registry:/opt/cargo/registry \
  --volume clawchat-cargo-git:/opt/cargo/git \
  --workdir /workspace \
  "$image_name" \
  "$@"
