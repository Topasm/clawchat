# Android release and in-app update

The Android app updates itself from this repository's GitHub releases, the way
a sideloaded open-source app does. A release build lists published releases,
accepts the unified `clawchat-v*` tags as well as legacy `android-v*` tags,
selects the newest compatible release that carries an APK, verifies the
SHA-256 digest published beside it, and hands the file to the system package
installer.

There is no Play Store in this path, so the signing key is the entire trust
anchor: **Android only installs an update over an existing app when both APKs
were signed with the same key.** Lose the keystore and no installed copy of
ClawChat can ever be updated again — only uninstalled and reinstalled, which
deletes its local data.

## One-time setup

### 1. Generate the upload/signing keystore

Run this on a machine you trust, not in CI, and back the file up somewhere
durable:

```bash
keytool -genkeypair -v \
  -keystore ~/keys/clawchat-release.jks \
  -alias clawchat \
  -keyalg RSA -keysize 4096 -validity 10000
```

### 2. Register the signing configuration

The Android job uses the protected `android-release` GitHub Environment,
separate from the desktop job's `desktop-release` environment. Create and
protect that environment first, then store the private signing values in it:

```bash
base64 -w0 ~/keys/clawchat-release.jks | gh secret set ANDROID_KEYSTORE_BASE64 --env android-release
gh secret set ANDROID_KEYSTORE_PASSWORD --env android-release   # keystore password
gh secret set ANDROID_KEY_ALIAS --env android-release           # clawchat
gh secret set ANDROID_KEY_PASSWORD --env android-release        # key password
```

Record the certificate fingerprint separately as an Actions variable in the
same environment. Copy the `SHA256:` value printed by this command (a
colon-separated fingerprint is accepted), then set it as shown:

```bash
keytool -list -v -keystore ~/keys/clawchat-release.jks -alias clawchat
gh variable set ANDROID_SIGNING_CERT_SHA256 --env android-release --body 'AA:BB:...:FF'
```

`ANDROID_SIGNING_CERT_SHA256` is deliberately a variable, not a secret: a
certificate fingerprint is public identity, not private key material. The
workflow removes separators and normalizes case, requires exactly 64
hexadecimal digits, and compares the result with the SHA-256 signer digest
reported by `apksigner` for the built APK. A missing value, malformed value, or
different keystore fails the release before any artifact is staged.

Repository-scoped secrets and variables also resolve in this job, but the
dedicated environment is recommended so Android signing can have its own
reviewers and deployment policy.

These four keystore secret names are canonical and all four are required. For
repositories that already use the older names, the unified workflow currently
accepts these fallbacks:

| Canonical secret            | Legacy fallback             |
| --------------------------- | --------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | None                        |
| `ANDROID_KEYSTORE_PASSWORD` | `RELEASE_KEYSTORE_PASSWORD` |
| `ANDROID_KEY_ALIAS`         | `RELEASE_KEYSTORE_ALIAS`    |
| `ANDROID_KEY_PASSWORD`      | `RELEASE_KEY_PASSWORD`      |

Prefer migrating to the canonical names. The workflow fails before Gradle runs
if any resolved value is missing, because a partially configured keystore
could produce an APK signed with a different key — one that no installed copy
can accept.

### 3. Verify

```bash
gh secret list --env android-release    # the four ANDROID_KEY* secrets
gh variable list --env android-release  # ANDROID_SIGNING_CERT_SHA256
```

## Cutting a release

1. Bump the version in `package.json` and every other declaration, including
   `android/app/build.gradle.kts` `versionName`. The `versionCode` is derived
   from it (`major * 1000000 + minor * 1000 + patch`), so it rises on its own:

   ```bash
   npm run check:release-version
   ```

2. Merge to `main`. The release only runs from the current `origin/main`
   commit.

3. Run the one cross-platform release workflow:

   ```bash
   gh workflow run release-tauri.yml --ref main
   ```

   In Actions this is named **Release ClawChat**. It:
   - runs the shared release preflight,
   - builds the desktop bundles and the signed Android APK/AAB in parallel,
   - verifies the APK's signing certificate against
     `ANDROID_SIGNING_CERT_SHA256` and checks its `versionName`,
   - writes and verifies `ClawChat-<version>.apk.sha256`,
   - assembles all assets into one **draft** release tagged
     `clawchat-v<version>`.

4. Confirm that the draft contains the APK, AAB, and APK checksum alongside the
   desktop assets, then **publish the draft**. The workflow has already checked
   the APK signer against the pinned certificate fingerprint. A draft is
   invisible to the GitHub API, so the in-app updater does not offer the
   release until you publish it.

New Android and desktop builds share the `clawchat-v*` release train. The
Android updater also keeps accepting existing `android-v*` releases for
backward compatibility, but a candidate must carry an APK before it can be
offered.

## What the app does

| Step     | Behavior                                                                                    |
| -------- | ------------------------------------------------------------------------------------------- |
| Check    | At launch, at most once every 12 hours, and on demand from Settings → App updates           |
| Offer    | A dialog with the release notes; **Download**, **Skip** (this version), or **Later**        |
| Download | Into `cacheDir/updates`, with progress; the SHA-256 asset must match or the file is deleted |
| Install  | `REQUEST_INSTALL_PACKAGES` + a `FileProvider` URI handed to the system installer            |

Users can turn automatic checks off in Settings; the manual **Check now**
button keeps working either way. A skipped version stops prompting until a
newer one is published.

Debug builds are signed with the debug key, so a released APK cannot install
over one. The updater is therefore compiled out of debug builds; to exercise it
while working on the updater itself:

```bash
cd android && ./gradlew assembleDebug -PUPDATE_CHECK_IN_DEBUG=true
```

A fork publishing its own releases points the updater at its own repository:

```bash
./gradlew assembleRelease -PUPDATE_REPOSITORY=your-org/your-fork
```

## Related

- [Desktop release and auto-update](./desktop-release.md) — the Tauri updater,
  which shares the release and tag but uses an independent signing key.
