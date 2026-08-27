const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

const scriptDirectory = __dirname;
const repositoryRoot = path.resolve(scriptDirectory, '..');
const bundleConfigPath = path.join(repositoryRoot, 'src-tauri', 'tauri.bundle.conf.json');
const outputPath = path.join(
  repositoryRoot,
  'src-tauri',
  'tauri.release.generated.conf.json',
);

async function main() {
  const publicKey = process.env.TAURI_UPDATER_PUBKEY?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const configuredEndpoint = process.env.TAURI_UPDATER_ENDPOINT?.trim();
  const windowsCertificateThumbprint =
    process.env.TAURI_WINDOWS_CERTIFICATE_THUMBPRINT?.trim();
  const windowsTimestampUrl = process.env.TAURI_WINDOWS_TIMESTAMP_URL?.trim();
  const endpoint =
    configuredEndpoint ||
    (repository
      ? `https://github.com/${repository}/releases/latest/download/latest.json`
      : undefined);

  if (!publicKey) {
    throw new Error('TAURI_UPDATER_PUBKEY is required for a release build');
  }
  if (!endpoint) {
    throw new Error(
      'TAURI_UPDATER_ENDPOINT is required outside GitHub Actions (or set GITHUB_REPOSITORY)',
    );
  }

  const endpointUrl = new URL(endpoint);
  if (endpointUrl.protocol !== 'https:') {
    throw new Error('TAURI_UPDATER_ENDPOINT must use HTTPS');
  }
  if (endpointUrl.username || endpointUrl.password) {
    throw new Error('TAURI_UPDATER_ENDPOINT must not contain embedded credentials');
  }

  let windowsSigningConfig;
  if (windowsCertificateThumbprint) {
    if (!/^[A-F\d]{40}$/i.test(windowsCertificateThumbprint)) {
      throw new Error(
        'TAURI_WINDOWS_CERTIFICATE_THUMBPRINT must be a 40-character SHA-1 thumbprint',
      );
    }
    if (!windowsTimestampUrl) {
      throw new Error(
        'TAURI_WINDOWS_TIMESTAMP_URL is required when Windows code signing is enabled',
      );
    }
    const timestampUrl = new URL(windowsTimestampUrl);
    if (!['http:', 'https:'].includes(timestampUrl.protocol)) {
      throw new Error('TAURI_WINDOWS_TIMESTAMP_URL must use HTTP or HTTPS');
    }
    if (timestampUrl.username || timestampUrl.password) {
      throw new Error('TAURI_WINDOWS_TIMESTAMP_URL must not contain embedded credentials');
    }
    windowsSigningConfig = {
      certificateThumbprint: windowsCertificateThumbprint.toUpperCase(),
      digestAlgorithm: 'sha256',
      timestampUrl: timestampUrl.toString(),
    };
  }

  const bundleConfig = JSON.parse(await readFile(bundleConfigPath, 'utf8'));
  const releaseConfig = {
    ...bundleConfig,
    bundle: {
      ...bundleConfig.bundle,
      createUpdaterArtifacts: true,
      ...(windowsSigningConfig ? { windows: windowsSigningConfig } : {}),
    },
    plugins: {
      ...bundleConfig.plugins,
      updater: {
        pubkey: publicKey,
        endpoints: [endpointUrl.toString()],
        windows: {
          installMode: 'passive',
        },
      },
    },
  };

  await writeFile(outputPath, `${JSON.stringify(releaseConfig, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(`Generated signed-updater release config for ${endpointUrl.origin}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
