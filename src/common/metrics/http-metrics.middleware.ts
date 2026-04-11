import type { Request, Response, NextFunction } from 'express';
import { Counter, Histogram, Gauge } from 'prom-client';
import { metricsRegistry } from './metrics.registry.js';

const httpRequestsTotal = new Counter({
  name: 'grn_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [metricsRegistry],
});

const httpRequestDuration = new Histogram({
  name: 'grn_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

const httpActiveConnections = new Gauge({
  name: 'grn_http_active_connections',
  help: 'Number of in-flight HTTP requests',
  registers: [metricsRegistry],
});

const EXCLUDED_PATHS = new Set(['/metrics', '/swagger']);

function normalizeRoute(req: Request): string {
  if (req.route?.path) {
    const base = req.baseUrl ?? '';
    return `${base}${req.route.path as string}`;
  }
  return 'unmatched';
}

function isExcluded(req: Request): boolean {
  const path = req.path;
  for (const excluded of EXCLUDED_PATHS) {
    if (path === excluded || path.startsWith(`${excluded}/`)) return true;
  }
  return false;
}

export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  if (isExcluded(req)) {
    next();
    return;
  }

  httpActiveConnections.inc();
  const stopTimer = httpRequestDuration.startTimer();

  res.on('finish', () => {
    const route = normalizeRoute(req);
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };
    stopTimer(labels);
    httpRequestsTotal.inc(labels);
    httpActiveConnections.dec();
  });

  next();
}
