# Android release and in-app update

The Android app updates itself from this repository's GitHub releases, the way
a sideloaded open-source app does. A release build lists published releases,
compares the newest `android-v*` tag against its own `versionName`, downloads
that release's APK, verifies the SHA-256 digest published beside it, and hands
the file to the system package installer.

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

### 2. Register the secrets

```bash
base64 -w0 ~/keys/clawchat-release.jks | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD   # keystore password
gh secret set ANDROID_KEY_ALIAS           # clawchat
gh secret set ANDROID_KEY_PASSWORD        # key password
```

All four are required. The release workflow fails before it builds anything if
any of them is missing, because a partially configured keystore would produce
an APK signed with a different key — one that no installed copy can accept.

### 3. Verify

```bash
gh secret list  # ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
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

3. Run **Actions → Release Android → Run workflow**. It:
   - re-runs the contract, unit-test, and lint gate,
   - builds a signed `assembleRelease` APK and a `bundleRelease` AAB,
   - verifies the APK's signing certificate and its `versionName`,
   - writes `ClawChat-<version>.apk.sha256` next to the APK,
   - creates a **draft** release tagged `android-v<version>`.

4. Compare the printed signing certificate digest with the previous release,
   then **publish the draft**. A draft is invisible to the GitHub API, so the
   in-app updater does not offer the release until you publish it.

Desktop releases live in the same repository under `clawchat-v*` and carry no
APK. The updater only considers `android-v*` tags, so the two release trains do
not interfere.

## What the app does

| Step | Behavior |
|---|---|
| Check | At launch, at most once every 12 hours, and on demand from Settings → App updates |
| Offer | A dialog with the release notes; **Download**, **Skip** (this version), or **Later** |
| Download | Into `cacheDir/updates`, with progress; the SHA-256 asset must match or the file is deleted |
| Install | `REQUEST_INSTALL_PACKAGES` + a `FileProvider` URI handed to the system installer |

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
  which uses a separate signing key and its own tag prefix.
