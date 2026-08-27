# Platform Matrix

This matrix is the product boundary for new work. A platform marked deprecated may remain in the repository during migration, but new product behavior must not be added to it.

| Target | Policy | Product role | Release validation |
|---|---|---|---|
| Web | Primary | Browser client and fastest product feedback loop | Typecheck, unit tests, renderer build, E2E |
| Tauri 2 | Primary | Windows, macOS, and Linux desktop; embedded FastAPI host/client modes | Rust tests, sidecar smoke test, signed package checks |
| Native Android | Primary | Mobile UX, widgets, notifications, background work, and offline cache | Gradle unit tests, lint, debug/release build |
| Capacitor iOS | Provisional | Reuses the React client until native iOS priority is decided | iOS sync/build when release work starts |
| Capacitor Android | Deprecated | Transitional artifact only; native Android is canonical | No new features; remove after iOS config is separated |
| Electron | Retired | Read-only legacy data import source | Import/audit regression tests only |

Web/Tauri and native Android share the server contract, not UI implementation. FastAPI OpenAPI is the contract source; generated client enums and CI drift checks keep wire values aligned.
