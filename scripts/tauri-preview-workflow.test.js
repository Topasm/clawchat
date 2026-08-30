const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowPath = path.resolve(__dirname, '..', '.github', 'workflows', 'build-tauri.yml');
const smokeScriptPath = path.resolve(__dirname, 'smoke-test-tauri-macos-app.sh');
const linuxSmokeScriptPath = path.resolve(__dirname, 'smoke-test-tauri-linux-app.sh');

function readNormalized(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

test('preview artifacts contain final installers instead of Tauri bundle support files', () => {
  const workflow = readNormalized(workflowPath);

  assert.match(
    workflow,
    /preview_paths: \|\n\s+src-tauri\/target\/release\/bundle\/appimage\/\*\.AppImage\n\s+src-tauri\/target\/release\/bundle\/deb\/\*\.deb/,
  );
  assert.match(workflow, /preview_paths: src-tauri\/target\/release\/bundle\/nsis\/\*\.exe/);
  assert.match(workflow, /preview_paths: src-tauri\/target\/release\/bundle\/dmg\/\*\.dmg/);
  assert.match(workflow, /path: \$\{\{ matrix\.preview_paths \}\}/);
  assert.match(workflow, /compression-level: 0/);
  assert.doesNotMatch(workflow, /path:\s+src-tauri\/target\/release\/bundle\/\*\*/);
});

test('base Tauri config provides a deserializable disabled updater config', () => {
  const config = JSON.parse(
    readNormalized(path.resolve(__dirname, '..', 'src-tauri', 'tauri.conf.json')),
  );

  assert.deepEqual(config.plugins?.updater, { pubkey: '', endpoints: [] });
});

test('preview and release workflows launch the packaged macOS app', () => {
  const previewWorkflow = readNormalized(workflowPath);
  const releaseWorkflow = readNormalized(
    path.resolve(__dirname, '..', '.github', 'workflows', 'release-tauri.yml'),
  );
  const smokeScript = readNormalized(smokeScriptPath);

  for (const workflow of [previewWorkflow, releaseWorkflow]) {
    assert.match(workflow, /os: macos-26/);
    assert.doesNotMatch(workflow, /os: macos-14/);
    assert.match(workflow, /name: Smoke-test packaged macOS app startup/);
    assert.match(workflow, /name: Verify packaged macOS server resource/);
    assert.match(workflow, /bash scripts\/smoke-test-tauri-macos-app\.sh "\$mount_dir"/);
  }
  assert.match(smokeScript, /CFBundleExecutable/);
  assert.match(smokeScript, /CFBundleIdentifier/);
  assert.match(smokeScript, /CFBundleIconFile/);
  assert.match(smokeScript, /\/usr\/bin\/iconutil -c iconset/);
  assert.match(smokeScript, /icon_512x512@2x\.png/);
  assert.match(smokeScript, /system tray is unavailable/);
  assert.match(smokeScript, /\/usr\/bin\/open -n -W "\$app_path"/);
  assert.match(smokeScript, /tell application id/);
  assert.match(smokeScript, /ClawChat exited during the macOS startup smoke test/);
  assert.match(smokeScript, /kill -0 "\$launch_waiter_pid"/);
  assert.match(smokeScript, /python3 -m http\.server 8000 --bind 0\.0\.0\.0/);
  assert.match(smokeScript, /port_blocker_pid/);
  assert.match(smokeScript, /reused the occupied default port/);
  assert.match(smokeScript, /::error title=macOS app startup smoke failed/);
});

test('preview and release workflows launch and terminate the packaged Linux app', () => {
  const previewWorkflow = readNormalized(workflowPath);
  const releaseWorkflow = readNormalized(
    path.resolve(__dirname, '..', '.github', 'workflows', 'release-tauri.yml'),
  );
  const smokeScript = readNormalized(linuxSmokeScriptPath);

  for (const workflow of [previewWorkflow, releaseWorkflow]) {
    assert.match(workflow, /name: Smoke-test packaged Linux app startup and shutdown/);
    assert.match(workflow, /bash scripts\/smoke-test-tauri-linux-app\.sh "\$appimage"/);
    assert.match(workflow, /xdg-utils xvfb/);
  }
  assert.match(smokeScript, /\[clawchat\] local server ready on port/);
  assert.match(smokeScript, /kill -TERM "\$app_pid"/);
  assert.match(smokeScript, /survived desktop SIGTERM/);
});

test('packaged server failures are exposed as GitHub annotations', () => {
  const verifier = readNormalized(path.resolve(__dirname, 'verify-tauri-package.js'));

  assert.match(verifier, /payload\.service === 'clawchat'/);
  assert.match(verifier, /device token failed after restart/);
  assert.match(verifier, /device WebSocket failed after restart/);
  assert.match(verifier, /JWT_SECRET_FILE/);
  assert.match(verifier, /process\.env\.GITHUB_ACTIONS === 'true'/);
  assert.match(verifier, /::error title=Tauri package verification failed/);
});
