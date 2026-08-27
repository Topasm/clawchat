import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SectionHeader from '../SectionHeader';

describe('SectionHeader', () => {
  it('uses an accessible disclosure button', () => {
    render(
      <SectionHeader title="Upcoming">
        <div>Task content</div>
      </SectionHeader>,
    );

    const disclosure = screen.getByRole('button', { name: /upcoming/i });
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Task content')).toBeInTheDocument();

    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Task content')).not.toBeInTheDocument();
  });
});
