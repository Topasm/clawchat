import { ChildProcess, spawn } from 'child_process';
import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';

const SERVER_PORT = 8000;
const HEALTH_URL = `http://127.0.0.1:${SERVER_PORT}/api/health`;
const MAX_HEALTH_RETRIES = 30;
// Progressive intervals: fast at first, then back off
// First 5 attempts at 150ms, next 5 at 300ms, rest at 500ms
function getRetryInterval(attempt: number): number {
  if (attempt <= 5) return 150;
  if (attempt <= 10) return 300;
  return 500;
}

// ── Status types ─────────────────────────────────────────────────────

export type ServerState = 'starting' | 'running' | 'stopped' | 'error';

export interface ServerStatus {
  state: ServerState;
  port: number;
  pid?: number;
  error?: string;
}

// ── Internal state ───────────────────────────────────────────────────

let managedProcess: ChildProcess | null = null;
let currentStatus: ServerStatus = { state: 'stopped', port: SERVER_PORT };

// ── Path helpers ─────────────────────────────────────────────────────

function getPidFilePath(): string {
  return path.join(app.getPath('userData'), 'server.pid');
}

function getLockFilePath(): string {
  return path.join(app.getPath('userData'), 'server.lock');
}

function findPython(): string {
  const serverDir = getServerDir();
  const venvPaths = [
    path.join(serverDir, 'venv', 'bin', 'python'),       // macOS/Linux
    path.join(serverDir, 'venv', 'Scripts', 'python.exe'), // Windows
  ];
  for (const p of venvPaths) {
    if (fs.existsSync(p)) return p;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function getServerDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'server');
  }
  return path.join(app.getAppPath(), 'server');
}

function getDataDir(): string {
  const dataDir = path.join(app.getPath('userData'), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

// ── Status broadcasting ──────────────────────────────────────────────

function setStatus(status: ServerStatus): void {
  currentStatus = status;
  // Broadcast to all renderer windows
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('server:status-changed', status);
    }
  }
}

// ── PID file management ──────────────────────────────────────────────

function writePidFile(pid: number): void {
  try {
    fs.writeFileSync(getPidFilePath(), String(pid), 'utf-8');
  } catch {
    // Non-fatal — we can still track via managedProcess
  }
}

