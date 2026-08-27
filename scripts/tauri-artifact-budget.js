const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED_PLATFORMS = new Set(['linux', 'windows', 'macos']);

function validateThresholds(thresholds, platform) {
  if (!thresholds || thresholds.schemaVersion !== 1) {
    throw new Error('unsupported Tauri artifact threshold schema');
  }
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(`unsupported Tauri artifact platform: ${platform}`);
  }
  const platformThresholds = thresholds.platforms?.[platform];
  if (!platformThresholds || !Array.isArray(platformThresholds.artifacts)) {
    throw new Error(`Tauri artifact thresholds are missing platform: ${platform}`);
  }
  if (platformThresholds.artifacts.length === 0) {
    throw new Error(`Tauri artifact thresholds are empty for platform: ${platform}`);
  }

  const identifiers = new Set();
  for (const artifact of platformThresholds.artifacts) {
    if (!artifact || typeof artifact.id !== 'string' || artifact.id.length === 0) {
      throw new Error('Tauri artifact threshold has an invalid id');
    }
    if (identifiers.has(artifact.id)) {
      throw new Error(`duplicate Tauri artifact threshold id: ${artifact.id}`);
    }
    identifiers.add(artifact.id);
    if (
      typeof artifact.directory !== 'string' ||
      artifact.directory.length === 0 ||
      artifact.directory.includes('/') ||
      artifact.directory.includes('\\') ||
      artifact.directory === '.' ||
      artifact.directory === '..'
    ) {
      throw new Error(`Tauri artifact threshold has an invalid directory: ${artifact.id}`);
    }
    if (typeof artifact.extension !== 'string' || !artifact.extension.startsWith('.')) {
      throw new Error(`Tauri artifact threshold has an invalid extension: ${artifact.id}`);
    }
    if (typeof artifact.required !== 'boolean') {
      throw new Error(`Tauri artifact threshold has an invalid required flag: ${artifact.id}`);
    }
    if (!Number.isSafeInteger(artifact.maxBytes) || artifact.maxBytes <= 0) {
      throw new Error(`Tauri artifact threshold has an invalid maxBytes: ${artifact.id}`);
    }
    if (
      artifact.baselineBytes !== undefined &&
      (!Number.isSafeInteger(artifact.baselineBytes) || artifact.baselineBytes <= 0)
    ) {
      throw new Error(`Tauri artifact threshold has an invalid baselineBytes: ${artifact.id}`);
    }
  }
  return platformThresholds.artifacts;
}

function checkTauriArtifactBudget(bundleRoot, platform, thresholds) {
  const root = path.resolve(bundleRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Tauri bundle directory is missing: ${root}`);
  }

  return validateThresholds(thresholds, platform).flatMap((artifact) => {
    const directory = path.join(root, artifact.directory);
    const matches = fs.existsSync(directory)
      ? fs
          .readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(artifact.extension))
          .map((entry) => path.join(directory, entry.name))
          .sort()
      : [];

    if (artifact.required && matches.length !== 1) {
      throw new Error(
        `required Tauri artifact ${artifact.id} expected exactly one file, found ${matches.length}`,
      );
    }
    if (!artifact.required && matches.length > 1) {
      throw new Error(
        `optional Tauri artifact ${artifact.id} expected at most one file, found ${matches.length}`,
      );
    }
    return matches.map((filePath) => {
      const actualBytes = fs.statSync(filePath).size;
      return {
        id: artifact.id,
        filePath,
        actualBytes,
        baselineBytes: artifact.baselineBytes ?? null,
        maxBytes: artifact.maxBytes,
        exceeded: actualBytes > artifact.maxBytes,
      };
    });
  });
}

module.exports = {
  SUPPORTED_PLATFORMS,
  checkTauriArtifactBudget,
  validateThresholds,
};
