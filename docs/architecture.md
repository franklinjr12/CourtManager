# Architecture

The browser is a Vite-built vanilla TypeScript SPA. It calls the same Hono application in development (`@hono/node-server`) and production (AWS Lambda Function URL). Hono routes validate HTTP shapes and delegate to tenant-aware services. Services apply domain rules and use the `Repository` interface; only the repository knows DynamoDB SDK commands.

```text
Browser / Cloudflare Pages
        | JSON / HTTP
Hono (Node server or Lambda)
        | services
Repository interface
        | PK/SK single table
DynamoDB Local or DynamoDB
```

`MemoryRepository` is used by fast unit/service tests. It serializes transactions so tests exercise the same conditional-lock semantics as DynamoDB Local.
## Phase 1 operations

`/today` is the authenticated operational landing page backed by one timezone-aware aggregation endpoint. Reservations use `BOOKED -> CHECKED_IN -> COMPLETED` with explicit cancellation and no-show transitions. Classes are definitions plus materialized `ClassSession` occurrences; both reservations and classes occupy the same `ScheduleService` locks. Finance is operational rather than accounting: activities create `Charge` records, payments reduce balances, and cancellation voids applicable future charges.
