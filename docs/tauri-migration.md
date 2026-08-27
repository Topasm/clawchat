# Tauri desktop migration

ClawChat completed its desktop-shell migration from Electron to Tauri 2 without rewriting the React renderer or FastAPI server. The packaged Python server remains a native sidecar, and the old Electron data format is supported only as an import source.

Build layering, renderer targets, and bundle regression gates are documented in
[build-performance.md](build-performance.md).

## Target boundary

```text
React features
  -> NativePlatformApi
     -> Web adapter
     -> Tauri adapter
        -> typed commands/events
           -> thin Rust commands
              -> Rust native services
```

Feature code must not read an Electron bridge or import `@tauri-apps/*` directly. Runtime-specific calls belong under `src/app/platform/`. Rust commands should validate inputs and delegate native work to services rather than containing domain logic.

## Migration phases

- [x] Introduce the runtime-neutral platform contract.
- [x] Route Electron and web renderer calls through platform adapters.
- [x] Add adapter contract tests and preserve web/Electron builds.
- [x] Add the minimal Tauri shell, capability file, and renderer adapter.
- [x] Port the embedded-server supervisor and configuration to Rust.
- [x] Migrate Electron user data into the Tauri application data directory.
- [x] Port tray, notifications, badge, global shortcut, autostart, dialogs, and Obsidian URL handling.
- [x] Add OS credential-vault storage and a signed Tauri updater pipeline.
- [ ] Configure production credentials and verify OS-signed/notarized installers.
- [x] Retire the Electron workflow and runtime after preserving the read-only data-import path.

Android Compose and iOS Capacitor clients are outside this migration. Their HTTP and WebSocket contracts remain unchanged.

## Initial native command surface

The first Rust implementation should expose only the operations already required by `NativePlatformApi`:

- `server_get_status`
- `server_get_config`
- `server_get_network_info`
- `server_update_config`
- `server_select_folder`
- `server_open_obsidian_vault`
- `server_set_app_mode`
- `server_get_app_mode`

Desktop events use stable transport-neutral names in the renderer:

- `server-status-change`
- `open-quick-capture`
- `notification:action`
- `navigate`

## Data compatibility gate

The Tauri build must keep the application identifier `com.clawchat.desktop`. Before starting a new server database, it must perform an idempotent import of the existing Electron data:

```text
Electron userData/
  server-config.json
  server-data/data/

Tauri app data/
  server-config.json
  server-data/data/
  electron-import-v1.json
```

The import must copy to a temporary destination, validate the SQLite database, atomically promote the copy, and leave the Electron source untouched. A failed import must stop host startup rather than silently create an empty database.

The implemented `electron-import-v1` step validates the SQLite 3 header, journal modes, payload fractions, page alignment, and declared page count before promotion. It never deletes or edits the Electron source. Set `CLAWCHAT_ELECTRON_USER_DATA` to an explicit legacy directory when testing a nonstandard Electron `userData` location.

### Staged import and rollback rehearsal

Use a disposable OS account or VM. Never point a rehearsal at the only copy of production data.

1. Close Electron and Tauri so the SQLite database and WAL files are stable.
2. Copy the complete Electron `userData` directory to a staging directory.
3. Start Tauri once with `CLAWCHAT_ELECTRON_USER_DATA` set to the absolute staging path.
4. Close Tauri before creating or editing application data.
5. Run the read-only audit against the staging source and Tauri app-data destination:

```bash
python scripts/verify_tauri_data_import.py \
  --electron-dir /absolute/path/to/electron-staging \
  --tauri-dir /absolute/path/to/tauri-app-data
```

The audit requires a matching `electron-import-v1.json`, compares normalized server configuration, and checks every copied database, WAL, upload, and attachment by relative path, size, and SHA-256. Run it immediately after import; intentional changes made in Tauri should make the byte-for-byte audit fail.

For rollback, close Tauri and reopen Electron against its original `userData`. The automated fixture test mutates the imported Tauri configuration and upload after migration and verifies that every captured Electron source byte is unchanged. Another test verifies that a non-empty Tauri data directory is never overwritten.

## Embedded server packaging

The FastAPI server continues to use PyInstaller `--onedir`; it is not converted to a single-file Tauri sidecar. This preserves the existing server loading behavior and avoids an extraction penalty at every launch.

```text
server/dist/clawchat-server/
  clawchat-server[.exe]
  bundle-manifest.json
  _internal/...

Tauri resources/
  server-bin/
    clawchat-server[.exe]
    bundle-manifest.json
    _internal/...
```

Build and verify the resource before packaging:

```bash
npm run build:tauri-server
npm run check:tauri-server
npm run package:tauri
```

