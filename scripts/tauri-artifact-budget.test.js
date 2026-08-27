const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { checkTauriArtifactBudget, validateThresholds } = require('./tauri-artifact-budget');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawchat-artifact-budget-'));
  fs.mkdirSync(path.join(root, 'deb'));
  fs.writeFileSync(path.join(root, 'deb', 'clawchat.deb'), Buffer.alloc(80));
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function thresholds(maxBytes = 100) {
  return {
    schemaVersion: 1,
    platforms: {
      linux: {
        artifacts: [
          {
            id: 'deb',
            directory: 'deb',
            extension: '.deb',
            required: true,
            baselineBytes: 75,
            maxBytes,
          },
          {
            id: 'optional-updater',
            directory: 'deb',
            extension: '.tar.gz',
            required: false,
            maxBytes,
          },
        ],
      },
    },
  };
}

test('checks required artifacts and ignores absent optional artifacts', () => {
  const project = fixture();
  try {
    const results = checkTauriArtifactBudget(project.root, 'linux', thresholds());
    assert.equal(results.length, 1);
    assert.deepEqual(
      { id: results[0].id, actualBytes: results[0].actualBytes, exceeded: results[0].exceeded },
      { id: 'deb', actualBytes: 80, exceeded: false },
    );
  } finally {
    project.cleanup();
  }
});

test('marks oversized artifacts as exceeded', () => {
  const project = fixture();
  try {
    const [result] = checkTauriArtifactBudget(project.root, 'linux', thresholds(79));
    assert.equal(result.exceeded, true);
  } finally {
    project.cleanup();
  }
});

test('fails closed when a required artifact is missing or duplicated', () => {
  const project = fixture();
  try {
    fs.unlinkSync(path.join(project.root, 'deb', 'clawchat.deb'));
    assert.throws(
      () => checkTauriArtifactBudget(project.root, 'linux', thresholds()),
      /expected exactly one file, found 0/,
    );
    fs.writeFileSync(path.join(project.root, 'deb', 'one.deb'), 'one');
    fs.writeFileSync(path.join(project.root, 'deb', 'two.deb'), 'two');
    assert.throws(
      () => checkTauriArtifactBudget(project.root, 'linux', thresholds()),
      /expected exactly one file, found 2/,
    );
  } finally {
    project.cleanup();
  }
});

test('checks an optional updater and rejects duplicate updater artifacts', () => {
  const project = fixture();
  try {
    fs.writeFileSync(path.join(project.root, 'deb', 'clawchat.tar.gz'), Buffer.alloc(90));
    const results = checkTauriArtifactBudget(project.root, 'linux', thresholds());
    assert.deepEqual(
      results.map(({ id, actualBytes, exceeded }) => ({ id, actualBytes, exceeded })),
      [
        { id: 'deb', actualBytes: 80, exceeded: false },
        { id: 'optional-updater', actualBytes: 90, exceeded: false },
      ],
    );

    fs.writeFileSync(path.join(project.root, 'deb', 'duplicate.tar.gz'), 'duplicate');
    assert.throws(
      () => checkTauriArtifactBudget(project.root, 'linux', thresholds()),
      /expected at most one file, found 2/,
    );
  } finally {
    project.cleanup();
  }
});

test('rejects malformed platform thresholds', () => {
  assert.throws(() => validateThresholds({ schemaVersion: 2 }, 'linux'), /unsupported/);
  assert.throws(() => validateThresholds(thresholds(), 'android'), /unsupported.*platform/);
  const invalid = thresholds();
  invalid.platforms.linux.artifacts[0].directory = '../deb';
  assert.throws(() => validateThresholds(invalid, 'linux'), /invalid directory/);
});
