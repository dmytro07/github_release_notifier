# GitHub Release Notifier

API service that lets users subscribe to email notifications about new releases of GitHub repositories.

## Tech Stack

- **Runtime:** Node.js 22, TypeScript (strict, ESM)
- **Framework:** Express 5
- **Database:** PostgreSQL 16 via Prisma ORM (with `@prisma/adapter-pg`)
- **Validation:** Zod v4
- **Logging:** Pino + pino-http
- **Testing:** Vitest, Supertest, Testcontainers
- **gRPC:** `@grpc/grpc-js` + `ts-proto`
- **Caching:** Redis 7 via ioredis (optional)
- **Metrics:** prom-client (Prometheus)
- **Email:** Nodemailer (MailHog for local dev)
- **CI:** GitHub Actions

## Architecture

Feature-first vertical slices with constructor-based dependency injection.

```
src/
├── config/           # Zod-validated env, Pino logger
├── common/
│   ├── errors/       # AppError hierarchy (400, 401, 403, 404, 409, 503)
│   ├── middleware/    # validate, error-handler, not-found, auth
│   ├── metrics/      # Prometheus registry + HTTP metrics middleware
│   └── types/        # Shared DTOs (PaginatedResponse)
├── modules/
│   ├── subscription/ # router, controller, service, schema (core domain)
│   └── repository/   # service, schema (repository tracking)
├── integrations/
│   ├── github/       # Octokit client + Redis-cached decorator
│   ├── email/        # Nodemailer client
│   └── redis/        # ioredis factory
├── grpc/             # gRPC server, handler, interceptors (auth, error-mapper)
├── jobs/             # ScannerJob — periodic release polling
├── generated/        # ts-proto generated types
├── app.ts            # Express app factory — middleware + route mounting
└── server.ts         # Composition root — wires dependencies, starts HTTP + gRPC
```

`server.ts` acts as the composition root: it instantiates all dependencies (Prisma, GitHub client, email client, Redis, services, controller) and injects them via constructors. No service locators or DI containers. This makes every dependency explicit and every class independently testable.

## Quick Start

### Docker (recommended)

```bash
pnpm docker:up
```

Alternatively:

```bash
cp .env.example .env          # Adjust GITHUB_TOKEN if you have one
docker compose up --build
```

This starts:

| Service  | Port                            |
| -------- | ------------------------------- |
| API      | `http://localhost:3000`         |
| gRPC     | `localhost:50051`               |
| Swagger  | `http://localhost:3000/swagger` |
| Metrics  | `http://localhost:3000/metrics` |
| MailHog  | `http://localhost:8025`         |
| Postgres | `localhost:5432`                |
| Redis    | `localhost:6379`                |

Prisma migrations run automatically on startup (`prisma migrate deploy` in the Dockerfile CMD).

### Local Development

```bash
pnpm start:dev
```

Alternatively:

```bash
pnpm install
cp .env.example .env          # Configure DATABASE_URL, SMTP_*, etc.

# Start Postgres, Redis, MailHog (via Docker or locally)
docker compose up postgres redis mailhog -d

pnpm prisma:generate          # Generate prisma client
pnpm prisma:migrate           # Run migrations
pnpm dev                      # tsx watch — hot-reload on file changes
```

## API Endpoints

All endpoints are defined in `swagger.yaml` (viewable at `/swagger`).

| Method | Path                         | Auth      | Description                          |
| ------ | ---------------------------- | --------- | ------------------------------------ |
| POST   | `/api/subscribe`             | API key\* | Subscribe email to repo releases     |
| GET    | `/api/confirm/{token}`       | None      | Confirm subscription via email token |
| GET    | `/api/unsubscribe/{token}`   | None      | Unsubscribe via email token          |
| GET    | `/api/subscriptions?email=…` | API key\* | List active subscriptions for email  |
| GET    | `/api/health`                | None      | Health check                         |
| GET    | `/metrics`                   | None      | Prometheus scrape endpoint           |

\* API key authentication is **optional** — only enforced when `API_SECRET_KEY` is set. When enabled, pass the key in the `X-API-Key` header. Comparison uses `timingSafeEqual` to prevent timing attacks.

### Subscription Flow

1. `POST /api/subscribe` — validates repo format (Zod), checks repo exists via GitHub API, creates subscription with `confirmed: false`, sends confirmation email.
2. User clicks the confirmation link in the email -> `GET /api/confirm/{token}` sets `confirmed: true`.
3. Scanner job periodically polls GitHub for new releases across all repositories that have active subscriptions. When `tag_name` differs from `last_seen_tag`, it sends notification emails and updates the stored tag.
4. Each notification email includes an unsubscribe link -> `GET /api/unsubscribe/{token}` deletes the subscription.

### Error Handling

- **400** — invalid input (Zod validation: bad email, malformed `owner/repo`)
- **401** — missing API key (when `API_SECRET_KEY` is configured)
- **403** — invalid API key
- **404** — GitHub repo not found, or token not found
- **409** — duplicate subscription (same email + repo)
- **429** — client rate limit (Express rate limiter: 100 req/window)
- **503** — GitHub rate limit hit (scanner pauses and retries after `x-ratelimit-reset`)

## Scanner Job

`ScannerJob` runs on a configurable interval (`SCANNER_INTERVAL_MS`, default 5 min). It:

1. Paginates through all repositories that have at least one confirmed subscription.
2. For each repo, fetches the latest release via GitHub API.
3. If `tag_name !== last_seen_tag`, updates the stored tag and sends notification emails to all confirmed subscribers.
4. On 429/rate-limit from GitHub, sleeps for the duration indicated by `x-ratelimit-reset` (capped at 1 hour), then reschedules.
5. Individual repo or email failures are caught and logged — they don't halt the entire scan.

