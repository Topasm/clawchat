#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inspectPackageLicenses } = require('./dependency-license-policy');

const repositoryRoot = path.resolve(__dirname, '..');
const packageManifest = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
);
const lockfile = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8'),
);

const violations = inspectPackageLicenses(lockfile);
if (packageManifest.license !== 'MIT') {
  violations.unshift(`root package: expected MIT license, received ${packageManifest.license ?? 'missing'}`);
}

if (violations.length > 0) {
  console.error('Dependency license policy failed:');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error('Review new licenses explicitly before updating the approved policy.');
  process.exit(1);
}

console.log(`Verified dependency licenses for ${Object.keys(lockfile.packages).length - 1} packages`);
