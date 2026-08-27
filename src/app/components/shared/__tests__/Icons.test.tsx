import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CalendarIcon, ICON_SIZE, ICON_STROKE_WIDTH, InfoIcon } from '../Icons';
import { GearIcon } from '../NavIcons';

describe('shared icons', () => {
  it('hides decorative icons and keeps them out of keyboard focus', () => {
    const { container } = render(<CalendarIcon />);
    const icon = container.querySelector('svg');

    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('focusable', 'false');
    expect(icon).toHaveAttribute('viewBox', '0 0 18 18');
    expect(icon).toHaveAttribute('stroke', 'currentColor');
    expect(icon).toHaveAttribute('width', String(ICON_SIZE.feature));
    expect(icon).toHaveAttribute('height', String(ICON_SIZE.feature));
    expect(icon).toHaveAttribute('stroke-width', String(ICON_STROKE_WIDTH));
  });

  it('exposes a meaningful icon with its accessible label', () => {
    render(<InfoIcon label="More information" />);

    const icon = screen.getByRole('img', { name: 'More information' });
    expect(icon).not.toHaveAttribute('aria-hidden');
    expect(icon).toHaveAttribute('focusable', 'false');
  });

  it('uses semantic sizes and the same contract for navigation icons', () => {
    const { container } = render(<GearIcon size={ICON_SIZE.control} />);
    const icon = container.querySelector('svg');

    expect(icon).toHaveAttribute('width', String(ICON_SIZE.control));
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('focusable', 'false');
  });
});