function readPidFile(): number | null {
  try {
    const raw = fs.readFileSync(getPidFilePath(), 'utf-8').trim();
    const pid = parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function removePidFile(): void {
  try {
    fs.unlinkSync(getPidFilePath());
  } catch {
    // Already gone
  }
}

function removeLockFile(): void {
  try {
    fs.unlinkSync(getLockFilePath());
  } catch {
    // Already gone
  }
}

/**
 * Check whether a process with the given PID is alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check only
    return true;
  } catch {
    return false;
  }
}

// ── Health check ─────────────────────────────────────────────────────

function checkHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

function waitForHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    let attempts = 0;

    const check = () => {
      attempts++;
      const req = http.get(HEALTH_URL, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else if (attempts < MAX_HEALTH_RETRIES) {
          setTimeout(check, getRetryInterval(attempts));
        } else {
          resolve(false);
        }
      });

      req.on('error', () => {
        if (attempts < MAX_HEALTH_RETRIES) {
          setTimeout(check, getRetryInterval(attempts));
        } else {
          resolve(false);
        }
      });

      req.end();
    };

    check();
  });
}

// ── Core lifecycle ───────────────────────────────────────────────────

/**
 * Start the server. If a detached server from a previous UI session is
 * still alive and healthy, reuse it instead of spawning a new one.
 */
export async function startServer(): Promise<ServerStatus> {
  // 1. Already managed by this process?
  if (managedProcess && managedProcess.exitCode === null) {
    const healthy = await checkHealth();
    if (healthy) {
      const status: ServerStatus = { state: 'running', port: SERVER_PORT, pid: managedProcess.pid };
      setStatus(status);
      return status;
    }
  }

  // 2. Detached server from a previous session still alive?
  const existingPid = readPidFile();
  if (existingPid && isProcessAlive(existingPid)) {
    const healthy = await checkHealth();
    if (healthy) {
      console.log(`[server-manager] Reusing existing server (PID ${existingPid})`);
      const status: ServerStatus = { state: 'running', port: SERVER_PORT, pid: existingPid };
      setStatus(status);
      return status;
    }
    // Process alive but unhealthy — kill the stale process
    console.log(`[server-manager] Stale server (PID ${existingPid}), killing`);
    try { process.kill(existingPid, 'SIGKILL'); } catch { /* already gone */ }
    removePidFile();
  } else if (existingPid) {
    // Stale PID file, process dead
    removePidFile();
  }

  // 3. Maybe another process already started serving (race condition guard)
  const alreadyHealthy = await checkHealth();
  if (alreadyHealthy) {
    console.log('[server-manager] Server already healthy on port (external)');
    const status: ServerStatus = { state: 'running', port: SERVER_PORT };
    setStatus(status);
    return status;
  }

  // 4. Spawn a new detached server
  setStatus({ state: 'starting', port: SERVER_PORT });

  const python = findPython();
  const serverDir = getServerDir();
  const dataDir = getDataDir();

  console.log(`[server-manager] Starting server from ${serverDir}`);
  console.log(`[server-manager] Python: ${python}`);
  console.log(`[server-manager] Data dir: ${dataDir}`);

  const env = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(SERVER_PORT),
    DATABASE_URL: `sqlite+aiosqlite:///${path.join(dataDir, 'clawchat.db')}`,
    UPLOAD_DIR: path.join(dataDir, 'uploads'),
  };

  try {
    managedProcess = spawn(
      python,
      ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(SERVER_PORT)],
      {
        cwd: serverDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true, // survive UI close
      }
    );

    // Allow the Electron process to exit without waiting for this child
    managedProcess.unref();

    if (managedProcess.pid) {
      writePidFile(managedProcess.pid);
    }

    managedProcess.stdout?.on('data', (data: Buffer) => {
      console.log(`[server] ${data.toString().trim()}`);
    });

    managedProcess.stderr?.on('data', (data: Buffer) => {
      console.error(`[server] ${data.toString().trim()}`);
    });

    managedProcess.on('exit', (code, signal) => {
      console.log(`[server-manager] Server exited with code=${code} signal=${signal}`);
      removePidFile();
      managedProcess = null;
      setStatus({ state: 'stopped', port: SERVER_PORT });
    });

    managedProcess.on('error', (err) => {
      console.error(`[server-manager] Failed to start server:`, err);
      removePidFile();
      managedProcess = null;
      setStatus({ state: 'error', port: SERVER_PORT, error: err.message });
    });

    // Wait for health check
    const healthy = await waitForHealth();
    if (!healthy) {
      throw new Error('Server failed health check after startup');
    }

    console.log(`[server-manager] Server is healthy on port ${SERVER_PORT}`);
    const status: ServerStatus = { state: 'running', port: SERVER_PORT, pid: managedProcess?.pid };
    setStatus(status);
    return status;

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[server-manager] Start failed: ${message}`);
    const status: ServerStatus = { state: 'error', port: SERVER_PORT, error: message };
    setStatus(status);
    return status;
  }
}

/**
 * Stop the server explicitly. Only called from the tray "Stop local server" action.
 */
export async function stopServer(): Promise<void> {
  // Try managed process first
  if (managedProcess && managedProcess.exitCode === null) {
    console.log('[server-manager] Stopping managed server...');
    await killProcess(managedProcess);
    managedProcess = null;
    removePidFile();
    removeLockFile();
    setStatus({ state: 'stopped', port: SERVER_PORT });
    return;
  }

  // Fall back to PID file (detached from previous session)
  const pid = readPidFile();
  if (pid && isProcessAlive(pid)) {
    console.log(`[server-manager] Stopping detached server (PID ${pid})...`);
    try {
      process.kill(pid, 'SIGTERM');
      // Give it a moment to shut down gracefully
      await new Promise<void>((resolve) => {
        let waited = 0;
        const interval = setInterval(() => {
          waited += 200;
          if (!isProcessAlive(pid) || waited >= 5000) {
            clearInterval(interval);
            if (isProcessAlive(pid)) {
              try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
            }
            resolve();
          }
        }, 200);
      });
    } catch {
      // Already gone
    }
    removePidFile();
    removeLockFile();
    setStatus({ state: 'stopped', port: SERVER_PORT });
    return;
  }

  removePidFile();
  removeLockFile();
  setStatus({ state: 'stopped', port: SERVER_PORT });
}

function killProcess(proc: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.log('[server-manager] Force-killing server');
      proc.kill('SIGKILL');
      resolve();
    }, 5000);

    proc.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    proc.kill('SIGTERM');
  });
}

/**
 * Get current server status.
 */
export function getServerStatus(): ServerStatus {
  return { ...currentStatus };
}

/**
 * Restart: stop then start.
 */
export async function restartServer(): Promise<ServerStatus> {
  await stopServer();
  return startServer();
}
