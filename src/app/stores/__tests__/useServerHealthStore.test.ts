import { describe, expect, it } from 'vitest';
import { parseServerHealth } from '../useServerHealthStore';

describe('parseServerHealth', () => {
  it('reads the signed-in health answer', () => {
    expect(
      parseServerHealth({
        service: 'clawchat',
        status: 'degraded',
        version: '1.4.30',
        ai_provider: 'openclaw',
        ai_connected: false,
        ai_model: 'llama3.2',
      }),
    ).toEqual({
      version: '1.4.30',
      status: 'degraded',
      aiConnected: false,
      aiProvider: 'openclaw',
      aiModel: 'llama3.2',
    });
  });

  it('accepts the anonymous answer, which leaves the model empty', () => {
    expect(
      parseServerHealth({ status: 'ok', version: '1.4.43', ai_connected: true, ai_model: '' }),
    ).toMatchObject({ aiConnected: true, aiModel: '', version: '1.4.43' });
  });

  it('rejects answers that do not say whether AI is connected', () => {
    expect(parseServerHealth({ status: 'ok', version: '1.4.43' })).toBeNull();
    expect(parseServerHealth('<html>')).toBeNull();
  });
});
