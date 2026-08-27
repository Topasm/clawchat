const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { validateServerBundle } = require('./server-bundle-manifest');

function sha256(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function executableHeader() {
  if (process.platform === 'win32') return Buffer.from('MZ\0\0');
  if (process.platform === 'darwin') return Buffer.from('cffaedfe', 'hex');
  return Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
}

function createFixture() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clawchat-server-bundle-'));
  const bundleRoot = path.join(temporaryRoot, 'server-bin');
  const internalRoot = path.join(bundleRoot, '_internal');
  fs.mkdirSync(internalRoot, { recursive: true });

  const executableName = process.platform === 'win32' ? 'clawchat-server.exe' : 'clawchat-server';
  const executable = Buffer.concat([executableHeader(), Buffer.from('fixture')]);
  const runtime = Buffer.from('runtime-library');
  fs.writeFileSync(path.join(bundleRoot, executableName), executable);
  fs.writeFileSync(path.join(internalRoot, 'runtime.bin'), runtime);
  if (process.platform !== 'win32') fs.chmodSync(path.join(bundleRoot, executableName), 0o755);

  const files = [
    {
      path: '_internal/runtime.bin',
      type: 'file',
      size: runtime.length,
      sha256: sha256(runtime),
    },
    {
      path: executableName,
      type: 'file',
      size: executable.length,
      sha256: sha256(executable),
    },
  ];
  const manifest = {
    schemaVersion: 1,
    bundleType: 'pyinstaller-onedir',
    platform: process.platform,
    architecture: process.arch,
    executable: executableName,
    files,
  };
  const manifestPath = path.join(bundleRoot, 'bundle-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    bundleRoot,
    internalRoot,
    manifest,
    manifestPath,
    cleanup: () => fs.rmSync(temporaryRoot, { recursive: true, force: true }),
  };
}

test('validates a complete server bundle and its hashes', () => {
  const fixture = createFixture();
  try {
    const result = validateServerBundle(fixture.bundleRoot);
    assert.equal(result.fileCount, 2);
    assert.ok(result.totalBytes > 0);
  } finally {
    fixture.cleanup();
  }
});

test('rejects a server file changed after manifest creation', () => {
  const fixture = createFixture();
  try {
    fs.writeFileSync(path.join(fixture.internalRoot, 'runtime.bin'), 'changed-library');
    assert.throws(() => validateServerBundle(fixture.bundleRoot), /SHA-256 mismatch/);
  } finally {
    fixture.cleanup();
  }
});

test('rejects files that are absent from the manifest', () => {
  const fixture = createFixture();
  try {
    fs.writeFileSync(path.join(fixture.internalRoot, 'unexpected.bin'), 'unexpected');
    assert.throws(() => validateServerBundle(fixture.bundleRoot), /file set mismatch/);
  } finally {
    fixture.cleanup();
  }
});

test('rejects unsafe paths before reading bundle files', () => {
  const fixture = createFixture();
  try {
    fixture.manifest.files[0].path = '../outside.bin';
    fs.writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
    assert.throws(() => validateServerBundle(fixture.bundleRoot), /unsafe file path/);
  } finally {
    fixture.cleanup();
  }
});

test('validates contained PyInstaller symlinks on Unix', { skip: process.platform === 'win32' }, () => {
  const fixture = createFixture();
  try {
    const linkPath = path.join(fixture.internalRoot, 'runtime-link.bin');
    fs.symlinkSync('runtime.bin', linkPath);
    fixture.manifest.files.splice(1, 0, {
      path: '_internal/runtime-link.bin',
      type: 'symlink',
      target: 'runtime.bin',
    });
    fixture.manifest.files.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
    fs.writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
    assert.equal(validateServerBundle(fixture.bundleRoot).fileCount, 3);
  } finally {
    fixture.cleanup();
  }
});

test(
  'validates packaged PyInstaller symlinks materialized as identical files on Unix',
  { skip: process.platform === 'win32' },
  () => {
    const fixture = createFixture();
    try {
      const linkPath = path.join(fixture.internalRoot, 'runtime-link.bin');
      fs.copyFileSync(path.join(fixture.internalRoot, 'runtime.bin'), linkPath);
      fixture.manifest.files.splice(1, 0, {
        path: '_internal/runtime-link.bin',
        type: 'symlink',
        target: 'runtime.bin',
      });
      fixture.manifest.files.sort((left, right) =>
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
      );
      fs.writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));

      assert.throws(() => validateServerBundle(fixture.bundleRoot), /not a valid symbolic link/);
      assert.equal(
        validateServerBundle(fixture.bundleRoot, { allowMaterializedSymlinks: true }).fileCount,
        3,
      );

      fs.writeFileSync(linkPath, 'changed-library');
      assert.throws(
        () => validateServerBundle(fixture.bundleRoot, { allowMaterializedSymlinks: true }),
        /materialized symbolic link content mismatch/,
      );
    } finally {
      fixture.cleanup();
    }
  },
);

test(
  'validates packaged PyInstaller alias links omitted while their targets remain on Unix',
  { skip: process.platform === 'win32' },
  () => {
    const fixture = createFixture();
    try {
      fixture.manifest.files.splice(1, 0, {
        path: '_internal/runtime-link.bin',
        type: 'symlink',
        target: 'runtime.bin',
      });
      fixture.manifest.files.sort((left, right) =>
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
      );
      fs.writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));

      assert.throws(() => validateServerBundle(fixture.bundleRoot), /ENOENT/);
      assert.equal(
        validateServerBundle(fixture.bundleRoot, { allowMaterializedSymlinks: true }).fileCount,
        3,
      );
    } finally {
      fixture.cleanup();
    }
  },
);

test(
  'resolves packaged PyInstaller links through omitted manifest aliases on Unix',
  { skip: process.platform === 'win32' },
  () => {
    const fixture = createFixture();
    try {
      fixture.manifest.files.push(
        {
          path: '_internal/current',
          type: 'symlink',
          target: '.',
        },
        {
          path: '_internal/runtime-chain.bin',
          type: 'symlink',
          target: 'current/runtime.bin',
        },
      );
      fixture.manifest.files.sort((left, right) =>
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
      );
      fs.writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));

      assert.equal(
        validateServerBundle(fixture.bundleRoot, { allowMaterializedSymlinks: true }).fileCount,
        4,
      );
    } finally {
      fixture.cleanup();
    }
  },
);

test('package smoke discovers and validates exactly one server resource', () => {
  const fixture = createFixture();
  try {
    const smoke = spawnSync(
      process.execPath,
      [path.join(__dirname, 'verify-tauri-package.js'), path.dirname(fixture.bundleRoot)],
      { encoding: 'utf8' },
    );
    assert.equal(smoke.status, 0, smoke.stderr);
    assert.match(smoke.stdout, /Tauri package smoke: verified server-bin/);
  } finally {
    fixture.cleanup();
  }
});
