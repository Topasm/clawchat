#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { MANIFEST_NAME, validateServerBundle } = require('./server-bundle-manifest');

// Keep the package smoke aligned with the desktop supervisor. A freshly
// extracted Windows onedir bundle can spend extra time in filesystem scanning
// before FastAPI finishes its lifespan startup.
const SERVER_READY_TIMEOUT_MS = 60_000;

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
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve(response.statusCode === 200 && payload.service === 'clawchat');
          } catch {
            resolve(false);
          }
        });
      },
    );
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(false));
  });
}

function apiRequest(port, requestPath, { method = 'GET', token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(payload.length);
    }
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: requestPath,
        method,
        headers,
        timeout: 2000,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            // The status still gives callers a useful failure diagnostic.
          }
          resolve({ status: response.statusCode, body: parsed });
        });
      },
    );
    request.once('timeout', () => request.destroy(new Error('request timed out')));
    request.once('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function webSocketPing(port, ticket) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${encodeURIComponent(ticket)}`);
    let settled = false;
    const timeout = setTimeout(() => {
      finish(new Error('timed out waiting for pong'));
    }, 3000);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (socket.readyState === WebSocket.OPEN) socket.close();
      if (error) reject(error);
      else resolve();
    }

    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'ping' })), {
      once: true,
    });
    socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload.type === 'pong') finish();
      } catch (error) {
        finish(error);
      }
    });
    socket.addEventListener('error', () => finish(new Error('WebSocket connection failed')), {
      once: true,
    });
    socket.addEventListener(
      'close',
      (event) => finish(new Error(`WebSocket closed before pong with code ${event.code}`)),
      { once: true },
    );
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(2000)]);
  }
}

async function smokeServer(executablePath) {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clawchat-packaged-server-'));
  const port = await reservePort();
  const output = [];
  const serverEnvironment = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    PIN: '654321',
    JWT_SECRET: 'change-this-to-a-random-secret-key',
    JWT_SECRET_FILE: path.join(runtimeRoot, 'server-jwt-secret'),
    DATABASE_URL: 'sqlite+aiosqlite:///./clawchat.db',
    UPLOAD_DIR: 'uploads',
    AI_BASE_URL: 'http://127.0.0.1:9',
  };
  let spawnError = null;
  let child = null;

  const launch = () => {
    spawnError = null;
    child = spawn(executablePath, [], {
      cwd: runtimeRoot,
      env: serverEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.once('error', (error) => {
      spawnError = error;
    });
    child.stdout.on('data', (chunk) => output.push(chunk.toString()));
    child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  };

  const waitUntilReady = async () => {
    const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await healthCheck(port)) return;
      if (spawnError) break;
      if (child.exitCode !== null || child.signalCode !== null) break;
      await delay(250);
    }
    const diagnostic = output.join('').slice(-8000);
    const reason = spawnError ? `: ${spawnError.message}` : diagnostic ? `:\n${diagnostic}` : '';
    throw new Error(`packaged server failed its semantic health check${reason}`);
  };

  try {
    launch();
    await waitUntilReady();

    const login = await apiRequest(port, '/api/auth/login', {
      method: 'POST',
      body: { pin: '654321' },
    });
    if (login.status !== 200 || !login.body?.access_token) {
      throw new Error(`packaged server login failed with status ${login.status}`);
    }
    const pairing = await apiRequest(port, '/api/pairing/session', {
      method: 'POST',
      token: login.body.access_token,
    });
    if (pairing.status !== 200 || !pairing.body?.code) {
      throw new Error(`packaged server pairing session failed with status ${pairing.status}`);
    }
    const claim = await apiRequest(port, '/api/pairing/claim', {
      method: 'POST',
      body: {
        code: pairing.body.code,
        device_name: 'Package restart smoke',
        device_type: process.platform,
      },
    });
    if (claim.status !== 200 || !claim.body?.device_token) {
      throw new Error(`packaged server pairing claim failed with status ${claim.status}`);
    }
    const beforeRestart = await apiRequest(port, '/api/todos', {
      token: claim.body.device_token,
    });
    if (beforeRestart.status !== 200) {
      throw new Error(`device token failed before restart with status ${beforeRestart.status}`);
    }
    const ticketBeforeRestart = await apiRequest(port, '/api/auth/ws-ticket', {
      method: 'POST',
      token: claim.body.device_token,
    });
    if (ticketBeforeRestart.status !== 200 || !ticketBeforeRestart.body?.ticket) {
      throw new Error(
        `device WebSocket ticket failed before restart with status ${ticketBeforeRestart.status}`,
      );
    }
    try {
      await webSocketPing(port, ticketBeforeRestart.body.ticket);
    } catch (error) {
      throw new Error(
        `device WebSocket failed before restart: ${error instanceof Error ? error.message : error}`,
      );
    }

    await stopChild(child);
    launch();
    await waitUntilReady();
    const afterRestart = await apiRequest(port, '/api/todos', {
      token: claim.body.device_token,
    });
    if (afterRestart.status !== 200) {
      throw new Error(`device token failed after restart with status ${afterRestart.status}`);
    }
    const ticketAfterRestart = await apiRequest(port, '/api/auth/ws-ticket', {
      method: 'POST',
      token: claim.body.device_token,
    });
    if (ticketAfterRestart.status !== 200 || !ticketAfterRestart.body?.ticket) {
      throw new Error(
        `device WebSocket ticket failed after restart with status ${ticketAfterRestart.status}`,
      );
    }
    try {
      await webSocketPing(port, ticketAfterRestart.body.ticket);
    } catch (error) {
      throw new Error(
        `device WebSocket failed after restart: ${error instanceof Error ? error.message : error}`,
      );
    }
    console.log(
      `Tauri package smoke: semantic health and restart-stable device HTTP/WebSocket auth ` +
        `passed on port ${port}`,
    );
  } finally {
    if (child) await stopChild(child);
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
  const result = validateServerBundle(path.dirname(manifests[0]), {
    // Tauri's resource bundler dereferences PyInstaller links on some package formats.
    // The validator still requires the materialized file to match its in-bundle target.
    allowMaterializedSymlinks: true,
  });
  console.log(
    `Tauri package smoke: verified ${path.relative(packageRoot, result.root)} ` +
      `(${result.fileCount} files, ${result.totalBytes} bytes)`,
  );
  if (runServer) await smokeServer(result.executablePath);
}

main().catch((error) => {
  const message = `Tauri package smoke failed: ${error instanceof Error ? error.message : error}`;
  console.error(message);
  if (process.env.GITHUB_ACTIONS === 'true') {
    const annotation = message
      .replaceAll('%', '%25')
      .replaceAll('\r', '%0D')
      .replaceAll('\n', '%0A');
    console.error(`::error title=Tauri package verification failed::${annotation}`);
  }
  process.exit(1);
});
