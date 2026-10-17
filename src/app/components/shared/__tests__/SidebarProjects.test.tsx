import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import SidebarProjects from '../SidebarProjects';

const projects = Array.from({ length: 11 }, (_, index) => ({
  id: `p${index}`,
  title: `Project ${index}`,
  status: 'active',
  task_count: 4,
  completed_task_count: 1,
}));

vi.mock('../../../hooks/queries', () => ({
  useProjectsQuery: () => ({ data: projects }),
}));

describe('SidebarProjects', () => {
  it('lists eight projects and links the rest as "N more"', () => {
    render(
      <MemoryRouter>
        <SidebarProjects collapsed={false} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /Project 7/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Project 8/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '3 more' })).toHaveAttribute('href', '/projects');
  });
});
