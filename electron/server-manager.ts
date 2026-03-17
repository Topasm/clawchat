import { app, dialog, ipcMain } from 'electron';
import { execFile, spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import http from 'node:http';

export type ServerStatus = 'initializing' | 'installing' | 'starting' | 'ready' | 'error';

interface ServerConfig {
  jwtSecret: string;
  pin: string;
  port: number;
  obsidianVaultPath?: string;
}

interface NetworkAddress {
  ip: string;
  name: string;
  isTailscale: boolean;
}

export class ServerManager {
  private process: ChildProcess | null = null;
  private status: ServerStatus = 'initializing';
  private config!: ServerConfig;
  private pythonPath: string | null = null;
  private venvPython: string | null = null;
  private restartCount = 0;
  private maxRestarts = 5;
  private stopping = false;
  private statusListener: ((status: ServerStatus) => void) | null = null;
  private logStream: fs.WriteStream | null = null;

  private get userDataPath() { return app.getPath('userData'); }
  private get serverDataPath() { return path.join(this.userDataPath, 'server-data'); }
  private get venvPath() { return path.join(this.userDataPath, 'server-venv'); }
  private get configPath() { return path.join(this.userDataPath, 'server-config.json'); }
  private get logPath() { return path.join(this.userDataPath, 'server.log'); }

  private get serverSourcePath(): string {
    if (process.env.VITE_DEV_SERVER_URL) {
      // Dev mode: server source is in the repo root
      return path.resolve(__dirname, '../server');
    }
    return path.join(process.resourcesPath!, 'server');
  }

  onStatusChange(cb: (status: ServerStatus) => void) {
    this.statusListener = cb;
  }

  private setStatus(status: ServerStatus) {
    this.status = status;
    this.statusListener?.(status);
  }

  getStatus(): ServerStatus { return this.status; }
  getConfig(): { port: number; pin: string; obsidianVaultPath: string } {
    return { port: this.config.port, pin: this.config.pin, obsidianVaultPath: this.config.obsidianVaultPath ?? '' };
  }

  updateConfig(updates: Partial<Pick<ServerConfig, 'obsidianVaultPath'>>): void {
    const vaultPathChanged = 'obsidianVaultPath' in updates
      && updates.obsidianVaultPath !== this.config.obsidianVaultPath;

    Object.assign(this.config, updates);
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');

    if (vaultPathChanged && this.status === 'ready') {
      this.restartServer();
    }
  }

  async restartServer(): Promise<void> {
    await this.stop();
    this.restartCount = 0;
    this.stopping = false;
    this.setStatus('starting');
    this.spawnServer();
    await this.waitForReady();
  }

  // ── Find system Python ────────────────────────────────────────────

  private async findPython(): Promise<string> {
    const candidates = process.platform === 'win32'
      ? ['py', 'python3.13', 'python3.12', 'python3.11', 'python3', 'python']
      : ['python3.13', 'python3.12', 'python3.11', 'python3', 'python'];

    for (const cmd of candidates) {
      try {
        const version = await this.execCmd(cmd, ['--version']);
        const match = version.match(/Python (\d+)\.(\d+)/);
        if (match) {
          const [, major, minor] = match.map(Number);
          if (major >= 3 && minor >= 11) return cmd;
        }
      } catch { /* try next */ }
    }

    dialog.showErrorBox(
      'Python Not Found',
      'ClawChat requires Python 3.11 or later.\n\nPlease install Python from https://python.org and restart the app.',
    );
    throw new Error('Python >= 3.11 not found');
  }

  // ── Virtual environment ───────────────────────────────────────────

  private async ensureVenv(): Promise<void> {
    const isWin = process.platform === 'win32';
    this.venvPython = isWin
      ? path.join(this.venvPath, 'Scripts', 'python.exe')
      : path.join(this.venvPath, 'bin', 'python');

    if (!fs.existsSync(this.venvPython)) {
      this.setStatus('installing');
      await this.execCmd(this.pythonPath!, ['-m', 'venv', this.venvPath]);
    }

    // Always run pip install (fast when up-to-date)
    this.setStatus('installing');
    const reqPath = path.join(this.serverSourcePath, 'requirements.txt');
    await this.execCmd(this.venvPython, ['-m', 'pip', 'install', '-r', reqPath, '--quiet'], 300_000);
  }

  // ── Configuration ─────────────────────────────────────────────────

  private ensureConfig(): void {
    let config: ServerConfig;
    try {
      config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
    } catch {
      config = {
        jwtSecret: crypto.randomBytes(32).toString('hex'),
        pin: String(Math.floor(100000 + Math.random() * 900000)),
        port: 8000,
      };
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
    }
    this.config = config;
  }

  // ── Start server ──────────────────────────────────────────────────

  async start(): Promise<void> {
    this.stopping = false;
    this.setStatus('initializing');

    // Ensure data directories exist
    fs.mkdirSync(this.serverDataPath, { recursive: true });
    fs.mkdirSync(path.join(this.serverDataPath, 'uploads'), { recursive: true });

    this.ensureConfig();
    this.pythonPath = await this.findPython();
    await this.ensureVenv();

    this.setStatus('starting');
    this.spawnServer();
  }

  private spawnServer(): void {
    if (this.stopping) return;

    // Open log file for appending
    this.logStream = fs.createWriteStream(this.logPath, { flags: 'a' });
    this.logStream.write(`\n--- Server starting at ${new Date().toISOString()} ---\n`);

    const dbPath = path.join(this.serverDataPath, 'clawchat.db');
    const uploadDir = path.join(this.serverDataPath, 'uploads');

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      DATABASE_URL: `sqlite+aiosqlite:///${dbPath}`,
      JWT_SECRET: this.config.jwtSecret,
      PIN: this.config.pin,
      UPLOAD_DIR: uploadDir,
      PORT: String(this.config.port),
      ...(this.config.obsidianVaultPath ? { OBSIDIAN_VAULT_PATH: this.config.obsidianVaultPath } : {}),
    };

    this.process = spawn(
      this.venvPython!,
      ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', String(this.config.port)],
      { cwd: this.serverSourcePath, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    this.process.stdout?.pipe(this.logStream, { end: false });
    this.process.stderr?.pipe(this.logStream, { end: false });

    this.process.on('exit', (code) => {
      this.logStream?.write(`--- Server exited with code ${code} at ${new Date().toISOString()} ---\n`);
      this.logStream?.end();
      this.logStream = null;

      if (!this.stopping && this.restartCount < this.maxRestarts) {
        this.restartCount++;
        const delay = Math.min(1000 * Math.pow(2, this.restartCount - 1), 30000);
        this.setStatus('starting');
        setTimeout(() => this.spawnServer(), delay);
      } else if (!this.stopping) {
        this.setStatus('error');
      }
    });
  }

  // ── Wait for ready ────────────────────────────────────────────────

  async waitForReady(timeout = 30000): Promise<void> {
    // Use longer timeout if venv was just created (pip install)
    const actualTimeout = !fs.existsSync(
      path.join(this.serverDataPath, 'clawchat.db'),
    ) ? 120000 : timeout;

    const start = Date.now();
    while (Date.now() - start < actualTimeout) {
      try {
        await this.healthCheck();
        this.restartCount = 0;
        this.setStatus('ready');
        return;
      } catch { /* keep polling */ }
      await this.sleep(500);
    }
    this.setStatus('error');
    throw new Error('Server did not become ready in time');
  }

  private healthCheck(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${this.config.port}/api/health`,
        { timeout: 2000 },
        (res) => {
          if (res.statusCode === 200) resolve();
          else reject(new Error(`Health check returned ${res.statusCode}`));
          res.resume();
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  // ── Stop server ───────────────────────────────────────────────────

  async stop(): Promise<void> {
    this.stopping = true;
    if (!this.process) return;

    const proc = this.process;
    this.process = null;

    if (process.platform === 'win32') {
      // On Windows, use taskkill to kill process tree
      try {
        await this.execCmd('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
      } catch { /* already dead */ }
    } else {
      proc.kill('SIGTERM');
      // Wait up to 5s, then SIGKILL
      const killed = await Promise.race([
        new Promise<boolean>((resolve) => proc.on('exit', () => resolve(true))),
        this.sleep(5000).then(() => false),
      ]);
      if (!killed) proc.kill('SIGKILL');
    }
  }

  // ── Network info ──────────────────────────────────────────────────

  getNetworkInfo(): { addresses: NetworkAddress[] } {
    const interfaces = os.networkInterfaces();
    const addresses: NetworkAddress[] = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family !== 'IPv4' || addr.internal) continue;
        const isTailscale = (
          addr.address.startsWith('100.') &&
          (name.startsWith('utun') || name.startsWith('tailscale') || name === 'Tailscale')
        );
        addresses.push({ ip: addr.address, name, isTailscale });
      }
    }

    // Sort: Tailscale first, then by interface name
    addresses.sort((a, b) => {
      if (a.isTailscale !== b.isTailscale) return a.isTailscale ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { addresses };
  }

  // ── IPC registration ──────────────────────────────────────────────

  registerIPC(): void {
    ipcMain.handle('server:status', () => this.status);
    ipcMain.handle('server:config', () => this.getConfig());
    ipcMain.handle('server:network-info', () => this.getNetworkInfo());
    ipcMain.handle('server:update-config', (_event, updates: Partial<Pick<ServerConfig, 'obsidianVaultPath'>>) => {
      this.updateConfig(updates);
    });
    ipcMain.handle('server:select-folder', async () => {
      const { dialog: dlg } = await import('electron');
      const result = await dlg.showOpenDialog({ properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths.length) return null;
      return result.filePaths[0];
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private execCmd(cmd: string, args: string[], timeout = 60000): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
        if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
        else resolve((stdout + stderr).trim());
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
