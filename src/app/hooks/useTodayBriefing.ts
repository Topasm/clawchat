import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import apiClient from '../services/apiClient';

export interface BriefingStats {
  events: number;
  tasks_due: number;
  overdue: number;
  in_progress: number;
  inbox: number;
  agent_tasks: number;
  [key: string]: number;
}

export interface BriefingSuggestion {
  action: string;
  todo_id: string;
  title: string;
  reason: string;
}

export interface BriefingData {
  summary: string;
  highlights?: string[];
  suggestions?: BriefingSuggestion[];
  load_assessment?: 'light' | 'moderate' | 'heavy';
  load_message?: string;
  stats: BriefingStats;
  date: string;
}

export default function useTodayBriefing() {
  const [briefingData, setBriefingData] = useState<BriefingData | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const serverUrl = useAuthStore((s) => s.serverUrl);

  useEffect(() => {
    if (!serverUrl) return;
    setBriefingLoading(true);
    apiClient.get('/today/briefing')
      .then((res) => setBriefingData(res.data ?? null))
      .catch(() => setBriefingData(null))
      .finally(() => setBriefingLoading(false));
  }, [serverUrl]);

  return { briefingData, briefingLoading };
}
