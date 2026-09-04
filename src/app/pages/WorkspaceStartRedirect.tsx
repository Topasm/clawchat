import { Navigate } from 'react-router-dom';
import { useCapabilitiesQuery } from '../hooks/queries/useCapabilitiesQuery';
import { useAuthStore } from '../stores/useAuthStore';
import { translateUi } from '../i18n';

/** Pick the first useful workspace surface while retaining old-server support. */
export default function WorkspaceStartRedirect() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const { data: capabilities, isLoading, isError } = useCapabilitiesQuery();

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          minHeight: 200,
          fontSize: 13,
          color: 'var(--cc-text-secondary)',
        }}
      >
        {translateUi('Loading…')}
      </div>
    );
  }

  const inboxUnavailable = !serverUrl || isError || capabilities?.features.inbox_pipeline === false;
  return <Navigate to={inboxUnavailable ? '/tasks' : '/inbox'} replace />;
}
