# Build structure and performance gates

ClawChat keeps the desktop build in three independently verifiable layers:

1. `dist/` is the Vite renderer shared by web and native shells.
2. `src-tauri/` is the Rust host, native command layer, and packaging configuration.
3. `src-tauri/binaries/clawchat-server/` is the platform-specific FastAPI onedir resource.

The native package is assembled only after the renderer, Rust code, and server resource have
passed their own checks. This preserves a thin Tauri command layer and avoids coupling frontend
bundling to the Python resource build.

## Renderer targets

`vite.config.mts` reads Tauri's build environment and selects a WebView-compatible target:

- Windows: Chrome 105
- macOS and Linux WebKit: Safari 13
- standalone web build: ES2022

Tauri debug builds keep source maps and skip minification. Production builds are minified.
The dev server uses the fixed port from `tauri.conf.json` and ignores Rust and server changes.

The router lazily loads the authenticated layout, authentication pages, and feature pages.
Vite 8 uses Rolldown's automatic chunk splitting and Oxc minification. The previous Rollup
vendor groups must not be carried forward: they pulled editor and drag-and-drop code into
the initial preload. Keep the existing budget ceilings and verify every renderer target.
`npm run typecheck` also checks the Vite configuration, including its Vitest options.

Lightning CSS 1.33.0 and its platform packages are reviewed as unmodified build-only
MPL-2.0 tools, not renderer/runtime dependencies. The license guard permits only these
named packages at that version with `dev: true`; a version or runtime-scope change requires
another review. Source and license: https://github.com/parcel-bundler/lightningcss/tree/v1.33.0.
The build distributes transformed application CSS, not the compiler's native binaries.
Mozilla's usage/distribution guidance: https://www.mozilla.org/en-US/MPL/2.0/FAQ/.

The 2026-09-05 Vite 8 migration measured the same Linux/Safari 13 target at
305.77 KiB raw / 98.08 KiB gzip initial JavaScript, versus 321.73 / 103.06 KiB
before migration. No budget ceilings were raised. Web, macOS, Windows, and Linux
renderer builds passed; these are renderer checks, not native installer smoke tests.
Browser startup was checked in English and Korean with both raw gzip catalogs and
HTTP-decoded catalogs. The catalog loader checks gzip magic bytes so preview servers
using `Content-Encoding: gzip` cannot cause double decompression at startup.

TypeScript is kept on the 6.0 patch line (`~6.0.3`): typescript-eslint 8.69.0
supports `>=4.8.4 <6.1.0`, so TypeScript 7 is not yet an eligible upgrade for this
toolchain. Do not bypass peer dependency checks. The app tsconfig explicitly includes
Node types because it also checks tests which read native command source files;
TypeScript 6 no longer automatically includes all installed `@types` packages.

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

The current conservative Tauri baseline is 310.54 KiB raw / 100.42 KiB gzip for initial JavaScript,
1.90 MiB for all JavaScript, and 2.07 MiB for all renderer files. These numbers come from
`build:tauri-renderer`, not the smaller ES2022 standalone web build, so the local measurement and
CI evaluate the same Safari 13-compatible output. Each ceiling retains approximately two to three
percent of measured headroom. New feature libraries should be measured and preferably route-loaded before
they are accepted.

The 2026-08-29 React 19 update is the one ceiling rise recorded here. React 18 to 19 costs 49,051
raw bytes (14,219 gzip) of initial JavaScript on its own — measured by upgrading in isolation, with
`framer-motion` held at 11 to confirm it contributes nothing. That is a real cost, not a regression
to fix, so the initial ceilings rise about 19 percent and the complete-renderer ceilings about 2.5
percent; each keeps three percent headroom.

React 19 also required `manualChunks` to change from a package-name array to a path-matching
function. React 19 splits its runtime across `react-dom/client`, `react/jsx-runtime` and
`scheduler`, which the name form does not follow: React was emitted into `vendor-react` *and* the
entry chunk at once, and `vendor-react` imported React back out of `vendor-query`. The totals above
are after that fix; without it the same upgrade also scrambles which chunk loads first.

The 2026-08-27 baseline update records the route-loaded Project Workspace, Review Inbox, Agent Run,
and Inbox Triage features. Their pages remain lazy chunks; the initial raw and gzip ceilings did not
need to increase, while the complete-renderer ceilings retain approximately three percent headroom.

The 2026-08-29 update re-measures after the Capacitor and iOS removal: initial JavaScript fell by
2,003 raw bytes (778 gzip) and the complete renderer fell by roughly 35 KB across fourteen fewer
chunks. Every ceiling is unchanged; only the baselines moved down. The previous baselines had been
recorded from the ES2022 web build rather than `build:tauri-renderer`, so they understated the
output CI actually measures; they are now taken from `build:tauri-renderer` as this document
requires.

Do not raise a threshold solely to make CI pass. Measure the new output, identify which entry or
route owns the increase, and record an intentional baseline change in the same commit.

Axios is emitted as `vendor-http` separately from the initial React Query chunk, so web and Tauri
first paint do not preload the HTTP client before a lazy route actually needs it.

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
