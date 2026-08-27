const assert = require('node:assert/strict');
const test = require('node:test');

const { inspectWorkflow } = require('./github-actions-pinning');

test('accepts remote actions pinned to a full commit SHA', () => {
  const workflow = `
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
  - uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7.0.0
  - uses: ./local-action
  - uses: docker://alpine:3.21
`;
  assert.deepEqual(inspectWorkflow(workflow), []);
});

test('rejects legacy pinned revisions of core actions', () => {
  const workflow = `
steps:
  - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
`;
  assert.deepEqual(
    inspectWorkflow(workflow).map(({ line, reference, reason }) => ({ line, reference, reason })),
    [
      {
        line: 3,
        reference: 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
        reason: 'core action is not pinned to the approved Node 24 revision',
      },
    ],
  );
});

test('rejects legacy core actions regardless of repository name casing', () => {
  const workflow = `
steps:
  - uses: Actions/Checkout@11d5960a326750d5838078e36cf38b85af677262
`;
  assert.deepEqual(
    inspectWorkflow(workflow).map(({ line, reference, reason }) => ({ line, reference, reason })),
    [
      {
        line: 3,
        reference: 'Actions/Checkout@11d5960a326750d5838078e36cf38b85af677262',
        reason: 'core action is not pinned to the approved Node 24 revision',
      },
    ],
  );
});

test('inspects block and flow mappings using valid YAML key formatting', () => {
  const workflow = `
steps:
  - uses : owner/action@main
  - { uses: owner/action@11d5960 }
`;
  assert.deepEqual(
    inspectWorkflow(workflow).map(({ line, reference }) => ({ line, reference })),
    [
      { line: 3, reference: 'owner/action@main' },
      { line: 4, reference: 'owner/action@11d5960' },
    ],
  );
});

test('resolves aliases used as action references', () => {
  const workflow = `
approved: &checkout actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
steps:
  - uses: *checkout
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
