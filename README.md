# Court Manager

Court Manager is a focused digital front desk for sports centers: courts, availability, staff bookings, public reservation requests, customers, external payment records, expenses, and lightweight reporting. Classes are supported as a secondary feature and are disabled by default for a new organization.

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

`corepack pnpm bootstrap:owner` creates an organization and owner idempotently. Set `OWNER_EMAIL`, `OWNER_PASSWORD`, and `ORGANIZATION_NAME` for production; local defaults are safe test values. `corepack pnpm seed:dev` creates representative local organization, owner, courts, and customers and refuses production. The seed login is `owner@arena.test` / `dev-password`.

## Quality gates

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:integration
corepack pnpm build
corepack pnpm test:e2e
```

The first four run fast domain, service, repository, DOM, and browser-router tests. Integration tests use the same repository contract and can be run against DynamoDB Local. E2E uses Playwright Chromium and the Docker development environment.

## Production

The API is bundled with esbuild and deployed manually through AWS SAM. The web app is built with Vite and uploaded manually to Cloudflare Pages/Wrangler. See [docs/deployment.md](docs/deployment.md) and use [docs/production-smoke-test.md](docs/production-smoke-test.md) after each early deployment.

## Known limitations

Payments are records of external transactions; there is no gateway, PIX integration, card storage, or automatic charging. Search and low-volume reports use scoped scans. Classes are intentionally lightweight. No messaging integration, background job system, automated deployment, or multi-branch model is included.
