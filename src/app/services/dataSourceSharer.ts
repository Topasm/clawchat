import apiClient from './apiClient';
import { logger } from './logger';
import { platformApi } from '../platform';
import type { SourceAnswer } from '../platform/nativePlatformTypes';
import type { SharedSourceSetting } from '../stores/useSettingsStore';

/**
 * Answers other devices' requests for the folders this machine shares.
 *
 * The folder stays on this disk. Home queues a phone's request; this loop
 * collects it, the Rust shell reads the folder within what was shared, and
 * the answer goes back through Home. A long poll keeps the answer prompt
 * without a push channel: Home holds the claim open until a request arrives.
 *
 * Kept apart from the worker that runs delegated work. Sharing a vault does
 * not offer this machine for runs, and a run that takes minutes must not hold
 * up a phone waiting for a note.
 */

export interface DataSourceSharerOptions {
  /** How this machine is named to the server. */
  label: string;
  /** Stable identity; the same one the worker uses. */
  deviceId: string;
  sources: SharedSourceSetting[];
  /** Seconds Home may hold a claim open waiting for a request. */
  claimWaitSeconds?: number;
  /** How often the light index of each source is sent again. */
  indexIntervalMs?: number;
  /** Pause after a failed claim before asking again. */
  retryDelayMs?: number;
  /** Called with each source's server id once it is registered. */
  onRegistered?: (localId: string, remoteId: string) => void;
}

interface ClaimedDataQuery {
  query_id: string;
  source_id: string;
  op: 'list' | 'read' | 'search';
  path: string;
  query?: string | null;
  include_folders: string[];
  exclude_folders: string[];
}

interface RegisteredSource {
  id: string;
  host_id: string;
}

const DEFAULT_CLAIM_WAIT_SECONDS = 20;
const DEFAULT_INDEX_INTERVAL_MS = 10 * 60_000;
const DEFAULT_RETRY_DELAY_MS = 5_000;

function isoFromSeconds(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : null;
}

/** The answer in the shape Home expects. */
export function toServerAnswer(answer: SourceAnswer) {
  return {
    ok: answer.ok,
    error: answer.error ?? null,
    entries: answer.entries.map((entry) => ({
      path: entry.path,
      is_dir: entry.isDir,
      size: entry.size ?? null,
      modified_at: isoFromSeconds(entry.modifiedAt),
    })),
    matches: answer.matches.map((match) => ({
      path: match.path,
      snippet: match.snippet ?? null,
      line: match.line ?? null,
    })),
    content: answer.content ?? null,
    truncated: answer.truncated,
  };
}

export class DataSourceSharer {
  private stopped = false;
  private hostId: string | null = null;
  /** Server source id -> the local folder it stands for. */
  private readonly bySourceId = new Map<string, SharedSourceSetting>();
  private abort: AbortController | null = null;
  private indexTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: DataSourceSharerOptions) {}

  start(): void {
    this.stopped = false;
    void this.run();
    this.indexTimer = setInterval(
      () => void this.refreshIndexes(),
      this.options.indexIntervalMs ?? DEFAULT_INDEX_INTERVAL_MS,
    );
  }

  /** Stop asking. A request already being read finishes on its own. */
  stop(): void {
    this.stopped = true;
    this.abort?.abort();
    if (this.indexTimer !== null) clearInterval(this.indexTimer);
    this.indexTimer = null;
  }

  private async run(): Promise<void> {
    const retryDelay = this.options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    while (!this.stopped) {
      try {
        if (this.hostId === null) {
          await this.register();
          await this.refreshIndexes();
        }
        if (this.hostId === null) {
          await this.pause(retryDelay);
          continue;
        }
        const job = await this.claim();
        if (job) await this.answer(job);
      } catch (error) {
        if (this.stopped) return;
        if ((error as { response?: { status?: number } }).response?.status === 404) {
          // The machine or a source was removed on the server; offer them again.
          this.hostId = null;
          this.bySourceId.clear();
        }
        logger.warn('Data source request loop failed; retrying', error);
        await this.pause(retryDelay);
      }
    }
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async register(): Promise<void> {
    for (const source of this.options.sources) {
      if (this.stopped) return;
      const response = await apiClient.post<RegisteredSource>('/data-sources', {
        device_id: this.options.deviceId,
        host_label: this.options.label,
        platform: platformApi.runtime.os,
        kind: source.kind,
        name: source.name,
        capabilities: ['list', 'read', 'search'],
        include_folders: source.includeFolders,
        exclude_folders: source.excludeFolders,
      });
      this.bySourceId.set(response.data.id, source);
      this.hostId = response.data.host_id;
      this.options.onRegistered?.(source.id, response.data.id);
    }
  }

  /** Send each source's file names and dates, so Home can list them while this machine is off. */
  async refreshIndexes(): Promise<void> {
    const worker = platformApi.worker;
    if (!worker) return;
    for (const [sourceId, source] of this.bySourceId) {
      if (this.stopped) return;
      try {
        const files = await worker.indexSource(
          source.root,
          source.includeFolders,
          source.excludeFolders,
        );
        await apiClient.put(`/data-sources/${sourceId}/index`, {
          files: files.map((file) => ({
            path: file.path,
            size: file.size,
            modified_at: isoFromSeconds(file.modifiedAt),
          })),
        });
      } catch (error) {
        // One unreadable folder must not stop the others being listed.
        logger.warn(`Could not send the index of ${source.name}`, error);
      }
    }
  }

  private async claim(): Promise<ClaimedDataQuery | null> {
    const wait = this.options.claimWaitSeconds ?? DEFAULT_CLAIM_WAIT_SECONDS;
    this.abort = new AbortController();
    const response = await apiClient.post<ClaimedDataQuery | null>(
      `/execution-hosts/${this.hostId}/data-queries/claim`,
      undefined,
      {
        params: { wait },
        signal: this.abort.signal,
        // Home holds the request open for `wait` seconds by design.
        timeout: (wait + 15) * 1000,
      },
    );
    return response.data ?? null;
  }

  private async answer(job: ClaimedDataQuery): Promise<void> {
    const source = this.bySourceId.get(job.source_id);
    const worker = platformApi.worker;
    let answer: SourceAnswer;
    if (!source || !worker) {
      answer = { ok: false, error: 'unknown_source', entries: [], matches: [], truncated: false };
    } else {
      try {
        answer = await worker.querySource({
          root: source.root,
          op: job.op,
          path: job.path,
          query: job.query ?? null,
          // Home's rules are the ones the request was checked against; what
          // this machine holds back is held back regardless.
          includeFolders: job.include_folders,
          excludeFolders: [...new Set([...job.exclude_folders, ...source.excludeFolders])],
        });
      } catch (error) {
        logger.warn('Could not read the shared folder', error);
        answer = { ok: false, error: 'io_error', entries: [], matches: [], truncated: false };
      }
    }
    await apiClient.post(
      `/execution-hosts/${this.hostId}/data-queries/${job.query_id}/answer`,
      toServerAnswer(answer),
    );
  }
}