Server bundles require Python 3.11 or newer. The build script pins all PyInstaller output under
`server/build` and `server/dist` so it cannot overwrite the Vite renderer in the repository-level
`dist` directory.

`src-tauri/tauri.bundle.conf.json` adds the generated resource only for packaging, so ordinary Rust checks do not require a local PyInstaller artifact. `.github/workflows/build-tauri.yml` creates unsigned preview artifacts for the sole desktop runtime.

The manifest covers every regular file by relative path, size, and SHA-256 and records contained
PyInstaller symlinks. CI extracts each installer and re-runs the validator against the packaged
resource, preventing an incomplete or altered onedir tree from being published.

## Credentials and auth migration

The Tauri adapter stores `auth-storage` in the operating-system credential vault: macOS Keychain, Windows Credential Manager, or Linux Secret Service. On first successful access it migrates the existing local-storage value and removes that copy. If a Linux desktop has no Secret Service provider, the adapter logs a warning and keeps the existing storage fallback so login is not broken.

Stronghold is intentionally not used for this passwordless flow. Its vault requires a 32-byte password hash; persisting that unlock secret beside the vault would not improve the current threat boundary. Stronghold remains an option if ClawChat later introduces a user-supplied master password.

## Signed updater releases

Preview CI remains unsigned and has no updater endpoint. Release configuration is generated only when release credentials are present, so a development build cannot accidentally trust a placeholder key.

Generate a Tauri updater signing key once on an isolated machine:

```bash
npx tauri signer generate -w ~/.tauri/clawchat-updater.key
```

Never commit the private key. Create a protected GitHub Environment named `desktop-release`, require a reviewer, and configure it with:

- Actions variable `TAURI_UPDATER_PUBKEY`: the generated public key.
- Optional Actions variable `TAURI_UPDATER_ENDPOINT`: an alternative HTTPS feed URL.
- Actions secret `TAURI_SIGNING_PRIVATE_KEY`: the private key contents or path accepted by Tauri CI.
- Actions secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password.

For a non-GitHub update host, also set `TAURI_UPDATER_ENDPOINT` to an HTTPS endpoint when generating the config. GitHub Actions defaults to:

```text
https://github.com/<owner>/<repository>/releases/latest/download/latest.json
```

Bump the release version in `package.json`, both root declarations in `package-lock.json`, `src-tauri/Cargo.toml`, and the `clawchat-tauri` entry in `src-tauri/Cargo.lock`. Keep `src-tauri/tauri.conf.json` pointing to `../package.json`; the renderer also injects that package version into Tauri/Web runtime metadata and the Settings About section. Verify the result before committing:

```bash
npm run check:release-version
```

Then run `Release Tauri Desktop` manually from the current `main` commit. A secret-free preflight job rejects version drift, a non-current `main` commit, or an existing `clawchat-v<version>` tag before any protected signing environment is entered. It also runs typecheck, frontend/script tests, migration audit, Rust core tests, and Rust formatting once; the three platform runners no longer duplicate those common checks.

The platform matrix builds and verifies Linux, Windows, and macOS independently, but it does not mutate a GitHub Release. Each runner stages only its verified installer, updater archive, and updater signature as a short-lived Actions artifact.

After all three runners succeed, one dependent publish job downloads the complete set and fails closed unless it finds exactly one required installer and updater for every supported platform. It generates a single combined `latest.json`, creates `checksums.txt` for all 11 release payload files, verifies those checksums, and only then creates one draft GitHub Release containing 12 files in total. This avoids concurrent matrix jobs overwriting a partial updater manifest. Inspect every asset, signature, `latest.json`, and `checksums.txt`, then publish the draft; clients do not see a draft release.

Tauri updater signatures are mandatory and independent from Apple notarization, Windows Authenticode, and Linux package signing, which remain a separate cutover gate.

The desktop client checks the signed feed at startup, every six hours, and after a network or
foreground resume when the previous check is at least one hour old. Users can disable background
checks or run an interactive check from Settings. The Tauri lifecycle reports
checking, available, download progress, ready-to-restart, and retryable error states; a dismissed
version stays quiet until a newer release or an explicit manual check. Installation never happens
silently because host mode may have active clients and work in progress.

The Rust updater serializes check/download/install operations, applies a 30-second manifest timeout
and a 10-minute package timeout, preserves a verified staged update across renderer reloads and
failed installation attempts, and performs installation off the UI thread. The check command also
returns update metadata directly, so correctness does not depend on an event listener becoming
ready before the native check completes. Before staging, native policy requires an HTTPS download
target without embedded credentials, bounded version/signature/release-note fields, and a package
no larger than 512 MiB. A declared or accumulated oversize package cancels the active stream rather
than buffering the remainder.

## Platform code signing

