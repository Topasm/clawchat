import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore, DEFAULT_SETTINGS } from '../stores/useSettingsStore';
import CodeEditor from '../components/shared/CodeEditor';

const MAX_LENGTH = 4000;

export default function SystemPromptPage() {
  const navigate = useNavigate();
  const systemPrompt = useSettingsStore((s) => s.systemPrompt);
  const setSystemPrompt = useSettingsStore((s) => s.setSystemPrompt);

  const [draft, setDraft] = useState(systemPrompt);
  const isDirty = draft !== systemPrompt;

  const handleSave = () => {
    setSystemPrompt(draft);
    navigate('/settings');
  };

  const handleReset = () => {
    setDraft(DEFAULT_SETTINGS.systemPrompt);
  };

  return (
    <div className="cc-sysprompt">
      <div className="cc-page-header">
        <div className="cc-page-header__title">System Prompt</div>
        <div className="cc-page-header__subtitle">
          Customize how the AI assistant behaves
        </div>
      </div>

      <CodeEditor
        value={draft}
        onChange={setDraft}
        language="markdown"
        maxLength={MAX_LENGTH}
        height="300px"
        placeholder="Enter your system prompt..."
      />

      <div className="cc-sysprompt__footer">
        <span className="cc-sysprompt__counter">
          {draft.length} / {MAX_LENGTH}
        </span>
        <div className="cc-sysprompt__actions">
          <button type="button" className="cc-btn cc-btn--secondary" onClick={handleReset}>
            Reset to Default
          </button>
          <button type="button" className="cc-btn cc-btn--primary" onClick={handleSave} disabled={!isDirty}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
