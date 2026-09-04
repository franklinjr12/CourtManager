# Manual backup and restore

For an early production deployment, create an on-demand DynamoDB backup before operationally significant changes:

```bash
aws dynamodb create-backup --table-name <production-table> --backup-name court-manager-YYYYMMDDHHmm
```

Restore to a separate table and verify its item counts and application smoke checklist before changing `DYNAMODB_TABLE`:

```bash
aws dynamodb restore-table-from-backup --target-table-name <restored-table> --backup-arn <backup-arn>
```

Point-in-time recovery is a later operational decision. Never use `reset:dev` against a production endpoint.
