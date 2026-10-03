import { lazy, Suspense, useState } from 'react';
import { DEFAULT_SETTINGS, useSettingsStore } from '../../stores/useSettingsStore';
import SettingsRow from '../shared/SettingsRow';
import { translateUi } from '../../i18n';

const MAX_LENGTH = 4000;

// CodeMirror is most of the settings bundle (~1.3 MB of source) and only this
// editor uses it, so it loads when the editor is about to open, not with the page.
const loadCodeEditor = () => import('../shared/CodeEditor');
const CodeEditor = lazy(loadCodeEditor);

/**
 * The system prompt editor, inline in the AI section. It used to be a page of
 * its own outside the settings panes, reached only from here.
 */
export default function SystemPromptSection() {
  const systemPrompt = useSettingsStore((s) => s.systemPrompt);
  const setSystemPrompt = useSettingsStore((s) => s.setSystemPrompt);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(systemPrompt);
  const isDirty = draft !== systemPrompt;
  const toggle = () => {
    if (!open) setDraft(systemPrompt);
    setOpen((current) => !current);
  };
  return (
    <>
      <SettingsRow
        label={translateUi('System prompt')}
        sublabel={translateUi('Customize how the AI assistant behaves')}
      >
        <button
          type="button"
          className="cc-btn cc-btn--secondary cc-btn--compact"
          aria-expanded={open}
          onClick={toggle}
          onPointerEnter={() => void loadCodeEditor()}
          onFocus={() => void loadCodeEditor()}
        >
          {open ? translateUi('Hide') : translateUi('Edit')}
        </button>
      </SettingsRow>
      {open && (
        <div className="cc-sysprompt" aria-label={translateUi('System prompt')}>
          <Suspense
            fallback={
              <div className="cc-sysprompt__loading" role="status">
                {translateUi('Loading…')}
              </div>
            }
          >
            <CodeEditor
              value={draft}
              onChange={setDraft}
              language="markdown"
              maxLength={MAX_LENGTH}
              height="240px"
              placeholder={translateUi('Enter your system prompt...')}
            />
          </Suspense>
          <div className="cc-sysprompt__footer">
            <span className="cc-sysprompt__counter">
              {draft.length} / {MAX_LENGTH}
            </span>
            <div className="cc-sysprompt__actions">
              <button
                type="button"
                className="cc-btn cc-btn--secondary cc-btn--compact"
                onClick={() => setDraft(DEFAULT_SETTINGS.systemPrompt)}
              >
                {translateUi('Reset to Default')}
              </button>
              <button
                type="button"
                className="cc-btn cc-btn--primary cc-btn--compact"
                disabled={!isDirty}
                onClick={() => {
                  setSystemPrompt(draft);
                  setOpen(false);
                }}
              >
                {translateUi('Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
