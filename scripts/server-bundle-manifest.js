const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_NAME = 'bundle-manifest.json';

function normalizeArchitecture(value) {
  const architecture = String(value).toLowerCase();
  if (['amd64', 'x64', 'x86_64'].includes(architecture)) return 'x64';
  if (['aarch64', 'arm64'].includes(architecture)) return 'arm64';
  return architecture;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function collectEntries(root, directory = root) {
  const entries = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const metadata = fs.lstatSync(entryPath);
    if (metadata.isSymbolicLink()) {
      entries.push(path.relative(root, entryPath).split(path.sep).join('/'));
    } else if (metadata.isDirectory()) {
      entries.push(...collectEntries(root, entryPath));
    } else if (metadata.isFile() && entryPath !== path.join(root, MANIFEST_NAME)) {
      entries.push(path.relative(root, entryPath).split(path.sep).join('/'));
    } else if (!metadata.isFile()) {
      throw new Error(`bundle contains an unsupported entry: ${path.relative(root, entryPath)}`);
    }
  }
  return entries.sort();
}

function validateRelativePath(relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    relativePath.includes('\\') ||
    path.posix.isAbsolute(relativePath) ||
    relativePath.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`manifest contains an unsafe file path: ${relativePath}`);
  }
}

function validateExecutableFormat(executablePath, platform) {
  const handle = fs.openSync(executablePath, 'r');
  const header = Buffer.alloc(4);
  try {
    fs.readSync(handle, header, 0, header.length, 0);
  } finally {
    fs.closeSync(handle);
  }

  const valid =
    (platform === 'linux' && header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) ||
    (platform === 'win32' && header.subarray(0, 2).equals(Buffer.from('MZ'))) ||
    (platform === 'darwin' &&
      new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca']).has(
        header.toString('hex'),
      ));
  if (!valid) {
    throw new Error(`server executable has an invalid ${platform} binary header`);
  }
}

