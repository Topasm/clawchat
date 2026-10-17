import { describe, expect, it } from 'vitest';
import { runFailureReason } from '../runFailure';

describe('runFailureReason', () => {
  it('turns what the server or agent raised into one plain sentence', () => {
    expect(runFailureReason('Execution interrupted by server restart; retry is available')).toBe(
      'The server restarted while this ran.',
    );
    expect(
      runFailureReason('No heartbeat for 10 minutes; the machine running this work stopped'),
    ).toBe('The machine running this stopped answering.');
    expect(runFailureReason('This project no longer has a path on that machine.')).toBe(
      "The project's folder is missing on that machine.",
    );
    expect(runFailureReason('HTTP 429 Too Many Requests')).toBe(
      'The AI service is busy. Try again in a moment.',
    );
    expect(runFailureReason('spawn codex ENOENT')).toBe(
      'The AI tool is not installed on that machine.',
    );
  });

  it('falls back to a general sentence for anything it does not know', () => {
    expect(runFailureReason('Traceback (most recent call last): KeyError')).toBe(
      'The run stopped with an error.',
    );
    expect(runFailureReason(null)).toBe('The run stopped before it finished.');
  });
});
