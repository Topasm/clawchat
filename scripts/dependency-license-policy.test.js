'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { inspectPackageLicenses } = require('./dependency-license-policy');

function lockfile(packages) {
  return { lockfileVersion: 3, packages: { '': {}, ...packages } };
}

test('accepts reviewed dependency licenses', () => {
  const result = inspectPackageLicenses(
    lockfile({
      'node_modules/example': { version: '1.0.0', license: 'MIT' },
      'node_modules/@scope/library': { version: '2.0.0', license: 'Apache-2.0' },
    }),
  );

  assert.deepEqual(result, []);
});

test('rejects missing and unreviewed licenses', () => {
  const result = inspectPackageLicenses(
    lockfile({
      'node_modules/copyleft': { version: '3.0.0', license: 'GPL-3.0-only' },
      'node_modules/unknown': { version: '1.0.0' },
    }),
  );

  assert.deepEqual(result, [
    'copyleft@3.0.0: unreviewed license GPL-3.0-only',
    'unknown@1.0.0: missing license metadata',
  ]);
});

test('fails closed for unsupported lockfile formats', () => {
  assert.throws(
    () => inspectPackageLicenses({ lockfileVersion: 2, packages: {} }),
    /package-lock v3/,
  );
});
