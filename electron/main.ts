import { app, BrowserWindow, Tray, Menu, nativeImage, safeStorage, ipcMain, Notification, dialog, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { startServer, stopServer, restartServer, getServerStatus } from './server-manager';

// Suppress EPIPE errors when the parent process pipe closes (e.g. dev server stops)
process.stdout?.on?.('error', () => {});
process.stderr?.on?.('error', () => {});

// ── Secure store helpers ──────────────────────────────────────────────
function getStorePath(): string {
  return path.join(app.getPath('userData'), 'secure-store.json');
}

function readStore(): Record<string, string> {
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeStore(data: Record<string, string>): void {
  fs.writeFileSync(getStorePath(), JSON.stringify(data, null, 2), 'utf-8');
}

// ── Server config helpers ─────────────────────────────────────────────
function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'server-config.json');
}

function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(data: Record<string, unknown>): void {
  fs.writeFileSync(getConfigPath(), JSON.stringify(data, null, 2), 'utf-8');
}

// ── IPC handlers for encrypted storage ────────────────────────────────
const canEncrypt = safeStorage.isEncryptionAvailable();

ipcMain.handle('secure-store:set', (_event, key: string, value: string) => {
  const store = readStore();
  if (canEncrypt) {
    const encrypted = safeStorage.encryptString(value);
    store[key] = encrypted.toString('base64');
  } else {
    // Fallback: store plaintext when Keychain is unavailable (e.g. SSH/CI)
    store[key] = 'plain:' + Buffer.from(value, 'utf-8').toString('base64');
  }
  writeStore(store);
});

ipcMain.handle('secure-store:get', (_event, key: string): string | null => {
  const store = readStore();
  const raw = store[key];
  if (!raw) return null;
  if (raw.startsWith('plain:')) {
    return Buffer.from(raw.slice(6), 'base64').toString('utf-8');
  }
  if (canEncrypt) {
    return safeStorage.decryptString(Buffer.from(raw, 'base64'));
  }
  return null;
});

ipcMain.handle('secure-store:delete', (_event, key: string) => {
  const store = readStore();
  delete store[key];
  writeStore(store);
});

// ── IPC handler for opening Obsidian vault ───────────────────────────
ipcMain.handle('obsidian:open-vault', async () => {
  const config = readConfig();

  const vaultPath = (config.obsidianVaultPath as string) ?? '';
  if (!vaultPath) {
    dialog.showErrorBox('Obsidian', 'No Obsidian vault path is configured. Set it in Settings first.');
    return;
  }

  const vaultName = path.basename(vaultPath);
  const uri = `obsidian://open?vault=${encodeURIComponent(vaultName)}`;

  try {
    await shell.openExternal(uri);
  } catch {
    dialog.showErrorBox('Obsidian', 'Could not open Obsidian. Make sure it is installed.');
  }
});

// ── IPC handler for app icon badge ────────────────────────────────────
ipcMain.on('badge:set', (_event, count: number) => {
  app.setBadgeCount(count);
});

// ── IPC handler for desktop notifications ────────────────────────────
ipcMain.on('notification:show', (
  _event,
  title: string,
  body: string,
  options?: { silent?: boolean; itemType?: string; itemId?: string },
) => {
  const notification = new Notification({
    title,
    body,
    silent: options?.silent ?? false,
    // Electron supports actions on macOS
    ...(options?.itemId && process.platform === 'darwin' ? {
      actions: [{ type: 'button' as const, text: 'Mark Done' }],
      hasReply: false,
    } : {}),
  });
  notification.on('action', (_actionEvent, actionIndex) => {
    if (actionIndex === 0 && options?.itemId) {
      // "Mark Done" action — send to renderer to handle API call
      mainWindow?.webContents.send('notification:action', {
        action: 'mark_done',
        itemType: options.itemType,
        itemId: options.itemId,
      });
    }
  });
  notification.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
    if (options?.itemId && options?.itemType) {
      const route = options.itemType === 'todo' ? `/tasks/${options.itemId}` : `/events/${options.itemId}`;
      mainWindow?.webContents.send('navigate', route);
    }
  });
  notification.show();
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'bottom' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('close', (e) => {
    if (tray && !app.isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('ClawChat');

  updateTrayMenu();

  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const serverStatus = getServerStatus();
  const serverRunning = serverStatus.state === 'running';

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: serverRunning ? 'Restart local server' : 'Start local server',
      click: async () => {
        if (serverRunning) {
          await restartServer();
        } else {
          await startServer();
        }
        updateTrayMenu();
      },
    },
    {
      label: 'Stop local server',
      enabled: serverRunning,
      click: async () => {
        await stopServer();
        updateTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit UI',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

// ── Auto-updater setup ─────────────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update-downloaded');
  });

  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update-error', err.message);
  });

  // IPC handlers for renderer control
  ipcMain.handle('update:check', () => autoUpdater.checkForUpdates());
  ipcMain.handle('update:download', () => autoUpdater.downloadUpdate());
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());

  // Check on startup and every 4 hours
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

// ── IPC: server management ───────────────────────────────────────────

function registerServerIpc() {
  ipcMain.handle('server:status', () => getServerStatus());

  ipcMain.handle('server:restart', async () => {
    const status = await restartServer();
    updateTrayMenu();
    return status;
  });

  ipcMain.handle('server:config', () => readConfig());

  ipcMain.handle('server:update-config', (_event, updates: Record<string, unknown>) => {
    const config = readConfig();
    Object.assign(config, updates);
    writeConfig(config);
    return config;
  });

  ipcMain.handle('server:select-folder', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('server:network-info', () => {
    const interfaces = os.networkInterfaces();
    const addresses: { ip: string; name: string; networkType?: string }[] = [];

    for (const [name, nets] of Object.entries(interfaces)) {
      if (!nets) continue;
      for (const net of nets) {
        // Skip internal (loopback) and link-local addresses
        if (net.internal) continue;
        if (net.family === 'IPv6' && net.scopeid !== 0) continue;

        let networkType: string | undefined;
        if (net.address.startsWith('100.')) {
          networkType = 'Tailscale';
        } else if (name.startsWith('wg') || name.startsWith('tun')) {
          networkType = 'VPN';
        }

        addresses.push({ ip: net.address, name, networkType });
      }
    }

    return { addresses };
  });
}

// ── App lifecycle ────────────────────────────────────────────────────

app.whenReady().then(async () => {
  registerServerIpc();

  // Create window immediately — don't block on server
  createWindow();
  createTray();
  setupAutoUpdater();

  // Start server in background; UI receives status via IPC events
  startServer().then(() => {
    updateTrayMenu();
  }).catch((err) => {
    console.error('[main] Server start error:', err);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // On non-macOS, closing all windows quits the UI but server keeps running
    app.quit();
  }
});

// Server intentionally NOT stopped on quit — it survives for mobile/LAN access.
// Users explicitly stop it via tray menu "Stop local server".
app.on('before-quit', () => {
  app.isQuitting = true;
});

// Augment Electron.App to include isQuitting
declare module 'electron' {
  interface App {
    isQuitting?: boolean;
  }
}
