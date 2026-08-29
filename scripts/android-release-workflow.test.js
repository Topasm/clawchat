const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const workflowPath = path.join(projectRoot, '.github', 'workflows', 'release-android.yml');
const updaterSourceDir = path.join(
  projectRoot,
  'android',
  'core',
  'src',
  'main',
  'java',
  'com',
  'clawchat',
  'android',
  'core',
  'update',
);

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function readWorkflow() {
  return read(workflowPath);
}

test('refuses to build without a complete release keystore', () => {
  const workflow = readWorkflow();

  for (const secret of [
    'ANDROID_KEYSTORE_BASE64',
    'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD',
  ]) {
    assert.match(workflow, new RegExp(`test -n "\\$${secret}"`));
  }

  const validationIndex = workflow.indexOf('Validate release signing secrets');
  const gradleIndex = workflow.indexOf('./gradlew testDebugUnitTest');
  assert.ok(validationIndex >= 0 && validationIndex < gradleIndex);
});

test('publishes from the current main commit under a new android tag', () => {
  const workflow = readWorkflow();

  assert.match(workflow, /npm run check:release-version/);
  assert.match(workflow, /Android releases must run from the current origin\/main commit\./);
  assert.match(workflow, /tag="android-v\$version"/);
  assert.match(workflow, /Release tag already exists: \$tag/);
});

test('runs the same test and lint gate as the pull-request build', () => {
  const workflow = readWorkflow();

  assert.match(workflow, /node scripts\/generate-api-contracts\.js --check/);
  assert.match(
    workflow,
    /\.\/gradlew testDebugUnitTest lintDebug lintRelease assembleRelease bundleRelease --warning-mode all/,
  );
});

test('verifies the built APK is signed and carries the released version', () => {
  const workflow = readWorkflow();

  assert.match(workflow, /apksigner" verify --print-certs "\$apk"/);
  assert.match(workflow, /aapt2" dump badging "\$apk" \| grep -F "versionName='\$VERSION'"/);
});

test('publishes the assets the in-app updater looks for', () => {
  const workflow = readWorkflow();

  assert.match(workflow, /release-artifacts\/ClawChat-\$VERSION\.apk/);
  assert.match(workflow, /sha256sum "ClawChat-\$VERSION\.apk" > "ClawChat-\$VERSION\.apk\.sha256"/);
  assert.match(workflow, /sha256sum --check "ClawChat-\$VERSION\.apk\.sha256"/);
  assert.match(workflow, /tag_name: \$\{\{ steps\.release\.outputs\.tag \}\}/);
  assert.match(workflow, /fail_on_unmatched_files: true/);
  assert.match(workflow, /files: release-artifacts\/\*/);
});

test('the published tag prefix is the one the Android updater filters on', () => {
  const workflow = readWorkflow();
  const appVersion = read(path.join(updaterSourceDir, 'AppVersion.kt'));

  const declared = /const val ANDROID_RELEASE_TAG_PREFIX = "([^"]+)"/.exec(appVersion);
  assert.ok(declared, 'ANDROID_RELEASE_TAG_PREFIX is not declared in AppVersion.kt');
  assert.equal(declared[1], 'android-v');
  assert.ok(workflow.includes(`tag="${declared[1]}$version"`));
});

test('the checksum asset name matches the suffix the updater resolves', () => {
  const selection = read(path.join(updaterSourceDir, 'AvailableUpdate.kt'));

  assert.match(selection, /const val APK_SUFFIX = "\.apk"/);
  assert.match(selection, /const val CHECKSUM_SUFFIX = "\.sha256"/);
});
