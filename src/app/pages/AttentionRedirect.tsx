import { Navigate, useLocation } from 'react-router-dom';
/**
 * `/runs` and `/review` used to be pages of their own. They are views of the
 * Attention page now, but links to the old paths still arrive: the server puts
 * `/runs?run_id=` in review items, and bookmarks and threads keep them too.
 */
export default function AttentionRedirect({ view }: { view: 'runs' | 'history' }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set('view', view);
  return (
    <Navigate
      to={`/attention?${params.toString()}${location.hash}`}
      replace
      state={location.state}
    />
  );
}
