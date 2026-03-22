import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const DIST = path.join(__dirname, '../dist');
const SERVER_DIR = path.join(__dirname, '../server');

// ── Server config (persisted to JSON) ─────────────────────────────────

interface ServerConfig {
  port: number;
  pin: string;
  obsidianVaultPath: string;
}

const CONFIG_PATH = path.join(app.getPath('userData'), 'server-config.json');

function loadConfig(): ServerConfig {
  const defaults: ServerConfig = { port: 8000, pin: '123456', obsidianVaultPath: '' };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) };
    }
  } catch { /* use defaults */ }
  return defaults;
}

function saveConfig(updates: Partial<ServerConfig>) {
  const current = loadConfig();
  const merged = { ...current, ...updates };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

// ── Server status ─────────────────────────────────────────────────────

type ServerState = 'starting' | 'running' | 'stopped' | 'error';

let serverStatus: { state: ServerState; port: number; pid?: number; error?: string } = {
  state: 'stopped',
  port: 8000,
};

function setServerStatus(state: ServerState, extra?: { pid?: number; error?: string }) {
  serverStatus = { state, port: loadConfig().port, ...extra };
  mainWindow?.webContents.send('server-status-change', serverStatus);
}

// ── Spawn the Python backend ──────────────────────────────────────────

function findPython(): string {
  // Check for venv inside server dir first
  const venvPython = process.platform === 'win32'
    ? path.join(SERVER_DIR, 'venv', 'Scripts', 'python.exe')
    : path.join(SERVER_DIR, 'venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) return venvPython;
  // Fallback to system python
  return process.platform === 'win32' ? 'python' : 'python3';
}

function startServer() {
  if (serverProcess) return; // already running

  const config = loadConfig();
  const python = findPython();

  setServerStatus('starting');

  // Build .env content for the server
  const envVars: Record<string, string> = {
    ...process.env as Record<string, string>,
    HOST: '0.0.0.0',
    PORT: String(config.port),
    PIN: config.pin,
  };
  if (config.obsidianVaultPath) {
    envVars.OBSIDIAN_VAULT_PATH = config.obsidianVaultPath;
  }

  // Auto-detect Obsidian CLI path if not explicitly set
  if (!envVars.OBSIDIAN_CLI_COMMAND) {
    const obsidianExe = process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'obsidian', 'Obsidian.exe')
      : process.platform === 'darwin'
        ? '/Applications/Obsidian.app/Contents/MacOS/Obsidian'
        : 'obsidian';
    if (fs.existsSync(obsidianExe)) {
      envVars.OBSIDIAN_CLI_COMMAND = obsidianExe;
    }
  }

  const uvicornArgs = ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', String(config.port)];
  if (VITE_DEV_SERVER_URL) uvicornArgs.push('--reload');

  serverProcess = spawn(python, uvicornArgs, {
    cwd: SERVER_DIR,
    env: envVars,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout?.on('data', (data: Buffer) => {
    const text = data.toString();
    console.log('[server]', text);
    // uvicorn prints "Uvicorn running on ..." when ready
    if (text.includes('Uvicorn running') || text.includes('Application startup complete')) {
      setServerStatus('running', { pid: serverProcess?.pid });
    }
  });

  serverProcess.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    console.error('[server]', text);
    // uvicorn often logs startup to stderr
    if (text.includes('Uvicorn running') || text.includes('Application startup complete')) {
      setServerStatus('running', { pid: serverProcess?.pid });
    }
  });

  serverProcess.on('error', (err) => {
    console.error('[server] Failed to start:', err.message);
    setServerStatus('error', { error: err.message });
    serverProcess = null;
  });

  serverProcess.on('exit', (code) => {
    console.log('[server] Exited with code', code);
    if (serverStatus.state !== 'error') {
      setServerStatus('stopped');
    }
    serverProcess = null;
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
    setServerStatus('stopped');
  }
}

// ── Window ────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    title: 'ClawChat',
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(DIST, 'index.html'));
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────

ipcMain.on('show-notification', (_e, title: string, body: string, opts?: { silent?: boolean }) => {
  const n = new Notification({ title, body, silent: opts?.silent });
  n.show();
});

ipcMain.on('set-badge-count', (_e, count: number) => {
  app.setBadgeCount(count);
});

// Server management IPC
ipcMain.handle('server:getStatus', () => serverStatus);
ipcMain.handle('server:getConfig', () => loadConfig());
ipcMain.handle('server:updateConfig', (_e, updates: Partial<ServerConfig>) => {
  saveConfig(updates);
  // Restart server with new config
  stopServer();
  startServer();
});
ipcMain.handle('server:getNetworkInfo', async () => {
  const { networkInterfaces } = await import('node:os');
  const nets = networkInterfaces();
  const addresses: { ip: string; name: string }[] = [];
  for (const [name, ifaces] of Object.entries(nets)) {
    for (const iface of ifaces || []) {
      if ((iface.family === 'IPv4' || (iface.family as unknown) === 4) && !iface.internal && !iface.address.startsWith('169.254.')) {
        addresses.push({ ip: iface.address, name });
      }
    }
  }
  return { addresses };
});
ipcMain.handle('server:selectFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('server:openObsidianVault', () => {
  const config = loadConfig();
  if (config.obsidianVaultPath) {
    const vaultName = path.basename(config.obsidianVaultPath);
    shell.openExternal(`obsidian://open?vault=${encodeURIComponent(vaultName)}`);
  }
});

// ── Auto-updater ──────────────────────────────────────────────────────

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update-downloaded');
  });

  ipcMain.handle('updater:check', () => autoUpdater.checkForUpdates());
  ipcMain.handle('updater:download', () => autoUpdater.downloadUpdate());
  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall(false, true);
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  startServer();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopServer();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopServer();
});
