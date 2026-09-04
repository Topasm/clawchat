import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RecurrenceSelector from '../RecurrenceSelector';

describe('RecurrenceSelector', () => {
  it('parses and preserves an UNTIL date when another field changes', () => {
    const onChange = vi.fn();
    const { container } = render(
      <RecurrenceSelector
        value="RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260930T000000Z"
        onChange={onChange}
      />,
    );

    const selects = screen.getAllByRole('combobox');
    expect(selects[0]).toHaveValue('WEEKLY');
    expect(selects[1]).toHaveValue('on_date');
    expect(container.querySelector('input[type="date"]')).toHaveValue('2026-09-30');

    fireEvent.click(screen.getByRole('button', { name: 'Tu' }));

    expect(onChange).toHaveBeenLastCalledWith(
      'RRULE:FREQ=WEEKLY;BYDAY=MO,TU;UNTIL=20260930T000000Z',
    );
  });

  it('synchronizes local controls when the value prop changes', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RecurrenceSelector value="RRULE:FREQ=DAILY" onChange={onChange} />,
    );

    expect(screen.getAllByRole('combobox')[0]).toHaveValue('DAILY');

    rerender(<RecurrenceSelector value="RRULE:FREQ=MONTHLY;COUNT=4" onChange={onChange} />);

    const selects = screen.getAllByRole('combobox');
    expect(selects[0]).toHaveValue('MONTHLY');
    expect(selects[1]).toHaveValue('after_count');
    expect(screen.getByRole('spinbutton')).toHaveValue(4);
  });
});
