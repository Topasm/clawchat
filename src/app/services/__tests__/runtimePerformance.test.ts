import { describe, expect, it } from 'vitest';
import {
  evaluateRuntimeBudget,
  RuntimePerformanceRecorder,
  summarizeSamples,
} from '../runtimePerformance';

describe('runtime performance recorder', () => {
  it('summarizes samples with stable percentiles', () => {
    expect(summarizeSamples([40, 10, 30, 20, 100])).toEqual({
      count: 5,
      meanMs: 40,
      p50Ms: 30,
      p95Ms: 100,
      maxMs: 100,
    });
  });

  it('ignores invalid values and reports collected metrics', () => {
    const recorder = new RuntimePerformanceRecorder();
    recorder.record('ui.inputToFrame', -1);
    recorder.record('ui.inputToFrame', Number.NaN);
    recorder.record('ui.inputToFrame', 16.25);

    const report = recorder.report();
    expect(report.metrics['ui.inputToFrame']).toMatchObject({ count: 1, p95Ms: 16.25 });
    expect(report.budget.passed).toBe(true);
  });

  it('fails budgets for slow startup and interaction p95 values', () => {
    const violations = evaluateRuntimeBudget(
      { route_ready: 4_500 },
      {
        'ui.inputToFrame': { count: 4, meanMs: 60, p50Ms: 55, p95Ms: 80, maxMs: 90 },
      },
    );

    expect(violations).toEqual([
      'route_ready 4500ms exceeds 4000ms',
      'ui.inputToFrame p95 80ms exceeds 50ms',
    ]);
  });
});
