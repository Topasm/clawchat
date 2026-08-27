# Electron to Tauri cutover — completed

The fallback Electron shell was removed on 2026-08-27. Tauri is the only desktop runtime. The
legacy data importer and its audit fixtures remain supported so existing installations can move
their data into Tauri without modifying the source directory.

## Production rollout gate

Source removal is complete, but production distribution must remain blocked until all of the
following are evidenced on Windows, macOS, and Linux:

- Signed installers and updater artifacts install, update, restart, and roll back successfully.
- Electron user data imports idempotently and the read-only migration audit passes.
- Host/client mode, tray lifecycle, notifications, secure storage, deep links, and auto-update have
  parity in packaged Tauri builds.
- Mobile clients reconnect to a Tauri host over REST, WebSocket, and relay fallback.
- The previous Electron release can still open its untouched source data after a Tauri rollback.
- CI package smoke tests and artifact budgets pass for all three target platforms.

## Removal change set

The completed cutover removed these items together:

1. `electron/`, `.github/workflows/build-electron.yml`, `electron-builder.yml`, and
   `tsconfig.electron.json`.
2. `dev:electron`, `build:electron`, and the Electron `package` script.
3. `electron`, `electron-builder`, `electron-updater`, and both Vite Electron plugins.
4. The Electron branch in `vite.config.ts`, `src/app/platform/electronPlatformApi.ts`, its tests,
   and `src/app/types/electron.d.ts`.
5. Electron runtime kinds and detection only after no persisted setting or migration code relies on
   those identifiers.
6. Outdated architecture, deployment, and frontend documentation.

Do not delete the Electron data importer or its audit fixtures at cutover. They remain part of the
upgrade path for users installing Tauri over an older Electron release.

`npm run check:runtime-boundary` now rejects every Electron bridge or runtime-package reference in
active TypeScript source. Migration documentation, Rust import code, and audit fixtures are retained.
