const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowPath = path.resolve(__dirname, '..', '.github', 'workflows', 'release-tauri.yml');

function readWorkflow() {
  return fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
}

test('preflight gates the build matrix and one dependent job publishes the release', () => {
  const workflow = readWorkflow();

  assert.doesNotMatch(workflow, /tauri-apps\/tauri-action/);
  assert.match(workflow, /\n  preflight:\n[\s\S]*?npm run check:release-version/);
  assert.match(workflow, /Desktop releases must run from the current origin\/main commit/);
  assert.match(workflow, /Release tag already exists/);
  assert.match(workflow, /\n  release:\n[\s\S]*?needs: preflight/);
  assert.match(workflow, /npx tauri build/);
  assert.match(workflow, /name: Stage verified release artifacts/);
  assert.match(workflow, /compression-level: 0/);
  assert.match(workflow, /\n  publish:\n[\s\S]*?needs: \[preflight, release\]/);
  assert.match(workflow, /actions\/download-artifact@[a-f\d]{40}/);
  assert.match(workflow, /npm run generate:tauri-release -- release-input release-artifacts/);
  assert.match(workflow, /sha256sum --check checksums\.txt/);
  assert.match(workflow, /softprops\/action-gh-release@[a-f\d]{40}/);

  const buildIndex = workflow.indexOf('npx tauri build');
  const stageIndex = workflow.indexOf('name: Stage verified release artifacts');
  const downloadIndex = workflow.indexOf('name: Download verified platform artifacts');
  const publishIndex = workflow.indexOf('name: Create one complete draft release');
  assert.ok(buildIndex < stageIndex);
  assert.ok(stageIndex < downloadIndex);
  assert.ok(downloadIndex < publishIndex);
});

test('final inventory requires every platform updater and all expected release files', () => {
  const workflow = readWorkflow();

  for (const platform of ['linux-x86_64', 'darwin-aarch64', 'windows-x86_64']) {
    assert.match(workflow, new RegExp(platform));
  }
  assert.match(workflow, /-eq 3/);
  assert.match(workflow, /-eq 12/);
  assert.match(workflow, /fail_on_unmatched_files: true/);
  assert.match(workflow, /draft: true/);
});

test('platform code signing is optional but all-or-nothing per platform', () => {
  // A first release has to be possible without a paid Apple or Windows
  // certificate. Updater signing is a separate, free, mandatory system.
  const workflow = readWorkflow();

  for (const platform of ['Apple', 'Windows', 'Linux']) {
    assert.match(
      workflow,
      new RegExp(`name: Resolve ${platform} signing configuration`),
      `${platform} signing must resolve rather than hard-fail`,
    );
  }

  // Updater signing stays mandatory.
  assert.match(workflow, /name: Validate updater signing secret presence/);
  assert.match(workflow, /TAURI_UPDATER_PUBKEY is required/);

  // Each import step only runs once its platform resolved to "enabled".
  assert.match(workflow, /Import Apple Developer ID certificate\n\s+if: runner\.os == 'macOS' && env\.APPLE_SIGNING_ENABLED == '1'/);
  assert.match(workflow, /Import Windows code-signing certificate\n\s+if: runner\.os == 'Windows' && env\.WINDOWS_SIGNING_ENABLED == '1'/);
  assert.match(workflow, /Import Linux AppImage signing key\n\s+if: runner\.os == 'Linux' && env\.LINUX_SIGNING_ENABLED == '1'/);

  // An unsigned macOS bundle still gets an ad-hoc signature, which the
  // updater needs in order to replace the app in place.
  assert.match(workflow, /Ad-hoc sign macOS build\n\s+if: runner\.os == 'macOS' && env\.APPLE_SIGNING_ENABLED != '1'/);
  assert.match(workflow, /APPLE_SIGNING_IDENTITY=-/);

  // Gatekeeper and stapler checks only apply to a notarized Developer ID build.
  assert.match(workflow, /if \[ "\$\{APPLE_SIGNING_ENABLED:-0\}" = '1' \]/);
});

test('nothing verifies a platform signature that was never produced', () => {
  // The Authenticode check ran unconditionally and failed an unsigned
  // Windows release on assets that were never meant to be signed.
  const workflow = readWorkflow();

  for (const [step, flag] of [
    ['Verify Windows Authenticode signatures', 'WINDOWS_SIGNING_ENABLED'],
    ['Verify embedded Linux AppImage signature', 'LINUX_SIGNING_ENABLED'],
  ]) {
    const guard = new RegExp(`name: ${step}\\n\\s+if: [^\\n]*env\\.${flag} == '1'`);
    assert.match(workflow, guard, `${step} must be guarded on ${flag}`);
  }
});

test('an unsigned macOS build is not handed empty Apple credentials', () => {
  // Tauri decides to notarize from the presence of these variables, and a
  // missing secret still arrives as an empty string, so the build failed with
  // "Team ID must be at least 3 characters".
  const workflow = readWorkflow();

  assert.match(
    workflow,
    /if \[ "\$\{APPLE_SIGNING_ENABLED:-0\}" != '1' \]; then\n\s+unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID/u,
  );
});

test('every job that compiles Rust installs the Linux desktop dependencies', () => {
  // The preflight job ran `npm run test:rust-core` without them and failed on
  // libdbus-sys, so no release could be cut at all.
  const workflow = readWorkflow();
  const jobs = workflow.split(/\n  (?=[a-z][a-z-]*:\n)/u);

  for (const job of jobs) {
    const compilesRust = /npm run test:rust-core|npx tauri build/u.test(job);
    if (!compilesRust) continue;
    const linuxOnly = /runs-on: ubuntu/u.test(job) || /matrix\.os/u.test(job);
    if (!linuxOnly) continue;
    assert.match(
      job,
      /apt-get install -y libwebkit2gtk-4\.1-dev libayatana-appindicator3-dev/u,
      'a job compiling Rust on Linux must install the desktop dependencies',
    );
  }
});

test('the release tag is passed under a name GitHub does not reserve', () => {
  // GITHUB_* is reserved: setting GITHUB_REF_NAME in a step's env is ignored
  // and the runner's own value wins, which for a workflow_dispatch run is the
  // dispatch ref rather than the tag being cut. The manifest step then failed
  // with "release tag main does not match package version".
  const workflow = readWorkflow();

  assert.match(
    workflow,
    /RELEASE_TAG: \$\{\{ needs\.preflight\.outputs\.tag \}\}/u,
    'the manifest step must receive the tag as RELEASE_TAG',
  );
  assert.doesNotMatch(
    workflow,
    /GITHUB_REF_NAME: \$\{\{/u,
    'a workflow cannot override a GITHUB_-prefixed variable',
  );
});
