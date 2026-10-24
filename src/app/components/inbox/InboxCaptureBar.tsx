import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { translateUi } from '../../i18n';

interface InboxCaptureBarProps {
  busy: boolean;
  /** Resolves once the capture is saved, so the text is kept if it fails. */
  onCapture: (title: string) => Promise<unknown>;
  autoFocus?: boolean;
  /** Names what the line is added to when that is not the Inbox. */
  label?: string;
}

/** The box grows with the memo up to this, then scrolls inside. */
const MAX_HEIGHT_PX = 160;

/**
 * The one input for something new: at the foot of the Inbox, and the same
 * input in the ⌘N dialog on every other screen. It grows with what is typed
 * so a long memo can be read back before it is added; Enter adds it and
 * Shift+Enter starts a new line.
 */
export default function InboxCaptureBar({
  busy,
  onCapture,
  autoFocus,
  label,
}: InboxCaptureBarProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Fit the box to its lines on every change, and back to one line once cleared.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? 'auto' : 'hidden';
  }, [draft]);
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const title = draft.trim();
    if (!title || busy) return;
    void onCapture(title).then(
      () => {
        setDraft('');
        inputRef.current?.focus();
      },
      () => undefined,
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter adds; Shift+Enter is a new line. Enter that ends an IME
    // composition (Korean, Japanese) only commits the characters.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };
  return (
    <form className="cc-inbox-capture" onSubmit={submit}>
      <textarea
        ref={inputRef}
        className="cc-inbox-capture__input"
        aria-label={label ?? translateUi('Add to Inbox')}
        autoFocus={autoFocus}
        placeholder={translateUi('Write a task or a note')}
        value={draft}
        rows={1}
        maxLength={500}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="cc-inbox-capture__hint" aria-hidden="true">
        {translateUi('Enter to add · Shift+Enter for a new line')}
      </span>
    </form>
  );
}
