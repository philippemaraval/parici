'use strict';

const DEFAULT_BUCKETS_MS = [25, 50, 100, 250, 500, 1000, 2500, 5000];

function safeText(value, maxLength = 160) {
  return String(value ?? '')
    .replace(/[\r\n\t]/g, ' ')
    .slice(0, maxLength);
}

function normalizeRoute(req) {
  const routePath = req.route?.path;
  if (routePath) {
    return safeText(`${req.baseUrl || ''}${routePath}`, 240);
  }
  return String(req.path || '').startsWith('/api') ? '/api/unmatched' : '/unmatched';
}

function operationForRoute(route) {
  if (route.includes('osm-sync')) return 'osm_sync';
  if (route.includes('/notifications') || route.includes('/push/')) return 'push';
  if (route.includes('/daily')) return 'daily';
  if (route.includes('/login') || route.includes('/session')) return 'connection';
  return 'api';
}

function jsonLog(level, event, fields = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event: safeText(event, 100),
    ...fields,
  };
  const line = JSON.stringify(payload);
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

function createObservability({
  service = 'camino-api',
  metricsToken = '',
  requireMetricsToken = false,
} = {}) {
  const counters = new Map();
  const latencyBuckets = new Map();
  let activeRequests = 0;

  function increment(name, labels = {}, value = 1) {
    const normalizedLabels = Object.fromEntries(
      Object.entries(labels)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [safeText(key, 40), safeText(entry, 80)]),
    );
    const key = JSON.stringify([name, normalizedLabels]);
    const current = counters.get(key) || { name, labels: normalizedLabels, value: 0 };
    current.value += value;
    counters.set(key, current);
  }

  function recordLatency(operation, durationMs) {
    const current = latencyBuckets.get(operation) || {
      count: 0,
      sum: 0,
      buckets: DEFAULT_BUCKETS_MS.map(() => 0),
    };
    current.count += 1;
    current.sum += durationMs;
    DEFAULT_BUCKETS_MS.forEach((limit, index) => {
      if (durationMs <= limit) current.buckets[index] += 1;
    });
    latencyBuckets.set(operation, current);
  }

  function requestMiddleware(req, res, next) {
    if (!String(req.path || '').startsWith('/api')) return next();
    const startedAt = process.hrtime.bigint();
    activeRequests += 1;
    res.once('finish', () => {
      activeRequests = Math.max(0, activeRequests - 1);
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const route = normalizeRoute(req);
      const operation = operationForRoute(route);
      const status = res.statusCode;
      increment('camino_http_requests_total', {
        method: req.method,
        operation,
        status_class: `${Math.floor(status / 100)}xx`,
      });
      if (status >= 500) increment('camino_api_errors_total', { operation });
      if ((status === 401 || status === 403) && operation === 'connection') {
        increment('camino_connection_failures_total');
      }
      if (status >= 400 && ['push', 'osm_sync', 'daily'].includes(operation)) {
        increment(`camino_${operation}_failures_total`);
      }
      recordLatency(operation, durationMs);
      jsonLog(status >= 500 ? 'error' : 'info', 'http_request', {
        service,
        request_id: safeText(req.requestId, 100),
        method: safeText(req.method, 12),
        route,
        operation,
        status,
        duration_ms: Math.round(durationMs * 100) / 100,
      });
    });
    next();
  }

  function formatLabels(labels) {
    const entries = Object.entries(labels);
    if (!entries.length) return '';
    return `{${entries
      .map(([key, value]) => `${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
      .join(',')}}`;
  }

  function prometheus() {
    const lines = [
      '# HELP camino_active_requests Current in-flight API requests.',
      '# TYPE camino_active_requests gauge',
      `camino_active_requests ${activeRequests}`,
    ];
    for (const { name, labels, value } of counters.values()) {
      lines.push(`${name}${formatLabels(labels)} ${value}`);
    }
    for (const [operation, metric] of latencyBuckets.entries()) {
      DEFAULT_BUCKETS_MS.forEach((limit, index) => {
        lines.push(
          `camino_http_request_duration_ms_bucket${formatLabels({
            operation,
            le: String(limit),
          })} ${metric.buckets[index]}`,
        );
      });
      lines.push(
        `camino_http_request_duration_ms_bucket${formatLabels({
          operation,
          le: '+Inf',
        })} ${metric.count}`,
      );
      lines.push(
        `camino_http_request_duration_ms_sum${formatLabels({ operation })} ${metric.sum}`,
      );
      lines.push(
        `camino_http_request_duration_ms_count${formatLabels({ operation })} ${metric.count}`,
      );
    }
    return `${lines.join('\n')}\n`;
  }

  function metricsHandler(req, res) {
    if (requireMetricsToken && !metricsToken) {
      return res.status(503).send('Metrics token is not configured\n');
    }
    if (metricsToken) {
      const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (supplied !== metricsToken) return res.status(401).send('Unauthorized\n');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.type('text/plain; version=0.0.4').send(prometheus());
  }

  return {
    increment,
    jsonLog: (level, event, fields) => jsonLog(level, event, { service, ...fields }),
    metricsHandler,
    prometheus,
    requestMiddleware,
  };
}

module.exports = { createObservability, normalizeRoute, operationForRoute };
