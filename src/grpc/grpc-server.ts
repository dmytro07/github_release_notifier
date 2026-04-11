import * as grpc from '@grpc/grpc-js';
import { ReleaseNotifierServiceService } from '../generated/release_notifier/v1/release_notifier.js';
import type { ReleaseNotifierServiceServer } from '../generated/release_notifier/v1/release_notifier.js';
import { withAuth } from './interceptors/auth.interceptor.js';

export function createGrpcServer(
  handler: ReleaseNotifierServiceServer,
  apiSecretKey: string | undefined,
): grpc.Server {
  const server = new grpc.Server();

  const wrappedHandler = Object.fromEntries(
    Object.entries(handler).map(([method, fn]) => {
      if (typeof fn !== 'function') return [method, fn];
      const authed = withAuth(fn as Parameters<typeof withAuth>[0], apiSecretKey);
      return [method, authed];
    }),
  ) as ReleaseNotifierServiceServer;

  server.addService(ReleaseNotifierServiceService, wrappedHandler);

  return server;
}
