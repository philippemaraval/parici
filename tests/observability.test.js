const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');

const {
  createObservability,
  normalizeRoute,
  operationForRoute,
} = require('../backend/observability');

test('normalizes identifiers and classifies operational routes', () => {
  assert.equal(normalizeRoute({ path: '/api/users/private-value' }), '/api/unmatched');
  assert.equal(
    normalizeRoute({ baseUrl: '/api/users', route: { path: '/:userId' } }),
    '/api/users/:userId',
  );
  assert.equal(operationForRoute('/api/editor/osm-sync/status'), 'osm_sync');
  assert.equal(operationForRoute('/api/notifications/subscribe'), 'push');
  assert.equal(operationForRoute('/api/daily/guess'), 'daily');
  assert.equal(operationForRoute('/api/login'), 'connection');
});

test('records request metrics without personal fields', () => {
  const observability = createObservability();
  const req = {
    baseUrl: '',
    method: 'POST',
    path: '/api/daily/guess',
    requestId: 'request-test',
    route: { path: '/api/daily/guess' },
  };
  const res = new EventEmitter();
  res.statusCode = 500;
  observability.requestMiddleware(req, res, () => {});
  res.emit('finish');

  const metrics = observability.prometheus();
  assert.match(metrics, /camino_api_errors_total\{operation="daily"\} 1/);
  assert.match(metrics, /camino_daily_failures_total 1/);
  assert.doesNotMatch(metrics, /request-test/);
});
