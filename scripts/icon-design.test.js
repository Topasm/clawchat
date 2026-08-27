const assert = require('node:assert/strict');
const test = require('node:test');

const { inspectIconSources } = require('./icon-design');

test('accepts responsive icons that inherit their paint', () => {
  const sources = [
    {
      filename: 'DecorativeIcon.tsx',
      source:
        '<svg viewBox="0 0 18 18" stroke="currentColor" aria-hidden="true" focusable="false" />',
    },
    {
      filename: 'MeaningfulIcon.tsx',
      source: '<svg viewBox="0 0 18 18" stroke="currentColor" aria-label="Connection status" />',
    },
  ];

  assert.deepEqual(inspectIconSources(sources, { inlineSvgLimit: 2 }), []);
});

test('rejects missing viewBox, hardcoded paint, missing accessibility, emoji, and SVG growth', () => {
  const sources = [
    {
      filename: 'BadIcon.tsx',
      source: '<svg fill="#fff" />\n<span>📌</span>',
    },
  ];

  assert.deepEqual(inspectIconSources(sources, { inlineSvgLimit: 0 }), [
    { filename: 'BadIcon.tsx', line: 1, reason: 'inline SVG is missing a viewBox' },
    {
      filename: 'BadIcon.tsx',
      line: 1,
      reason: 'icon paint must inherit currentColor or use a design token',
    },
    {
      filename: 'BadIcon.tsx',
      line: 1,
      reason: 'SVG must have an accessible label or be aria-hidden and non-focusable',
    },
    {
      filename: 'BadIcon.tsx',
      line: 2,
      reason: 'emoji UI icon 📌 must use the shared vector icon set',
    },
    { filename: 'src/app', line: 1, reason: 'inline SVG count 1 exceeds migration ceiling 0' },
  ]);
});

test('rejects decorative SVGs that can receive focus', () => {
  const sources = [
    {
      filename: 'FocusableDecoration.tsx',
      source: '<svg viewBox="0 0 18 18" aria-hidden="true" />',
    },
  ];

  assert.deepEqual(inspectIconSources(sources, { inlineSvgLimit: 1 }), [
    {
      filename: 'FocusableDecoration.tsx',
      line: 1,
      reason: 'SVG must have an accessible label or be aria-hidden and non-focusable',
    },
  ]);
});
