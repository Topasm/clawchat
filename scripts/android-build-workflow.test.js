const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowPath = path.resolve(__dirname, '..', '.github', 'workflows', 'build-android.yml');

function readWorkflow() {
  return fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
}

test('uses the shared release tag prefix', () => {
  assert.match(readWorkflow(), /tags: \['clawchat-v\*'\]/);
});

test('gates Android compilation on generated API contract drift', () => {
  const workflow = readWorkflow();

  assert.match(workflow, /actions\/setup-node@[a-f\d]{40}/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /node scripts\/generate-api-contracts\.js --check/);

  const contractIndex = workflow.indexOf('node scripts/generate-api-contracts.js --check');
  const gradleIndex = workflow.indexOf('./gradlew testDebugUnitTest');
  assert.ok(contractIndex >= 0 && contractIndex < gradleIndex);
});

test('keeps tests, debug and release lint, installable debug output, and the release bundle in one gate', () => {
  const workflow = readWorkflow();

  assert.match(
    workflow,
    /\.\/gradlew testDebugUnitTest lintDebug lintRelease assembleDebug assembleRelease bundleRelease --warning-mode all/,
  );
  assert.match(workflow, /android\/app\/build\/outputs\/apk\/debug\/app-debug\.apk/);
  assert.match(workflow, /android\/app\/build\/outputs\/bundle\/release\/app-release\.aab/);
});

test('checks widget callback constructors in optimized APKs before uploading or publishing', () => {
  for (const [filename, apk, nextStep] of [
    ['build-android.yml', 'app-release-unsigned.apk', 'name: Upload Android artifacts'],
    ['release-tauri.yml', 'app-release.apk', 'name: Stage verified Android release artifacts'],
  ]) {
    const workflow = fs.readFileSync(path.join(path.dirname(workflowPath), filename), 'utf8');
    const checkIndex = workflow.indexOf(
      `bash scripts/check-android-widget-callbacks.sh android/app/build/outputs/apk/release/${apk}`,
    );
    const buildIndex = workflow.indexOf('./gradlew testDebugUnitTest');
    assert.ok(buildIndex >= 0 && checkIndex > buildIndex, filename);
    assert.ok(checkIndex < workflow.indexOf(nextStep), filename);
  }
});
