import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, Notification, nativeImage, shell, Tray } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, stopServer, getServerStatus, restartServer } from './server-manager';
import type { ServerManagerConfig } from './server-manager';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const DIST = path.join(__dirname, '../dist');

// ── App mode & config ────────────────────────────────────────────────

type AppMode = 'client' | 'host';

interface ServerConfig {
  appMode: AppMode;
  port: number;
  pin: string;
  obsidianVaultPath: string;
  hostServerUrl: string;
  autoStartHost: boolean;
}

const CONFIG_PATH = path.join(app.getPath('userData'), 'server-config.json');

function loadConfig(): ServerConfig {
  const defaults: ServerConfig = {
    appMode: 'client',
    port: 8000,
    pin: '123456',
    obsidianVaultPath: '',
    hostServerUrl: '',
    autoStartHost: false,
  };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      const merged = { ...defaults, ...saved };
      // Migration: existing users (had port/pin but no appMode) become hosts
      if (!('appMode' in saved) && ('port' in saved || 'pin' in saved)) {
        merged.appMode = 'host';
        merged.autoStartHost = true;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
      }
      return merged;
    }
  } catch { /* use defaults */ }
  return defaults;
}

function saveConfig(updates: Partial<ServerConfig>): ServerConfig {
  const current = loadConfig();
  const merged = { ...current, ...updates };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

function getServerManagerConfig(config: ServerConfig): ServerManagerConfig {
  return {
    port: config.port,
    pin: config.pin,
    obsidianVaultPath: config.obsidianVaultPath,
  };
}

// ── System tray ──────────────────────────────────────────────────────

function createTrayIcon(): Tray {
  // Try to load icon from build resources, fall back to programmatic icon
  const iconPath = path.join(__dirname, '../build/tray-icon.png');
  let icon: Electron.NativeImage;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } else {
    // Programmatic 16x16 icon (simple filled circle)
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - 7.5, dy = y - 7.5;
        const inside = dx * dx + dy * dy <= 49; // radius ~7
        const offset = (y * size + x) * 4;
        canvas[offset] = inside ? 100 : 0;     // R
        canvas[offset + 1] = inside ? 140 : 0; // G
        canvas[offset + 2] = inside ? 255 : 0; // B
        canvas[offset + 3] = inside ? 255 : 0; // A
      }
    }
    icon = nativeImage.createFromBuffer(canvas, { width: size, height: size });
  }
  return new Tray(icon);
}

function setupTray() {
  tray = createTrayIcon();
  tray.setToolTip('ClawChat');

  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const config = loadConfig();
  const status = getServerStatus();

  if (config.appMode === 'host') {
    const stateLabel = status.state === 'running'
      ? 'Host Running'
      : status.state === 'starting'
        ? 'Starting...'
        : status.state === 'error'
          ? 'Error'
          : 'Stopped';

    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `ClawChat — ${stateLabel}`, enabled: false },
      { type: 'separator' },
      {
        label: 'Show Window',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Stop Server',
        enabled: status.state === 'running' || status.state === 'starting',
        click: async () => {
          await stopServer();
          updateTrayMenu();
        },
      },
      {
        label: 'Restart Server',
        enabled: status.state !== 'starting',
        click: async () => {
          await restartServer(getServerManagerConfig(loadConfig()));
          updateTrayMenu();
        },
      },
      { type: 'separator' },
      { label: 'Quit ClawChat', click: () => app.quit() },
    ]));
  } else {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'ClawChat — Client', enabled: false },
      { type: 'separator' },
      {
        label: 'Show Window',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
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
ipcMain.handle('server:getStatus', () => getServerStatus());
ipcMain.handle('server:getConfig', () => loadConfig());

ipcMain.handle('server:updateConfig', async (_e, updates: Partial<ServerConfig>) => {
  const config = saveConfig(updates);

  // Handle OS login auto-start
  if ('autoStartHost' in updates) {
    app.setLoginItemSettings({ openAtLogin: !!config.autoStartHost });
  }

  // Restart server if host mode and server-related config changed
  if (config.appMode === 'host' && ('port' in updates || 'pin' in updates || 'obsidianVaultPath' in updates)) {
    await restartServer(getServerManagerConfig(config));
    updateTrayMenu();
  }

  return config;
});

ipcMain.handle('server:setAppMode', async (_e, mode: AppMode) => {
  const config = saveConfig({ appMode: mode });

  if (mode === 'host') {
    await startServer(getServerManagerConfig(config));
    if (config.autoStartHost) {
      app.setLoginItemSettings({ openAtLogin: true });
    }
  } else {
    await stopServer();
    app.setLoginItemSettings({ openAtLogin: false });
  }

  updateTrayMenu();
  return config;
});

ipcMain.handle('server:getAppMode', () => loadConfig().appMode);

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

app.whenReady().then(async () => {
  createWindow();
  setupTray();
  setupAutoUpdater();

  const config = loadConfig();

  if (config.appMode === 'host') {
    await startServer(getServerManagerConfig(config));
    if (config.autoStartHost) {
      app.setLoginItemSettings({ openAtLogin: true });
    }
    updateTrayMenu();
  }

  // Global shortcut for quick capture (Cmd/Ctrl+Shift+Space)
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('open-quick-capture');
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  const config = loadConfig();
  if (config.appMode === 'host') {
    // Host mode: server keeps running, tray keeps process alive
    // On macOS this is standard (app stays in dock). On Windows/Linux the tray keeps it.
    return;
  }
  // Client mode: standard quit behavior
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  globalShortcut.unregisterAll();
  const config = loadConfig();
  if (config.appMode === 'host') {
    await stopServer();
  }
});
