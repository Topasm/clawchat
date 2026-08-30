import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSettingsStore, DEFAULT_SETTINGS } from '../stores/useSettingsStore';
import CodeEditor from '../components/shared/CodeEditor';
import SettingsShell from '../components/settings/SettingsShell';
import { translateUi, useTranslation } from '../i18n';
import { settingsNavigationState } from '../services/settingsNavigation';
const MAX_LENGTH = 4000;
export default function SystemPromptPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const systemPrompt = useSettingsStore((s) => s.systemPrompt);
  const setSystemPrompt = useSettingsStore((s) => s.setSystemPrompt);
  const [draft, setDraft] = useState(systemPrompt);
  const isDirty = draft !== systemPrompt;
  const handleSave = () => {
    setSystemPrompt(draft);
    navigate('/settings/workspace', {
      state: settingsNavigationState(location.pathname, location.search, location.state),
    });
  };
  const handleReset = () => {
    setDraft(DEFAULT_SETTINGS.systemPrompt);
  };
  return (
    <SettingsShell
      activePane="workspace"
      title={translateUi('System Prompt')}
      description={t('settingsShell.workspaceDescription')}
    >
      <div className="cc-sysprompt">
        <div className="cc-page-header__subtitle">
          {translateUi('Customize how the AI assistant behaves')}
        </div>

        <CodeEditor
          value={draft}
          onChange={setDraft}
          language="markdown"
          maxLength={MAX_LENGTH}
          height="300px"
          placeholder={translateUi('Enter your system prompt...')}
        />

        <div className="cc-sysprompt__footer">
          <span className="cc-sysprompt__counter">
            {draft.length} / {MAX_LENGTH}
          </span>
          <div className="cc-sysprompt__actions">
            <button type="button" className="cc-btn cc-btn--secondary" onClick={handleReset}>
              {translateUi('Reset to Default')}
            </button>
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              onClick={handleSave}
              disabled={!isDirty}
            >
              {translateUi('Save')}
            </button>
          </div>
        </div>
      </div>
    </SettingsShell>
  );
}
