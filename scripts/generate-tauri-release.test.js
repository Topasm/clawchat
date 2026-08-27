const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { PLATFORM_DIRECTORIES, generateTauriRelease } = require('./generate-tauri-release');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawchat-release-'));
  const artifactsDir = path.join(root, 'input');
  const outputDir = path.join(root, 'output');
  const write = (platform, name, content = name) => {
    const directory = path.join(artifactsDir, PLATFORM_DIRECTORIES[platform]);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, name), content);
  };

  write('linux', 'ClawChat.AppImage');
  write('linux', 'ClawChat.deb');
  write('linux', 'ClawChat.AppImage.tar.gz');
  write('linux', 'ClawChat.AppImage.tar.gz.sig', 'linux-signature\n');
  write('macos', 'ClawChat.dmg');
  write('macos', 'ClawChat.app.tar.gz');
  write('macos', 'ClawChat.app.tar.gz.sig', 'mac-signature\n');
  write('windows', 'ClawChat.exe');
  write('windows', 'ClawChat.nsis.zip');
  write('windows', 'ClawChat.nsis.zip.sig', 'windows-signature\n');

  return {
    root,
    artifactsDir,
    outputDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function generate(project) {
  return generateTauriRelease({
    artifactsDir: project.artifactsDir,
    outputDir: project.outputDir,
    version: '1.2.3',
    tag: 'clawchat-v1.2.3',
    repository: 'example/clawchat',
    publishedAt: new Date('2026-08-27T00:00:00.000Z'),
  });
}

test('builds one complete cross-platform updater manifest and checksum file', () => {
  const project = fixture();
  try {
    const { manifest, releaseFiles } = generate(project);
    assert.deepEqual(Object.keys(manifest.platforms), [
      'linux-x86_64',
      'darwin-aarch64',
      'windows-x86_64',
    ]);
    assert.equal(manifest.platforms['linux-x86_64'].signature, 'linux-signature');
    assert.match(
      manifest.platforms['darwin-aarch64'].url,
      /darwin-aarch64-ClawChat\.app\.tar\.gz$/,
    );
    assert.equal(releaseFiles.length, 12);

    const checksumPath = path.join(project.outputDir, 'checksums.txt');
    const checksumLines = fs.readFileSync(checksumPath, 'utf8').trim().split('\n');
    assert.equal(checksumLines.length, 11);
    assert.ok(checksumLines.some((line) => line.endsWith('  latest.json')));
    assert.ok(!checksumLines.some((line) => line.endsWith('  checksums.txt')));
    for (const line of checksumLines) {
      const [, digest, filename] = line.match(/^([a-f\d]{64})  (.+)$/);
      const actual = crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(project.outputDir, filename)))
        .digest('hex');
      assert.equal(digest, actual);
    }
  } finally {
    project.cleanup();
  }
});

test('fails closed when an installer, updater, or updater signature is missing', () => {
  for (const [platform, file, expected] of [
    ['linux', 'ClawChat.deb', /Linux DEB installer, found 0/],
    ['macos', 'ClawChat.app.tar.gz', /macOS updater archive, found 0/],
    ['windows', 'ClawChat.nsis.zip.sig', /missing updater signature/],
  ]) {
    const project = fixture();
    try {
      fs.unlinkSync(path.join(project.artifactsDir, PLATFORM_DIRECTORIES[platform], file));
      assert.throws(() => generate(project), expected);
    } finally {
      project.cleanup();
    }
  }
});

test('rejects empty signatures, duplicate artifacts, stale output, and mismatched tags', () => {
  const emptySignature = fixture();
  try {
    fs.writeFileSync(
      path.join(
        emptySignature.artifactsDir,
        PLATFORM_DIRECTORIES.linux,
        'ClawChat.AppImage.tar.gz.sig',
      ),
      ' \n',
    );
    assert.throws(() => generate(emptySignature), /signature is empty/);
  } finally {
    emptySignature.cleanup();
  }

  const duplicate = fixture();
  try {
    fs.writeFileSync(
      path.join(duplicate.artifactsDir, PLATFORM_DIRECTORIES.windows, 'Second.exe'),
      'duplicate',
    );
    assert.throws(() => generate(duplicate), /Windows NSIS installer, found 2/);
  } finally {
    duplicate.cleanup();
  }

  const stale = fixture();
  try {
    fs.mkdirSync(stale.outputDir);
    fs.writeFileSync(path.join(stale.outputDir, 'stale.txt'), 'stale');
    assert.throws(() => generate(stale), /output directory is not empty/);
  } finally {
    stale.cleanup();
  }

  const identity = fixture();
  try {
    assert.throws(
      () =>
        generateTauriRelease({
          artifactsDir: identity.artifactsDir,
          outputDir: identity.outputDir,
          version: '1.2.3',
          tag: 'clawchat-v1.2.4',
          repository: 'example/clawchat',
        }),
      /does not match package version/,
    );
  } finally {
    identity.cleanup();
  }
});
