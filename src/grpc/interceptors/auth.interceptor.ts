import { timingSafeEqual } from 'node:crypto';
import { status as grpcStatus, type ServerUnaryCall, type sendUnaryData } from '@grpc/grpc-js';

// RPC method names (fully-qualified) that do not require authentication
const PUBLIC_METHODS = new Set([
  '/release_notifier.v1.ReleaseNotifierService/ConfirmSubscription',
  '/release_notifier.v1.ReleaseNotifierService/Unsubscribe',
  '/release_notifier.v1.ReleaseNotifierService/Health',
]);

export function withAuth<Req, Res>(
  handler: (call: ServerUnaryCall<Req, Res>, callback: sendUnaryData<Res>) => void,
  apiSecretKey: string | undefined,
): (call: ServerUnaryCall<Req, Res>, callback: sendUnaryData<Res>) => void {
  return (call, callback) => {
    const methodPath = call.getPath();

    if (PUBLIC_METHODS.has(methodPath)) {
      handler(call, callback);
      return;
    }

    if (!apiSecretKey) {
      handler(call, callback);
      return;
    }

    const values = call.metadata.get('x-api-key');
    const apiKey = values[0];

    if (!apiKey || typeof apiKey !== 'string') {
      callback({ code: grpcStatus.UNAUTHENTICATED, message: 'Unauthorized' });
      return;
    }

    const expected = Buffer.from(apiSecretKey);
    const received = Buffer.from(apiKey);

    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      callback({ code: grpcStatus.PERMISSION_DENIED, message: 'Forbidden' });
      return;
    }

    handler(call, callback);
  };
}
