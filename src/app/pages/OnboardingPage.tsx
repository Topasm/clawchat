import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';
import { IS_ELECTRON } from '../types/platform';
import { DEFAULT_SERVER_URL, DEFAULT_SERVER_URL_PLACEHOLDER } from '../config/constants';
import { useAppMode } from '../hooks/useAppMode';
import PairingCodeDisplay from '../components/pairing/PairingCodeDisplay';
import QRScanner from '../components/shared/QRScanner';

type Step = 'welcome' | 'role' | 'server' | 'claude' | 'pairing' | 'ready';

type ServerStatus = 'checking' | 'online' | 'offline' | 'error';
type ClaudeStatus = 'checking' | 'ready' | 'not-installed' | 'not-authenticated' | 'unavailable';

function getSteps(isElectron: boolean, chosenRole: 'host' | 'client' | null): Step[] {
  if (!isElectron) {
    return ['welcome', 'server', 'claude', 'pairing', 'ready'];
  }
  if (chosenRole === 'client') {
    return ['welcome', 'role', 'server', 'ready'];
  }
  // Host or not yet chosen
  return ['welcome', 'role', 'server', 'claude', 'pairing', 'ready'];
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const { appMode, setAppMode } = useAppMode();

  const [chosenRole, setChosenRole] = useState<'host' | 'client' | null>(
    IS_ELECTRON ? null : null
  );
  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking');
  const [electronServerStatus, setElectronServerStatus] = useState<string>('unknown');
  const [manualServerUrl, setManualServerUrl] = useState(DEFAULT_SERVER_URL);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus>('checking');
  const [pairingComplete, setPairingComplete] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const steps = getSteps(IS_ELECTRON, chosenRole);
  const currentIndex = steps.indexOf(currentStep);

  // Sync chosenRole from appMode if already set (e.g. migration)
  useEffect(() => {
    if (IS_ELECTRON && appMode && chosenRole === null) {
      setChosenRole(appMode);
    }
  }, [appMode, chosenRole]);

  // Redirect if already logged in
  useEffect(() => {
    if (token) {
      navigate('/today', { replace: true });
    }
  }, [token, navigate]);

  // Check embedded server status (Electron IPC)
  const checkElectronServer = useCallback(async () => {
    if (!IS_ELECTRON) return;
    try {
      const status = await window.electronAPI.server.getStatus();
      setElectronServerStatus(status.state);
      if (status.state === 'running') {
        setServerStatus('online');
      } else if (status.state === 'starting') {
        setServerStatus('checking');
      } else {
        setServerStatus('offline');
      }
    } catch {
      setServerStatus('error');
    }
  }, []);

  // Check server health via HTTP
  const checkServerHealth = useCallback(async (url?: string) => {
    const targetUrl = (url ?? manualServerUrl).replace(/\/+$/, '');
    if (!targetUrl) {
      setServerStatus('offline');
      return;
    }
    setServerStatus('checking');
    try {
      const response = await fetch(`${targetUrl}/api/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      setServerStatus(response.ok ? 'online' : 'error');
    } catch {
      setServerStatus('offline');
    }
  }, [manualServerUrl]);

  // Auto-check server when entering the server step
  useEffect(() => {
    if (currentStep !== 'server') return;

    if (IS_ELECTRON && chosenRole === 'host') {
      checkElectronServer();
      const unsub = window.electronAPI.server.onStatusChange((status) => {
        setElectronServerStatus(status.state);
        if (status.state === 'running') {
          setServerStatus('online');
        } else if (status.state === 'starting') {
          setServerStatus('checking');
        } else {
          setServerStatus('offline');
        }
      });
      return unsub;
    } else {
      // Client mode (Electron or non-Electron): check remote server health
      checkServerHealth();
    }
  }, [currentStep, chosenRole, checkElectronServer, checkServerHealth]);

  // Auto-retry Electron server check when status is checking
  useEffect(() => {
    if (currentStep !== 'server' || !IS_ELECTRON || chosenRole !== 'host' || serverStatus !== 'checking') return;
    const interval = setInterval(checkElectronServer, 2000);
    return () => clearInterval(interval);
  }, [currentStep, chosenRole, serverStatus, checkElectronServer]);

  // Check Claude Code availability
  const checkClaudeCode = useCallback(async () => {
    setClaudeStatus('checking');
    const baseUrl = IS_ELECTRON
      ? (serverUrl ?? DEFAULT_SERVER_URL)
      : manualServerUrl.replace(/\/+$/, '');

    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        setClaudeStatus('unavailable');
        return;
      }

      const data = await response.json();
      if (data.claude_code === 'authenticated' || data.claudeCode === 'authenticated') {
        setClaudeStatus('ready');
      } else if (data.claude_code === 'not_authenticated' || data.claudeCode === 'not_authenticated') {
        setClaudeStatus('not-authenticated');
      } else if (data.claude_code === 'not_installed' || data.claudeCode === 'not_installed') {
        setClaudeStatus('not-installed');
      } else {
        setClaudeStatus('ready');
      }
    } catch {
      setClaudeStatus('unavailable');
    }
  }, [serverUrl, manualServerUrl]);

  useEffect(() => {
    if (currentStep === 'claude') {
      checkClaudeCode();
    }
  }, [currentStep, checkClaudeCode]);

  const goNext = () => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex]);
    }
  };

  const goBack = () => {
    const prevIndex = currentIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex]);
    }
  };

  const enterApp = () => {
    try {
      localStorage.setItem('cc-onboarding-complete', 'true');
    } catch { /* localStorage may be unavailable */ }
    navigate('/login', { replace: true });
  };

  const handleRoleSelect = async (role: 'host' | 'client') => {
    setChosenRole(role);
    if (IS_ELECTRON) {
      await setAppMode(role);
    }
    // Advance to next step (server)
    const nextSteps = getSteps(IS_ELECTRON, role);
    const roleIndex = nextSteps.indexOf('role');
    if (roleIndex >= 0 && roleIndex + 1 < nextSteps.length) {
      setCurrentStep(nextSteps[roleIndex + 1]);
    }
  };

  const handleQRScan = async (data: string) => {
    setShowScanner(false);
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'clawchat_pair' && parsed.server_url && parsed.code) {
        const pairUrl = parsed.server_url.replace(/\/+$/, '');
        setManualServerUrl(pairUrl);
        setServerStatus('checking');
        try {
          const res = await fetch(`${pairUrl}/api/pairing/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: parsed.code,
              device_name: IS_ELECTRON ? 'Desktop Client' : 'Device',
              device_type: IS_ELECTRON ? 'web' : 'android',
            }),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData?.detail || 'Pairing failed');
          }
          const result = await res.json();
          const resolvedUrl = result.api_base_url || pairUrl;
          // Store device token
          useAuthStore.setState({
            token: result.device_token,
            refreshToken: null,
            serverUrl: resolvedUrl,
            isLoading: false,
          });
          // Save host URL in Electron config
          if (IS_ELECTRON) {
            await window.electronAPI.server.updateConfig({ hostServerUrl: resolvedUrl });
          }
          setServerStatus('online');
        } catch (err) {
          console.error('QR pairing failed:', err);
          setServerStatus('error');
        }
      } else if (parsed.serverUrl) {
        setManualServerUrl(parsed.serverUrl);
        checkServerHealth(parsed.serverUrl);
      }
    } catch {
      // Not valid JSON / QR
    }
  };

  // ── Step renderers ──────────────────────────────────────────

  const renderStepDot = (index: number) => {
    let className = 'cc-onboarding__step-dot';
    if (index === currentIndex) {
      className += ' cc-onboarding__step-dot--active';
    } else if (index < currentIndex) {
      className += ' cc-onboarding__step-dot--completed';
    }
    return (
      <div key={`dot-${index}`} className={className}>
        {index < currentIndex ? '\u2713' : index + 1}
      </div>
    );
  };

  const renderStepLine = (index: number) => {
    let className = 'cc-onboarding__step-line';
    if (index < currentIndex) {
      className += ' cc-onboarding__step-line--completed';
    }
    return <div key={`line-${index}`} className={className} />;
  };

  const renderStepper = () => {
    const elements: React.ReactNode[] = [];
    steps.forEach((_, i) => {
      elements.push(renderStepDot(i));
      if (i < steps.length - 1) {
        elements.push(renderStepLine(i));
      }
    });
    return <div className="cc-onboarding__stepper">{elements}</div>;
  };

  const getServerStatusDot = () => {
    switch (serverStatus) {
      case 'checking':
        return 'cc-onboarding__status-dot cc-onboarding__status-dot--spin';
      case 'online':
        return 'cc-onboarding__status-dot cc-onboarding__status-dot--green';
      case 'offline':
      case 'error':
        return 'cc-onboarding__status-dot cc-onboarding__status-dot--red';
    }
  };

  const getServerStatusLabel = () => {
    if (IS_ELECTRON && chosenRole === 'host') {
      switch (serverStatus) {
        case 'checking':
          return 'Starting embedded server...';
        case 'online':
          return 'Server is running';
        case 'offline':
          return `Server is ${electronServerStatus}`;
        case 'error':
          return 'Failed to start server';
      }
    }
    switch (serverStatus) {
      case 'checking':
        return 'Checking server...';
      case 'online':
        return 'Server is reachable';
      case 'offline':
        return 'Server is unreachable';
      case 'error':
        return 'Connection error';
    }
  };

  const getClaudeStatusDot = () => {
    switch (claudeStatus) {
      case 'checking':
        return 'cc-onboarding__status-dot cc-onboarding__status-dot--spin';
      case 'ready':
        return 'cc-onboarding__status-dot cc-onboarding__status-dot--green';
      case 'not-authenticated':
        return 'cc-onboarding__status-dot cc-onboarding__status-dot--yellow';
      case 'not-installed':
        return 'cc-onboarding__status-dot cc-onboarding__status-dot--red';
      case 'unavailable':
        return 'cc-onboarding__status-dot cc-onboarding__status-dot--gray';
    }
  };

  const renderWelcome = () => (
    <div className="cc-onboarding__card">
      <h2 className="cc-onboarding__card-title">Welcome to ClawChat</h2>
      <p className="cc-onboarding__card-description">
        ClawChat is your personal productivity hub with AI-powered chat, tasks,
        calendar, and notes &mdash; all in one place. This wizard will help you
        get everything set up in a few quick steps.
      </p>
      <div className="cc-onboarding__actions">
        <span />
        <div className="cc-onboarding__actions-right">
          <button className="cc-btn cc-btn--primary" onClick={goNext}>
            Get Started
          </button>
        </div>
      </div>
    </div>
  );

  const renderRole = () => (
    <div className="cc-onboarding__card">
      <h2 className="cc-onboarding__card-title">Choose Your Role</h2>
      <p className="cc-onboarding__card-description">
        Is this your main desktop, or are you connecting to a ClawChat host
        running on another machine?
      </p>

      <div className="cc-onboarding__role-grid">
        <div
          className={`cc-onboarding__role-card${chosenRole === 'host' ? ' cc-onboarding__role-card--selected' : ''}`}
          onClick={() => handleRoleSelect('host')}
        >
          <div className="cc-onboarding__role-icon">{'\uD83D\uDDA5'}</div>
          <div className="cc-onboarding__role-content">
            <div className="cc-onboarding__role-title">Set Up as Host</div>
            <p className="cc-onboarding__role-description">
              Run the ClawChat server on this computer. Your data stays here.
              Other devices connect to you.
            </p>
          </div>
        </div>

        <div
          className={`cc-onboarding__role-card${chosenRole === 'client' ? ' cc-onboarding__role-card--selected' : ''}`}
          onClick={() => handleRoleSelect('client')}
        >
          <div className="cc-onboarding__role-icon">{'\uD83D\uDD17'}</div>
          <div className="cc-onboarding__role-content">
            <div className="cc-onboarding__role-title">Connect to a Host</div>
            <p className="cc-onboarding__role-description">
              Connect to a ClawChat server running on another device. No server
              runs on this machine.
            </p>
          </div>
        </div>
      </div>

      <div className="cc-onboarding__actions">
        <button className="cc-btn cc-btn--ghost" onClick={goBack}>
          Back
        </button>
        <span />
      </div>
    </div>
  );

  const renderServer = () => {
    const isHostOnElectron = IS_ELECTRON && chosenRole === 'host';
    const showUrlInput = !isHostOnElectron;

    return (
      <div className="cc-onboarding__card">
        <h2 className="cc-onboarding__card-title">
          {isHostOnElectron ? 'Server Status' : 'Connect to Host'}
        </h2>
        <p className="cc-onboarding__card-description">
          {isHostOnElectron
            ? 'ClawChat includes an embedded server. It should start automatically.'
            : 'Connect to your ClawChat host by scanning a QR code or entering the server URL.'}
        </p>

        <div className="cc-onboarding__status-row">
          <div className={getServerStatusDot()} />
          <div>
            <div className="cc-onboarding__status-label">{getServerStatusLabel()}</div>
            {isHostOnElectron && serverStatus === 'checking' && (
              <div className="cc-onboarding__status-sublabel">This usually takes a few seconds</div>
            )}
          </div>
        </div>

        {showUrlInput && (
          <>
            <div className="cc-onboarding__input-group">
              <label className="cc-onboarding__input-label">Server URL</label>
              <input
                type="url"
                className="cc-onboarding__input"
                value={manualServerUrl}
                onChange={(e) => setManualServerUrl(e.target.value)}
                onBlur={() => checkServerHealth()}
                placeholder={DEFAULT_SERVER_URL_PLACEHOLDER}
              />
              <div className="cc-onboarding__input-hint">
                Enter the URL where your ClawChat host is running, or scan a QR code from the host.
              </div>
            </div>

            <button
              className="cc-btn cc-btn--secondary"
              onClick={() => setShowScanner(true)}
              style={{ marginBottom: 8 }}
            >
              Scan QR Code
            </button>
          </>
        )}

        {isHostOnElectron && serverStatus === 'offline' && (
          <button
            className="cc-btn cc-btn--secondary"
            onClick={checkElectronServer}
            style={{ marginTop: 8 }}
          >
            Retry
          </button>
        )}

        {showUrlInput && (serverStatus === 'offline' || serverStatus === 'error') && (
          <button
            className="cc-btn cc-btn--secondary"
            onClick={() => checkServerHealth()}
            style={{ marginTop: 8 }}
          >
            Retry
          </button>
        )}

        <div className="cc-onboarding__actions">
          <button className="cc-btn cc-btn--ghost" onClick={goBack}>
            Back
          </button>
          <div className="cc-onboarding__actions-right">
            <button className="cc-btn cc-btn--primary" onClick={goNext}>
              {serverStatus === 'online' ? 'Next' : 'Skip'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderClaudeCode = () => (
    <div className="cc-onboarding__card">
      <h2 className="cc-onboarding__card-title">Claude Code</h2>
      <p className="cc-onboarding__card-description">
        ClawChat can use Claude Code for AI-powered features like smart task
        suggestions, natural language chat, and more. This is optional &mdash;
        all non-AI features work without it.
      </p>

      <div className="cc-onboarding__status-row">
        <div className={getClaudeStatusDot()} />
        <div>
          <div className="cc-onboarding__status-label">
            {claudeStatus === 'checking' && 'Checking Claude Code...'}
            {claudeStatus === 'ready' && 'Claude Code is installed and authenticated'}
            {claudeStatus === 'not-installed' && 'Claude Code is not installed'}
            {claudeStatus === 'not-authenticated' && 'Claude Code is not authenticated'}
            {claudeStatus === 'unavailable' && 'Could not check Claude Code status'}
          </div>
        </div>
      </div>

      {claudeStatus === 'not-installed' && (
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--cc-text-secondary)', lineHeight: 1.6 }}>
          Install Claude Code from{' '}
          <a
            href="https://docs.anthropic.com/en/docs/claude-code"
            target="_blank"
            rel="noopener noreferrer"
            className="cc-onboarding__link"
          >
            docs.anthropic.com
          </a>
          , then return here and click Retry.
        </div>
      )}

      {claudeStatus === 'not-authenticated' && (
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--cc-text-secondary)', lineHeight: 1.6 }}>
          Run <code className="cc-onboarding__code">claude login</code> in your
          terminal to authenticate, then click Retry.
        </div>
      )}

      {(claudeStatus === 'not-installed' || claudeStatus === 'not-authenticated' || claudeStatus === 'unavailable') && (
        <button
          className="cc-btn cc-btn--secondary"
          onClick={checkClaudeCode}
          style={{ marginTop: 8 }}
        >
          Retry
        </button>
      )}

      <div className="cc-onboarding__actions">
        <button className="cc-btn cc-btn--ghost" onClick={goBack}>
          Back
        </button>
        <div className="cc-onboarding__actions-right">
          {claudeStatus !== 'ready' && (
            <button className="cc-btn cc-btn--ghost" onClick={goNext}>
              Skip for now
            </button>
          )}
          <button className="cc-btn cc-btn--primary" onClick={goNext}>
            Next
          </button>
        </div>
      </div>
    </div>
  );

  const renderPairing = () => (
    <div className="cc-onboarding__card">
      <h2 className="cc-onboarding__card-title">Mobile Pairing</h2>
      <p className="cc-onboarding__card-description">
        Optionally pair a mobile device to access ClawChat on the go. You can
        always set this up later in Settings.
      </p>

      {serverStatus === 'online' && token ? (
        <PairingCodeDisplay compact onPaired={() => setPairingComplete(true)} />
      ) : (
        <>
          <div className="cc-onboarding__qr-placeholder">
            <span>Log in to the server first<br />to generate a pairing code</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--cc-text-tertiary)', textAlign: 'center', marginTop: 8 }}>
            You can pair devices later from Settings after logging in.
          </div>
        </>
      )}

      <div className="cc-onboarding__actions">
        <button className="cc-btn cc-btn--ghost" onClick={goBack}>
          Back
        </button>
        <div className="cc-onboarding__actions-right">
          {!pairingComplete && (
            <button className="cc-btn cc-btn--ghost" onClick={goNext}>
              Skip
            </button>
          )}
          <button className="cc-btn cc-btn--primary" onClick={goNext}>
            Next
          </button>
        </div>
      </div>
    </div>
  );

  const renderReady = () => (
    <div className="cc-onboarding__card" style={{ textAlign: 'center' }}>
      <div className="cc-onboarding__ready-icon">
        <span>{'\u2713'}</span>
      </div>
      <h2 className="cc-onboarding__card-title" style={{ textAlign: 'center' }}>
        You&apos;re all set!
      </h2>
      <p className="cc-onboarding__card-description" style={{ textAlign: 'center' }}>
        {IS_ELECTRON && chosenRole === 'host'
          ? 'Your ClawChat host is running. Other devices can connect to this machine.'
          : 'ClawChat is ready to use.'
        }{' '}
        You can adjust any of these settings later from the Settings page.
      </p>
      <div className="cc-onboarding__actions" style={{ justifyContent: 'center' }}>
        <button className="cc-btn cc-btn--primary" onClick={enterApp} style={{ padding: '12px 32px', fontSize: 15 }}>
          Enter ClawChat
        </button>
      </div>
    </div>
  );

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 'welcome':
        return renderWelcome();
      case 'role':
        return renderRole();
      case 'server':
        return renderServer();
      case 'claude':
        return renderClaudeCode();
      case 'pairing':
        return renderPairing();
      case 'ready':
        return renderReady();
    }
  };

  return (
    <div className="cc-onboarding">
      <div className="cc-onboarding__container">
        {renderStepper()}
        {renderCurrentStep()}
      </div>
      {showScanner && (
        <QRScanner onScan={handleQRScan} onClose={() => setShowScanner(false)} />
      )}
    </div>
  );
}
