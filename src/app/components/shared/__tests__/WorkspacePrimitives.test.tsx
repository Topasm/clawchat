import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  InsertionTarget,
  ListRow,
  Pane,
  PaneSection,
  PropertyRow,
  SectionHeader,
  StatusDot,
} from '../WorkspacePrimitives';

describe('workspace primitives', () => {
  it('preserves semantic elements, props, and consumer classes', () => {
    render(
      <Pane as="main" aria-label="Queue" className="queue">
        <PaneSection aria-label="Section">
          <SectionHeader>Heading</SectionHeader>
          <ListRow as="button" type="button">
            Project
          </ListRow>
          <PropertyRow>Property</PropertyRow>
          <InsertionTarget aria-label="Drop before" />
        </PaneSection>
      </Pane>,
    );

    expect(screen.getByRole('main', { name: 'Queue' })).toHaveClass('cc-pane', 'queue');
    expect(screen.getByRole('region', { name: 'Section' })).toHaveClass('cc-pane-section');
    expect(screen.getByRole('button', { name: 'Project' })).toHaveClass('cc-list-row');
    expect(screen.getByText('Property')).toHaveClass('cc-property-row');
    expect(screen.getByLabelText('Drop before')).toHaveClass('cc-insertion-target');
  });

  it('encodes semantic status without forcing accessible noise', () => {
    render(<StatusDot data-testid="status" tone="success" />);

    expect(screen.getByTestId('status')).toHaveClass('cc-status-dot');
    expect(screen.getByTestId('status')).toHaveAttribute('data-tone', 'success');
    expect(screen.getByTestId('status')).toHaveAttribute('aria-hidden', 'true');
  });
});
