import { describe, it, expect, vi } from 'vitest';
import { status as grpcStatus, Metadata } from '@grpc/grpc-js';
import type { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import { withAuth } from '../../../src/grpc/interceptors/auth.interceptor.js';

const API_KEY = 'super-secret';

function makeCall(
  path: string,
  apiKey?: string,
): ServerUnaryCall<unknown, unknown> {
  const meta = new Metadata();
  if (apiKey !== undefined) meta.set('x-api-key', apiKey);
  return {
    getPath: () => path,
    metadata: meta,
  } as unknown as ServerUnaryCall<unknown, unknown>;
}

function noopHandler(_call: ServerUnaryCall<unknown, unknown>, cb: sendUnaryData<unknown>) {
  cb(null, {});
}

describe('withAuth', () => {
  describe('when API_SECRET_KEY is not set', () => {
    it('allows all requests through', () => {
      const callback = vi.fn();
      const wrapped = withAuth(noopHandler, undefined);
      wrapped(makeCall('/release_notifier.v1.ReleaseNotifierService/Subscribe'), callback);
      expect(callback).toHaveBeenCalledWith(null, {});
    });
  });

  describe('public methods', () => {
    it('allows ConfirmSubscription without a key', () => {
      const callback = vi.fn();
      const wrapped = withAuth(noopHandler, API_KEY);
      wrapped(makeCall('/release_notifier.v1.ReleaseNotifierService/ConfirmSubscription'), callback);
      expect(callback).toHaveBeenCalledWith(null, {});
    });

    it('allows Unsubscribe without a key', () => {
      const callback = vi.fn();
      const wrapped = withAuth(noopHandler, API_KEY);
      wrapped(makeCall('/release_notifier.v1.ReleaseNotifierService/Unsubscribe'), callback);
      expect(callback).toHaveBeenCalledWith(null, {});
    });

    it('allows Health without a key', () => {
      const callback = vi.fn();
      const wrapped = withAuth(noopHandler, API_KEY);
      wrapped(makeCall('/release_notifier.v1.ReleaseNotifierService/Health'), callback);
      expect(callback).toHaveBeenCalledWith(null, {});
    });
  });

  describe('protected methods with API_SECRET_KEY set', () => {
    it('rejects requests with no x-api-key metadata', () => {
      const callback = vi.fn();
      const wrapped = withAuth(noopHandler, API_KEY);
      wrapped(makeCall('/release_notifier.v1.ReleaseNotifierService/Subscribe'), callback);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpcStatus.UNAUTHENTICATED }),
      );
    });

    it('rejects requests with wrong x-api-key', () => {
      const callback = vi.fn();
      const wrapped = withAuth(noopHandler, API_KEY);
      wrapped(makeCall('/release_notifier.v1.ReleaseNotifierService/Subscribe', 'wrong-key'), callback);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpcStatus.PERMISSION_DENIED }),
      );
    });

    it('allows requests with correct x-api-key', () => {
      const callback = vi.fn();
      const wrapped = withAuth(noopHandler, API_KEY);
      wrapped(makeCall('/release_notifier.v1.ReleaseNotifierService/Subscribe', API_KEY), callback);
      expect(callback).toHaveBeenCalledWith(null, {});
    });

    it('also protects GetSubscriptions', () => {
      const callback = vi.fn();
      const wrapped = withAuth(noopHandler, API_KEY);
      wrapped(makeCall('/release_notifier.v1.ReleaseNotifierService/GetSubscriptions'), callback);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpcStatus.UNAUTHENTICATED }),
      );
    });
  });
});
