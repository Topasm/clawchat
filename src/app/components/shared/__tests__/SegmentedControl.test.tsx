import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SegmentedControl from '../SegmentedControl';

describe('SegmentedControl', () => {
  it('exposes its group name and selected state', () => {
    render(
      <SegmentedControl
        ariaLabel="Task view"
        options={[
          { label: 'List', value: 'list' },
          { label: 'Graph', value: 'graph' },
        ]}
        value="graph"
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole('group', { name: 'Task view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Graph' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the selected value', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Task view"
        options={[{ label: 'List', value: 'list' }]}
        value="graph"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(onChange).toHaveBeenCalledWith('list');
  });
});
