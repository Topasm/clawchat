import { getStartupDiagnostics, type StartupPhase } from './startupPerformance';

export type RuntimeMetric = 'ui.inputToFrame' | 'ui.longTask';

export interface MetricSummary {
  count: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface RuntimePerformanceReport {
  schemaVersion: 1;
  generatedAt: string;
  startup: Partial<Record<StartupPhase, number>>;
  metrics: Partial<Record<RuntimeMetric, MetricSummary>>;
  budget: {
    passed: boolean;
    violations: string[];
  };
}

const MAX_SAMPLES = 500;
const STARTUP_BUDGET_MS: Partial<Record<StartupPhase, number>> = {
  auth_ready: 3_000,
  route_ready: 4_000,
  startup_shell_hidden: 4_200,
  platform_ready: 3_000,
  transport_ready: 5_000,
};
const METRIC_P95_BUDGET_MS: Partial<Record<RuntimeMetric, number>> = {
  'ui.inputToFrame': 50,
  'ui.longTask': 200,
};

declare global {
  interface Window {
    clawchatPerformance?: {
      report(): RuntimePerformanceReport;
      reset(): void;
    };
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function summarizeSamples(samples: readonly number[]): MetricSummary {
  if (samples.length === 0) {
    return { count: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (ratio: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
  return {
    count: sorted.length,
    meanMs: round(sorted.reduce((total, value) => total + value, 0) / sorted.length),
    p50Ms: round(percentile(0.5)),
    p95Ms: round(percentile(0.95)),
    maxMs: round(sorted[sorted.length - 1]),
  };
}

export function evaluateRuntimeBudget(
  startup: Partial<Record<StartupPhase, number>>,
  metrics: Partial<Record<RuntimeMetric, MetricSummary>>,
): string[] {
  const violations: string[] = [];

  for (const [phase, maxMs] of Object.entries(STARTUP_BUDGET_MS) as Array<[StartupPhase, number]>) {
    const actualMs = startup[phase];
    if (actualMs !== undefined && actualMs > maxMs) {
      violations.push(`${phase} ${actualMs}ms exceeds ${maxMs}ms`);
    }
  }

  for (const [metric, maxMs] of Object.entries(METRIC_P95_BUDGET_MS) as Array<
    [RuntimeMetric, number]
  >) {
    const summary = metrics[metric];
    if (summary && summary.count > 0 && summary.p95Ms > maxMs) {
      violations.push(`${metric} p95 ${summary.p95Ms}ms exceeds ${maxMs}ms`);
    }
  }

  return violations;
}

export class RuntimePerformanceRecorder {
  private samples = new Map<RuntimeMetric, number[]>();

  record(metric: RuntimeMetric, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const samples = this.samples.get(metric) ?? [];
    samples.push(durationMs);
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
    this.samples.set(metric, samples);
  }

  reset(): void {
    this.samples.clear();
  }

  report(): RuntimePerformanceReport {
    const startup = getStartupDiagnostics().phases;
    const metrics: Partial<Record<RuntimeMetric, MetricSummary>> = {};
    for (const [metric, samples] of this.samples) metrics[metric] = summarizeSamples(samples);
    const violations = evaluateRuntimeBudget(startup, metrics);

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      startup,
      metrics,
      budget: { passed: violations.length === 0, violations },
    };
  }
}

const recorder = new RuntimePerformanceRecorder();
let installed = false;

function measurementEnabled(): boolean {
  return (
    import.meta.env.DEV || new URLSearchParams(window.location.search).get('performance') === '1'
  );
}

export function installRuntimePerformance(): void {
  if (installed || !measurementEnabled()) return;
  installed = true;

  if (
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes?.includes('longtask')
  ) {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) recorder.record('ui.longTask', entry.duration);
    });
    observer.observe({ entryTypes: ['longtask'] });
  }

  const recordInputFrame = () => {
    const startedAt = performance.now();
    window.requestAnimationFrame(() => {
      recorder.record('ui.inputToFrame', performance.now() - startedAt);
    });
  };
  window.addEventListener('pointerdown', recordInputFrame, { capture: true, passive: true });
  window.addEventListener('keydown', recordInputFrame, { capture: true, passive: true });

  window.clawchatPerformance = {
    report: () => recorder.report(),
    reset: () => recorder.reset(),
  };
}
