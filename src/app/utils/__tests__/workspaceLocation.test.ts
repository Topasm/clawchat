import { afterEach, describe, expect, it } from 'vitest';
import { changeAppLanguage } from '../../i18n';
import type { WorkspaceProfile } from '../../stores/useWorkspaceStore';
import {
  activeWorkspaceName,
  isLocalHostMode,
  itemStorageLocation,
  workspaceAddressLabel,
} from '../workspaceLocation';

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
  const home = { name: 'Home', kind: 'remote' as const };
  const device = { name: 'This device', kind: 'local' as const };

  it('marks a task created offline as held on this device', () => {
    expect(itemStorageLocation({ id: 'temp-1700000000000' }, home)).toEqual({
      kind: 'pending',
      workspaceName: 'Home',
    });
  });

  it('tells a task on a Home server from one in the workspace on this device', () => {
    expect(itemStorageLocation({ id: 'b7c1d6' }, home)).toEqual({
      kind: 'server',
      workspaceName: 'Home',
    });
    expect(itemStorageLocation({ id: 'b7c1d6' }, device)).toEqual({
      kind: 'device',
      workspaceName: 'This device',
    });
  });
});

describe('activeWorkspaceName', () => {
  const profile = (id: string, kind: WorkspaceProfile['kind'], name: string) =>
    ({ id, kind, name }) as WorkspaceProfile;
  const profiles = [
    profile('local', 'local', 'This device'),
    profile('remote-1', 'remote', 'Home'),
  ];

  afterEach(async () => {
    await changeAppLanguage('en');
  });

  it('reads the private workspace in the app language', async () => {
    await changeAppLanguage('ko');
    expect(activeWorkspaceName({ profiles, activeWorkspaceId: 'local' })).toBe('이 장치');
  });

  it("keeps a server's own name", async () => {
    await changeAppLanguage('ko');
    expect(activeWorkspaceName({ profiles, activeWorkspaceId: 'remote-1' })).toBe('Home');
  });
});
