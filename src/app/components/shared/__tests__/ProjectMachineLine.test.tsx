import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProjectMachineLine from '../ProjectMachineLine';

describe('ProjectMachineLine', () => {
  it('keeps offline machine warnings and the configured folder visible together', () => {
    const onChange = vi.fn();
    render(
      <ProjectMachineLine
        project={{
          execution_host_label: 'My Mac',
          execution_host_online: false,
          execution_workspace_path: '/Users/test/research folder',
        }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText('Machine offline — runs are refused until it is back')).toBeVisible();
    expect(screen.getByText('/Users/test/research folder')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Change where this runs' }));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('shows an unset folder even when a machine is configured', () => {
    render(
      <ProjectMachineLine
        project={{
          execution_host_label: 'My Mac',
          execution_host_online: true,
          execution_workspace_path: null,
        }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Runs on My Mac')).toBeVisible();
    expect(screen.getByText('Not set up')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Change where this runs' })).toBeVisible();
  });

  it('does not hide a recorded path when its machine is missing', () => {
    render(
      <ProjectMachineLine
        project={{
          execution_host_label: null,
          execution_host_online: null,
          execution_workspace_path: '/srv/research',
        }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('No machine chosen')).toBeVisible();
    expect(screen.getByText('/srv/research')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choose machine' })).toBeVisible();
  });
});
