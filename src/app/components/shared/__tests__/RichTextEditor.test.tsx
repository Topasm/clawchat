import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RichTextEditor from '../RichTextEditor';

describe('RichTextEditor', () => {
  it('renders with placeholder text', () => {
    render(<RichTextEditor placeholder="Write something..." />);
    expect(screen.getByText('Write something...')).toBeInTheDocument();
  });

  it('renders toolbar buttons with correct titles', () => {
    render(<RichTextEditor />);
    expect(screen.getByTitle('Bold')).toBeInTheDocument();
    expect(screen.getByTitle('Italic')).toBeInTheDocument();
    expect(screen.getByTitle('Bullet List')).toBeInTheDocument();
    expect(screen.getByTitle('Numbered List')).toBeInTheDocument();
  });

  it('hides toolbar in read-only mode', () => {
    const { container } = render(
      <RichTextEditor initialMarkdown="Hello" editable={false} />,
    );
    expect(container.querySelector('.cc-rte--readonly')).toBeInTheDocument();
    expect(container.querySelector('.cc-rte__toolbar')).not.toBeInTheDocument();
  });
});
