import { useProjectsQuery } from '../hooks/queries';
import InboxNotesPanel from '../components/inbox/InboxNotesPanel';
import { translateUi } from '../i18n';

/** Notes with no project yet (the Inbox files ideas here); projects keep their own. */
export default function NotesPage() {
  const { data: projects = [] } = useProjectsQuery();
  return (
    <div className="cc-notes-page">
      <div className="cc-page-header">
        <div className="cc-page-header__title">{translateUi('Notes')}</div>
      </div>
      <InboxNotesPanel projects={projects} />
    </div>
  );
}
