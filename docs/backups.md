# Manual backup and restore

For an early production deployment, create an on-demand DynamoDB backup before operationally significant changes:

```bash
aws dynamodb create-backup --table-name <production-table> --backup-name court-manager-YYYYMMDDHHmm
```

Restore to a separate table and verify its item counts and application smoke checklist before changing `DYNAMODB_TABLE`:

```bash
aws dynamodb restore-table-from-backup --target-table-name <restored-table> --backup-arn <backup-arn>
```

## Point-in-time recovery

The SAM template enables point-in-time recovery (35-day window) on the
production table. Check its status with:

```bash
aws dynamodb describe-continuous-backups --table-name <production-table>
```

Restore to a new table at a UTC timestamp (or use `--use-latest-restorable-time`):

```bash
aws dynamodb restore-table-to-point-in-time --source-table-name <production-table> --target-table-name <restored-table> --restore-date-time <ISO-8601 UTC timestamp>
```

A restored table does not inherit TTL, PITR, deletion protection, tags, or the
stack's IAM policy. Re-enable TTL on `expiresAt` and PITR on the restored table,
and enable deletion protection once it is verified. Then verify item counts and
run [docs/production-smoke-test.md](production-smoke-test.md).

The API is outside the stack's restore path. Pointing it at the restored table
means changing `DYNAMODB_TABLE` and the IAM resource, which requires a deliberate
template change or importing the table into the stack. Keep the original table
until the restored table is verified.

Never use `reset:dev` against a production endpoint.
