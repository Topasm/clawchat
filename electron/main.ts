import { app, BrowserWindow, Tray, Menu, nativeImage, safeStorage, ipcMain, Notification, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';
import fs from 'node:fs';
import { ServerManager } from './server-manager';

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

// ── IPC handler for desktop notifications ────────────────────────────
ipcMain.on('notification:show', (_event, title: string, body: string) => {
  const notification = new Notification({ title, body, silent: false });
  notification.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  notification.show();
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const serverManager = new ServerManager();

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

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
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

app.whenReady().then(async () => {
  // Register server IPC handlers before window creation
  serverManager.registerIPC();

  // Push status changes to renderer
  serverManager.onStatusChange((status) => {
    mainWindow?.webContents.send('server:status-changed', status);
  });

  // Start server, then create window
  try {
    await serverManager.start();
    await serverManager.waitForReady();
  } catch (err) {
    dialog.showErrorBox(
      'Server Error',
      `Failed to start the ClawChat server.\n\n${err instanceof Error ? err.message : String(err)}\n\nThe app will launch but may not function correctly.`,
    );
  }

  createWindow();
  createTray();
  setupAutoUpdater();

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
    app.quit();
  }
});

app.on('before-quit', async () => {
  app.isQuitting = true;
  await serverManager.stop();
});

// Augment Electron.App to include isQuitting
declare module 'electron' {
  interface App {
    isQuitting?: boolean;
  }
}
