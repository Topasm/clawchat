const assert = require('node:assert/strict');
const test = require('node:test');

const {
  checkRendererPerformanceBudget,
  metricValue,
  validateThresholds,
} = require('./renderer-performance-budget');

function report(overrides = {}) {
  return {
    schemaVersion: 1,
    initialJavaScript: { rawBytes: 100_000, gzipBytes: 30_000 },
    allJavaScript: { rawBytes: 500_000 },
    allRendererFiles: { rawBytes: 750_000 },
    rendererCoreFiles: { rawBytes: 725_000 },
    localizationAssets: { rawBytes: 25_000 },
    ...overrides,
  };
}

function thresholds(metrics) {
  return { schemaVersion: 1, metrics };
}

test('reports configured metrics and marks only exceeded budgets', () => {
  const results = checkRendererPerformanceBudget(
    report(),
    thresholds({
      'initialJavaScript.rawBytes': { baselineBytes: 90_000, maxBytes: 110_000 },
      'initialJavaScript.gzipBytes': { baselineBytes: 20_000, maxBytes: 25_000 },
    }),
  );

  assert.deepEqual(
    results.map(({ metric, actualBytes, exceeded }) => ({ metric, actualBytes, exceeded })),
    [
      { metric: 'initialJavaScript.rawBytes', actualBytes: 100_000, exceeded: false },
      { metric: 'initialJavaScript.gzipBytes', actualBytes: 30_000, exceeded: true },
    ],
  );
});

test('fails closed when a configured report metric is absent', () => {
  assert.throws(
    () =>
      checkRendererPerformanceBudget(
        { schemaVersion: 1, initialJavaScript: { rawBytes: 100_000 } },
        thresholds({ 'initialJavaScript.gzipBytes': { maxBytes: 35_000 } }),
      ),
    /missing integer metric/,
  );
});

test('rejects empty, unknown, or malformed thresholds', () => {
  assert.throws(() => validateThresholds(thresholds({})), /must not be empty/);
  assert.throws(
    () => validateThresholds(thresholds({ 'unknown.bytes': { maxBytes: 1 } })),
    /Unsupported renderer performance metric/,
  );
  assert.throws(
    () =>
      validateThresholds(
        thresholds({ 'initialJavaScript.rawBytes': { baselineBytes: 10, maxBytes: 0 } }),
      ),
    /must define maxBytes/,
  );
});

test('metricValue requires a non-negative safe integer', () => {
  assert.equal(metricValue(report(), 'allRendererFiles.rawBytes'), 750_000);
  assert.equal(metricValue(report(), 'rendererCoreFiles.rawBytes'), 725_000);
  assert.throws(
    () => metricValue({ initialJavaScript: { rawBytes: Number.NaN } }, 'initialJavaScript.rawBytes'),
    /missing integer metric/,
  );
});
