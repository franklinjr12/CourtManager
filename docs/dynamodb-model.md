# DynamoDB model

The table uses `PK` and `SK` with on-demand billing. Organization-owned entities are stored under `ORG#<id>` and global entities use `RESERVATION#`, `REQUEST#`, `PAYMENT#`, `EXPENSE#`, `CLASS#`, `BLOCK#`, or `SESSION#` partitions. Schedule locks use `SCHEDULE#<org>#<court>#<YYYY-MM-DD>` and `LOCK#HH:mm` sort keys.

Sessions store only `sha256(token)` and an `expiresAt` TTL. Records retain audit fields and are archived rather than removed when history matters. Local scans are intentionally bounded at the service boundary for the MVP; operational lists should move to purpose-built indexes once volume warrants it.
## Phase 1 records

Phase 1 adds `CLASS_SESSION#<id>` and `CHARGE#<id>` records plus lifecycle audit fields. Class sessions use deterministic `<classId>-<YYYY-MM-DD>` identifiers. Charges use deterministic reservation or class-session identities so retries are safe. Legacy `CONFIRMED` reservations are normalized to `BOOKED` by `migrate:phase1`; reads tolerate the legacy value during rollout.
