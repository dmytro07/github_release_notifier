import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { Registry } from 'prom-client';

vi.mock('../../../../src/config/env.js', () => ({
  env: { NODE_ENV: 'test', CORS_ORIGIN: '*' },
}));

vi.mock('../../../../src/common/metrics/metrics.registry.js', () => {
  const registry = new Registry();
  return { metricsRegistry: registry };
});

import { createApp } from '../../../../src/app.js';
import type { ISubscriptionController } from '../../../../src/modules/subscription/subscription.controller.js';

const stubController: ISubscriptionController = {
  subscribe: vi.fn(),
  confirmSubscription: vi.fn(),
  unsubscribe: vi.fn(),
  getSubscriptions: vi.fn(),
};

let app: Express;

describe('GET /metrics', () => {
  beforeAll(() => {
    app = createApp(stubController);
  });

  it('returns 200 with Prometheus text content type', async () => {
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  it('includes custom HTTP metrics definitions', async () => {
    const res = await request(app).get('/metrics');

    expect(res.text).toContain('grn_http_requests_total');
    expect(res.text).toContain('grn_http_request_duration_seconds');
    expect(res.text).toContain('grn_http_active_connections');
  });

  it('records HTTP request labels after a GET /api/health request', async () => {
    await request(app).get('/api/health');

    const res = await request(app).get('/metrics');

    expect(res.text).toContain('method="GET"');
    expect(res.text).toContain('grn_http_requests_total');
  });

  it('does not record /metrics requests in grn_http_requests_total', async () => {
    await request(app).get('/metrics');
    const res = await request(app).get('/metrics');

    const lines = res.text
      .split('\n')
      .filter((l) => l.startsWith('grn_http_requests_total{') && l.includes('route="/metrics"'));

    expect(lines).toHaveLength(0);
  });
});
