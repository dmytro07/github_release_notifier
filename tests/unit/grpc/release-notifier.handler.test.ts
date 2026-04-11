import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/config/env.js', () => ({
  env: { NODE_ENV: 'test' },
}));

import { status as grpcStatus, Metadata } from '@grpc/grpc-js';
import type { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import { createReleaseNotifierHandler } from '../../../src/grpc/release-notifier.handler.js';
import type { ISubscriptionService } from '../../../src/modules/subscription/subscription.service.js';
import type {
  SubscribeRequest,
  SubscribeResponse,
  ConfirmRequest,
  ConfirmResponse,
  UnsubscribeRequest,
  UnsubscribeResponse,
  GetSubscriptionsRequest,
  GetSubscriptionsResponse,
  HealthRequest,
  HealthResponse,
} from '../../../src/generated/release_notifier/v1/release_notifier.js';
import { ConflictError, NotFoundError } from '../../../src/common/errors/app-error.js';

function makeCall<T>(request: T, path = ''): ServerUnaryCall<T, unknown> {
  const meta = new Metadata();
  return {
    request,
    metadata: meta,
    getPath: () => path,
  } as unknown as ServerUnaryCall<T, unknown>;
}

const service: ISubscriptionService = {
  subscribe: vi.fn(),
  confirmSubscription: vi.fn(),
  unsubscribe: vi.fn(),
  getSubscriptions: vi.fn(),
  getSubscriptionsToNotify: vi.fn(),
  markSubscriptionNotified: vi.fn(),
};

describe('ReleaseNotifierHandler', () => {
  let handler: ReturnType<typeof createReleaseNotifierHandler>;

  beforeEach(() => {
    vi.resetAllMocks();
    handler = createReleaseNotifierHandler(service);
  });

  describe('subscribe', () => {
    it('calls service.subscribe and returns success message', async () => {
      (service.subscribe as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const callback = vi.fn() as unknown as sendUnaryData<SubscribeResponse>;
      handler.subscribe(
        makeCall<SubscribeRequest>({ email: 'user@example.com', repo: 'golang/go' }),
        callback,
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(service.subscribe).toHaveBeenCalledWith('user@example.com', 'golang/go');
      expect(callback).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ message: expect.any(String) }),
      );
    });

    it('rejects invalid email with INVALID_ARGUMENT', async () => {
      const callback = vi.fn() as unknown as sendUnaryData<SubscribeResponse>;
      handler.subscribe(
        makeCall<SubscribeRequest>({ email: 'not-an-email', repo: 'golang/go' }),
        callback,
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpcStatus.INVALID_ARGUMENT }),
      );
    });

    it('rejects invalid repo format with INVALID_ARGUMENT', async () => {
      const callback = vi.fn() as unknown as sendUnaryData<SubscribeResponse>;
      handler.subscribe(
        makeCall<SubscribeRequest>({ email: 'user@example.com', repo: 'invalid-format' }),
        callback,
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpcStatus.INVALID_ARGUMENT }),
      );
    });

    it('maps ConflictError from service to ALREADY_EXISTS', async () => {
      (service.subscribe as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ConflictError('Already subscribed'),
      );
      const callback = vi.fn() as unknown as sendUnaryData<SubscribeResponse>;
      handler.subscribe(
        makeCall<SubscribeRequest>({ email: 'user@example.com', repo: 'golang/go' }),
        callback,
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpcStatus.ALREADY_EXISTS }),
      );
    });

    it('maps NotFoundError from service to NOT_FOUND', async () => {
      (service.subscribe as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Repo not found on GitHub'),
      );
      const callback = vi.fn() as unknown as sendUnaryData<SubscribeResponse>;
      handler.subscribe(
        makeCall<SubscribeRequest>({ email: 'user@example.com', repo: 'golang/go' }),
        callback,
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpcStatus.NOT_FOUND }),
      );
    });
  });

  describe('confirmSubscription', () => {
    it('calls service.confirmSubscription and returns success message', async () => {
      (service.confirmSubscription as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const callback = vi.fn() as unknown as sendUnaryData<ConfirmResponse>;
      const token = '550e8400-e29b-41d4-a716-446655440000';
      handler.confirmSubscription(makeCall<ConfirmRequest>({ token }), callback);
      await new Promise((r) => setTimeout(r, 0));
      expect(service.confirmSubscription).toHaveBeenCalledWith(token);
      expect(callback).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ message: expect.any(String) }),
      );
    });

    it('rejects non-UUID token with INVALID_ARGUMENT', async () => {
      const callback = vi.fn() as unknown as sendUnaryData<ConfirmResponse>;
      handler.confirmSubscription(makeCall<ConfirmRequest>({ token: 'not-a-uuid' }), callback);
      await new Promise((r) => setTimeout(r, 0));
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpcStatus.INVALID_ARGUMENT }),
      );
    });

    it('maps NotFoundError to NOT_FOUND', async () => {
      (service.confirmSubscription as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError(),
      );
      const callback = vi.fn() as unknown as sendUnaryData<ConfirmResponse>;
      handler.confirmSubscription(
        makeCall<ConfirmRequest>({ token: '550e8400-e29b-41d4-a716-446655440000' }),
        callback,
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpcStatus.NOT_FOUND }),
      );
    });
  });

  describe('unsubscribe', () => {
    it('calls service.unsubscribe and returns success message', async () => {
      (service.unsubscribe as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const callback = vi.fn() as unknown as sendUnaryData<UnsubscribeResponse>;
      const token = '550e8400-e29b-41d4-a716-446655440001';
      handler.unsubscribe(makeCall<UnsubscribeRequest>({ token }), callback);
      await new Promise((r) => setTimeout(r, 0));
      expect(service.unsubscribe).toHaveBeenCalledWith(token);
      expect(callback).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ message: expect.any(String) }),
      );
    });

    it('rejects non-UUID token with INVALID_ARGUMENT', async () => {
      const callback = vi.fn() as unknown as sendUnaryData<UnsubscribeResponse>;
      handler.unsubscribe(makeCall<UnsubscribeRequest>({ token: 'bad-token' }), callback);
      await new Promise((r) => setTimeout(r, 0));
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpcStatus.INVALID_ARGUMENT }),
      );
    });
  });

  describe('getSubscriptions', () => {
    it('returns mapped subscriptions', async () => {
      (service.getSubscriptions as ReturnType<typeof vi.fn>).mockResolvedValue([
        { email: 'user@example.com', repo: 'golang/go', confirmed: true, last_seen_tag: 'v1.22.0' },
        { email: 'user@example.com', repo: 'nodejs/node', confirmed: false, last_seen_tag: null },
      ]);
      const callback = vi.fn() as unknown as sendUnaryData<GetSubscriptionsResponse>;
      handler.getSubscriptions(
        makeCall<GetSubscriptionsRequest>({ email: 'user@example.com' }),
        callback,
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(service.getSubscriptions).toHaveBeenCalledWith('user@example.com');
      expect(callback).toHaveBeenCalledWith(null, {
        subscriptions: [
          { email: 'user@example.com', repo: 'golang/go', confirmed: true, lastSeenTag: 'v1.22.0' },
          {
            email: 'user@example.com',
            repo: 'nodejs/node',
            confirmed: false,
            lastSeenTag: undefined,
          },
        ],
      });
    });

    it('rejects invalid email with INVALID_ARGUMENT', async () => {
      const callback = vi.fn() as unknown as sendUnaryData<GetSubscriptionsResponse>;
      handler.getSubscriptions(makeCall<GetSubscriptionsRequest>({ email: 'not-valid' }), callback);
      await new Promise((r) => setTimeout(r, 0));
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ code: grpcStatus.INVALID_ARGUMENT }),
      );
    });
  });

  describe('health', () => {
    it('returns status ok', async () => {
      const callback = vi.fn() as unknown as sendUnaryData<HealthResponse>;
      handler.health(makeCall<HealthRequest>({}), callback);
      await new Promise((r) => setTimeout(r, 0));
      expect(callback).toHaveBeenCalledWith(null, { status: 'ok' });
    });
  });
});
