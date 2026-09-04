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

There is intentionally no CI or push-to-deploy workflow. Run `OWNER_EMAIL`, `OWNER_PASSWORD`, and `ORGANIZATION_NAME` with `corepack pnpm bootstrap:owner` after deployment. The production bootstrap refuses missing explicit credentials and never overwrites an existing owner.

For early backups, use the AWS console or CLI on-demand backup:

```bash
aws dynamodb create-backup --table-name <production-table> --backup-name court-manager-$(Get-Date -Format yyyyMMddHHmmss)
aws dynamodb restore-table-from-backup --target-table-name <restored-table> --backup-arn <backup-arn>
```

Verify the restored table before switching application configuration. Point-in-time recovery can be enabled later when operational history warrants its cost.
