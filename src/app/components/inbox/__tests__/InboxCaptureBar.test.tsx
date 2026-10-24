import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import InboxCaptureBar from '../InboxCaptureBar';

describe('InboxCaptureBar', () => {
  it('adds on Enter and keeps Shift+Enter for a new line', async () => {
    const onCapture = vi.fn().mockResolvedValue({});
    render(<InboxCaptureBar busy={false} onCapture={onCapture} />);
    const box = screen.getByRole('textbox', { name: 'Add to Inbox' });
    expect(box.tagName).toBe('TEXTAREA');

    fireEvent.change(box, { target: { value: 'Call the landlord' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onCapture).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: 'Call the landlord\nabout the heating' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onCapture).toHaveBeenCalledWith('Call the landlord\nabout the heating');
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('lets Enter finish an IME composition without adding', () => {
    const onCapture = vi.fn().mockResolvedValue({});
    render(<InboxCaptureBar busy={false} onCapture={onCapture} />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: '집세 내기' } });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('keeps the text when saving fails', async () => {
    const onCapture = vi.fn().mockRejectedValue(new Error('offline'));
    render(<InboxCaptureBar busy={false} onCapture={onCapture} />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'Buy milk' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(onCapture).toHaveBeenCalledOnce());
    expect(box).toHaveValue('Buy milk');
  });
});
