#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { checkTauriArtifactBudget } = require('./tauri-artifact-budget');

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error(
    'Usage: node scripts/check-tauri-artifact-budget.js <bundle-directory> <linux|windows|macos>',
  );
  process.exit(2);
}

const rootDirectory = path.resolve(__dirname, '..');
const bundleRoot = path.resolve(args[0]);
const platform = args[1];
const thresholdPath = path.resolve(
  process.env.CLAWCHAT_TAURI_ARTIFACT_THRESHOLDS ||
    path.join(rootDirectory, '.tauri-artifact-thresholds.json'),
);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

try {
  const thresholds = JSON.parse(fs.readFileSync(thresholdPath, 'utf8'));
  const results = checkTauriArtifactBudget(bundleRoot, platform, thresholds);
  console.log(`Tauri artifact budget: ${bundleRoot} (${platform})`);
  for (const result of results) {
    const baseline =
      result.baselineBytes === null ? '' : `, baseline ${formatBytes(result.baselineBytes)}`;
    console.log(
      `  ${result.exceeded ? 'FAIL' : 'PASS'} ${result.id}: ` +
        `${formatBytes(result.actualBytes)} (max ${formatBytes(result.maxBytes)}${baseline}) ` +
        `[${path.relative(bundleRoot, result.filePath)}]`,
    );
  }
  if (results.some((result) => result.exceeded)) {
    console.error('Tauri artifact size budget exceeded; investigate before changing thresholds.');
    process.exit(1);
  }
} catch (error) {
  console.error(`Tauri artifact budget failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
