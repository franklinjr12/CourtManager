# Court Manager

Court Manager is a sports-center operating platform for courts, availability, staff bookings, customer accounts, customer self-service, public reservation requests, classes, memberships, packages, service credits, fixed-court agreements, external payment records, expenses, and lightweight reporting. Classes are supported as a secondary feature and are disabled by default for a new organization.

## Architecture

```text
Cloudflare Pages / Vite SPA
          | JSON
AWS Lambda Function URL or local Hono server
          | services -> Repository
      DynamoDB or DynamoDB Local
```

The repository is a pnpm workspace with `apps/api`, `apps/web`, `packages/contracts`, `infrastructure`, `scripts`, and `docs`. The frontend uses native DOM, History API, Fetch API, and custom CSS—no UI framework or component library.

## Local development

Install Node.js 22+, Docker, and Docker Compose. Corepack supplies the pinned pnpm version.

```bash
corepack pnpm install
Copy-Item .env.example .env # PowerShell; use cp on Unix
corepack pnpm dev
```

The dev command starts DynamoDB Local on port 8120, waits for it, starts the API on 8787, and starts Vite on 5173. The API creates the table when missing. Stop the process with Ctrl+C. `DYNAMODB_ENDPOINT` must stay local for `corepack pnpm reset:dev`.

## Bootstrap and seed

`corepack pnpm bootstrap:owner` creates an organization and owner idempotently. Set `OWNER_EMAIL`, `OWNER_PASSWORD`, and `ORGANIZATION_NAME` for production; local defaults are safe test values. `corepack pnpm seed:dev` creates representative non-production Phase 2 data (customer account, reservation history/upcoming booking, class enrollment/waitlist, court waitlist, and pending request) and refuses production. Staff login: `owner@arena.test` / `dev-password`. Customer login: `customer1@arena.test` / `dev-password` at `/portal/arena-central/login`.

Seed defaults to `REQUEST_APPROVAL`. Select primary venue mode before reset/seed:

```powershell
$env:DEV_BOOKING_MODE = 'AUTO_CONFIRM' # or REQUEST_APPROVAL / STAFF_ONLY
corepack pnpm reset:dev
corepack pnpm seed:dev
```

`reset:dev` only accepts localhost/127.0.0.1 DynamoDB endpoints, recreates local DynamoDB data, and removes all development seed records. Keep `NODE_ENV` non-production.

Court Manager now includes a timezone-aware Today front desk, staff and coach workflows, customer portal authentication, policy-aware customer booking, materialized class sessions with attendance, operational charges and customer balances, and Phase 3 commercial relationships. Commercial operations include reusable plans and package definitions, snapshotted memberships and customer packages, auditable entitlement ledgers, fixed-court agreements, manual renewals, and customer-safe commercial portal views. See [docs/commercial-model.md](docs/commercial-model.md) for the domain rules.

Run `corepack pnpm migrate:phase1` once when upgrading legacy data; it is idempotent. For Phase 2 production upgrades, run `corepack pnpm migrate:phase2` after deployment. Existing class data may also require the write-paused `corepack pnpm migrate:class-discovery` backfill. For Phase 3, deploy the commercial code and run the additive, idempotent `corepack pnpm migrate:phase3`; use `corepack pnpm reconcile:commercial` to materialize expired memberships, packages, and remaining credit expiry in bulk. Neither command invents commercial records for existing Phase 2 customers or activities.

## Quality gates

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:integration
corepack pnpm build
corepack pnpm test:e2e
corepack pnpm test:coverage
```

Phase 3 commercial regression:

```bash
corepack pnpm test:phase3
corepack pnpm test:phase3:integration
corepack pnpm test:phase3:e2e
corepack pnpm test:phase3:all
```

See [docs/testing/phase3-coverage.md](docs/testing/phase3-coverage.md) for the coverage matrix, fixtures, and canonical scenarios.

The first four run fast domain, service, repository, DOM, and browser-router tests. Integration tests use the same repository contract and can be run against DynamoDB Local. E2E uses Playwright Chromium and the Docker development environment.

## Production

The API is bundled with esbuild and deployed manually through AWS SAM. The web app is built with Vite and uploaded manually to Cloudflare Pages/Wrangler. See [docs/deployment.md](docs/deployment.md) and use [docs/production-smoke-test.md](docs/production-smoke-test.md) after each early deployment.

## Known limitations

Payments are records of external transactions; there is no payment gateway, PIX integration, card storage, bank reconciliation, or automatic charging. Membership renewals, package issuance, credit restoration, and fixed-court billing are staff-managed workflows; there is no recurring billing automation. There is no automated email, WhatsApp integration, push notification, or automatic waitlist notification/fulfillment; staff manually deliver activation/reset links and fulfill waitlists. Phase 3 does not include retention scoring, campaigns, events, open games, rankings, referrals, loyalty, access-control hardware, or external commercial integrations. Search and low-volume reports use scoped scans. Classes remain intentionally lightweight. No background job system, automated deployment, or multi-branch model is included.
