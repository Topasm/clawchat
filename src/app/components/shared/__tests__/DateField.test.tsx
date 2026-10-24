import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeAppLanguage } from '../../../i18n';
import DateField from '../DateField';

describe('DateField', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T12:00:00.000Z'));
  });
  afterEach(async () => {
    vi.useRealTimers();
    await changeAppLanguage('en');
  });

  it('prints the date the way the app does, not the way the system does', async () => {
    const { container } = render(
      <DateField value="2026-10-25" onChange={vi.fn()} aria-label="Due" />,
    );
    expect(container.querySelector('.cc-date-field__text')).toHaveTextContent('Oct 25');
    expect(screen.getByLabelText('Due')).toHaveValue('2026-10-25');

    await changeAppLanguage('ko');
    expect(container.querySelector('.cc-date-field__text')).toHaveTextContent('10월 25일');
  });

  it('says what to do while empty and passes a picked date up', () => {
    const onChange = vi.fn();
    const { container } = render(<DateField value="" onChange={onChange} aria-label="Due" />);
    expect(container.querySelector('.cc-date-field__text')).toHaveTextContent('Set date');

    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2027-01-02' } });
    expect(onChange).toHaveBeenCalledWith('2027-01-02');
  });

  it('shows the native segments only for keyboard focus', () => {
    const { container } = render(
      <DateField value="2026-10-25" onChange={vi.fn()} aria-label="Due" />,
    );
    const input = screen.getByLabelText('Due');

    fireEvent.focus(input);
    expect(container.firstChild).toHaveClass('cc-date-field--keyboard');
    fireEvent.blur(input);
    expect(container.firstChild).not.toHaveClass('cc-date-field--keyboard');

    fireEvent.pointerDown(input);
    fireEvent.focus(input);
    expect(container.firstChild).not.toHaveClass('cc-date-field--keyboard');
  });
});
