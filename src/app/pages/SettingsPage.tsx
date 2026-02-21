import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../config/ThemeContext';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useModuleStore } from '../stores/useModuleStore';
import { useChatStore } from '../stores/useChatStore';
import { useToastStore } from '../stores/useToastStore';
import SettingsSection from '../components/shared/SettingsSection';
import SettingsRow from '../components/shared/SettingsRow';
import Toggle from '../components/shared/Toggle';
import Slider from '../components/shared/Slider';
import SegmentedControl from '../components/shared/SegmentedControl';

interface BackupData {
  version: number;
  exportedAt: string;
  data: {
    todos: unknown[];
    events: unknown[];
    memos: unknown[];
    conversations: unknown[];
  };
}

function isValidBackup(obj: unknown): obj is BackupData {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  if (typeof record.version !== 'number') return false;
  if (typeof record.data !== 'object' || record.data === null) return false;
  const data = record.data as Record<string, unknown>;
  return (
    Array.isArray(data.todos) &&
    Array.isArray(data.events) &&
    Array.isArray(data.memos) &&
    Array.isArray(data.conversations)
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();
  const settings = useSettingsStore();
  const token = useAuthStore((s) => s.token);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const logout = useAuthStore((s) => s.logout);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const { todos, events, memos } = useModuleStore.getState();
    const { conversations } = useChatStore.getState();

    const backup: BackupData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: { todos, events, memos, conversations },
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `clawchat-backup-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    useToastStore.getState().addToast('success', 'Data exported successfully');
  };

  const handleImport = async (file: File) => {
    let backup: BackupData;

    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (!isValidBackup(parsed)) {
        useToastStore.getState().addToast('error', 'Invalid backup file format');
        return;
      }
      backup = parsed;
    } catch {
      useToastStore.getState().addToast('error', 'Could not parse JSON file');
      return;
    }

    const { todos, events, memos, conversations } = backup.data;
    const confirmed = window.confirm(
      `Import ${todos.length} todos, ${events.length} events, ${memos.length} memos, and ${conversations.length} conversations?\n\nThis will add them as new items.`,
    );
    if (!confirmed) return;

    let errors = 0;

    const moduleStore = useModuleStore.getState();
    const chatStore = useChatStore.getState();

    for (const todo of todos) {
      try {
        const { title, description, priority, due_date, tags } = todo as Record<string, unknown>;
        await moduleStore.createTodo({
          title: String(title ?? ''),
          description: description != null ? String(description) : undefined,
          priority: priority as 'urgent' | 'high' | 'medium' | 'low' | undefined,
          due_date: due_date != null ? String(due_date) : undefined,
          tags: Array.isArray(tags) ? tags : undefined,
        });
      } catch {
        errors++;
      }
    }

    for (const event of events) {
      try {
        const { title, description, start_time, end_time, location, is_all_day, reminder_minutes, tags } =
          event as Record<string, unknown>;
        await moduleStore.createEvent({
          title: String(title ?? ''),
          description: description != null ? String(description) : undefined,
          start_time: String(start_time ?? ''),
          end_time: end_time != null ? String(end_time) : undefined,
          location: location != null ? String(location) : undefined,
          is_all_day: typeof is_all_day === 'boolean' ? is_all_day : undefined,
          reminder_minutes: typeof reminder_minutes === 'number' ? reminder_minutes : undefined,
          tags: Array.isArray(tags) ? tags : undefined,
        });
      } catch {
        errors++;
      }
    }

    for (const memo of memos) {
      try {
        const { content, tags } = memo as Record<string, unknown>;
        await moduleStore.createMemo({
          content: String(content ?? ''),
          tags: Array.isArray(tags) ? tags : undefined,
        });
      } catch {
        errors++;
      }
    }

    for (const convo of conversations) {
      try {
        const { title } = convo as Record<string, unknown>;
        await chatStore.createConversation(title != null ? String(title) : undefined);
      } catch {
        errors++;
      }
    }

    if (errors > 0) {
      useToastStore.getState().addToast('warning', `Import done with ${errors} failed item(s)`);
    } else {
      useToastStore.getState().addToast('success', 'All data imported successfully');
    }
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImport(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="cc-page-header">
        <div className="cc-page-header__title">Settings</div>
      </div>

      <SettingsSection title="Chat">
        <SettingsRow label="Font size">
          <Slider
            value={settings.fontSize}
            min={12}
            max={22}
            onChange={settings.setFontSize}
            formatValue={(v) => `${v}px`}
          />
        </SettingsRow>
        <SettingsRow label="Send on Enter" sublabel="Use Shift+Enter for newline">
          <Toggle checked={settings.sendOnEnter} onChange={settings.setSendOnEnter} />
        </SettingsRow>
        <SettingsRow label="Show timestamps">
          <Toggle checked={settings.showTimestamps} onChange={settings.setShowTimestamps} />
        </SettingsRow>
        <SettingsRow label="Show avatars">
          <Toggle checked={settings.showAvatars} onChange={settings.setShowAvatars} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="LLM">
        <SettingsRow label="Temperature">
          <Slider
            value={settings.temperature}
            min={0}
            max={2}
            step={0.1}
            onChange={settings.setTemperature}
            formatValue={(v) => v.toFixed(1)}
          />
        </SettingsRow>
        <SettingsRow label="Max tokens">
          <Slider
            value={settings.maxTokens}
            min={256}
            max={8192}
            step={256}
            onChange={settings.setMaxTokens}
            formatValue={(v) => `${v}`}
          />
        </SettingsRow>
        <SettingsRow label="Stream responses">
          <Toggle checked={settings.streamResponses} onChange={settings.setStreamResponses} />
        </SettingsRow>
        <SettingsRow label="System prompt">
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => navigate('/settings/system-prompt')}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            Edit
          </button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Appearance">
        <SettingsRow label="Theme">
          <SegmentedControl
            options={[
              { label: 'System', value: 'system' },
              { label: 'Light', value: 'light' },
              { label: 'Dark', value: 'dark' },
            ]}
            value={mode}
            onChange={(v) => setMode(v as 'light' | 'dark' | 'system')}
          />
        </SettingsRow>
        <SettingsRow label="Compact mode">
          <Toggle checked={settings.compactMode} onChange={settings.setCompactMode} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Notifications">
        <SettingsRow label="Notifications enabled">
          <Toggle checked={settings.notificationsEnabled} onChange={settings.setNotificationsEnabled} />
        </SettingsRow>
        <SettingsRow label="Reminder sound">
          <Toggle checked={settings.reminderSound} onChange={settings.setReminderSound} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Data & Storage">
        <SettingsRow label="Save history">
          <Toggle checked={settings.saveHistory} onChange={settings.setSaveHistory} />
        </SettingsRow>
        <SettingsRow label="Analytics">
          <Toggle checked={settings.analyticsEnabled} onChange={settings.setAnalyticsEnabled} />
        </SettingsRow>
        <SettingsRow label="Reset to defaults">
          <button
            type="button"
            className="cc-btn cc-btn--danger"
            onClick={settings.resetToDefaults}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            Reset
          </button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Data Management">
        <SettingsRow label="Export all data" sublabel="Download todos, events, memos, and conversations as JSON">
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={handleExport}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            Export
          </button>
        </SettingsRow>
        <SettingsRow label="Import data" sublabel="Restore from a previously exported JSON file">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={onFileSelected}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => fileInputRef.current?.click()}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            Import
          </button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Server Connection">
        {token ? (
          <>
            <SettingsRow label="Server" sublabel={serverUrl ?? 'Unknown'}>
              <span style={{ fontSize: 12, color: 'var(--cc-success)' }}>Connected</span>
            </SettingsRow>
            <SettingsRow label="Logout" sublabel="Disconnect from server">
              <button className="cc-btn cc-btn--danger" onClick={() => { logout(); navigate('/today'); }}>
                Logout
              </button>
            </SettingsRow>
          </>
        ) : (
          <SettingsRow label="Demo Mode" sublabel="No server connected">
            <button className="cc-btn cc-btn--primary" onClick={() => navigate('/login')}>
              Connect
            </button>
          </SettingsRow>
        )}
      </SettingsSection>
    </div>
  );
}
