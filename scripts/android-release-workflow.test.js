const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parse } = require('yaml');

const projectRoot = path.resolve(__dirname, '..');
const workflowPath = path.join(projectRoot, '.github', 'workflows', 'release-tauri.yml');
const legacyWorkflowPath = path.join(projectRoot, '.github', 'workflows', 'release-android.yml');
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

test('builds Android inside the one cross-platform release workflow', () => {
  const workflow = readWorkflow();
  const jobs = parse(workflow).jobs;

  assert.equal(fs.existsSync(legacyWorkflowPath), false);
  assert.match(workflow, /^name: Release ClawChat$/m);
  assert.match(workflow, /\n  android:\n[\s\S]*?needs: preflight/);
  assert.equal(jobs.android.environment, 'android-release');
  assert.equal(jobs.release.environment, 'desktop-release');
  assert.match(workflow, /name: ClawChat-release-android/);
  assert.match(workflow, /\n  publish:\n[\s\S]*?needs: \[preflight, release, android\]/);
});

test('refuses to build without complete signing configuration and supports secret aliases', () => {
  const workflow = readWorkflow();

  for (const secret of [
    'ANDROID_KEYSTORE_BASE64',
    'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD',
  ]) {
    assert.match(workflow, new RegExp(`test -n "\\$${secret}"`));
  }
  assert.match(
    workflow,
    /ANDROID_KEYSTORE_PASSWORD: \$\{\{ secrets\.ANDROID_KEYSTORE_PASSWORD \|\| secrets\.RELEASE_KEYSTORE_PASSWORD \}\}/,
  );
  assert.match(
    workflow,
    /ANDROID_KEY_ALIAS: \$\{\{ secrets\.ANDROID_KEY_ALIAS \|\| secrets\.RELEASE_KEYSTORE_ALIAS \}\}/,
  );
  assert.match(
    workflow,
    /ANDROID_KEY_PASSWORD: \$\{\{ secrets\.ANDROID_KEY_PASSWORD \|\| secrets\.RELEASE_KEY_PASSWORD \}\}/,
  );
  assert.match(
    workflow,
    /ANDROID_SIGNING_CERT_SHA256: \$\{\{ vars\.ANDROID_SIGNING_CERT_SHA256 \}\}/,
  );
  assert.match(workflow, /test -n "\$ANDROID_SIGNING_CERT_SHA256"/);
  assert.match(
    workflow,
    /printf '%s' "\$ANDROID_SIGNING_CERT_SHA256"[\s\S]*?tr -d '\[:space:\]:-'[\s\S]*?tr '\[:upper:\]' '\[:lower:\]'/,
  );
  assert.match(workflow, /\^\[0-9a-f\]\{64\}\$/);
  assert.match(
    workflow,
    /printf 'ANDROID_SIGNING_CERT_SHA256_NORMALIZED=%s\\n'[\s\S]*?"\$expected_signing_cert_sha256" >> "\$GITHUB_ENV"/,
  );

  const validationIndex = workflow.indexOf('Validate Android release signing configuration');
  const gradleIndex = workflow.indexOf('./gradlew testDebugUnitTest');
  assert.ok(validationIndex >= 0 && validationIndex < gradleIndex);
});

test('publishes Android from the current main commit under the shared release tag', () => {
  const workflow = readWorkflow();

  assert.match(workflow, /npm run check:release-version/);
  assert.match(workflow, /ClawChat releases must run from the current origin\/main commit\./);
  assert.match(workflow, /tag="clawchat-v\$version"/);
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

test('pins the APK signer fingerprint and verifies the AAB signature and released version', () => {
  const workflow = readWorkflow();

  assert.match(workflow, /apksigner" verify --verbose --print-certs "\$apk"/);
  assert.match(
    workflow,
    /sed -nE 's\/\^Signer #1 certificate SHA-256 digest: \(\[0-9a-fA-F\]\{64\}\)\$\/\\1\/p'/,
  );
  assert.match(
    workflow,
    /if \[\[ "\$actual_signing_cert_sha256" != "\$ANDROID_SIGNING_CERT_SHA256_NORMALIZED" \]\]; then[\s\S]*?exit 1[\s\S]*?fi/,
  );
  assert.match(workflow, /jarsigner -verify -verbose -certs "\$aab"/);
  assert.match(workflow, /grep -F 'jar verified\.'/);
  assert.match(workflow, /aapt2" dump badging "\$apk" \| grep -F "versionName='\$VERSION'"/);

  const signerVerificationIndex = workflow.indexOf(
    'APK signing certificate does not match ANDROID_SIGNING_CERT_SHA256',
  );
  const artifactStagingIndex = workflow.indexOf('Stage verified Android release artifacts');
  assert.ok(signerVerificationIndex >= 0 && signerVerificationIndex < artifactStagingIndex);
});

test('publishes the assets the in-app updater looks for', () => {
  const workflow = readWorkflow();

  assert.match(workflow, /release-android-artifacts\/ClawChat-\$VERSION\.apk/);
  assert.match(workflow, /release-android-artifacts\/ClawChat-\$VERSION\.aab/);
  assert.match(workflow, /sha256sum "ClawChat-\$VERSION\.apk" > "ClawChat-\$VERSION\.apk\.sha256"/);
  assert.match(workflow, /sha256sum --check "ClawChat-\$VERSION\.apk\.sha256"/);
  assert.match(workflow, /tag_name: \$\{\{ needs\.preflight\.outputs\.tag \}\}/);
  assert.match(
    workflow,
    /test -s "release-artifacts\/ClawChat-\$\{\{ needs\.preflight\.outputs\.version \}\}\.apk"/,
  );
  assert.match(workflow, /fail_on_unmatched_files: true/);
  assert.match(workflow, /files: release-artifacts\/\*/);
});

test('the Android updater accepts the shared tag and the legacy tag', () => {
  const workflow = readWorkflow();
  const appVersion = read(path.join(updaterSourceDir, 'AppVersion.kt'));

  const shared = /const val CLAWCHAT_RELEASE_TAG_PREFIX = "([^"]+)"/.exec(appVersion);
  const legacy = /const val ANDROID_RELEASE_TAG_PREFIX = "([^"]+)"/.exec(appVersion);
  assert.equal(shared?.[1], 'clawchat-v');
  assert.equal(legacy?.[1], 'android-v');
  assert.ok(workflow.includes(`tag="${shared[1]}$version"`));
});

test('the checksum asset name matches the suffix the updater resolves', () => {
  const selection = read(path.join(updaterSourceDir, 'AvailableUpdate.kt'));

  assert.match(selection, /const val APK_SUFFIX = "\.apk"/);
  assert.match(selection, /const val CHECKSUM_SUFFIX = "\.sha256"/);
});
