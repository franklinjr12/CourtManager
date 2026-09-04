# DynamoDB model

The table uses `PK` and `SK` with on-demand billing. Organization-owned entities are stored under `ORG#<id>` and global entities use `RESERVATION#`, `REQUEST#`, `PAYMENT#`, `EXPENSE#`, `CLASS#`, `BLOCK#`, or `SESSION#` partitions. Schedule locks use `SCHEDULE#<org>#<court>#<YYYY-MM-DD>` and `LOCK#HH:mm` sort keys.

Sessions store only `sha256(token)` and an `expiresAt` TTL. Records retain audit fields and are archived rather than removed when history matters. Local scans are intentionally bounded at the service boundary for the MVP; operational lists should move to purpose-built indexes once volume warrants it.
