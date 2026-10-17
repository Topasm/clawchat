import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloseTaskPane, useOpenTask, useSelectedTaskId } from '../useTaskPane';

const platform = vi.hoisted(() => ({ isMobile: false }));
vi.mock('../usePlatform', () => ({
  default: () => ({ isMobile: platform.isMobile, isDesktop: false }),
}));

function useHarness() {
  return {
    location: useLocation(),
    selected: useSelectedTaskId(),
    open: useOpenTask(),
    close: useCloseTaskPane(),
  };
}

function renderAt(entry: string) {
  return renderHook(useHarness, {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>,
  });
}

describe('useTaskPane', () => {
  beforeEach(() => {
    platform.isMobile = false;
  });

  it('opens a task beside the list on desktop and keeps the other query', () => {
    const { result } = renderAt('/tasks?view=list');
    expect(result.current.selected).toBeNull();

    act(() => result.current.open('todo-1'));

    expect(result.current.location.pathname).toBe('/tasks');
    expect(result.current.location.search).toBe('?view=list&task=todo-1');
    expect(result.current.selected).toBe('todo-1');
  });

  it('closes the pane by dropping the task from the URL', () => {
    const { result } = renderAt('/schedule/today?task=todo-1');
    expect(result.current.selected).toBe('todo-1');

    act(() => result.current.close());

    expect(result.current.location.pathname).toBe('/schedule/today');
    expect(result.current.location.search).toBe('');
    expect(result.current.selected).toBeNull();
  });

  it('gives a task its own page on a phone', () => {
    platform.isMobile = true;
    const { result } = renderAt('/tasks');

    act(() => result.current.open('todo-1'));

    expect(result.current.location.pathname).toBe('/tasks/todo-1');
    expect(result.current.location.search).toBe('');
  });
});
