# Build structure and performance gates

ClawChat keeps the desktop build in three independently verifiable layers:

1. `dist/` is the Vite renderer shared by web and native shells.
2. `src-tauri/` is the Rust host, native command layer, and packaging configuration.
3. `src-tauri/binaries/clawchat-server/` is the platform-specific FastAPI onedir resource.

The native package is assembled only after the renderer, Rust code, and server resource have
passed their own checks. This preserves a thin Tauri command layer and avoids coupling frontend
bundling to the Python resource build.

## Renderer targets

`vite.config.ts` reads Tauri's build environment and selects a WebView-compatible target:

- Windows: Chrome 105
- macOS and Linux WebKit: Safari 13
- standalone web build: ES2022

Tauri debug builds keep source maps and skip minification. Production builds are minified.
The dev server uses the fixed port from `tauri.conf.json` and ignores Rust and server changes.

The router lazily loads the authenticated layout, authentication pages, and feature pages. React
and React Router live in a stable shared chunk so task-only dependencies such as drag-and-drop and
the graph renderer do not become initial-entry dependencies.

## Performance budget

Build and inspect the conservative Tauri renderer with:

```bash
npm run build:tauri-renderer
npm run measure:renderer
npm run check:renderer-budget
```

The budget file `.renderer-performance-thresholds.json` tracks both initial HTML JavaScript and
the complete renderer. The initial metrics guard startup cost; complete-renderer metrics prevent
route splitting from hiding overall growth. CI and every Tauri package job fail when a threshold
is exceeded.

The current conservative Tauri baseline is 256.93 KiB raw / 85.12 KiB gzip for initial JavaScript,
1.75 MiB for all JavaScript, and 1.89 MiB for all renderer files. These numbers come from
`build:tauri-renderer`, not the smaller ES2022 standalone web build, so the local measurement and
CI evaluate the same Safari 13-compatible output. Each ceiling retains approximately three percent
of measured headroom. New feature libraries should be measured and preferably route-loaded before
they are accepted.

Do not raise a threshold solely to make CI pass. Measure the new output, identify which entry or
route owns the increase, and record an intentional baseline change in the same commit.

Axios is emitted as `vendor-http` separately from the initial React Query chunk. Capacitor startup
is dynamically imported, so web and Tauri first paint do not preload the HTTP client solely for a
mobile-only initialization path.

## Runtime diagnostics

Development builds collect startup milestones, long tasks, and input-to-next-frame latency. Enable
the same recorder in a production package by launching the renderer with `?performance=1`, then
inspect the report from DevTools:

```js
window.clawchatPerformance?.report()
```

The report includes `auth_ready`, `route_ready`, `startup_shell_hidden`, `platform_ready`, and
`transport_ready` milestones plus p50/p95 interaction summaries. It evaluates explicit startup,
input-frame, and long-task budgets and returns any violations without uploading diagnostics.
`window.clawchatPerformance?.reset()` starts a fresh local sampling window.

## Rust profiles

Development builds use incremental compilation. Release builds use one codegen unit, size
optimization, LTO, abort-on-panic, and symbol stripping. Cargo dependencies remain locked in CI.

## Python server resource

Unlike TextEx's single pinned sidecar binary, ClawChat embeds a PyInstaller onedir application.
It is therefore built for each target OS rather than downloaded once. Validate it before native
packaging with:

```bash
npm run build:tauri-server
npm run check:tauri-server
```

CI installs the build dependency group, including pinned PyInstaller, from `server/uv.lock`.
`npm run build:tauri-server` runs the verifier automatically after manifest generation; the
separate check command remains useful when inspecting an existing output directory. The bundle
must be built with Python 3.11 or newer; the build script fails before PyInstaller starts when an
older interpreter is selected.

The build writes `bundle-manifest.json` beside the server executable. It records every regular
file's relative path, size, and SHA-256, plus contained PyInstaller symlink targets. Validation
rejects missing, unexpected, modified, cross-platform, wrong-architecture, path-escaping, and
incorrectly formatted executable entries.

Preview and release workflows extract the generated DEB, DMG, or NSIS package and run the same
validator against the packaged `server-bin` directory. This catches resource mapping or installer
assembly failures that a source-directory check cannot detect. They then launch that packaged
server in an isolated temporary directory and require a successful `/api/health` response.

## Native package size budget

The renderer budget does not account for the Rust host, WebView package metadata, or embedded
Python server. Preview and release jobs therefore check the final installer files separately:

```bash
npm run check:tauri-artifact-budget -- src-tauri/target/release/bundle linux
npm run check:tauri-artifact-budget -- src-tauri/target/release/bundle windows
npm run check:tauri-artifact-budget -- src-tauri/target/release/bundle macos
```

`.tauri-artifact-thresholds.json` defines one required installer per platform and optional updater
artifacts. A missing or duplicated required installer fails closed. If an optional updater artifact
exists, it must also stay under its configured limit.

The current limits are provisional ceilings because a complete three-platform package baseline is
not reproducible on one host. After the first successful matrix build, record the emitted sizes,
set each baseline to the measured value, and keep a small explicit allowance in `maxBytes`. Do not
raise a ceiling only to unblock CI; identify whether growth came from the Python resource, Rust
dependencies, package metadata, or renderer first.

## Release assembly

Platform runners never publish directly. They upload already-compressed installers and updater
archives with artifact recompression disabled. A single dependent job downloads all three platform
sets, and `scripts/generate-tauri-release.js` requires exactly one AppImage, DEB, DMG, NSIS
installer, platform updater archive, and non-empty updater signature before producing release data.

Before protected signing jobs start, the Linux preflight runs common type, test, migration, Rust
core, formatting, workflow pin, and release-version checks once. This removes the same work from
all three platform jobs while retaining a hard dependency from every package build to preflight.
It also requires the workflow commit to equal the current `origin/main` and refuses an existing
release tag.

The assembler writes one `latest.json` with Linux x64, macOS arm64, and Windows x64 entries plus a
deterministically sorted `checksums.txt`. It verifies the checksums and the 12-file final inventory
before creating one draft release. This prevents parallel platform jobs from racing to overwrite a
partial updater manifest.

## Workflow dependency pinning

Every remote GitHub Action is pinned to a full 40-character commit SHA. The trailing version
comment records the reviewed major line without allowing the workflow to follow a mutable tag.
Local actions and `docker://` references are the only exceptions.

Run the repository-wide guard after adding or updating a workflow:

```bash
npm run check:actions-pinned
```

To update an Action, review its official release and repository, resolve the intended release tag
to its exact commit, replace the SHA and version comment together, and run the guard plus the
affected workflow tests. Never replace the SHA with a branch, moving major tag, shortened SHA, or
an unreviewed commit.
