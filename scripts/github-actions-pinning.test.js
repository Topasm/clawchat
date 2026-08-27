const assert = require('node:assert/strict');
const test = require('node:test');

const { inspectWorkflow } = require('./github-actions-pinning');

test('accepts remote actions pinned to a full commit SHA', () => {
  const workflow = `
steps:
  - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
  - uses: ./local-action
  - uses: docker://alpine:3.21
`;
  assert.deepEqual(inspectWorkflow(workflow), []);
});

test('rejects tags, branches, shortened SHAs, and missing revisions', () => {
  const workflow = `
steps:
  - uses: actions/checkout@v4
  - uses: owner/action@main
  - uses: owner/action@11d5960
  - uses: owner/action
`;
  assert.deepEqual(
    inspectWorkflow(workflow).map(({ line, reference }) => ({ line, reference })),
    [
      { line: 3, reference: 'actions/checkout@v4' },
      { line: 4, reference: 'owner/action@main' },
      { line: 5, reference: 'owner/action@11d5960' },
      { line: 6, reference: 'owner/action' },
    ],
  );
});
