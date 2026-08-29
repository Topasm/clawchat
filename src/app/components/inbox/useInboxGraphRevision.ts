import { useCallback, useEffect, useState } from 'react';

import type { TaskGraphInsightsResponse } from '../../types/api';

interface GraphInsightsSource {
  data?: TaskGraphInsightsResponse;
  refetch: () => Promise<{ data?: TaskGraphInsightsResponse }>;
}

export interface InboxGraphRevision {
  /** The revision every optimistic Inbox command is expected to apply on top of. */
  placementRevision: number | null;
  setPlacementRevision: (revision: number) => void;
  /** Re-reads the server revision after a 409 so the next command can succeed. */
  refreshPlacementRevision: () => Promise<void>;
}

/** Tracks the graph revision the Inbox commands optimistically build on. */
export default function useInboxGraphRevision(
  graphInsights: GraphInsightsSource,
): InboxGraphRevision {
  const [placementRevision, setPlacementRevision] = useState<number | null>(null);

  useEffect(() => {
    if (graphInsights.data) setPlacementRevision(graphInsights.data.graph_revision);
  }, [graphInsights.data]);

  const refetch = graphInsights.refetch;
  const refreshPlacementRevision = useCallback(async () => {
    const refreshed = await refetch();
    if (refreshed.data) setPlacementRevision(refreshed.data.graph_revision);
  }, [refetch]);

  return { placementRevision, setPlacementRevision, refreshPlacementRevision };
}
