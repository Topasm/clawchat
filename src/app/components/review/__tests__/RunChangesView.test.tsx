import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RunChangesView from '../RunChangesView';

const patchQuery = vi.fn();
vi.mock('../../../hooks/queries', () => ({
  useAgentRunPatchQuery: (...args: unknown[]) => patchQuery(...args),
}));

describe('RunChangesView', () => {
  beforeEach(() => patchQuery.mockReset());

  it('shows each changed file with its added and removed lines', () => {
    patchQuery.mockReturnValue({
      data: '--- a/calc.py\n+++ b/calc.py\n@@ -1,2 +1,2 @@\n def add(a, b):\n-    return a - b\n+    return a + b\n',
      isLoading: false,
      isError: false,
    });
    const { container } = render(<RunChangesView runId="run_1" />);
    expect(patchQuery).toHaveBeenCalledWith('run_1', true);
    expect(screen.getByText('calc.py')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(container.querySelector('.cc-run-changes__line--add')?.textContent).toContain(
      'return a + b',
    );
    expect(container.querySelector('.cc-run-changes__line--del')?.textContent).toContain(
      'return a - b',
    );
  });

  it('says so when the run recorded no patch', () => {
    patchQuery.mockReturnValue({ data: null, isLoading: false, isError: false });
    render(<RunChangesView runId="run_1" />);
    expect(screen.getByText('No patch was recorded for this result.')).toBeInTheDocument();
  });
});
