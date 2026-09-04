import apiClient from './apiClient';
import { platformApi } from '../platform';
import { useWorkerStore } from '../stores/useWorkerStore';
import { logger } from './logger';

/**
 * Runs the work this machine was addressed for.
 *
 * The loop lives here rather than in the Rust shell so it inherits the
 * session the app already holds — token refresh, workspace scoping and error
 * handling included. The shell contributes the one thing a browser cannot do:
 * starting a CLI in a directory on this machine.
 *
 * Nothing is queued for a machine that is off, so this only ever collects work
 * created while the app was running. That is why polling is enough: there is
 * no backlog to catch up on, and no push channel to keep alive.
 */

export interface WorkerRunnerOptions {
  /** How this machine is named to the server. */
  label: string;
  /** Stable identity; unlike the label, this never changes. */
  deviceId: string;
  /** "claude" or "codex". */
  provider: string;
  /** Milliseconds between polls while idle. */
  pollIntervalMs?: number;
}

interface ClaimedJob {
  run_id: string;
  instruction: string;
  cwd: string;
  model: string | null;
  project_id?: string | null;
  todo_title?: string | null;
}

interface HostProjectPath {
  project_id: string;
  path: string;
  context_updated_at: string | null;
}

const DEFAULT_POLL_INTERVAL_MS = 4000;
const RUN_HEARTBEAT_INTERVAL_MS = 60_000;

/** Read one local project folder and publish its bounded description. */
export async function uploadProjectContext(
  hostId: string,
  projectId: string,
  path: string,
): Promise<void> {
  const worker = platformApi.worker;
  if (!worker) return;
  const files = await worker.readContext(path);
  await apiClient.put(`/projects/${projectId}/workspace/context`, {
    host_id: hostId,
    files,
  });
}

export class WorkerRunner {
  private hostId: string | null = null;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private readonly options: WorkerRunnerOptions) {}

  get isRunning(): boolean {
    return !this.stopped;
  }

  /** Register this machine and begin collecting work for it. */
  async start(): Promise<void> {
    this.stopped = false;
    useWorkerStore
      .getState()
      .setRefreshProjectContext((projectId, path) => this.refreshProjectContext(projectId, path));
    const interval = this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    try {
      await this.register();
    } finally {
      // Registration can fail while the server is starting or the network is
      // moving. Keep the loop alive so "Connecting…" can recover on its own.
      this.scheduleNextPoll(this.hostId === null ? interval : 0);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    useWorkerStore.getState().reset();
  }

  private async register(): Promise<void> {
    const response = await apiClient.post('/execution-hosts/register', {
      label: this.options.label,
      device_id: this.options.deviceId,
      platform: platformApi.runtime.os,
    });
    this.hostId = response.data?.id ?? null;
    if (this.hostId === null) return;
    useWorkerStore.getState().setRegistered(this.hostId, this.options.label);
    // Checking in is the moment the server can first ask what the folders
    // here look like, and the app has just been opened on them.
    await this.refreshAllContexts();
  }

  /**
   * Send the server what a bound folder says about itself.
   *
   * The server never reads this disk; this is the only way its chat and run
   * prompts learn what the folder is for.
   */
  async refreshProjectContext(projectId: string, path: string): Promise<void> {
    if (this.hostId === null) return;
    await uploadProjectContext(this.hostId, projectId, path);
  }

  private async refreshAllContexts(): Promise<void> {
    if (!platformApi.worker || this.hostId === null) return;
    try {
      const response = await apiClient.get(`/execution-hosts/${this.hostId}/paths`);
      const rows: HostProjectPath[] = response.data ?? [];
      for (const row of rows) {
        try {
          await this.refreshProjectContext(row.project_id, row.path);
        } catch (error) {
          // One unreadable folder must not stop the others being described.
          logger.warn(`Could not send folder context for ${row.path}`, error);
        }
      }
    } catch (error) {
      logger.warn('Could not list the folders bound to this machine', error);
    }
  }

  private scheduleNextPoll(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.poll();
    }, delayMs);
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.running) return;
    const interval = this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    try {
      if (this.hostId === null) await this.register();
      if (this.hostId === null) {
        this.scheduleNextPoll(interval);
        return;
      }

      const claim = await apiClient.post(`/execution-hosts/${this.hostId}/jobs/claim`);
      const job: ClaimedJob | null = claim.data ?? null;
      if (job === null) {
        this.scheduleNextPoll(interval);
        return;
      }

      await this.execute(job);
      // Something was waiting, so look again immediately rather than idling
      // through a full interval with work outstanding.
      this.scheduleNextPoll(0);
    } catch (error) {
      logger.warn('Worker poll failed', error);
      this.scheduleNextPoll(interval);
    }
  }

  private async execute(job: ClaimedJob): Promise<void> {
    this.running = true;
    useWorkerStore
      .getState()
      .setBusy(job.run_id, job.todo_title || job.instruction.slice(0, 80) || null);
    const worker = platformApi.worker;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let heartbeatInFlight = false;

    const heartbeat = async (): Promise<void> => {
      if (heartbeatInFlight) return;
      heartbeatInFlight = true;
      try {
        await apiClient.post(`/runs/${job.run_id}/heartbeat`, {
          progress: 10,
          message: 'Running on this machine',
        });
      } catch (error) {
        // A transient heartbeat failure must not kill the local CLI. The next
        // tick can restore liveness, and the final result is reported once.
        logger.warn('Could not heartbeat worker run', error);
      } finally {
        heartbeatInFlight = false;
      }
    };

    try {
      if (!worker) {
        // Claimed on a surface that cannot run anything. Hand it back as a
        // failure rather than leaving the run started and silent.
        await apiClient.post(`/runs/${job.run_id}/result`, {
          error: 'This machine cannot run work.',
        });
        return;
      }

      await heartbeat();
      heartbeatTimer = setInterval(() => {
        void heartbeat();
      }, RUN_HEARTBEAT_INTERVAL_MS);

      if (job.project_id) {
        // The folder may have changed since it was last described; the run's
        // own instruction is already frozen, but the next chat turn is not.
        try {
          await this.refreshProjectContext(job.project_id, job.cwd);
        } catch (error) {
          logger.warn('Could not refresh folder context before the run', error);
        }
      }

      let outcome: { result: string } | { error: string };
      try {
        const result = await worker.run({
          provider: this.options.provider,
          prompt: job.instruction,
          cwd: job.cwd,
          model: job.model,
        });
        outcome = { result: result.output || '(no output)' };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outcome = { error: message };
      }
      try {
        await apiClient.post(`/runs/${job.run_id}/result`, outcome);
      } catch (reportError) {
        // The server may already have made the run terminal (for example a
        // cancellation or watchdog decision). Never submit a second result.
        logger.warn('Could not report worker run result', reportError);
      }
    } catch (error) {
      logger.warn('Worker execution setup failed', error);
    } finally {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
      }
      this.running = false;
      useWorkerStore.getState().setBusy(null);
    }
  }
}
