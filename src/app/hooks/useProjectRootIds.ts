import { useMemo } from 'react';
import { useProjectsQuery } from './queries';

/**
 * The tasks that stand for projects themselves. They are listed on the
 * Projects page, so task lists and counts leave them out.
 */
export default function useProjectRootIds(): Set<string> {
  const { data: projects = [] } = useProjectsQuery();
  return useMemo(
    () => new Set(projects.flatMap((project) => project.root_task_id ?? [])),
    [projects],
  );
}
