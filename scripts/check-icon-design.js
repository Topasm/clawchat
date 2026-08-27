#!/usr/bin/env node

const path = require('node:path');
const { inspectIconContract } = require('./icon-design');

const rootDirectory = path.resolve(__dirname, '..');
const violations = inspectIconContract(rootDirectory);

if (violations.length > 0) {
  console.error('Icon design validation failed:');
  for (const violation of violations) {
    console.error(
      `  ${path.relative(rootDirectory, violation.filename)}:${violation.line} ${violation.reason}`,
    );
  }
  process.exit(1);
}

console.log(
  'Verified icon design: semantic sizes, shared stroke, accessibility, and one centralized SVG',
);
