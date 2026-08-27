#!/usr/bin/env node

const path = require('node:path');
const { validateServerBundle } = require('./server-bundle-manifest');

const args = process.argv.slice(2);
if (args.length > 1) {
  console.error('Usage: node scripts/check-tauri-server-bundle.js [bundle-directory]');
  process.exit(2);
}

const repositoryRoot = path.resolve(__dirname, '..');
const bundleRoot = path.resolve(
  args[0] || path.join(repositoryRoot, 'server', 'dist', 'clawchat-server'),
);

try {
  const result = validateServerBundle(bundleRoot);
  console.log(
    `Verified Tauri server bundle: ${path.relative(repositoryRoot, result.executablePath)} ` +
      `(${result.fileCount} files, ${result.totalBytes} bytes)`,
  );
} catch (error) {
  console.error(
    `Tauri server bundle check failed: ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}
