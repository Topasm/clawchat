import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';
import { IS_ELECTRON } from '../types/platform';
import { DEFAULT_SERVER_URL, DEFAULT_SERVER_URL_PLACEHOLDER } from '../config/constants';
import PairingCodeDisplay from '../components/pairing/PairingCodeDisplay';

type Step = 'welcome' | 'server' | 'claude' | 'pairing' | 'ready';

const STEPS: Step[] = ['welcome', 'server', 'claude', 'pairing', 'ready'];

type ServerStatus = 'checking' | 'online' | 'offline' | 'error';
type ClaudeStatus = 'checking' | 'ready' | 'not-installed' | 'not-authenticated' | 'unavailable';

export default function OnboardingPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const serverUrl = useAuthStore((s) => s.serverUrl);

  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking');
  const [electronServerStatus, setElectronServerStatus] = useState<string>('unknown');
  const [manualServerUrl, setManualServerUrl] = useState(DEFAULT_SERVER_URL);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus>('checking');
  const [pairingComplete, setPairingComplete] = useState(false);

  const currentIndex = STEPS.indexOf(currentStep);

  // If user already has a token, redirect to the app
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

    if (IS_ELECTRON) {
      checkElectronServer();
      // Listen for status changes
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
      checkServerHealth();
    }
  }, [currentStep, checkElectronServer, checkServerHealth]);

  // Auto-retry Electron server check when status is checking
  useEffect(() => {
    if (currentStep !== 'server' || !IS_ELECTRON || serverStatus !== 'checking') return;
    const interval = setInterval(checkElectronServer, 2000);
    return () => clearInterval(interval);
  }, [currentStep, serverStatus, checkElectronServer]);

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
      // The health endpoint may report claude_code status
      if (data.claude_code === 'authenticated' || data.claudeCode === 'authenticated') {
        setClaudeStatus('ready');
      } else if (data.claude_code === 'not_authenticated' || data.claudeCode === 'not_authenticated') {
        setClaudeStatus('not-authenticated');
      } else if (data.claude_code === 'not_installed' || data.claudeCode === 'not_installed') {
        setClaudeStatus('not-installed');
      } else {
        // Server is reachable but no claude info — treat as ready (graceful)
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
    if (nextIndex < STEPS.length) {
      setCurrentStep(STEPS[nextIndex]);
    }
  };

  const goBack = () => {
    const prevIndex = currentIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(STEPS[prevIndex]);
    }
  };

  const enterApp = () => {
    // Mark onboarding as complete
    try {
      localStorage.setItem('cc-onboarding-complete', 'true');
    } catch {
      // localStorage may be unavailable
    }
    navigate('/login', { replace: true });
  };

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
    STEPS.forEach((_, i) => {
      elements.push(renderStepDot(i));
      if (i < STEPS.length - 1) {
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
        return 'cc-onboarding__status-dot cc-onboarding__status-dot--red';
      case 'error':
        return 'cc-onboarding__status-dot cc-onboarding__status-dot--red';
    }
  };

  const getServerStatusLabel = () => {
    if (IS_ELECTRON) {
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

  const renderServer = () => (
    <div className="cc-onboarding__card">
      <h2 className="cc-onboarding__card-title">Server Status</h2>
      <p className="cc-onboarding__card-description">
        {IS_ELECTRON
          ? 'ClawChat includes an embedded server. It should start automatically.'
          : 'Connect to your ClawChat server to sync your data.'}
      </p>

      <div className="cc-onboarding__status-row">
        <div className={getServerStatusDot()} />
        <div>
          <div className="cc-onboarding__status-label">{getServerStatusLabel()}</div>
          {IS_ELECTRON && serverStatus === 'checking' && (
            <div className="cc-onboarding__status-sublabel">This usually takes a few seconds</div>
          )}
        </div>
      </div>

      {!IS_ELECTRON && (
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
            Enter the URL where your ClawChat server is running. When opened through a reverse proxy or tunnel, leaving the default is usually correct.
          </div>
        </div>
      )}

      {IS_ELECTRON && serverStatus === 'offline' && (
        <button
          className="cc-btn cc-btn--secondary"
          onClick={checkElectronServer}
          style={{ marginTop: 8 }}
        >
          Retry
        </button>
      )}

      {!IS_ELECTRON && (serverStatus === 'offline' || serverStatus === 'error') && (
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
            {claudeStatus === 'ready' ? 'Next' : 'Next'}
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
            {pairingComplete ? 'Next' : 'Next'}
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
        ClawChat is ready to use. You can adjust any of these settings later
        from the Settings page.
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
    </div>
  );
}