The manual release workflow is serialized and uses the protected `desktop-release` environment. It refuses to build when platform signing credentials are missing, imports credentials only into the ephemeral runner, verifies the produced artifact, and removes the imported Apple keychain or Windows certificate even when a build fails. No production certificate is stored in the repository.

### macOS Developer ID and notarization

Create and export a `Developer ID Application` certificate as a password-protected `.p12`, then configure:

- Secret `APPLE_CERTIFICATE`: `openssl base64 -A -in certificate.p12` output.
- Secret `APPLE_CERTIFICATE_PASSWORD`: the `.p12` export password.
- Secret `APPLE_ID`: the Apple Developer account email.
- Secret `APPLE_PASSWORD`: an app-specific password, not the account password.
- Secret `APPLE_TEAM_ID`: the Developer Program team ID.

The workflow uses a temporary Keychain, lets Tauri notarize and staple the DMG, then checks `codesign`, Gatekeeper (`spctl`), and the stapled notarization ticket. A free Apple Developer account cannot notarize an external Developer ID distribution.

### Windows Authenticode

Acquire a current code-signing certificate using the storage/signing mechanism required by its issuer. The checked-in workflow currently supports an exportable password-protected PFX:

- Secret `WINDOWS_CERTIFICATE`: base64-encoded PFX bytes.
- Secret `WINDOWS_CERTIFICATE_PASSWORD`: the PFX export password.
- Variable `TAURI_WINDOWS_TIMESTAMP_URL`: the timestamp service URL supplied by the certificate issuer.

The workflow imports the PFX into `Cert:\\CurrentUser\\My`, derives its SHA-1 thumbprint rather than storing it as configuration, signs with SHA-256, and requires `Get-AuthenticodeSignature` to report `Valid`. Certificates issued after June 2023 may require hardware-backed or cloud signing instead of an exportable PFX; in that case replace this import step with the issuer's Tauri `signCommand` integration.

### Linux AppImage

Configure:

- Secret `LINUX_GPG_PRIVATE_KEY`: base64-encoded exported private key.
- Secret `LINUX_GPG_PASSPHRASE`: its passphrase.
- Variable `LINUX_GPG_KEY_ID`: the published signing key ID.

The workflow enables `APPIMAGETOOL_FORCE_SIGN=1` and verifies that the resulting AppImage contains an embedded PGP signature. AppImage does not automatically validate that signature for end users, so publish the public key fingerprint through an authenticated project page. Tauri updater signatures remain the automatic integrity boundary for in-app updates.

Until real credentials are configured and the draft artifacts pass these checks, the platform code-signing migration item remains incomplete.

## Current verification status

- Renderer: 192 tests pass, including runtime adapter parity, updater lifecycle, startup diagnostics,
  localization, offline isolation, graph layout, and accessibility coverage.
- Build/release and design-system script suite: 61 tests pass, including action pinning, release
  inventory, artifact budgets, design-token and icon-contract validation, and packaged PyInstaller
  link handling. Runtime-boundary coverage rejects static, dynamic, and bracket-based native access
  from feature code.
- Rust core: 13 configuration, import/rollback, credential-key, health check, onedir resolution, and updater-policy tests pass.
- Read-only migration auditor: 3 path, configuration, and SHA-256 comparison tests pass.
- Web production build and renderer budgets pass. The current initial payload is 258.87 KiB raw / 85.67 KiB gzip; all JavaScript is 1.84 MiB against a 1.89 MiB ceiling.
- Production npm dependencies audit with zero known vulnerabilities, and 851 lockfile package
  licenses pass the reviewed allowlist.
- Tauri preview CI passes on Linux x64, Windows x64, and macOS arm64; every installer is extracted
  or mounted and its packaged FastAPI server must pass an actual health check.
- GitHub-owned checkout/setup actions are pinned to approved Node 24 revisions, and the repository
  check rejects a downgrade to legacy revisions.
- A Windows GNU source cross-check and Clippy with warnings denied pass.
- The current Rocky Linux 9.4 host cannot link a native Tauri binary because it has GLib 2.68 and lacks `webkit2gtk-4.1`/`rsvg2`; the Ubuntu Tauri CI job installs the required desktop packages.

## Post-cutover guarantees

- Frontend tests, typecheck, web build, and Tauri desktop build pass.
- Rust formatting, Clippy with warnings denied, and Rust tests pass.
- The sidecar starts, reuses a healthy instance, restarts, and terminates on all supported desktop targets.
- Closing the host window keeps the tray process alive; quitting terminates the server process tree.
- Existing configuration, database, uploads, PIN, and host/client mode survive an Electron-to-Tauri upgrade.
- Mobile clients can connect to Tauri host mode over the existing REST and WebSocket protocols.
- Installer and updater artifacts are signed and rollback has been exercised.
