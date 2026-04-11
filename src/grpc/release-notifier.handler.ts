import type { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import type { ISubscriptionService } from '../modules/subscription/subscription.service.js';
import {
  subscribeRequestSchema,
  tokenParamsSchema,
  emailQuerySchema,
} from '../modules/subscription/subscription.schema.js';
import { BadRequestError } from '../common/errors/app-error.js';
import type { ReleaseNotifierServiceServer } from '../generated/release_notifier/v1/release_notifier.js';
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
} from '../generated/release_notifier/v1/release_notifier.js';
import { withErrorMapping } from './interceptors/error-mapper.interceptor.js';

export function createReleaseNotifierHandler(service: ISubscriptionService): ReleaseNotifierServiceServer {
  const subscribe = withErrorMapping(
    async (call: ServerUnaryCall<SubscribeRequest, SubscribeResponse>, callback: sendUnaryData<SubscribeResponse>) => {
      const result = subscribeRequestSchema.safeParse(call.request);
      if (!result.success) {
        throw new BadRequestError(result.error.issues[0]?.message ?? 'Invalid request');
      }
      await service.subscribe(result.data.email, result.data.repo);
      callback(null, { message: 'Subscription created. Please check your email to confirm.' });
    },
  );

  const confirmSubscription = withErrorMapping(
    async (call: ServerUnaryCall<ConfirmRequest, ConfirmResponse>, callback: sendUnaryData<ConfirmResponse>) => {
      const result = tokenParamsSchema.safeParse({ token: call.request.token });
      if (!result.success) {
        throw new BadRequestError(result.error.issues[0]?.message ?? 'Invalid token');
      }
      await service.confirmSubscription(result.data.token);
      callback(null, { message: 'Subscription confirmed.' });
    },
  );

  const unsubscribe = withErrorMapping(
    async (call: ServerUnaryCall<UnsubscribeRequest, UnsubscribeResponse>, callback: sendUnaryData<UnsubscribeResponse>) => {
      const result = tokenParamsSchema.safeParse({ token: call.request.token });
      if (!result.success) {
        throw new BadRequestError(result.error.issues[0]?.message ?? 'Invalid token');
      }
      await service.unsubscribe(result.data.token);
      callback(null, { message: 'Unsubscribed successfully.' });
    },
  );

  const getSubscriptions = withErrorMapping(
    async (
      call: ServerUnaryCall<GetSubscriptionsRequest, GetSubscriptionsResponse>,
      callback: sendUnaryData<GetSubscriptionsResponse>,
    ) => {
      const result = emailQuerySchema.safeParse({ email: call.request.email });
      if (!result.success) {
        throw new BadRequestError(result.error.issues[0]?.message ?? 'Invalid email');
      }
      const subscriptions = await service.getSubscriptions(result.data.email);
      callback(null, {
        subscriptions: subscriptions.map((s) => ({
          email: s.email,
          repo: s.repo,
          confirmed: s.confirmed,
          lastSeenTag: s.last_seen_tag ?? undefined,
        })),
      });
    },
  );

  const health = withErrorMapping(
    async (_call: ServerUnaryCall<HealthRequest, HealthResponse>, callback: sendUnaryData<HealthResponse>) => {
      callback(null, { status: 'ok' });
    },
  );

  return { subscribe, confirmSubscription, unsubscribe, getSubscriptions, health } as ReleaseNotifierServiceServer;
}
