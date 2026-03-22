import { useRef } from 'react';
import { useToastStore } from '../stores/useToastStore';
import { queryClient } from '../config/queryClient';
import { queryKeys } from './queries/queryKeys';
import apiClient from '../services/apiClient';
import type { TodoResponse, EventResponse, ConversationResponse } from '../types/api';

interface BackupData {
  version: number;
  exportedAt: string;
  data: {
    todos: unknown[];
    events: unknown[];
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
    Array.isArray(data.conversations)
  );
}

export default function useSettingsExportImport() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const todos = queryClient.getQueryData<TodoResponse[]>(queryKeys.todos) ?? [];
    const events = queryClient.getQueryData<EventResponse[]>(queryKeys.events) ?? [];
    const conversations = queryClient.getQueryData<ConversationResponse[]>(queryKeys.conversations) ?? [];

    const backup: BackupData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: { todos, events, conversations },
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

    const { todos, events, conversations } = backup.data;
    const confirmed = window.confirm(
      `Import ${todos.length} todos, ${events.length} events, and ${conversations.length} conversations?\n\nThis will add them as new items.`,
    );
    if (!confirmed) return;

    let errors = 0;

    for (const todo of todos) {
      try {
        const { title, description, priority, due_date, tags } = todo as Record<string, unknown>;
        await apiClient.post('/todos', {
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
        await apiClient.post('/events', {
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

    for (const convo of conversations) {
      try {
        const { title } = convo as Record<string, unknown>;
        await apiClient.post('/chat/conversations', {
          title: title != null ? String(title) : 'New Conversation',
        });
      } catch {
        errors++;
      }
    }

    // Invalidate all queries to pick up imported data
    queryClient.invalidateQueries({ queryKey: queryKeys.todos });
    queryClient.invalidateQueries({ queryKey: queryKeys.events });
    queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    queryClient.invalidateQueries({ queryKey: queryKeys.today });

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

  return { fileInputRef, handleExport, onFileSelected };
}
