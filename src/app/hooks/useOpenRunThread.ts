import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useOptionalChatPanelController } from '../components/chat-panel/ChatPanelControllerContext';
import apiClient from '../services/apiClient';
import { AgentRunResponseSchema } from '../types/schemas';

/** Resolve the execution's conversation, never the task's planning conversation. */
export default function useOpenRunThread() {
  const panel = useOptionalChatPanelController();
  const navigate = useNavigate();
  const location = useLocation();
  const generation = useRef(0);
  const mounted = useRef(true);
  const locationKey = useRef(location.key);
  locationKey.current = location.key;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [location.key]);

  return async (runId: string, subtitle?: string) => {
    if (!mounted.current || location.key !== locationKey.current) return;
    const request = ++generation.current;
    if (!panel) {
      navigate(`/runs?run_id=${runId}`);
      return;
    }
    const isCurrentSelection = panel.beginSelection?.() ?? (() => true);
    try {
      const response = await apiClient.get(`/runs/${runId}`);
      const run = AgentRunResponseSchema.parse(response.data);
      if (request !== generation.current || !isCurrentSelection()) return;
      if (run.conversation_id) {
        panel.open(run.conversation_id, {
          kind: 'run',
          ...(run.project_id ? { projectId: run.project_id } : {}),
          title: 'Task Agent',
          subtitle: subtitle ?? run.todo_title ?? undefined,
        });
        return;
      }
    } catch {
      // Keep the successfully started run accessible when thread lookup fails.
    }
    if (request === generation.current && isCurrentSelection()) navigate(`/runs?run_id=${runId}`);
  };
}
