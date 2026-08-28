const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowPath = path.resolve(
  __dirname,
  '..',
  '.github',
  'workflows',
  'publish-docker.yml',
);

function readWorkflow() {
  // Windows checkouts convert to CRLF, which breaks any pattern that expects a
  // newline immediately after a token. Normalize so these assertions describe
  // the file's content rather than the runner's line-ending policy.
  return fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
}

test('publishing a release without Docker credentials does not fail the run', () => {
  // This workflow fires on `release: published`, so an unconfigured registry
  // would report a perfectly good desktop release as failed.
  const workflow = readWorkflow();

  assert.match(workflow, /name: Resolve Docker Hub credentials/u);
  assert.match(workflow, /id: credentials/u);
  assert.match(workflow, /configured=false/u);

  const guarded = workflow.match(/if: steps\.credentials\.outputs\.configured == 'true'/gu) ?? [];
  const steps = workflow.match(/^ {6}- /gmu) ?? [];
  // Every step except the resolver itself has to be guarded.
  assert.equal(guarded.length, steps.length - 1);
});

test('an explicit dispatch still fails when credentials are missing', () => {
  // Skipping silently is right for a release trigger, but someone who asked
  // for a publish should be told it cannot happen.
  const workflow = readWorkflow();

  assert.match(
    workflow,
    /if \[ "\$\{\{ github\.event_name \}\}" = 'workflow_dispatch' \]; then\n\s+echo 'DOCKER_USERNAME and DOCKER_PASSWORD are required/u,
  );
});
