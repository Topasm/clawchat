import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import apiClient from '../services/apiClient';

export default function useTodayBriefing() {
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const serverUrl = useAuthStore((s) => s.serverUrl);

  useEffect(() => {
    if (!serverUrl) return;
    setBriefingLoading(true);
    apiClient.get('/today/briefing')
      .then((res) => setBriefing(res.data?.briefing ?? null))
      .catch(() => setBriefing(null))
      .finally(() => setBriefingLoading(false));
  }, [serverUrl]);

  return { briefing, briefingLoading };
}
