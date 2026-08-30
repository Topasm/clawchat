import { useNavigate } from 'react-router-dom';
import WorkspaceConnectionsSection from '../components/settings/WorkspaceConnectionsSection';
import ToastContainer from '../components/shared/ToastContainer';
import { useTheme } from '../config/ThemeContext';
import { themeCssVars } from '../config/themeCssVars';

export default function ConnectionCenterPage() {
  const navigate = useNavigate();
  const { colors } = useTheme();

  return (
    <div className="cc-public-shell" style={themeCssVars(colors)}>
      <header className="cc-public-shell__header">
        <div>
          <div className="cc-public-shell__eyebrow">ClawChat</div>
          <h1>Connections</h1>
          <p>Choose the workspace to view and manage this device's local server separately.</p>
        </div>
        <div className="cc-settings-inline-actions">
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => navigate('/settings/app')}
          >
            Settings
          </button>
          <button
            type="button"
            className="cc-btn cc-btn--secondary"
            onClick={() => navigate('/diagnostics')}
          >
            Diagnostics
          </button>
          <button type="button" className="cc-btn cc-btn--secondary" onClick={() => navigate(-1)}>
            Back
          </button>
        </div>
      </header>

      <main className="cc-public-shell__content cc-settings-page">
        <WorkspaceConnectionsSection />
      </main>
      <ToastContainer />
    </div>
  );
}
