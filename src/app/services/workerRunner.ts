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
}

interface ClaimedJob {
  run_id: string;
  instruction: string;
  cwd: string;
  model: string | null;
}

const DEFAULT_POLL_INTERVAL_MS = 4000;
const RUN_HEARTBEAT_INTERVAL_MS = 60_000;

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
    }
  }
}
