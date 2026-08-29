import { describe, expect, it } from 'vitest';

import { describeStartupLogLocation } from '../startupDiagnostics';

describe('startup log location', () => {
  it('points a macOS user at Application Support', () => {
    const location = describeStartupLogLocation(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
    );

    expect(location.startupLog).toBe(
      '~/Library/Application Support/com.clawchat.desktop/startup.log',
    );
    expect(location.serverLog).toBe(
      '~/Library/Application Support/com.clawchat.desktop/server.log',
    );
  });

  it('uses the platform data directory elsewhere', () => {
    expect(describeStartupLogLocation('Mozilla/5.0 (Windows NT 10.0; Win64; x64)').startupLog).toBe(
      '%APPDATA%\\com.clawchat.desktop\\startup.log',
    );
    expect(describeStartupLogLocation('Mozilla/5.0 (X11; Linux x86_64)').startupLog).toBe(
      '~/.local/share/com.clawchat.desktop/startup.log',
    );
  });
});
