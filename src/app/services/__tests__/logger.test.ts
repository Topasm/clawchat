import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '../logger';

describe('Logger privacy boundary', () => {
  let logger: Logger;

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logger = new Logger();
  });

  afterEach(() => {
    logger.dispose();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('redacts secrets before console output and local persistence', () => {
    logger.warn('Request failed token=message-secret', {
      authorization: 'Bearer metadata-secret',
      path: '/scratch/e1816a02/vault/private.md',
    });
    logger.error(
      'Connection failed',
      new Error('Bearer error-secret at /Users/alice/project/client.ts'),
    );
    logger.flush();

    const serializedEntries = JSON.stringify(logger.getEntries());
    const persisted = localStorage.getItem('clawchat-logs:v2');
    const consoleOutput = JSON.stringify([
      ...vi.mocked(console.warn).mock.calls,
      ...vi.mocked(console.error).mock.calls,
    ]);

    for (const output of [serializedEntries, persisted, consoleOutput]) {
      expect(output).not.toContain('message-secret');
      expect(output).not.toContain('metadata-secret');
      expect(output).not.toContain('error-secret');
      expect(output).not.toContain('e1816a02');
      expect(output).not.toContain('alice');
    }
    expect(persisted).toContain('[redacted]');
    expect(persisted).toContain('[local-path]');
  });

  it('drops legacy unredacted storage and sanitizes restored v2 entries', () => {
    logger.dispose();
    localStorage.setItem('clawchat-logs', JSON.stringify([{ token: 'legacy-secret' }]));
    localStorage.setItem(
      'clawchat-logs:v2',
      JSON.stringify([
        {
          timestamp: '2026-08-27T00:00:00.000Z',
          level: 'info',
          message: 'token=restored-secret',
          metadata: { password: 'restored-password' },
        },
      ]),
    );

    logger = new Logger();
    const restored = JSON.stringify(logger.getEntries());

    expect(localStorage.getItem('clawchat-logs')).toBeNull();
    expect(restored).not.toContain('legacy-secret');
    expect(restored).not.toContain('restored-secret');
    expect(restored).not.toContain('restored-password');
    expect(restored).toContain('[redacted]');
  });
});
