import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, useCreateProject, useInboxProjectCandidatesQuery } from '../../hooks/queries';
import type { ProjectFolderCandidate } from '../../types/schemas';
import { translateUi } from '../../i18n';

/**
 * Vault project folders (01_Projects and the like) no project is named after
 * yet, each one import away. A project is only ever made on purpose: from
 * here or "+ 프로젝트", never out of a task.
 */
export default function ProjectFolderCandidates() {
  const queryClient = useQueryClient();
  const { data: candidates = [] } = useInboxProjectCandidatesQuery();
  const createProject = useCreateProject();
  if (candidates.length === 0) return null;
  const importCandidate = (candidate: ProjectFolderCandidate) =>
    createProject.mutate(
      { title: candidate.name, description: candidate.folder },
      {
        onSuccess: () =>
          void queryClient.invalidateQueries({ queryKey: queryKeys.inboxProjectCandidates }),
      },
    );
  return (
    <section className="cc-project-candidates" aria-labelledby="cc-project-candidates-title">
      <h2 className="cc-inbox-section__title" id="cc-project-candidates-title">
        {translateUi('Projects in your vault')}
      </h2>
      <ul className="cc-inbox-list">
        {candidates.map((candidate) => (
          <li key={`${candidate.source_name}:${candidate.folder}`} className="cc-inbox-row">
            <span className="cc-inbox-row__title cc-inbox-row__title--static">
              {candidate.name}
              <small>{candidate.folder}</small>
            </span>
            <button
              type="button"
              className="cc-btn cc-btn--compact"
              disabled={createProject.isPending}
              onClick={() => importCandidate(candidate)}
            >
              {translateUi('Import')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
