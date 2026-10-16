import { useRef, useState, type FormEvent } from 'react';
import { translateUi } from '../../i18n';

interface InboxCaptureBarProps {
  busy: boolean;
  /** Resolves once the capture is saved, so the text is kept if it fails. */
  onCapture: (title: string) => Promise<unknown>;
  autoFocus?: boolean;
  /** Names what the line is added to when that is not the Inbox. */
  label?: string;
}

/**
 * The one input for something new: at the foot of the Inbox, and the same
 * input in the ⌘N dialog on every other screen.
 */
export default function InboxCaptureBar({
  busy,
  onCapture,
  autoFocus,
  label,
}: InboxCaptureBarProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
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
  return (
    <form className="cc-inbox-capture" onSubmit={submit}>
      <input
        ref={inputRef}
        className="cc-inbox-capture__input"
        aria-label={label ?? translateUi('Add to Inbox')}
        autoFocus={autoFocus}
        placeholder={translateUi('Write a task or a note')}
        value={draft}
        maxLength={500}
        onChange={(event) => setDraft(event.target.value)}
      />
      <span className="cc-inbox-capture__hint" aria-hidden="true">
        {translateUi('Enter to add')}
      </span>
    </form>
  );
}
