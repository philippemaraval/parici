#!/usr/bin/env node
'use strict';

const healthUrl = process.env.HEALTHCHECK_URL;
const maxLatencyMs = Number(process.env.MAX_HEALTH_LATENCY_MS || 2500);
if (!healthUrl) throw new Error('HEALTHCHECK_URL is required');

function metricTotal(text, metricName) {
  return text
    .split('\n')
    .filter((line) => line.startsWith(metricName))
    .reduce((total, line) => total + Number(line.trim().split(/\s+/).at(-1) || 0), 0);
}

async function checkMetrics() {
  const metricsUrl = process.env.METRICS_URL;
  if (!metricsUrl) return {};
  const headers = { 'user-agent': 'camino-operations-monitor/1.0' };
  if (process.env.METRICS_TOKEN) {
    headers.authorization = `Bearer ${process.env.METRICS_TOKEN}`;
  }
  const response = await fetch(metricsUrl, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Metrics endpoint returned ${response.status}`);
  const text = await response.text();
  const thresholds = {
    camino_api_errors_total: Number(process.env.MAX_API_ERRORS || 50),
    camino_connection_failures_total: Number(process.env.MAX_CONNECTION_FAILURES || 20),
    camino_push_failures_total: Number(process.env.MAX_PUSH_FAILURES || 10),
    camino_osm_sync_failures_total: Number(process.env.MAX_OSM_SYNC_FAILURES || 2),
    camino_daily_failures_total: Number(process.env.MAX_DAILY_FAILURES || 10),
  };
  const totals = {};
  for (const [metricName, threshold] of Object.entries(thresholds)) {
    totals[metricName] = metricTotal(text, metricName);
    if (totals[metricName] > threshold) {
      throw new Error(`${metricName}=${totals[metricName]} exceeds ${threshold}`);
    }
  }
  return totals;
}

async function main() {
  const startedAt = performance.now();
  const response = await fetch(healthUrl, {
    headers: { 'user-agent': 'camino-operations-monitor/1.0' },
    signal: AbortSignal.timeout(10_000),
  });
  const latencyMs = performance.now() - startedAt;
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true || payload?.database === 'failed') {
    throw new Error(`Unhealthy response (${response.status}): ${JSON.stringify(payload)}`);
  }
  if (latencyMs > maxLatencyMs) {
    throw new Error(`Health latency ${Math.round(latencyMs)}ms exceeds ${maxLatencyMs}ms`);
  }
  const metrics = await checkMetrics();
  process.stdout.write(
    `${JSON.stringify({
      event: 'health_check',
      ok: true,
      latency_ms: Math.round(latencyMs),
      metrics,
    })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ event: 'health_check', ok: false, error: error.message })}\n`,
  );
  process.exit(1);
});