function validateServerBundle(
  bundleRoot,
  {
    expectedPlatform = process.platform,
    expectedArchitecture = process.arch,
    allowMaterializedSymlinks = false,
  } = {},
) {
  const root = path.resolve(bundleRoot);
  const rootMetadata = fs.lstatSync(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error(`server bundle is not a regular directory: ${root}`);
  }
  const realRoot = fs.realpathSync(root);

  const manifestPath = path.join(root, MANIFEST_NAME);
  const manifestMetadata = fs.lstatSync(manifestPath);
  if (manifestMetadata.isSymbolicLink() || !manifestMetadata.isFile()) {
    throw new Error(`bundle manifest is not a regular file: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (manifest.schemaVersion !== 1 || manifest.bundleType !== 'pyinstaller-onedir') {
    throw new Error('unsupported server bundle manifest schema');
  }
  if (manifest.platform !== expectedPlatform) {
    throw new Error(
      `server bundle platform mismatch: expected ${expectedPlatform}, received ${manifest.platform}`,
    );
  }
  if (normalizeArchitecture(manifest.architecture) !== normalizeArchitecture(expectedArchitecture)) {
    throw new Error(
      `server bundle architecture mismatch: expected ${expectedArchitecture}, received ${manifest.architecture}`,
    );
  }

  const expectedExecutable = expectedPlatform === 'win32' ? 'clawchat-server.exe' : 'clawchat-server';
  if (manifest.executable !== expectedExecutable) {
    throw new Error(`server bundle executable is invalid: ${manifest.executable}`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length < 2) {
    throw new Error('server bundle manifest does not contain the onedir files');
  }

  const manifestPaths = [];
  const manifestPathSet = new Set();
  let totalBytes = 0;
  for (const entry of manifest.files) {
    validateRelativePath(entry?.path);
    if (manifestPathSet.has(entry.path)) {
      throw new Error(`manifest contains a duplicate file path: ${entry.path}`);
    }
    manifestPathSet.add(entry.path);

    const filePath = path.resolve(root, ...entry.path.split('/'));
    const relativeToRoot = path.relative(root, filePath);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      throw new Error(`manifest file escapes the bundle: ${entry.path}`);
    }
    let metadata = null;
    try {
      metadata = fs.lstatSync(filePath);
    } catch (error) {
      if (
        !(
          allowMaterializedSymlinks &&
          entry.type === 'symlink' &&
          error instanceof Error &&
          error.code === 'ENOENT'
        )
      ) {
        throw error;
      }
    }
    if (entry.type === 'file') {
      if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
        throw new Error(`manifest contains an invalid file size: ${entry.path}`);
      }
      if (typeof entry.sha256 !== 'string' || !/^[a-f\d]{64}$/.test(entry.sha256)) {
        throw new Error(`manifest contains an invalid SHA-256: ${entry.path}`);
      }
      if (!metadata || metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error(`manifest entry is not a regular file: ${entry.path}`);
      }
      if (metadata.size !== entry.size) {
        throw new Error(
          `server bundle size mismatch for ${entry.path}: expected ${entry.size}, received ${metadata.size}`,
        );
      }
      const digest = sha256File(filePath);
      if (digest !== entry.sha256) {
        throw new Error(
          `server bundle SHA-256 mismatch for ${entry.path}: expected ${entry.sha256}, received ${digest}`,
        );
      }
      totalBytes += entry.size;
    } else if (entry.type === 'symlink') {
      if (
        typeof entry.target !== 'string' ||
        entry.target.length === 0 ||
        path.isAbsolute(entry.target)
      ) {
        throw new Error(`manifest entry is not a valid symbolic link: ${entry.path}`);
      }
      const declaredTarget = path.resolve(path.dirname(filePath), entry.target);
      const declaredRelativeTarget = path.relative(root, declaredTarget);
      if (declaredRelativeTarget.startsWith('..') || path.isAbsolute(declaredRelativeTarget)) {
        throw new Error(`server bundle symbolic link escapes the bundle: ${entry.path}`);
      }
      const realTarget = fs.realpathSync(declaredTarget);
      const relativeTarget = path.relative(realRoot, realTarget);
      if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
        throw new Error(`server bundle symbolic link escapes the bundle: ${entry.path}`);
      }
      const targetManifestPath = relativeTarget.split(path.sep).join('/');
      if (
        !manifest.files.some(
          (candidate) =>
            candidate?.path === targetManifestPath ||
            candidate?.path?.startsWith(`${targetManifestPath}/`),
        )
      ) {
        throw new Error(`server bundle symbolic link target is not declared: ${entry.path}`);
      }
      if (!metadata) {
        // Some package formats omit directory alias links while retaining their target tree.
        // The target is still contained here and its own manifest entries are validated below.
      } else if (metadata.isSymbolicLink()) {
        if (fs.readlinkSync(filePath) !== entry.target) {
          throw new Error(`server bundle symbolic link mismatch for ${entry.path}`);
        }
      } else if (allowMaterializedSymlinks && metadata.isFile()) {
        const targetMetadata = fs.statSync(realTarget);
        if (
          !targetMetadata.isFile() ||
          metadata.size !== targetMetadata.size ||
          sha256File(filePath) !== sha256File(realTarget)
        ) {
          throw new Error(`materialized symbolic link content mismatch for ${entry.path}`);
        }
      } else {
        throw new Error(`manifest entry is not a valid symbolic link: ${entry.path}`);
      }
    } else {
      throw new Error(`manifest contains an unsupported entry type: ${entry.path}`);
    }
    if (metadata) manifestPaths.push(entry.path);
  }

  const sortedManifestPaths = [...manifestPaths].sort();
  if (JSON.stringify(manifestPaths) !== JSON.stringify(sortedManifestPaths)) {
    throw new Error('server bundle manifest file entries are not sorted');
  }
  const actualPaths = collectEntries(root);
  if (JSON.stringify(actualPaths) !== JSON.stringify(sortedManifestPaths)) {
    const missing = sortedManifestPaths.filter((entry) => !actualPaths.includes(entry));
    const unexpected = actualPaths.filter((entry) => !sortedManifestPaths.includes(entry));
    throw new Error(
      `server bundle file set mismatch (missing: ${missing.join(', ') || 'none'}; ` +
        `unexpected: ${unexpected.join(', ') || 'none'})`,
    );
  }

  const internalDirectory = path.join(root, '_internal');
  if (!fs.existsSync(internalDirectory) || !fs.statSync(internalDirectory).isDirectory()) {
    throw new Error('PyInstaller _internal directory is missing');
  }
  const executablePath = path.join(root, expectedExecutable);
  validateExecutableFormat(executablePath, expectedPlatform);
  if (expectedPlatform !== 'win32' && (fs.statSync(executablePath).mode & 0o111) === 0) {
    throw new Error('server executable does not have an executable permission bit');
  }

  return {
    root,
    manifestPath,
    executablePath,
    fileCount: manifest.files.length,
    totalBytes,
  };
}

module.exports = {
  MANIFEST_NAME,
  collectEntries,
  normalizeArchitecture,
  sha256File,
  validateServerBundle,
};
