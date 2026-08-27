#!/usr/bin/env node

const path = require('node:path');
const { inspectRepository } = require('./design-tokens');

const rootDirectory = path.resolve(__dirname, '..');
const violations = inspectRepository(rootDirectory);

if (violations.length > 0) {
  console.error('Design token validation failed:');
  for (const violation of violations) {
    console.error(
      `  ${path.relative(rootDirectory, violation.filename)}:${violation.line} ${violation.reason}`,
    );
  }
  process.exit(1);
}

console.log('Verified design tokens: CSS variables resolve and border radii use shared tokens');
