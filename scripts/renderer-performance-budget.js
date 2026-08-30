const METRIC_LABELS = Object.freeze({
  'allJavaScript.rawBytes': 'All JavaScript raw',
  'allRendererFiles.rawBytes': 'All renderer files raw',
  'initialJavaScript.gzipBytes': 'Initial HTML JavaScript gzip',
  'initialJavaScript.rawBytes': 'Initial HTML JavaScript raw',
  'localizationAssets.rawBytes': 'Compressed localization assets raw',
  'rendererCoreFiles.rawBytes': 'Renderer core files raw',
});

function metricValue(report, metric) {
  const value = metric.split('.').reduce((current, part) => current?.[part], report);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Renderer performance report is missing integer metric: ${metric}`);
  }
  return value;
}

function validateThresholds(thresholds) {
  if (!thresholds || thresholds.schemaVersion !== 1) {
    throw new Error('Unsupported renderer performance threshold schema');
  }
  if (!thresholds.metrics || typeof thresholds.metrics !== 'object') {
    throw new Error('Renderer performance thresholds must define metrics');
  }

  const entries = Object.entries(thresholds.metrics);
  if (entries.length === 0) {
    throw new Error('Renderer performance thresholds must not be empty');
  }

  for (const [metric, threshold] of entries) {
    if (!(metric in METRIC_LABELS)) {
      throw new Error(`Unsupported renderer performance metric: ${metric}`);
    }
    if (!threshold || !Number.isSafeInteger(threshold.maxBytes) || threshold.maxBytes <= 0) {
      throw new Error(`Renderer performance threshold must define maxBytes: ${metric}`);
    }
    if (
      threshold.baselineBytes !== undefined &&
      (!Number.isSafeInteger(threshold.baselineBytes) || threshold.baselineBytes <= 0)
    ) {
      throw new Error(`Renderer performance threshold has invalid baselineBytes: ${metric}`);
    }
  }

  return entries;
}

function checkRendererPerformanceBudget(report, thresholds) {
  if (!report || report.schemaVersion !== 1) {
    throw new Error('Unsupported renderer performance report schema');
  }

  return validateThresholds(thresholds).map(([metric, threshold]) => {
    const actualBytes = metricValue(report, metric);
    return {
      metric,
      label: METRIC_LABELS[metric],
      actualBytes,
      baselineBytes: threshold.baselineBytes ?? null,
      maxBytes: threshold.maxBytes,
      exceeded: actualBytes > threshold.maxBytes,
    };
  });
}

module.exports = {
  checkRendererPerformanceBudget,
  metricValue,
  validateThresholds,
};
