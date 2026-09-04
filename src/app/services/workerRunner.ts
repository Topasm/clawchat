import apiClient from './apiClient';
import { platformApi } from '../platform';
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
  /** "claude" or "codex". */
  provider: string;
  /** Milliseconds between polls while idle. */
  pollIntervalMs?: number;
  /** Milliseconds between heartbeats while a job runs. */
  heartbeatIntervalMs?: number;
}

interface ClaimedJob {
  run_id: string;
  instruction: string;
  cwd: string;
  model: string | null;
}

const DEFAULT_POLL_INTERVAL_MS = 4000;
// Well inside the server's heartbeat timeout (RUN_HEARTBEAT_TIMEOUT_MINUTES,
// ten minutes by default), with room for a couple of missed posts.
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;

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
    await this.register();
    this.scheduleNextPoll(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async register(): Promise<void> {
    const response = await apiClient.post('/execution-hosts/register', {
      label: this.options.label,
      platform: platformApi.runtime.os,
    });
    this.hostId = response.data?.id ?? null;
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
    const worker = platformApi.worker;
    try {
      if (!worker) {
        // Claimed on a surface that cannot run anything. Hand it back as a
        // failure rather than leaving the run started and silent.
        await apiClient.post(`/runs/${job.run_id}/result`, {
          error: 'This machine cannot run work.',
        });
        return;
      }

      await apiClient.post(`/runs/${job.run_id}/heartbeat`, {
        progress: 10,
        message: 'Running on this machine',
      });

      // The server fails a run whose heartbeat lapses, on the reading that
      // the machine behind it is gone. A CLI run can take much longer than
      // that timeout, so keep saying we are here until it returns.
      const heartbeatMs = this.options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
      const heartbeat = setInterval(() => {
        apiClient
          .post(`/runs/${job.run_id}/heartbeat`, { message: 'Still running on this machine' })
          .catch((error: unknown) => logger.warn('Worker heartbeat failed', error));
      }, heartbeatMs);
      let result;
      try {
        result = await worker.run({
          provider: this.options.provider,
          prompt: job.instruction,
          cwd: job.cwd,
          model: job.model,
        });
      } finally {
        clearInterval(heartbeat);
      }
      await apiClient.post(`/runs/${job.run_id}/result`, {
        result: result.output || '(no output)',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await apiClient.post(`/runs/${job.run_id}/result`, { error: message });
      } catch (reportError) {
        // The run stays started on the server; its heartbeat lapsing is what
        // the recovery path already watches for.
        logger.warn('Could not report a failed worker run', reportError);
      }
    } finally {
      this.running = false;
    }
  }
}
