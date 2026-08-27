const assert = require('node:assert/strict');
const test = require('node:test');

const { inspectDesignTokens } = require('./design-tokens');

test('accepts shared and runtime-injected design tokens', () => {
  const styles = [{
    filename: 'tokens.css',
    source: `
:root { --cc-radius-md: 8px; }
.card {
  color: var(--cc-text);
  border-radius: var(--cc-radius-md);
}
`,
  }];
  const runtimeSource = `{ '--cc-text': colors.text }`;

  assert.deepEqual(inspectDesignTokens(styles, runtimeSource), []);
});

test('rejects undefined variables and raw pixel radii', () => {
  const styles = [{
    filename: 'invalid.css',
    source: `.card {
  color: var(--cc-missing);
  border-radius: 12px;
}`,
  }];

  assert.deepEqual(inspectDesignTokens(styles), [
    { filename: 'invalid.css', line: 2, reason: 'undefined design token --cc-missing' },
    { filename: 'invalid.css', line: 3, reason: 'raw border radius 12px' },
  ]);
});

test('ignores token-like text in comments', () => {
  const styles = [{
    filename: 'comments.css',
    source: `/* --cc-comment-only: #fff; */
.card { color: var(--cc-comment-only); }`,
  }];

  assert.deepEqual(inspectDesignTokens(styles), [
    {
      filename: 'comments.css',
      line: 2,
      reason: 'undefined design token --cc-comment-only',
    },
  ]);
});

test('rejects semicolonless, uppercase, and corner-specific pixel radii', () => {
  const styles = [{
    filename: 'radii.css',
    source: `.first { border-radius: 10PX }
.second { border-top-left-radius: 4px }`,
  }];

  assert.deepEqual(inspectDesignTokens(styles), [
    { filename: 'radii.css', line: 1, reason: 'raw border radius 10PX' },
    { filename: 'radii.css', line: 2, reason: 'raw border radius 4px' },
  ]);
});

test('reports malformed CSS as a violation', () => {
  const styles = [{ filename: 'broken.css', source: '.card { color: red;' }];

  const violations = inspectDesignTokens(styles);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].filename, 'broken.css');
  assert.match(violations[0].reason, /^invalid CSS:/);
});
