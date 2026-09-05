#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function readText(projectRoot, relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function readJson(projectRoot, relativePath) {
  return JSON.parse(readText(projectRoot, relativePath));
}

function requireVersion(value, location) {
  if (typeof value !== 'string' || !SEMVER_PATTERN.test(value)) {
    throw new Error(`invalid release version at ${location}: ${value}`);
  }
  return value;
}

function singleCapturedVersion(contents, pattern, location) {
  const matches = [...contents.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`expected exactly one release version at ${location}, found ${matches.length}`);
  }
  return requireVersion(matches[0][1], location);
}

function tomlSection(contents, sectionName, location) {
  const heading = new RegExp(`^\\[${sectionName}\\]\\s*$`, 'm').exec(contents);
  if (!heading || heading.index === undefined) {
    throw new Error(`missing [${sectionName}] section at ${location}`);
  }
  const remainder = contents.slice(heading.index + heading[0].length);
  const nextHeading = remainder.search(/^\[/m);
  return nextHeading === -1 ? remainder : remainder.slice(0, nextHeading);
}

function cargoLockPackage(contents, packageName, location) {
  const packages = contents
    .split(/\r?\n(?=\[\[package\]\]\s*(?:\r?\n|$))/)
    .filter((entry) => /^name\s*=\s*"([^"]+)"\s*$/m.exec(entry)?.[1] === packageName);
  if (packages.length !== 1) {
    throw new Error(
      `expected exactly one ${packageName} package at ${location}, found ${packages.length}`,
    );
  }
  return packages[0];
}

function requireSourceInvariant(contents, pattern, location) {
  if (!pattern.test(contents)) {
    throw new Error(`missing package version wiring at ${location}`);
  }
}

function requirePackageVersionWiring(projectRoot, version) {
  const tauriConfig = readJson(projectRoot, 'src-tauri/tauri.conf.json');
  if (tauriConfig.version !== '../package.json') {
    throw new Error(
      `src-tauri/tauri.conf.json version must reference ../package.json, received ${tauriConfig.version}`,
    );
  }

  const viteConfig = readText(projectRoot, 'vite.config.mts');
  requireSourceInvariant(
    viteConfig,
    /import\s+packageJson\s+from\s+['"]\.\/package\.json['"]/,
    'vite.config.mts package.json import',
  );
  requireSourceInvariant(
    viteConfig,
    /__APP_VERSION__:\s*JSON\.stringify\(packageVersion\)/,
    'vite.config.mts __APP_VERSION__ define',
  );

  for (const relativePath of [
    'src/app/platform/tauriPlatformApi.ts',
    'src/app/platform/webPlatformApi.ts',
  ]) {
    requireSourceInvariant(
      readText(projectRoot, relativePath),
      /appVersion:\s*__APP_VERSION__/,
      `${relativePath} runtime version`,
    );
  }
  requireSourceInvariant(
    readText(projectRoot, 'src/app/pages/AppSettingsPage.tsx'),
    /v\{platformApi\.runtime\.appVersion\}/,
    'src/app/pages/AppSettingsPage.tsx displayed version',
  );

  return { location: 'renderer and Tauri package.json version wiring', version };
}

function collectReleaseVersions(projectRoot = path.resolve(__dirname, '..')) {
  const packageJson = readJson(projectRoot, 'package.json');
  const packageVersion = requireVersion(packageJson.version, 'package.json version');
  const packageLock = readJson(projectRoot, 'package-lock.json');
  const cargoTomlPath = 'src-tauri/Cargo.toml';
  const cargoLockPath = 'src-tauri/Cargo.lock';
  const serverVersionPath = 'server/app_version.py';
  const serverProjectPath = 'server/pyproject.toml';
  const serverLockPath = 'server/uv.lock';
  const androidBuildPath = 'android/app/build.gradle.kts';
  const cargoTomlPackage = tomlSection(
    readText(projectRoot, cargoTomlPath),
    'package',
    cargoTomlPath,
  );
  const cargoLockEntry = cargoLockPackage(
    readText(projectRoot, cargoLockPath),
    'clawchat-tauri',
    cargoLockPath,
  );
  const serverLockEntry = cargoLockPackage(
    readText(projectRoot, serverLockPath),
    'clawchat-server',
    serverLockPath,
  );

  return [
    { location: 'package.json version', version: packageVersion },
    {
      location: 'package-lock.json top-level version',
      version: requireVersion(packageLock.version, 'package-lock.json top-level version'),
    },
    {
      location: 'package-lock.json root package version',
      version: requireVersion(
        packageLock.packages?.['']?.version,
        'package-lock.json root package version',
      ),
    },
    {
      location: 'src-tauri/Cargo.toml [package] version',
      version: singleCapturedVersion(
        cargoTomlPackage,
        /^version\s*=\s*"([^"]+)"\s*$/gm,
        'src-tauri/Cargo.toml [package] version',
      ),
    },
    {
      location: 'src-tauri/Cargo.lock clawchat-tauri version',
      version: singleCapturedVersion(
        cargoLockEntry,
        /^version\s*=\s*"([^"]+)"\s*$/gm,
        'src-tauri/Cargo.lock clawchat-tauri version',
      ),
    },
    {
      location: 'server/app_version.py APP_VERSION',
      version: singleCapturedVersion(
        readText(projectRoot, serverVersionPath),
        /^APP_VERSION\s*=\s*["']([^"']+)["']\s*$/gm,
        'server/app_version.py APP_VERSION',
      ),
    },
    {
      location: 'server/pyproject.toml [project] version',
      version: singleCapturedVersion(
        tomlSection(readText(projectRoot, serverProjectPath), 'project', serverProjectPath),
        /^version\s*=\s*"([^"]+)"\s*$/gm,
        'server/pyproject.toml [project] version',
      ),
    },
    {
      location: 'server/uv.lock clawchat-server version',
      version: singleCapturedVersion(
        serverLockEntry,
        /^version\s*=\s*"([^"]+)"\s*$/gm,
        'server/uv.lock clawchat-server version',
      ),
    },
    {
      location: 'android/app/build.gradle.kts versionName',
      version: singleCapturedVersion(
        readText(projectRoot, androidBuildPath),
        /^\s*versionName\s*=\s*"([^"]+)"\s*$/gm,
        'android/app/build.gradle.kts versionName',
      ),
    },
    requirePackageVersionWiring(projectRoot, packageVersion),
  ];
}

function checkReleaseVersion(projectRoot = path.resolve(__dirname, '..')) {
  const declarations = collectReleaseVersions(projectRoot);
  const expectedVersion = declarations[0].version;
  if (declarations.some(({ version }) => version !== expectedVersion)) {
    const details = declarations
      .map(({ location, version }) => `  - ${location}: ${version}`)
      .join('\n');
    throw new Error(`release versions do not match package.json (${expectedVersion}):\n${details}`);
  }
  return { version: expectedVersion, tag: `clawchat-v${expectedVersion}`, declarations };
}

if (require.main === module) {
  const projectRoot = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '..');
  try {
    const { version, tag, declarations } = checkReleaseVersion(projectRoot);
    console.log(
      `Release ${tag} is synchronized across ${declarations.length} declarations (${version}).`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  SEMVER_PATTERN,
  checkReleaseVersion,
  collectReleaseVersions,
};
