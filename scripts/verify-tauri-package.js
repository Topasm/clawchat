#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { MANIFEST_NAME, validateServerBundle } = require('./server-bundle-manifest');

const args = process.argv.slice(2);
const runServer = args.includes('--run-server');
const positionalArgs = args.filter((argument) => argument !== '--run-server');
if (positionalArgs.length !== 1) {
  console.error(
    'Usage: node scripts/verify-tauri-package.js <extracted-package-directory> [--run-server]',
  );
  process.exit(2);
}

const packageRoot = path.resolve(positionalArgs[0]);

function findServerBundleManifests(directory) {
  const matches = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const metadata = fs.lstatSync(entryPath);
    if (metadata.isSymbolicLink()) continue;
    if (metadata.isDirectory()) {
      matches.push(...findServerBundleManifests(entryPath));
    } else if (
      metadata.isFile() &&
      entry.name === MANIFEST_NAME &&
      path.basename(path.dirname(entryPath)) === 'server-bin'
    ) {
      matches.push(entryPath);
    }
  }
  return matches;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port === null) reject(new Error('could not reserve a server smoke port'));
        else resolve(port);
      });
    });
  });
}

function healthCheck(port) {
  return new Promise((resolve) => {
    const request = http.get(
      { hostname: '127.0.0.1', port, path: '/api/health', timeout: 1000 },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(false));
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(2000),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(2000),
    ]);
  }
}

async function smokeServer(executablePath) {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clawchat-packaged-server-'));
  const port = await reservePort();
  const output = [];
  let spawnError = null;
  const child = spawn(executablePath, [], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      PIN: '654321',
      DATABASE_URL: 'sqlite+aiosqlite:///./clawchat.db',
      UPLOAD_DIR: 'uploads',
      AI_BASE_URL: 'http://127.0.0.1:9',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.once('error', (error) => {
    spawnError = error;
  });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));

  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (await healthCheck(port)) {
        console.log(`Tauri package smoke: packaged server health check passed on port ${port}`);
        return;
      }
      if (spawnError) break;
      if (child.exitCode !== null || child.signalCode !== null) break;
      await delay(250);
    }
    const diagnostic = output.join('').slice(-8000);
    const reason = spawnError ? `: ${spawnError.message}` : diagnostic ? `:\n${diagnostic}` : '';
    throw new Error(`packaged server failed its health check${reason}`);
  } finally {
    await stopChild(child);
    try {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    } catch (error) {
      console.warn(
        `Tauri package smoke warning: could not remove ${runtimeRoot}: ` +
          `${error instanceof Error ? error.message : error}`,
      );
    }
  }
}

async function main() {
  if (!fs.statSync(packageRoot).isDirectory()) {
    throw new Error(`package root is not a directory: ${packageRoot}`);
  }
  const manifests = findServerBundleManifests(packageRoot);
  if (manifests.length !== 1) {
    throw new Error(
      `expected exactly one packaged server manifest, found ${manifests.length}: ` +
        manifests.map((entry) => path.relative(packageRoot, entry)).join(', '),
    );
  }
  const result = validateServerBundle(path.dirname(manifests[0]));
  console.log(
    `Tauri package smoke: verified ${path.relative(packageRoot, result.root)} ` +
      `(${result.fileCount} files, ${result.totalBytes} bytes)`,
  );
  if (runServer) await smokeServer(result.executablePath);
}

main().catch((error) => {
  console.error(`Tauri package smoke failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
