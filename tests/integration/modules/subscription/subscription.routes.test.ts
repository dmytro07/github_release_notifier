import { describe, it } from 'vitest';

describe('Subscription Routes (integration)', () => {
  it.todo('POST /api/subscribe should create subscription');
  it.todo('POST /api/subscribe should return 400 for invalid input');
  it.todo('POST /api/subscribe should return 409 for duplicate subscription');
  it.todo('GET /api/confirm/:token should confirm subscription');
  it.todo('GET /api/confirm/:token should return 404 for invalid token');
  it.todo('GET /api/unsubscribe/:token should remove subscription');
  it.todo('GET /api/subscriptions?email= should return subscriptions');
  it.todo('GET /api/subscriptions should return 400 for invalid email');
  it.todo('GET /api/health should return 200');
});
