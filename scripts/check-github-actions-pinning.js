#!/usr/bin/env node

const path = require('node:path');
const { inspectWorkflowDirectory } = require('./github-actions-pinning');

const workflowDirectory = path.resolve(__dirname, '..', '.github', 'workflows');
const violations = inspectWorkflowDirectory(workflowDirectory);

if (violations.length > 0) {
  console.error('GitHub Actions pinning check failed:');
  for (const violation of violations) {
    console.error(
      `  ${path.relative(path.resolve(__dirname, '..'), violation.filename)}:${violation.line} ` +
        `${violation.reference}`,
    );
  }
  process.exit(1);
}

console.log('Verified GitHub Actions pinning: every remote action uses a full commit SHA');
