const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowPath = path.resolve(__dirname, '..', '.github', 'workflows', 'release-tauri.yml');

test('preflight gates the build matrix and one dependent job publishes the release', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.doesNotMatch(workflow, /tauri-apps\/tauri-action/);
  assert.match(workflow, /\n  preflight:\n[\s\S]*?npm run check:release-version/);
  assert.match(workflow, /Desktop releases must run from the current origin\/main commit/);
  assert.match(workflow, /Release tag already exists/);
  assert.match(workflow, /\n  release:\n[\s\S]*?needs: preflight/);
  assert.match(workflow, /npx tauri build/);
  assert.match(workflow, /name: Stage verified release artifacts/);
  assert.match(workflow, /compression-level: 0/);
  assert.match(workflow, /\n  publish:\n[\s\S]*?needs: \[preflight, release\]/);
  assert.match(workflow, /actions\/download-artifact@[a-f\d]{40}/);
  assert.match(workflow, /npm run generate:tauri-release -- release-input release-artifacts/);
  assert.match(workflow, /sha256sum --check checksums\.txt/);
  assert.match(workflow, /softprops\/action-gh-release@[a-f\d]{40}/);

  const buildIndex = workflow.indexOf('npx tauri build');
  const stageIndex = workflow.indexOf('name: Stage verified release artifacts');
  const downloadIndex = workflow.indexOf('name: Download verified platform artifacts');
  const publishIndex = workflow.indexOf('name: Create one complete draft release');
  assert.ok(buildIndex < stageIndex);
  assert.ok(stageIndex < downloadIndex);
  assert.ok(downloadIndex < publishIndex);
});

test('final inventory requires every platform updater and all expected release files', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  for (const platform of ['linux-x86_64', 'darwin-aarch64', 'windows-x86_64']) {
    assert.match(workflow, new RegExp(platform));
  }
  assert.match(workflow, /-eq 3/);
  assert.match(workflow, /-eq 12/);
  assert.match(workflow, /fail_on_unmatched_files: true/);
  assert.match(workflow, /draft: true/);
});
