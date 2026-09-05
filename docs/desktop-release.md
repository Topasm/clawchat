# Desktop release and auto-update

ClawChat desktop updates itself through the Tauri updater. A release build
embeds an Ed25519 public key and an update endpoint; the running app polls that
endpoint, verifies the signature of any newer bundle against the embedded key,
and installs it. The same manual release workflow also builds Android and puts
all supported platforms in one GitHub release.

Two different signing systems are involved, and they are independent:

|                           | Purpose                                                           | Required? | Cost                              |
| ------------------------- | ----------------------------------------------------------------- | --------- | --------------------------------- |
| **Updater signing**       | Proves an update came from you. The app refuses unsigned updates. | **Yes**   | Free                              |
| **Platform code signing** | Establishes app identity for Keychain and OS installation checks. | macOS by default | Developer certificate |

Normal releases require macOS Developer ID signing and notarization. Temporary
ad-hoc macOS builds require an explicit workflow opt-in. Updater signatures alone
do not preserve the identity macOS uses to authorize Keychain access.

## One-time setup

### 1. Generate the updater key pair

Run this on a machine you trust, not in CI and not in a shared session. The
private key is a long-lived identity: **if you lose it, no already-installed
copy of ClawChat can ever be updated again.** Back it up somewhere durable.

```bash
npx tauri signer generate -w ~/.tauri/clawchat.key
```

It prompts for a password and writes two files:

- `~/.tauri/clawchat.key` — private key. Never commit this.
- `~/.tauri/clawchat.key.pub` — public key. Safe to share.

### 2. Register the secrets

```bash
# Private key and its password — secrets.
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/clawchat.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD   # paste the password

# Public key — a variable, because it is embedded in the shipped binary.
gh variable set TAURI_UPDATER_PUBKEY < ~/.tauri/clawchat.key.pub
```

Leave `TAURI_UPDATER_ENDPOINT` unset. The release config then defaults to
`https://github.com/<owner>/<repo>/releases/latest/download/latest.json`,
which is where the publish job uploads the manifest.

### 3. Verify

```bash
gh secret list    # TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD
gh variable list  # TAURI_UPDATER_PUBKEY
```

The unified release also requires Android signing credentials. Configure the
canonical `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` secrets in the separate
`android-release` GitHub Environment. Existing repositories may temporarily
keep `RELEASE_KEYSTORE_PASSWORD`,
`RELEASE_KEYSTORE_ALIAS`, and `RELEASE_KEY_PASSWORD` as fallbacks for the last
three values; `ANDROID_KEYSTORE_BASE64` has no legacy fallback. Also set the
public signing-certificate fingerprint as the required
`ANDROID_SIGNING_CERT_SHA256` Actions variable in that environment; the
Android job fails if the built APK was signed by another key. Repository-level
configuration also resolves, but does not provide the same independent
protection policy. See
[Android release and in-app update](./android-release.md) for keystore setup.

## Platform code signing

Each platform is all-or-nothing: configure every value for a platform, or none
of them. A partial configuration fails the release rather than silently
producing an unsigned build. Windows and Linux platform signing remain optional;
macOS requires all five secrets by default.

| Platform             | Secrets                                                                                          | Variables                     |
| -------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------- |
| macOS                | `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | —                             |
| Windows              | `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`                                            | `TAURI_WINDOWS_TIMESTAMP_URL` |
| Linux (AppImage GPG) | `LINUX_GPG_PRIVATE_KEY`, `LINUX_GPG_PASSPHRASE`                                                  | `LINUX_GPG_KEY_ID`            |

### macOS: keep Keychain approval across updates

ClawChat stores login credentials in the Keychain service
`com.clawchat.desktop.auth`. Ad-hoc signing identifies a specific build, so
replacing it can trigger another access prompt even after **Always Allow**.
An app setting cannot grant macOS approval on the user's behalf. Do not disable
Keychain protection or grant all applications access to this item.

One-time maintainer setup in GitHub **Settings → Environments → desktop-release →
Environment secrets**:

1. Obtain a **Developer ID Application** certificate with its private key using
   the Apple Developer account that will own future releases.
2. Export it as a password-protected `.p12` on a trusted Mac. Store its Base64
   contents in `APPLE_CERTIFICATE` and its export password in
   `APPLE_CERTIFICATE_PASSWORD`. Never commit either value or paste them in chat.
3. Set `APPLE_ID`, an app-specific password in `APPLE_PASSWORD`, and the owning
   `APPLE_TEAM_ID` for notarization. Do not use the Apple account's login password.
4. Keep the same team, bundle identifier and compatible signing requirements
   across releases. Keep the Keychain service name unchanged. The workflow
   imports the certificate into a temporary keychain, signs and notarizes, then
   verifies the bundle, Gatekeeper assessment and stapled DMG ticket.

The transition from an ad-hoc build may need one more **Always Allow** approval.
Verify on a Mac with two consecutive Developer ID releases: sign in, approve
Keychain access, update in place, then relaunch and confirm that login restores
without another access prompt. Check both the in-app updater and a DMG replacement
in `/Applications`. A locked/reset Keychain or changed signing identity can still
require approval; this is not a promise to suppress all system prompts.

If a temporary ad-hoc build is deliberately needed with **no** Apple secrets set:

```bash
gh workflow run release-tauri.yml --ref main -f allow_ad_hoc_macos=true
```

This exception does **not** fix repeated Keychain prompts and does not permit a
partial Apple configuration. Disclose the limitation before publishing its draft.
The separate preview workflow remains ad-hoc signed for development.

References: [Apple code signing requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements),
[Tauri macOS signing setup](https://v2.tauri.app/distribute/sign/macos/).

## Cutting a release

1. Bump the version. It must match in all ten declarations, including the
   `server/uv.lock` project package entry; the check tells you if it does not:

   ```bash
   npm run check:release-version
   ```

2. Land that on `main`. The release refuses to run from any other commit.

3. Run the workflow:

   ```bash
   gh workflow run release-tauri.yml --ref main
   ```

4. The **Release ClawChat** workflow builds Linux x64, Windows x64, macOS
   arm64, and signed Android APK/AAB artifacts. It verifies every platform,
   assembles `latest.json` plus `checksums.txt`, and opens one **draft** GitHub
   release tagged `clawchat-v<version>`.

   The final inventory is exactly 13 assets: eight desktop files, the Android
   APK/AAB/APK checksum, `latest.json`, and `checksums.txt`. The checksum file
   covers the other 12 assets.

5. Review the draft, then publish it. Auto-update only starts working once the
   release is published, because the endpoint points at `releases/latest`.

## Verifying auto-update actually works

Auto-update cannot be proven by a single release: the running app has to find a
_newer_ one. After publishing the first release, install it, then publish a
second with a bumped version and confirm the installed copy offers it.

Until a second release exists, the first one's updater is configured but
untested.
