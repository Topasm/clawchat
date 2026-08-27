import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Checkbox from '../Checkbox';

describe('Checkbox', () => {
  it('uses a keyboard-operable checkbox button with a useful name', () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} />);

    const checkbox = screen.getByRole('checkbox', { name: 'Mark complete' });
    expect(checkbox.tagName).toBe('BUTTON');
    expect(checkbox).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('announces the inverse action when checked', () => {
    render(<Checkbox checked onChange={() => undefined} />);

    expect(screen.getByRole('checkbox', { name: 'Mark incomplete' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
