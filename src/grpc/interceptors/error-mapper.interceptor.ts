import { status as grpcStatus, type ServerUnaryCall, type sendUnaryData, Metadata } from '@grpc/grpc-js';
import {
  AppError,
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  GitHubRateLimitError,
} from '../../common/errors/app-error.js';
import { logger } from '../../config/logger.js';

function toGrpcStatus(err: unknown): { code: number; message: string; metadata?: Metadata } {
  if (err instanceof GitHubRateLimitError) {
    const meta = new Metadata();
    meta.set('retry-after-ms', String(err.retryAfterMs));
    return { code: grpcStatus.UNAVAILABLE, message: err.message, metadata: meta };
  }
  if (err instanceof BadRequestError) {
    return { code: grpcStatus.INVALID_ARGUMENT, message: err.message };
  }
  if (err instanceof NotFoundError) {
    return { code: grpcStatus.NOT_FOUND, message: err.message };
  }
  if (err instanceof UnauthorizedError) {
    return { code: grpcStatus.UNAUTHENTICATED, message: err.message };
  }
  if (err instanceof ForbiddenError) {
    return { code: grpcStatus.PERMISSION_DENIED, message: err.message };
  }
  if (err instanceof ConflictError) {
    return { code: grpcStatus.ALREADY_EXISTS, message: err.message };
  }
  if (err instanceof AppError) {
    return { code: grpcStatus.INTERNAL, message: err.message };
  }
  logger.error({ err }, 'Unexpected gRPC server error');
  return { code: grpcStatus.INTERNAL, message: 'Internal server error' };
}

export function withErrorMapping<Req, Res>(
  handler: (call: ServerUnaryCall<Req, Res>, callback: sendUnaryData<Res>) => Promise<void>,
): (call: ServerUnaryCall<Req, Res>, callback: sendUnaryData<Res>) => void {
  return (call, callback) => {
    handler(call, callback).catch((err: unknown) => {
      const { code, message, metadata } = toGrpcStatus(err);
      callback({ code, message, metadata } as Parameters<sendUnaryData<Res>>[0]);
    });
  };
}
