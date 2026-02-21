import { app, BrowserWindow, Tray, Menu, nativeImage, safeStorage, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

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
ipcMain.handle('secure-store:set', (_event, key: string, value: string) => {
  const encrypted = safeStorage.encryptString(value);
  const store = readStore();
  store[key] = encrypted.toString('base64');
  writeStore(store);
});

ipcMain.handle('secure-store:get', (_event, key: string): string | null => {
  const store = readStore();
  const base64 = store[key];
  if (!base64) return null;
  return safeStorage.decryptString(Buffer.from(base64, 'base64'));
});

ipcMain.handle('secure-store:delete', (_event, key: string) => {
  const store = readStore();
  delete store[key];
  writeStore(store);
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

app.whenReady().then(() => {
  createWindow();
  createTray();

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

app.on('before-quit', () => {
  app.isQuitting = true;
});

// Augment Electron.App to include isQuitting
declare module 'electron' {
  interface App {
    isQuitting?: boolean;
  }
}
