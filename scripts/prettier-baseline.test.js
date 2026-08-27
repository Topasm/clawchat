'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { compareFormattingDebt, normalizeFormattingPath } = require('./prettier-baseline');

test('normalizes Windows repository paths to portable baseline keys', () => {
  assert.equal(
    normalizeFormattingPath('src\\app\\components\\TaskGraph.tsx'),
    'src/app/components/TaskGraph.tsx',
  );
  assert.equal(
    normalizeFormattingPath('src/app/components/TaskGraph.tsx'),
    'src/app/components/TaskGraph.tsx',
  );
});

test('accepts unchanged legacy formatting debt', () => {
  const debt = {
    'src/app/App.tsx': 'app-hash',
    'src/styles/main.css': 'style-hash',
  };

  assert.deepEqual(compareFormattingDebt(debt, debt), []);
});

test('reports new, changed, and stale formatting debt', () => {
  const currentDebt = {
    'src/app/App.tsx': 'new-app-hash',
    'src/app/NewView.tsx': 'new-view-hash',
  };
  const baselineFiles = {
    'src/app/App.tsx': 'old-app-hash',
    'src/app/RemovedView.tsx': 'removed-view-hash',
  };

  assert.deepEqual(compareFormattingDebt(currentDebt, baselineFiles), [
    'src/app/App.tsx: formatting differs from baseline',
    'src/app/NewView.tsx: formatting differs from baseline',
    'src/app/RemovedView.tsx: remove stale formatting baseline entry',
  ]);
});
