import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/config/env.js', () => ({
  env: { NODE_ENV: 'test' },
}));

import { status as grpcStatus } from '@grpc/grpc-js';
import type { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import { withErrorMapping } from '../../../src/grpc/interceptors/error-mapper.interceptor.js';
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  GitHubRateLimitError,
  AppError,
} from '../../../src/common/errors/app-error.js';

function makeCall(): ServerUnaryCall<unknown, unknown> {
  return { request: {} } as ServerUnaryCall<unknown, unknown>;
}

function makeCallback(): sendUnaryData<unknown> {
  return vi.fn();
}

describe('withErrorMapping', () => {
  it('calls callback with success response when handler resolves', async () => {
    const callback = makeCallback();
    const handler = withErrorMapping(async (_call, cb) => {
      cb(null, { message: 'ok' });
    });
    handler(makeCall() as ServerUnaryCall<unknown, unknown>, callback);
    await Promise.resolve();
    expect(callback).toHaveBeenCalledWith(null, { message: 'ok' });
  });

  it('maps BadRequestError to INVALID_ARGUMENT', async () => {
    const callback = makeCallback();
    const handler = withErrorMapping(async () => {
      throw new BadRequestError('bad input');
    });
    handler(makeCall() as ServerUnaryCall<unknown, unknown>, callback);
    await new Promise((r) => setTimeout(r, 0));
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpcStatus.INVALID_ARGUMENT, message: 'bad input' }),
    );
  });

  it('maps NotFoundError to NOT_FOUND', async () => {
    const callback = makeCallback();
    const handler = withErrorMapping(async () => {
      throw new NotFoundError('not found');
    });
    handler(makeCall() as ServerUnaryCall<unknown, unknown>, callback);
    await new Promise((r) => setTimeout(r, 0));
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpcStatus.NOT_FOUND }),
    );
  });

  it('maps UnauthorizedError to UNAUTHENTICATED', async () => {
    const callback = makeCallback();
    const handler = withErrorMapping(async () => {
      throw new UnauthorizedError();
    });
    handler(makeCall() as ServerUnaryCall<unknown, unknown>, callback);
    await new Promise((r) => setTimeout(r, 0));
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpcStatus.UNAUTHENTICATED }),
    );
  });

  it('maps ForbiddenError to PERMISSION_DENIED', async () => {
    const callback = makeCallback();
    const handler = withErrorMapping(async () => {
      throw new ForbiddenError();
    });
    handler(makeCall() as ServerUnaryCall<unknown, unknown>, callback);
    await new Promise((r) => setTimeout(r, 0));
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpcStatus.PERMISSION_DENIED }),
    );
  });

  it('maps ConflictError to ALREADY_EXISTS', async () => {
    const callback = makeCallback();
    const handler = withErrorMapping(async () => {
      throw new ConflictError('duplicate');
    });
    handler(makeCall() as ServerUnaryCall<unknown, unknown>, callback);
    await new Promise((r) => setTimeout(r, 0));
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpcStatus.ALREADY_EXISTS }),
    );
  });

  it('maps GitHubRateLimitError to UNAVAILABLE with retry-after metadata', async () => {
    const callback = makeCallback();
    const handler = withErrorMapping(async () => {
      throw new GitHubRateLimitError(60_000);
    });
    handler(makeCall() as ServerUnaryCall<unknown, unknown>, callback);
    await new Promise((r) => setTimeout(r, 0));
    const [err] = (callback as ReturnType<typeof vi.fn>).mock.calls[0] as [{ code: number; metadata?: { get: (k: string) => string[] } }];
    expect(err.code).toBe(grpcStatus.UNAVAILABLE);
    expect(err.metadata?.get('retry-after-ms')[0]).toBe('60000');
  });

  it('maps unknown AppError subclass to INTERNAL', async () => {
    const callback = makeCallback();
    const handler = withErrorMapping(async () => {
      throw new AppError(418, "I'm a teapot");
    });
    handler(makeCall() as ServerUnaryCall<unknown, unknown>, callback);
    await new Promise((r) => setTimeout(r, 0));
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpcStatus.INTERNAL }),
    );
  });

  it('maps unexpected errors to INTERNAL', async () => {
    const callback = makeCallback();
    const handler = withErrorMapping(async () => {
      throw new Error('something exploded');
    });
    handler(makeCall() as ServerUnaryCall<unknown, unknown>, callback);
    await new Promise((r) => setTimeout(r, 0));
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpcStatus.INTERNAL, message: 'Internal server error' }),
    );
  });
});