## Environment Variables

See `.env.example` for all variables. Key ones:

| Variable              | Required | Default  | Description                                      |
| --------------------- | -------- | -------- | ------------------------------------------------ |
| `DATABASE_URL`        | Yes      | —        | PostgreSQL connection string                     |
| `BASE_URL`            | Yes      | —        | Public URL for confirmation/unsubscribe links    |
| `GITHUB_TOKEN`        | No       | —        | GitHub PAT (raises rate limit from 60 to 5000/h) |
| `REDIS_URL`           | No       | —        | Enables GitHub API response caching when set     |
| `API_SECRET_KEY`      | No       | —        | Enables X-API-Key authentication when set        |
| `SCANNER_INTERVAL_MS` | No       | `300000` | Release scan interval in ms                      |
| `GRPC_PORT`           | No       | `50051`  | gRPC server port                                 |

## Testing

```bash
pnpm test:unit          # Unit tests (Vitest)
pnpm test:integration   # Integration tests (Testcontainers — needs Docker)
```

**Unit tests** (10 suites) cover:

- `SubscriptionService` — subscribe, confirm, unsubscribe, list, duplicate/not-found handling
- `RepositoryService` — find-or-create, pagination, update
- `GitHubClient` — repo lookup, release fetch, 404 handling, rate limit detection
- `CachedGitHubClient` — cache hit/miss, null sentinel, Redis failure fallthrough
- `ScannerJob` — new release detection, email dispatch, rate limit pause, error isolation
- gRPC interceptors and handler — auth, error mapping, request routing
- Prometheus metrics — HTTP metrics middleware, `/metrics` route

**Integration tests** (2 suites) exercise full HTTP and gRPC flows against a real PostgreSQL instance (via Testcontainers).

## Implemented Extras

### gRPC Interface

A parallel `ReleaseNotifierService` mirrors all REST endpoints over gRPC on port 50051. Defined in `proto/release_notifier/v1/release_notifier.proto`. Includes:

- Auth interceptor (validates `x-api-key` metadata when `API_SECRET_KEY` is set)
- Error-mapper interceptor (translates `AppError` to gRPC status codes)
- Full integration test suite

### Redis Caching

When `REDIS_URL` is configured, `CachedGitHubClient` decorates the base `GitHubClient` with a read-through cache (TTL 10 min). Cache misses fall through to the live API. Redis failures are logged and silently bypassed — the service degrades gracefully rather than failing.

A `__null__` sentinel is cached for 404 responses to avoid repeatedly hitting GitHub for nonexistent repos.

### API Key Authentication

Optional `X-API-Key` header authentication. When `API_SECRET_KEY` is set, all `/api/*` routes (except `/api/health`, `/api/confirm/*`, `/api/unsubscribe/*`) require the key. Uses `crypto.timingSafeEqual` for constant-time comparison.

The gRPC server enforces the same key via an auth interceptor on the `x-api-key` metadata field.

### Prometheus Metrics

`GET /metrics` exposes default Node.js runtime metrics (GC, event loop, memory) and custom HTTP request metrics (`grn_http_request_duration_seconds` histogram) via `prom-client`. All metrics use a `grn_` prefix to avoid collisions.

### GitHub Actions CI

Pipeline (`.github/workflows/ci.yml`) runs on every push/PR to `main`:

1. pnpm install (frozen lockfile)
2. Prisma client generation
3. ESLint
4. TypeScript type check (`tsc`)
5. Unit tests
6. Integration tests (Testcontainers)

## Deployment Plan (not implemented)

The service is not currently deployed to a hosting environment. Below is the plan for a production deployment on **AWS**.

### Target Architecture

```
Internet
  │
  ├── Route 53 (DNS)
  │     └── api.releases.example.com
  │
  ├── ALB (Application Load Balancer)
  │     ├── HTTPS :443 → ECS (REST API, port 3000)
  │     └── gRPC  :443 → ECS (gRPC, port 50051)
  │
  ├── ECS Fargate (Service)
  │     └── API task (Express + gRPC + Scanner — single container)
  │
  ├── RDS PostgreSQL (Multi-AZ)
  │     └── Private subnet, encrypted at rest
  │
  ├── ElastiCache Redis (cluster mode)
  │     └── Private subnet, GitHub API response cache
  │
  └── SES (Simple Email Service)
        └── Production email delivery (replaces MailHog)
```

### Infrastructure as Code

All infrastructure would be managed with **AWS CloudFormation** templates:

- **VPC stack** — VPC, public/private subnets across 2 AZs, NAT gateway, security groups
- **Data stack** — RDS PostgreSQL instance, ElastiCache Redis cluster, Secrets Manager entries for DB credentials and `API_SECRET_KEY`
- **Compute stack** — ECS Fargate cluster, task definition, ALB with target groups, auto-scaling policies, CloudWatch log groups
- **DNS stack** — Route 53 hosted zone, ACM certificate for HTTPS

Stacks would use cross-stack references (`Fn::ImportValue`) for loose coupling and independent update cycles.

### CI/CD Pipeline

The existing GitHub Actions CI would be extended with a deployment stage:

1. **CI** (existing) — lint, typecheck, unit tests, integration tests
2. **Build** — build Docker image, push to Amazon ECR
3. **Deploy** — update ECS service

Environment-specific configuration would be stored in AWS Secrets Manager and injected as ECS task definition environment variables / secrets.

### Static Subscription Page

A simple static HTML page for subscribing to releases would be:

- Hosted on **S3 + CloudFront** (separate from the API)
- A single-page form that calls `POST /api/subscribe`
- Served under the same domain (e.g., `releases.example.com`) with the API behind `/api` path routing on the ALB
