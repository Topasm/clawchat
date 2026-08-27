const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { checkReleaseVersion, collectReleaseVersions } = require('./check-release-version');

const VERSION = '1.2.3';
const scriptPath = path.join(__dirname, 'check-release-version.js');

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawchat-release-version-'));
  const versions = {
    packageJson: VERSION,
    packageLockTopLevel: VERSION,
    packageLockRoot: VERSION,
    cargoToml: VERSION,
    cargoLock: VERSION,
    serverVersion: VERSION,
    serverProjectVersion: VERSION,
    androidVersion: VERSION,
    ...overrides,
  };
  const write = (relativePath, contents) => {
    const destination = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, contents);
  };

  write('package.json', `${JSON.stringify({ name: 'clawchat', version: versions.packageJson })}\n`);
  write(
    'package-lock.json',
    `${JSON.stringify({
      name: 'clawchat',
      version: versions.packageLockTopLevel,
      packages: { '': { name: 'clawchat', version: versions.packageLockRoot } },
    })}\n`,
  );
  write(
    'src-tauri/Cargo.toml',
    `[package]\nname = "clawchat-tauri"\nversion = "${versions.cargoToml}"\n\n[dependencies]\nserde = "1"\n`,
  );
  write(
    'src-tauri/Cargo.lock',
    `version = 4\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\n\n[[package]]\nname = "clawchat-tauri"\nversion = "${versions.cargoLock}"\n`,
  );
  write('server/app_version.py', `APP_VERSION = "${versions.serverVersion}"\n`);
  write(
    'server/pyproject.toml',
    `[project]\nname = "clawchat-server"\nversion = "${versions.serverProjectVersion}"\n`,
  );
  write(
    'android/app/build.gradle.kts',
    `android {\n  defaultConfig {\n    versionName = "${versions.androidVersion}"\n  }\n}\n`,
  );
  write('src-tauri/tauri.conf.json', '{"version":"../package.json"}\n');
  write(
    'vite.config.ts',
    `import packageJson from './package.json';\nconst packageVersion = packageJson.version;\nexport default { define: { __APP_VERSION__: JSON.stringify(packageVersion) } };\n`,
  );
  write('src/app/platform/tauriPlatformApi.ts', 'appVersion: __APP_VERSION__,\n');
  write('src/app/platform/webPlatformApi.ts', 'appVersion: __APP_VERSION__,\n');
  write(
    'src/app/pages/SettingsPage.tsx',
    '<span>v{platformApi.runtime.appVersion}</span>\n',
  );

  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('accepts synchronized package, lockfile, Cargo, Tauri, and renderer versions', () => {
  const project = fixture();
  try {
    const result = checkReleaseVersion(project.root);
    assert.equal(result.version, VERSION);
    assert.equal(result.tag, `clawchat-v${VERSION}`);
    assert.equal(result.declarations.length, 9);
  } finally {
    project.cleanup();
  }
});

test('rejects every duplicated release version when it drifts', async (t) => {
  for (const [key, location] of [
    ['packageLockTopLevel', 'package-lock.json top-level version'],
    ['packageLockRoot', 'package-lock.json root package version'],
    ['cargoToml', 'src-tauri/Cargo.toml [package] version'],
    ['cargoLock', 'src-tauri/Cargo.lock clawchat-tauri version'],
    ['serverVersion', 'server/app_version.py APP_VERSION'],
    ['serverProjectVersion', 'server/pyproject.toml [project] version'],
    ['androidVersion', 'android/app/build.gradle.kts versionName'],
  ]) {
    await t.test(location, () => {
      const project = fixture({ [key]: '9.9.9' });
      try {
        assert.throws(
          () => checkReleaseVersion(project.root),
          (error) =>
            error instanceof Error &&
            error.message.includes('release versions do not match package.json') &&
            error.message.includes(`${location}: 9.9.9`),
        );
      } finally {
        project.cleanup();
      }
    });
  }
});

test('fails closed when Tauri or renderer package-version wiring is removed', () => {
  const project = fixture();
  try {
    fs.writeFileSync(path.join(project.root, 'src-tauri/tauri.conf.json'), '{"version":"1.2.3"}');
    assert.throws(() => collectReleaseVersions(project.root), /must reference \.\.\/package\.json/);
  } finally {
    project.cleanup();
  }

  const renderer = fixture();
  try {
    fs.writeFileSync(
      path.join(renderer.root, 'src/app/platform/tauriPlatformApi.ts'),
      "appVersion: '',\n",
    );
    assert.throws(() => collectReleaseVersions(renderer.root), /runtime version/);
  } finally {
    renderer.cleanup();
  }
});

test('command exits non-zero and reports all declarations when versions drift', () => {
  const project = fixture({ cargoLock: '2.0.0' });
  try {
    const result = spawnSync(process.execPath, [scriptPath, project.root], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /release versions do not match package\.json/);
    assert.match(result.stderr, /Cargo\.lock clawchat-tauri version: 2\.0\.0/);
  } finally {
    project.cleanup();
  }
});
