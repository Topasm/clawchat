const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(repositoryRoot, 'scripts', 'create-tauri-release-config.js');
const outputPath = path.join(
  repositoryRoot,
  'src-tauri',
  'tauri.release.generated.conf.json',
);

/** A well-formed Tauri updater public key: base64 of a two-line Minisign box. */
function validPublicKey() {
  const payload = Buffer.concat([
    Buffer.from('Ed', 'ascii'),
    crypto.randomBytes(8),
    crypto.randomBytes(32),
  ]);
  const box = `untrusted comment: minisign public key 1234\n${payload.toString('base64')}\n`;
  return Buffer.from(box, 'utf8').toString('base64');
}

function run(pubkey) {
  try {
    execFileSync(process.execPath, [scriptPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        TAURI_UPDATER_PUBKEY: pubkey,
        GITHUB_REPOSITORY: 'Topasm/clawchat',
        TAURI_UPDATER_ENDPOINT: '',
        TAURI_WINDOWS_CERTIFICATE_THUMBPRINT: '',
      },
    });
    return { ok: true, output: '' };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

test.afterEach(() => {
  fs.rmSync(outputPath, { force: true });
});

test('a valid updater public key produces a release config', () => {
  const result = run(validPublicKey());

  assert.equal(result.ok, true, result.output);
  const config = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.match(config.plugins.updater.endpoints[0], /^https:\/\/github\.com\//);
});

// A malformed key is silent at build time but permanent in the field: the
// shipped app can never verify an update, and installed copies cannot be
// corrected. Each of these has to fail the build.
for (const [name, pubkey] of [
  ['not base64', 'not-base64!!'],
  ['empty', ''],
  ['base64 of something that is not a Minisign box', Buffer.from('hello').toString('base64')],
  [
    'the raw two-line file rather than its base64',
    'untrusted comment: minisign public key\nRWQfoo',
  ],
  [
    'a Minisign box with a truncated payload',
    Buffer.from(
      `untrusted comment: minisign public key\n${Buffer.from('Ed short').toString('base64')}\n`,
    ).toString('base64'),
  ],
]) {
  test(`rejects ${name}`, () => {
    const result = run(pubkey);

    assert.equal(result.ok, false, `expected a failure for ${name}`);
    assert.match(result.output, /TAURI_UPDATER_PUBKEY/);
    assert.equal(fs.existsSync(outputPath), false, 'no config may be written');
  });
}
