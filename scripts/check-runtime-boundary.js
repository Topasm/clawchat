#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { collectSources, inspectRuntimeBoundary } = require('./runtime-boundary');

const repositoryRoot = path.resolve(__dirname, '..');
const sources = collectSources(path.join(repositoryRoot, 'src'));
const violations = inspectRuntimeBoundary(sources);

if (violations.length > 0) {
  console.error('Desktop runtime boundary failed:');
  for (const violation of violations) {
    console.error(
      `  ${path.relative(repositoryRoot, violation.filename)}:${violation.line} ${violation.reason}`,
    );
  }
  process.exit(1);
}

console.log('Verified runtime boundary: Electron is absent and Tauri stays behind platform adapters');
