import type { ProjectFolderCandidate } from '../../types/schemas';
import { translateUi } from '../../i18n';

interface InboxProjectCandidatesProps {
  candidates: ProjectFolderCandidate[];
  busy: boolean;
  onImport: (candidate: ProjectFolderCandidate) => void;
}

/** Vault project folders no project is named after yet, each one import away. */
export default function InboxProjectCandidates({
  candidates,
  busy,
  onImport,
}: InboxProjectCandidatesProps) {
  if (candidates.length === 0) return null;
  return (
    <aside className="cc-inbox-candidates" aria-labelledby="cc-inbox-candidates-title">
      <h2 className="cc-inbox-section__title" id="cc-inbox-candidates-title">
        {translateUi('Projects in your vault')}
      </h2>
      <ul className="cc-inbox-list">
        {candidates.map((candidate) => (
          <li key={`${candidate.source_name}:${candidate.folder}`} className="cc-inbox-row">
            <span className="cc-inbox-row__title cc-inbox-row__title--static">
              {candidate.name}
              <small>{candidate.source_name}</small>
            </span>
            <button
              type="button"
              className="cc-btn cc-btn--compact"
              disabled={busy}
              onClick={() => onImport(candidate)}
            >
              {translateUi('Import')}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
