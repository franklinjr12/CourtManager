# Manual deployment

Requirements are Node.js 22+, Corepack, Docker, Docker Compose, AWS SAM CLI, and Wrangler for the web deployment.

```bash
corepack pnpm install
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:integration
corepack pnpm build
cd infrastructure
sam build
sam deploy --guided
```

Capture the resulting Function URL. Build and upload the web app manually:

```bash
VITE_API_BASE_URL=<production-api-url> corepack pnpm --filter web build
wrangler pages deploy apps/web/dist
```

## Phase 2 production migration

After deploying the API and before enabling customer self-service, point the
migration command at the production table using the same AWS region,
credentials, and `DYNAMODB_TABLE` configuration as the deployed API:

```bash
corepack pnpm migrate:phase2
```

`migrate:phase2` is additive and idempotent. It backfills missing organization
booking-policy defaults and organization waitlist access records. It does not
delete or rewrite customer, staff, reservation, session, or public-request
history. Take a DynamoDB backup before running production backfills. Never use
`reset:dev` against production.

For existing organizations that will enable customer class discovery, pause
class/enrollment writes and then run the separate idempotent backfill:

```bash
corepack pnpm migrate:class-discovery
```

Resume class/enrollment writes only after the command succeeds. Run
[docs/production-smoke-test.md](production-smoke-test.md) after migrations and
after each early deployment.

## Phase 3 persistence migration

Apply production migrations in order after deploying the corresponding API
code. Phase 3 must run after the Phase 1 and Phase 2 migrations (and after the
class-discovery backfill when that feature is enabled). Take a DynamoDB backup,
confirm the production region, credentials, table name, and organization
timezone configuration, then run the additive commercial index backfill:

```bash
corepack pnpm migrate:phase3
```

The migration is idempotent. It adds missing query indexes for existing Phase 3
records and customer charge/payment access records, but does not invent
memberships, packages, balances, or usage for older data. Take a DynamoDB
backup before running it. Existing Phase 2 customers, reservations, classes,
attendance, charges, and payments are preserved without artificial commercial
relationships. Run the command a second time; it should create zero additional
indexes. Never use `reset:dev` against a production table.

Commercial expiration reconciliation is an independent, retry-safe operation:

```bash
corepack pnpm reconcile:commercial
```

It is optional for correctness because membership/package reads evaluate
expiration against the organization timezone, but it is useful for
materializing status changes and expiring unused credit balances in bulk.

There is intentionally no CI or push-to-deploy workflow. Run `OWNER_EMAIL`, `OWNER_PASSWORD`, and `ORGANIZATION_NAME` with `corepack pnpm bootstrap:owner` after deployment. The production bootstrap refuses missing explicit credentials and never overwrites an existing owner.

For early backups, use the AWS console or CLI on-demand backup:

```bash
aws dynamodb create-backup --table-name <production-table> --backup-name court-manager-$(Get-Date -Format yyyyMMddHHmmss)
aws dynamodb restore-table-from-backup --target-table-name <restored-table> --backup-arn <backup-arn>
```

Verify the restored table before switching application configuration. Point-in-time recovery can be enabled later when operational history warrants its cost.
