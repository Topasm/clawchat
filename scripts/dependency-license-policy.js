'use strict';

const APPROVED_LICENSES = new Set([
  '(MIT OR CC0-1.0)',
  '(WTFPL OR MIT)',
  '0BSD',
  'Apache-2.0',
  'Apache-2.0 OR MIT',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
  'Python-2.0',
  'Unlicense',
  'WTFPL',
  'WTFPL OR ISC',
]);

// Vite 8's unmodified, build-only CSS compiler. See docs/build-performance.md.
// Do not permit MPL dependencies generally or allow these packages into runtime dependencies.
const REVIEWED_BUILD_PACKAGES = new Set([
  'lightningcss',
  'lightningcss-android-arm64',
  'lightningcss-darwin-arm64',
  'lightningcss-darwin-x64',
  'lightningcss-freebsd-x64',
  'lightningcss-linux-arm-gnueabihf',
  'lightningcss-linux-arm64-gnu',
  'lightningcss-linux-arm64-musl',
  'lightningcss-linux-x64-gnu',
  'lightningcss-linux-x64-musl',
  'lightningcss-win32-arm64-msvc',
  'lightningcss-win32-x64-msvc',
]);

function dependencyName(packagePath, metadata) {
  if (metadata.name) return metadata.name;
  const marker = 'node_modules/';
  const offset = packagePath.lastIndexOf(marker);
  return offset >= 0 ? packagePath.slice(offset + marker.length) : packagePath;
}

function inspectPackageLicenses(lockfile, approvedLicenses = APPROVED_LICENSES) {
  if (!lockfile || lockfile.lockfileVersion !== 3 || !lockfile.packages) {
    throw new Error('Expected an npm package-lock v3 dependency graph');
  }

  const violations = [];
  for (const [packagePath, metadata] of Object.entries(lockfile.packages)) {
    if (!packagePath || metadata.link) continue;
    const name = dependencyName(packagePath, metadata);
    const version = metadata.version ?? 'unknown';
    const license = typeof metadata.license === 'string' ? metadata.license.trim() : '';

    if (!license) {
      violations.push(`${name}@${version}: missing license metadata`);
    } else if (
      !approvedLicenses.has(license) &&
      !(
        license === 'MPL-2.0' &&
        metadata.dev === true &&
        version === '1.33.0' &&
        REVIEWED_BUILD_PACKAGES.has(name)
      )
    ) {
      violations.push(`${name}@${version}: unreviewed license ${license}`);
    }
  }

  return violations.sort();
}

module.exports = { APPROVED_LICENSES, inspectPackageLicenses };
