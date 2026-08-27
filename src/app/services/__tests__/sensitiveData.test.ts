import { describe, expect, it } from 'vitest';
import { redactSensitiveText, sanitizeLogMetadata, sanitizeLogValue } from '../sensitiveData';

describe('sensitive log data', () => {
  it('redacts credentials and local paths embedded in text', () => {
    const result = redactSensitiveText(
      [
        'Authorization: Bearer super-secret-token',
        'token=query-secret',
        'https://example.test/ws?access_token=url-secret&mode=relay',
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature',
        '/scratch/e1816a02/private-vault/daily.md',
        String.raw`C:\Users\alice\vault\daily.md`,
      ].join(' '),
    );

    expect(result).not.toContain('super-secret-token');
    expect(result).not.toContain('query-secret');
    expect(result).not.toContain('url-secret');
    expect(result).not.toContain('eyJhbGci');
    expect(result).not.toContain('e1816a02');
    expect(result).not.toContain('alice');
    expect(result).toContain('[redacted]');
    expect(result).toContain('[local-path]');
  });

  it('redacts sensitive fields recursively and handles cycles', () => {
    const metadata: Record<string, unknown> = {
      operation: 'sync',
      accessToken: 'access-secret',
      nested: {
        password: 'password-secret',
        detail: 'read /home/alice/private/note.md',
      },
    };
    metadata.self = metadata;

    const result = sanitizeLogMetadata(metadata);

    expect(result).toMatchObject({
      operation: 'sync',
      accessToken: '[redacted]',
      nested: {
        password: '[redacted]',
        detail: 'read [local-path]',
      },
      self: '[circular]',
    });
    expect(JSON.stringify(result)).not.toContain('access-secret');
    expect(JSON.stringify(result)).not.toContain('password-secret');
  });

  it('sanitizes error messages and stack traces', () => {
    const error = new Error('Failed with apiKey=top-secret at /tmp/private/session.json');
    error.stack = 'Error at /Users/alice/project/source.ts:42 Bearer stack-secret';

    const result = sanitizeLogValue(error);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('top-secret');
    expect(serialized).not.toContain('stack-secret');
    expect(serialized).not.toContain('alice');
    expect(serialized).toContain('[redacted]');
    expect(serialized).toContain('[local-path]');
  });
});
