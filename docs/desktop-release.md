# Desktop release and auto-update

ClawChat desktop updates itself through the Tauri updater. A release build
embeds an Ed25519 public key and an update endpoint; the running app polls that
endpoint, verifies the signature of any newer bundle against the embedded key,
and installs it.

Two different signing systems are involved, and they are independent:

| | Purpose | Required? | Cost |
|---|---|---|---|
| **Updater signing** | Proves an update came from you. The app refuses unsigned updates. | **Yes** | Free |
| **Platform code signing** | Stops Gatekeeper / SmartScreen warnings at install time. | No | Paid (Apple $99/yr, Windows cert) |

Without platform signing the release still builds and auto-update still works.
Users see an OS warning the first time they install. That is the expected state
for an early release.

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

## Optional: platform code signing

Each platform is all-or-nothing: configure every value for a platform, or none
of them. A partial configuration fails the release rather than silently
producing an unsigned build.

| Platform | Secrets | Variables |
|---|---|---|
| macOS | `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | — |
| Windows | `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD` | `TAURI_WINDOWS_TIMESTAMP_URL` |
| Linux (AppImage GPG) | `LINUX_GPG_PRIVATE_KEY`, `LINUX_GPG_PASSPHRASE` | `LINUX_GPG_KEY_ID` |

When macOS signing is absent the app is ad-hoc signed instead. That is not a
trust anchor, but it is a valid signature, which the macOS updater needs to
replace the bundle in place.

## Cutting a release

1. Bump the version. It must match in all nine declarations; the check tells you
   if it does not:

   ```bash
   npm run check:release-version
   ```

2. Land that on `main`. The release refuses to run from any other commit.

3. Run the workflow:

   ```bash
   gh workflow run release-tauri.yml --ref main
   ```

4. The workflow builds Linux x64, Windows x64, and macOS arm64, verifies each
   bundle, assembles `latest.json` plus `checksums.txt`, and opens a **draft**
   GitHub release tagged `clawchat-v<version>`.

5. Review the draft, then publish it. Auto-update only starts working once the
   release is published, because the endpoint points at `releases/latest`.

## Verifying auto-update actually works

Auto-update cannot be proven by a single release: the running app has to find a
*newer* one. After publishing the first release, install it, then publish a
second with a bumped version and confirm the installed copy offers it.

Until a second release exists, the first one's updater is configured but
untested.
