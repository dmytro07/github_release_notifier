import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { Registry } from 'prom-client';

vi.mock('../../../../src/config/env.js', () => ({
  env: { NODE_ENV: 'test' },
}));

vi.mock('../../../../src/common/metrics/metrics.registry.js', () => {
  const registry = new Registry();
  return { metricsRegistry: registry };
});

import { httpMetrics } from '../../../../src/common/metrics/http-metrics.middleware.js';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/api/health',
    baseUrl: '',
    route: undefined,
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response & { _finish: () => void } {
  const listeners: Record<string, Array<() => void>> = {};
  const res = {
    statusCode: 200,
    on: (event: string, cb: () => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
    },
    _finish: () => {
      for (const cb of listeners['finish'] ?? []) cb();
    },
  };
  return res as unknown as Response & { _finish: () => void };
}

describe('httpMetrics middleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it('calls next() for a regular request', () => {
    const req = makeReq();
    const res = makeRes();

    httpMetrics(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('skips /metrics path and calls next()', () => {
    const req = makeReq({ path: '/metrics' });
    const res = makeRes();

    httpMetrics(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('skips /swagger path and calls next()', () => {
    const req = makeReq({ path: '/swagger' });
    const res = makeRes();

    httpMetrics(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('skips /swagger/sub-path and calls next()', () => {
    const req = makeReq({ path: '/swagger/ui' });
    const res = makeRes();

    httpMetrics(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('uses req.route.path for matched routes', () => {
    const req = makeReq({
      method: 'GET',
      path: '/confirm/some-token',
      baseUrl: '/api',
      route: { path: '/confirm/:token' } as Request['route'],
    });
    const res = makeRes();
    res.statusCode = 200;

    httpMetrics(req, res, next);
    res._finish();

    expect(next).toHaveBeenCalledOnce();
  });

  it('uses "unmatched" label for unmatched routes', () => {
    const req = makeReq({
      method: 'GET',
      path: '/does-not-exist',
      baseUrl: '',
      route: undefined,
    });
    const res = makeRes();
    res.statusCode = 404;

    httpMetrics(req, res, next);
    res._finish();

    expect(next).toHaveBeenCalledOnce();
  });
});
