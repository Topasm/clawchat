#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkRendererPerformanceBudget } = require('./renderer-performance-budget');

const args = process.argv.slice(2);
if (args.length > 1) {
  console.error('Usage: node scripts/check-renderer-performance-budget.js [build-directory]');
  process.exit(2);
}

const rootDirectory = path.resolve(__dirname, '..');
const buildDirectory = path.resolve(args[0] || path.join(rootDirectory, 'dist'));
const thresholdPath = path.resolve(
  process.env.CLAWCHAT_RENDERER_PERFORMANCE_THRESHOLDS ||
    path.join(rootDirectory, '.renderer-performance-thresholds.json'),
);
const measureScript = path.join(__dirname, 'measure-renderer-bundle.js');

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

try {
  const measured = spawnSync(process.execPath, [measureScript, buildDirectory, '--json'], {
    cwd: rootDirectory,
    encoding: 'utf8',
  });
  if (measured.status !== 0) {
    process.stderr.write(measured.stderr || measured.stdout);
    process.exit(measured.status ?? 1);
  }

  const report = JSON.parse(measured.stdout);
  const thresholds = JSON.parse(fs.readFileSync(thresholdPath, 'utf8'));
  const results = checkRendererPerformanceBudget(report, thresholds);

  console.log(`Renderer performance budget: ${buildDirectory}`);
  for (const result of results) {
    const status = result.exceeded ? 'FAIL' : 'PASS';
    const baseline =
      result.baselineBytes === null ? '' : `, baseline ${formatBytes(result.baselineBytes)}`;
    console.log(
      `  ${status} ${result.label}: ${formatBytes(result.actualBytes)} ` +
        `(max ${formatBytes(result.maxBytes)}${baseline})`,
    );
  }

  if (results.some((result) => result.exceeded)) {
    console.error(
      'Renderer performance budget exceeded. Rebuild with npm run build:web and investigate before changing thresholds.',
    );
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
