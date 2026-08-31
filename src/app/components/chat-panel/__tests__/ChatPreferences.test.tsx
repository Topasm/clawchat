import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { useChatStore } from '../../../stores/useChatStore';
import ChatInput from '../ChatInput';
import MessageBubble from '../MessageBubble';

describe('chat display preferences', () => {
  beforeEach(() => {
    useChatStore.getState().resetToDemo();
    useSettingsStore.setState({
      sendOnEnter: true,
      showAvatars: true,
      showTimestamps: true,
    });
  });

  it('keeps a recoverable draft when creating or sending the chat fails', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('offline'));
    render(
      <ChatInput
        draftKey="workspace:conversation-1"
        onSend={onSend}
        isStreaming={false}
        onStop={() => {}}
      />,
    );
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'do not lose this' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(input).toHaveValue('do not lose this');
    expect(useChatStore.getState().drafts['workspace:conversation-1']).toBe('do not lose this');
  });

  it('sends with Enter when the preference is enabled', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} isStreaming={false} onStop={() => {}} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it('keeps Enter for new lines and uses Ctrl+Enter when the preference is disabled', () => {
    useSettingsStore.setState({ sendOnEnter: false });
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} isStreaming={false} onStop={() => {}} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it('hides message avatars when the preference is disabled', () => {
    useSettingsStore.setState({ showAvatars: false });
    const { container } = render(
      <MessageBubble
        message={{
          _id: 'message-1',
          text: 'Hello',
          createdAt: new Date('2026-01-01T12:00:00Z'),
          user: { _id: 'assistant', name: 'Assistant' },
        }}
      />,
    );

    expect(container.querySelector('.cc-avatar')).not.toBeInTheDocument();
  });

  it('gives icon-only message actions accessible names', () => {
    render(
      <MessageBubble
        message={{
          _id: 'message-2',
          text: 'Editable message',
          createdAt: new Date('2026-01-01T12:00:00Z'),
          user: { _id: 'user', name: 'User' },
        }}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Copy message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete message' })).toBeInTheDocument();
  });

  it('offers retry for a failed outgoing message', () => {
    const onRetry = vi.fn();
    render(
      <MessageBubble
        message={{
          _id: 'failed-message',
          text: 'Try again',
          createdAt: new Date('2026-01-01T12:00:00Z'),
          user: { _id: 'user', name: 'User' },
          deliveryStatus: 'failed',
        }}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
