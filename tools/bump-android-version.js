#!/usr/bin/env node

/**
 * Syncs the version from package.json into android/app/build.gradle.kts.
 *
 * versionName  = package.json version (e.g. "0.1.0")
 * versionCode  = (major * 10000 + minor * 100 + patch) * 10
 *
 * Usage: node tools/bump-android-version.js
 */

const fs = require('fs');
const path = require('path');

const pkgPath = path.resolve(__dirname, '..', 'package.json');
const gradlePath = path.resolve(__dirname, '..', 'android', 'app', 'build.gradle.kts');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;

const parts = version.split('.').map(Number);
if (parts.length < 3 || parts.some(isNaN)) {
  console.error(`Invalid version in package.json: "${version}"`);
  process.exit(1);
}

const [major, minor, patch] = parts;
const versionCode = (major * 10000 + minor * 100 + patch) * 10;

if (!fs.existsSync(gradlePath)) {
  console.error(`build.gradle.kts not found at ${gradlePath}`);
  process.exit(1);
}

let gradle = fs.readFileSync(gradlePath, 'utf8');

gradle = gradle.replace(/versionCode\s*=\s*\d+/, `versionCode = ${versionCode}`);
gradle = gradle.replace(/versionName\s*=\s*"[^"]+"/, `versionName = "${version}"`);

fs.writeFileSync(gradlePath, gradle, 'utf8');

console.log(`Updated android/app/build.gradle.kts:`);
console.log(`  versionName = "${version}"`);
console.log(`  versionCode = ${versionCode}`);
