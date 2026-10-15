import { describe, expect, it } from 'vitest';
import { isLocalHostMode, itemStorageLocation, workspaceAddressLabel } from '../workspaceLocation';

describe('workspaceAddressLabel', () => {
  it('shows the host and port a workspace answers on', () => {
    expect(workspaceAddressLabel('http://192.168.1.20:8000')).toBe('192.168.1.20:8000');
    expect(workspaceAddressLabel('https://home.tail1234.ts.net/')).toBe('home.tail1234.ts.net');
    expect(workspaceAddressLabel('https://example.com/clawchat/')).toBe('example.com/clawchat');
  });

  it('has no address for a workspace without a server', () => {
    expect(workspaceAddressLabel(null)).toBeNull();
  });
});

describe('isLocalHostMode', () => {
  const host = { appMode: 'host' as const, localServerEnabled: true };

  it('is hosting while this device serves the workspace shown', () => {
    expect(isLocalHostMode(host, 'local')).toBe(true);
  });

  it('is not hosting while the window is a client of another Home', () => {
    expect(isLocalHostMode(host, 'remote-home')).toBe(false);
  });

  it('is not hosting in legacy client mode with the local server off', () => {
    expect(isLocalHostMode({ appMode: 'client', localServerEnabled: false }, 'local')).toBe(false);
  });

  it('is not hosting where there is no desktop runtime', () => {
    expect(isLocalHostMode(null, 'local')).toBe(false);
  });
});

describe('itemStorageLocation', () => {
  it('marks a task created offline as held on this device', () => {
    expect(itemStorageLocation({ id: 'temp-1700000000000' }, 'Home')).toEqual({
      kind: 'pending',
      workspaceName: 'Home',
    });
  });

  it('names the workspace a synced task is saved to', () => {
    expect(itemStorageLocation({ id: 'b7c1d6' }, 'Home')).toEqual({
      kind: 'workspace',
      workspaceName: 'Home',
    });
  });
});
