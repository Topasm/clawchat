import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useServerHealthStore } from '../../../stores/useServerHealthStore';
import { useWorkspaceStore } from '../../../stores/useWorkspaceStore';
import AiSetupBanner from '../AiSetupBanner';
import ServerVersionBanner from '../ServerVersionBanner';
import ServerVersionNotice from '../ServerVersionNotice';
import StorageLocationBadge from '../StorageLocationBadge';
import WorkspaceMenu from '../WorkspaceMenu';

const SERVER = 'https://home.example:8443';

function health(aiConnected: boolean) {
  return {
    version: '1.4.43',
    status: aiConnected ? ('ok' as const) : ('degraded' as const),
    aiConnected,
    aiProvider: 'openclaw',
    aiModel: aiConnected ? 'llama3.2' : '',
  };
}

function useRemoteHome() {
  useWorkspaceStore.getState().upsertRemote('Home', SERVER, { hostId: 'host-home' });
}

beforeEach(() => {
  localStorage.clear();
  useWorkspaceStore.getState().reset();
  useServerHealthStore.getState().clear();
  useAuthStore.setState({ serverUrl: SERVER });
});

afterEach(() => {
  useAuthStore.setState({ serverUrl: null });
});

describe('WorkspaceMenu', () => {
  it('keeps the workspace name, address and connection state in view', () => {
    render(
      <MemoryRouter>
        <WorkspaceMenu
          workspaceName="Home"
          address="home.example:8443"
          connectionStatus="reconnecting"
          connectionLabel="Reconnecting"
          aiLabel="AI: llama3.2"
          pendingCount={2}
          collapsed={false}
          onOpenSearch={() => {}}
        />
      </MemoryRouter>,
    );

    const button = screen.getByRole('button', { name: 'Workspace menu. Current: Home' });
    expect(button).toHaveClass('cc-connection-status--reconnecting');
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-address')).toHaveTextContent('home.example:8443');
    expect(button).toHaveTextContent('Reconnecting');
    expect(button).toHaveAttribute(
      'title',
      'Home · home.example:8443 · Reconnecting · AI: llama3.2',
    );
    fireEvent.click(button);
    expect(screen.getByRole('menuitem', { name: 'Switch workspace' })).toBeInTheDocument();
  });

  it('says the private workspace lives on this device', () => {
    render(
      <MemoryRouter>
        <WorkspaceMenu
          workspaceName="This device"
          address={null}
          connectionStatus="connected"
          connectionLabel="Connected"
          aiLabel={null}
          pendingCount={0}
          collapsed={false}
          onOpenSearch={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('workspace-address')).toHaveTextContent('On this device');
  });
});

describe('AiSetupBanner', () => {
  const renderBanner = () =>
    render(
      <MemoryRouter initialEntries={['/schedule/today']}>
        <AiSetupBanner />
      </MemoryRouter>,
    );

  it('points to AI settings when the server says AI is not connected', () => {
    useServerHealthStore.getState().setHealth(SERVER, health(false));
    renderBanner();

    expect(screen.getByRole('status')).toHaveTextContent('AI not connected');
    expect(screen.getByRole('link', { name: 'Set up' })).toHaveAttribute(
      'href',
      '/settings/workspace#ai',
    );
  });

  it('stays hidden while AI is connected or not yet known', () => {
    useServerHealthStore.getState().setHealth(SERVER, health(true));
    const { unmount } = renderBanner();
    expect(screen.queryByText('AI not connected')).not.toBeInTheDocument();
    unmount();

    useServerHealthStore.getState().clear();
    renderBanner();
    expect(screen.queryByText('AI not connected')).not.toBeInTheDocument();
  });

  it('ignores a snapshot from the workspace the app just left', () => {
    useServerHealthStore.getState().setHealth('https://old.example', health(false));
    renderBanner();
    expect(screen.queryByText('AI not connected')).not.toBeInTheDocument();
  });
});

describe('ServerVersionNotice', () => {
  it('names this app and the Home server, and asks to update the older Home', () => {
    render(<ServerVersionNotice serverVersion="1.4.30" serverName="Home" appVersion="1.4.43" />);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('This app is 1.4.43; the Home server (Home) runs 1.4.30.');
    expect(notice).toHaveTextContent('Update the Home server to 1.4.43');
  });

  it('asks to update an older app to the server release', () => {
    render(<ServerVersionNotice serverVersion="1.4.50" serverName="Home" appVersion="1.4.43" />);
    expect(screen.getByRole('status')).toHaveTextContent('Update this app to 1.4.50');
  });

  it('renders nothing when the versions match or are unknown', () => {
    const { container, rerender } = render(
      <ServerVersionNotice serverVersion="1.4.43" appVersion="1.4.43" />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<ServerVersionNotice serverVersion={undefined} appVersion="1.4.43" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ServerVersionBanner', () => {
  beforeEach(() => {
    useAuthStore.setState({ serverUrl: 'https://home.example:8443', token: 'jwt' });
    useWorkspaceStore.setState({
      profiles: [
        { id: 'ws-home', kind: 'remote', name: 'ClawChat', serverUrl: 'https://home.example:8443' },
      ] as never,
      activeWorkspaceId: 'ws-home',
    });
  });

  it('shows one line in the shell when the app and the Home server differ', () => {
    useServerHealthStore.getState().setHealth('https://home.example:8443', {
      version: '1.4.58',
      status: 'ok',
      aiConnected: true,
      aiProvider: 'codex_cli',
      aiModel: '',
    });
    render(
      <MemoryRouter>
        <ServerVersionBanner appVersion="1.4.57" />
      </MemoryRouter>,
    );
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('This app is 1.4.57; the Home server (ClawChat) runs 1.4.58.');
    expect(banner).toHaveTextContent('Update this app to 1.4.58');
    expect(screen.getByRole('link', { name: 'Connection' })).toHaveAttribute(
      'href',
      '/connections',
    );
  });

  it('stays out of the way while the releases match', () => {
    useServerHealthStore.getState().setHealth('https://home.example:8443', {
      version: '1.4.57',
      status: 'ok',
      aiConnected: true,
      aiProvider: 'codex_cli',
      aiModel: '',
    });
    const { container } = render(
      <MemoryRouter>
        <ServerVersionBanner appVersion="1.4.57" />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('StorageLocationBadge', () => {
  it('marks a task still held on this device and names its workspace', () => {
    useRemoteHome();
    render(<StorageLocationBadge item={{ id: 'temp-1' }} />);
    expect(
      screen.getByLabelText('Only on this device · waiting to sync to Home'),
    ).toHaveTextContent('Waiting to send');
  });

  it('keeps synced rows unmarked in lists', () => {
    useRemoteHome();
    const { container } = render(<StorageLocationBadge item={{ id: 'task-1' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says a synced task is on the Home server, by name, on its detail page', () => {
    useRemoteHome();
    render(<StorageLocationBadge item={{ id: 'task-1' }} variant="line" />);
    expect(screen.getByRole('note')).toHaveTextContent('Saved on the Home server · Home');
  });

  it('says a task in the private workspace is on this device', () => {
    render(<StorageLocationBadge item={{ id: 'task-1' }} variant="line" />);
    expect(screen.getByRole('note')).toHaveTextContent('Saved on this device');
    expect(screen.getByRole('note')).toHaveClass('cc-storage-line--device');
  });

  it('distinguishes the pending line from a saved one', () => {
    render(<StorageLocationBadge item={{ id: 'temp-2' }} variant="line" />);
    const line = screen.getByRole('note');
    expect(line).toHaveClass('cc-storage-line--pending');
    expect(line).toHaveTextContent('Only on this device · waiting to sync to This device');
  });
});
