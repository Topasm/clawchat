#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PLATFORM_DIRECTORIES = {
  linux: 'ClawChat-release-linux',
  macos: 'ClawChat-release-macos-arm64',
  windows: 'ClawChat-release-windows',
};

function listFiles(directory) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`release artifact directory is missing: ${directory}`);
  }
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(entryPath);
      return entry.isFile() ? [entryPath] : [];
    })
    .sort();
}

function selectOne(files, label, predicate) {
  const matches = files.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${label}, found ${matches.length}`);
  }
  if (fs.statSync(matches[0]).size === 0) {
    throw new Error(`${label} is empty: ${matches[0]}`);
  }
  return matches[0];
}

function selectUpdater(files, label, extension) {
  const artifact = selectOne(files, label, (file) => file.endsWith(extension));
  const signature = `${artifact}.sig`;
  if (!files.includes(signature)) {
    throw new Error(`missing updater signature for ${artifact}`);
  }
  if (!fs.readFileSync(signature, 'utf8').trim()) {
    throw new Error(`updater signature is empty for ${artifact}`);
  }
  return { artifact, signature };
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function validateReleaseIdentity(version, tag, repository) {
  if (
    typeof version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
  ) {
    throw new Error(`invalid package version: ${version}`);
  }
  if (tag !== `clawchat-v${version}`) {
    throw new Error(`release tag ${tag} does not match package version ${version}`);
  }
  if (
    typeof repository !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
  ) {
    throw new Error(`invalid GitHub repository: ${repository}`);
  }
}

function prepareOutputDirectory(directory) {
  if (fs.existsSync(directory) && fs.readdirSync(directory).length > 0) {
    throw new Error(`release output directory is not empty: ${directory}`);
  }
  fs.mkdirSync(directory, { recursive: true });
}

function generateTauriRelease({
  artifactsDir,
  outputDir,
  version,
  tag,
  repository,
  publishedAt = new Date(),
}) {
  validateReleaseIdentity(version, tag, repository);

  const platformFiles = Object.fromEntries(
    Object.entries(PLATFORM_DIRECTORIES).map(([platform, directory]) => [
      platform,
      listFiles(path.join(artifactsDir, directory)),
    ]),
  );
  const installers = [
    {
      platform: 'linux',
      file: selectOne(platformFiles.linux, 'Linux AppImage installer', (file) =>
        file.endsWith('.AppImage'),
      ),
    },
    {
      platform: 'linux',
      file: selectOne(platformFiles.linux, 'Linux DEB installer', (file) => file.endsWith('.deb')),
    },
    {
      platform: 'macos-arm64',
      file: selectOne(platformFiles.macos, 'macOS DMG installer', (file) => file.endsWith('.dmg')),
    },
    {
      platform: 'windows',
      file: selectOne(platformFiles.windows, 'Windows NSIS installer', (file) =>
        file.endsWith('.exe'),
      ),
    },
  ];
  // Tauri v2 signs the delivered bundle itself on Linux and Windows, so the
  // updater artifact there is the installer, not a separate archive. Only
  // macOS still ships a distinct .app.tar.gz. The v1 layout this used to
  // expect (.AppImage.tar.gz, .nsis.zip) is never produced.
  const updaters = {
    'linux-x86_64': selectUpdater(platformFiles.linux, 'Linux updater bundle', '.AppImage'),
    'darwin-aarch64': selectUpdater(
      platformFiles.macos,
      'macOS updater archive',
      '.app.tar.gz',
    ),
    'windows-x86_64': selectUpdater(
      platformFiles.windows,
      'Windows updater bundle',
      '.exe',
    ),
  };

  prepareOutputDirectory(outputDir);
  const releaseNames = new Map();
  const copyArtifact = (platform, file) => {
    // The same bundle is both the installer and the updater on Linux and
    // Windows. Stage it once and reuse the name so the manifest points at the
    // file people actually download.
    const staged = releaseNames.get(file);
    if (staged) return staged;

    const releaseName = `${platform}-${path.basename(file)}`;
    const destination = path.join(outputDir, releaseName);
    if (fs.existsSync(destination)) {
      throw new Error(`duplicate release artifact name: ${releaseName}`);
    }
    fs.copyFileSync(file, destination);
    releaseNames.set(file, releaseName);
    return releaseName;
  };

  for (const installer of installers) {
    copyArtifact(installer.platform, installer.file);
  }
  for (const [platform, updater] of Object.entries(updaters)) {
    copyArtifact(platform, updater.artifact);
    copyArtifact(platform, updater.signature);
  }

  const platforms = Object.fromEntries(
    Object.entries(updaters).map(([platform, { artifact, signature }]) => {
      const releaseName = releaseNames.get(artifact);
      return [
        platform,
        {
          signature: fs.readFileSync(signature, 'utf8').trim(),
          url:
            `https://github.com/${repository}/releases/download/${tag}/` +
            encodeURIComponent(releaseName),
        },
      ];
    }),
  );
  const manifest = {
    version,
    notes: `ClawChat ${version}`,
    pub_date: publishedAt.toISOString(),
    platforms,
  };
  fs.writeFileSync(path.join(outputDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const checksumFiles = listFiles(outputDir).sort((left, right) =>
    path.basename(left).localeCompare(path.basename(right)),
  );
  const checksums = checksumFiles
    .map((file) => `${sha256(file)}  ${path.basename(file)}`)
    .join('\n');
  fs.writeFileSync(path.join(outputDir, 'checksums.txt'), `${checksums}\n`);

  return { manifest, releaseFiles: [...checksumFiles, path.join(outputDir, 'checksums.txt')] };
}

if (require.main === module) {
  const [artifactsArg = 'release-input', outputArg = 'release-artifacts'] = process.argv.slice(2);
  const repositoryRoot = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
  );
  // GitHub reserves the GITHUB_ prefix, so a workflow cannot hand the release
  // tag over as GITHUB_REF_NAME: the runner's own value wins, which is the
  // dispatch ref (`main`) rather than the tag being cut. Prefer an unreserved
  // name, and keep GITHUB_REF_NAME as the fallback for tag-triggered runs.
  const tag =
    process.env.RELEASE_TAG ||
    process.env.GITHUB_REF_NAME ||
    `clawchat-v${packageJson.version}`;
  const repository = process.env.GITHUB_REPOSITORY || 'clawchat/clawchat';
  const result = generateTauriRelease({
    artifactsDir: path.resolve(repositoryRoot, artifactsArg),
    outputDir: path.resolve(repositoryRoot, outputArg),
    version: packageJson.version,
    tag,
    repository,
  });
  console.log(
    `Generated ${result.releaseFiles.length} release files for ` +
      `${Object.keys(result.manifest.platforms).join(', ')}`,
  );
}

module.exports = {
  PLATFORM_DIRECTORIES,
  generateTauriRelease,
  validateReleaseIdentity,
};
