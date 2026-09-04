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
