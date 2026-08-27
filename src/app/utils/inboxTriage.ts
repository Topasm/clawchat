import type { InboxTriagePreviewResponse, TaskPlacementGroup } from '../types/schemas';

export function buildInboxTriagePlacementGroups(
  preview: InboxTriagePreviewResponse,
  selectedTaskIds: readonly string[],
): TaskPlacementGroup[] {
  const selected = new Set(selectedTaskIds);
  const groups = new Map<string, TaskPlacementGroup>();

  for (const suggestion of preview.suggestions) {
    if (!selected.has(suggestion.task_id)) continue;
    const proposed = suggestion.proposed_parent_key
      ? preview.proposed_workstreams.find(
          (workstream) => workstream.key === suggestion.proposed_parent_key,
        )
      : null;
    if (suggestion.proposed_parent_key && !proposed) {
      throw new Error('The suggested Workstream is no longer available');
    }

    const key = proposed
      ? `new:${proposed.key}`
      : `existing:${suggestion.project_id}\u0000${suggestion.parent_id ?? ''}`;
    const group = groups.get(key) ?? {
      todo_ids: [],
      project_id: suggestion.project_id,
      parent_id: proposed ? null : suggestion.parent_id,
      inbox_state: 'none' as const,
      ...(proposed
        ? {
            create_parent: {
              title: proposed.title,
              description: proposed.description,
              parent_id: proposed.parent_id,
            },
          }
        : {}),
    };
    group.todo_ids.push(suggestion.task_id);
    groups.set(key, group);
  }

  return Array.from(groups.values());
}
