const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowPath = path.resolve(__dirname, '..', '.github', 'workflows', 'build-android.yml');

function readWorkflow() {
  return fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
}

test('gates Android compilation on generated API contract drift', () => {
  const workflow = readWorkflow();

  assert.match(workflow, /actions\/setup-node@[a-f\d]{40}/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /node scripts\/generate-api-contracts\.js --check/);

  const contractIndex = workflow.indexOf('node scripts/generate-api-contracts.js --check');
  const gradleIndex = workflow.indexOf('./gradlew testDebugUnitTest');
  assert.ok(contractIndex >= 0 && contractIndex < gradleIndex);
});

test('keeps tests, lint, installable debug output, and the release bundle in one gate', () => {
  const workflow = readWorkflow();

  assert.match(
    workflow,
    /\.\/gradlew testDebugUnitTest lintDebug assembleDebug bundleRelease --warning-mode all/,
  );
  assert.match(workflow, /android\/app\/build\/outputs\/apk\/debug\/app-debug\.apk/);
  assert.match(workflow, /android\/app\/build\/outputs\/bundle\/release\/app-release\.aab/);
});

