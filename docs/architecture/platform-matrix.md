# Platform Matrix

This matrix is the product boundary for new work. A platform marked deprecated may remain in the repository during migration, but new product behavior must not be added to it.

| Target | Policy | Product role | Release validation |
|---|---|---|---|
| Web | Primary | Browser client and fastest product feedback loop | Typecheck, unit tests, renderer build, E2E |
| Tauri 2 | Primary | Windows, macOS, and Linux desktop; embedded FastAPI host/client modes | Rust tests, sidecar smoke test, signed package checks |
| Native Android | Primary | Standalone local todo workspace or connected capture, monitor, approve, and intervene UX; includes widgets, notifications, background work, and Korean UI | Gradle unit tests, lint, Room migrations, debug/release build, signed release APK checks |
| Capacitor (iOS/Android) | Removed | Removed from the repository; iOS is not a supported target | None |
| Electron | Retired | Read-only legacy data import source | Import/audit regression tests only |

Web/Tauri and Android's connected mode share the server contract, not UI implementation. FastAPI OpenAPI is the contract source; generated client enums and CI drift checks keep wire values aligned. Android local mode remains device-owned and does not make server requests.
