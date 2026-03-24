import { ChildProcess, spawn } from 'child_process';
import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';

const MAX_HEALTH_RETRIES = 30;

function getRetryInterval(attempt: number): number {
  if (attempt <= 5) return 150;
  if (attempt <= 10) return 300;
  return 500;
}

// ── Config passed by main.ts ────────────────────────────────────────

export interface ServerManagerConfig {
  port: number;
  pin: string;
  obsidianVaultPath: string;
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
let currentStatus: ServerStatus = { state: 'stopped', port: 8000 };
let activePort = 8000;

// ── Path helpers ─────────────────────────────────────────────────────

function getPidFilePath(): string {
  return path.join(app.getPath('userData'), 'server.pid');
}

function getLockFilePath(): string {
  return path.join(app.getPath('userData'), 'server.lock');
}

function getServerDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'server');
  }
  return path.join(app.getAppPath(), 'server');
}

function getDataDir(): string {
  const dataDir = path.join(app.getPath('userData'), 'server-data', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

function findPython(): string {
  const serverDir = getServerDir();
  const venvPaths = [
    path.join(serverDir, 'venv', 'bin', 'python'),
    path.join(serverDir, 'venv', 'Scripts', 'python.exe'),
  ];
  for (const p of venvPaths) {
    if (fs.existsSync(p)) return p;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function findServerBinary(): string | null {
  if (!app.isPackaged) return null;
  const ext = process.platform === 'win32' ? '.exe' : '';
  const binary = path.join(process.resourcesPath, 'server-bin', `clawchat-server${ext}`);
  return fs.existsSync(binary) ? binary : null;
}

function findObsidianCli(): string | undefined {
  if (process.env.OBSIDIAN_CLI_COMMAND) return process.env.OBSIDIAN_CLI_COMMAND;
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    candidates.push(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'obsidian', 'Obsidian.exe'));
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Obsidian.app/Contents/MacOS/Obsidian');
  } else {
    candidates.push('obsidian');
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

// ── Status broadcasting ──────────────────────────────────────────────

function setStatus(status: ServerStatus): void {
  currentStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('server-status-change', status);
    }
  }
}

// ── PID file management ──────────────────────────────────────────────

function writePidFile(pid: number): void {
  try {
    fs.writeFileSync(getPidFilePath(), String(pid), 'utf-8');
  } catch { /* non-fatal */ }
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
  try { fs.unlinkSync(getPidFilePath()); } catch { /* already gone */ }
}

function removeLockFile(): void {
  try { fs.unlinkSync(getLockFilePath()); } catch { /* already gone */ }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ── Health check ─────────────────────────────────────────────────────

function getHealthUrl(port: number): string {
  return `http://127.0.0.1:${port}/api/health`;
}

function checkHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(getHealthUrl(port), (res) => {
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

function waitForHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let attempts = 0;

    const check = () => {
      attempts++;
      const req = http.get(getHealthUrl(port), (res) => {
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

export async function startServer(config: ServerManagerConfig): Promise<ServerStatus> {
  const port = config.port;
  activePort = port;

  // 1. Already managed by this process?
  if (managedProcess && managedProcess.exitCode === null) {
    const healthy = await checkHealth(port);
    if (healthy) {
      const status: ServerStatus = { state: 'running', port, pid: managedProcess.pid };
      setStatus(status);
      return status;
    }
  }

  // 2. Detached server from a previous session still alive?
  const existingPid = readPidFile();
  if (existingPid && isProcessAlive(existingPid)) {
    const healthy = await checkHealth(port);
    if (healthy) {
      console.log(`[server-manager] Reusing existing server (PID ${existingPid})`);
      const status: ServerStatus = { state: 'running', port, pid: existingPid };
      setStatus(status);
      return status;
    }
    console.log(`[server-manager] Stale server (PID ${existingPid}), killing`);
    try { process.kill(existingPid, 'SIGKILL'); } catch { /* already gone */ }
    removePidFile();
  } else if (existingPid) {
    removePidFile();
  }

  // 3. Maybe another process already started serving
  const alreadyHealthy = await checkHealth(port);
  if (alreadyHealthy) {
    console.log('[server-manager] Server already healthy on port (external)');
    const status: ServerStatus = { state: 'running', port };
    setStatus(status);
    return status;
  }

  // 4. Spawn a new detached server
  setStatus({ state: 'starting', port });

  const dataDir = getDataDir();
  const uploadsDir = path.join(dataDir, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    HOST: '0.0.0.0',
    PORT: String(port),
    PIN: config.pin,
    DATABASE_URL: `sqlite+aiosqlite:///${path.join(dataDir, 'clawchat.db')}`,
    UPLOAD_DIR: uploadsDir,
  };

  if (config.obsidianVaultPath) {
    env.OBSIDIAN_VAULT_PATH = config.obsidianVaultPath;
  }

  const obsidianCli = findObsidianCli();
  if (obsidianCli) {
    env.OBSIDIAN_CLI_COMMAND = obsidianCli;
  }

  const binary = findServerBinary();
  const serverDir = getServerDir();

  console.log(`[server-manager] Starting server on port ${port}`);
  console.log(`[server-manager] Data dir: ${dataDir}`);

  try {
    if (binary) {
      // Packaged mode
      managedProcess = spawn(binary, [], {
        cwd: path.dirname(dataDir),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
    } else {
      // Dev mode
      const python = findPython();
      const uvicornArgs = ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', String(port)];
      if (process.env.VITE_DEV_SERVER_URL) uvicornArgs.push('--reload');

      console.log(`[server-manager] Python: ${python}`);

      managedProcess = spawn(python, uvicornArgs, {
        cwd: serverDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
    }

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
      setStatus({ state: 'stopped', port: activePort });
    });

    managedProcess.on('error', (err) => {
      console.error(`[server-manager] Failed to start server:`, err);
      removePidFile();
      managedProcess = null;
      setStatus({ state: 'error', port: activePort, error: err.message });
    });

    const healthy = await waitForHealth(port);
    if (!healthy) {
      throw new Error('Server failed health check after startup');
    }

    console.log(`[server-manager] Server is healthy on port ${port}`);
    const status: ServerStatus = { state: 'running', port, pid: managedProcess?.pid };
    setStatus(status);
    return status;

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[server-manager] Start failed: ${message}`);
    const status: ServerStatus = { state: 'error', port, error: message };
    setStatus(status);
    return status;
  }
}

export async function stopServer(): Promise<void> {
  if (managedProcess && managedProcess.exitCode === null) {
    console.log('[server-manager] Stopping managed server...');
    await killProcess(managedProcess);
    managedProcess = null;
    removePidFile();
    removeLockFile();
    setStatus({ state: 'stopped', port: activePort });
    return;
  }

  const pid = readPidFile();
  if (pid && isProcessAlive(pid)) {
    console.log(`[server-manager] Stopping detached server (PID ${pid})...`);
    try {
      process.kill(pid, 'SIGTERM');
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
    } catch { /* already gone */ }
    removePidFile();
    removeLockFile();
    setStatus({ state: 'stopped', port: activePort });
    return;
  }

  removePidFile();
  removeLockFile();
  setStatus({ state: 'stopped', port: activePort });
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

export function getServerStatus(): ServerStatus {
  return { ...currentStatus };
}

export async function restartServer(config: ServerManagerConfig): Promise<ServerStatus> {
  await stopServer();
  return startServer(config);
}
