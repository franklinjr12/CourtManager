# Phase 3 Test Coverage

This document inventories Phase 3 commercial test coverage and serves as the completion checklist for the Phase 3 testing epic.

## How to run

```bash
corepack pnpm test:phase3
corepack pnpm test:phase3:integration
corepack pnpm test:phase3:e2e
corepack pnpm test:phase3:all
corepack pnpm test:coverage
```

Shared fixtures live in `apps/api/src/testing/phase3-fixture.ts` and `tests/e2e/support/commercial.ts`. Prefer `createCommercialVenue()` / `createIsolatedVenue()` with fixed dates via `localDate()` and `fixedInstant()`.

## Coverage thresholds

`pnpm test:coverage` enforces V8 coverage on Phase 3 domain modules:

| Layer                                                             | Statements | Functions | Lines | Branches |
| ----------------------------------------------------------------- | ---------- | --------- | ----- | -------- |
| Domain/business rules (`plans`, `memberships`, `entitlements`, …) | 100%       | 100%      | 100%  | 90%      |
| Orchestration/persistence (`phase3-repository`, migrations)       | 95%        | 95%       | 95%   | 90%      |

Generated output is gitignored under `coverage/`.

## Feature matrix

| Feature                          | Unit | Integration | API/Auth | E2E Staff | E2E Customer | Status  |
| -------------------------------- | ---- | ----------- | -------- | --------- | ------------ | ------- |
| Plans                            | ✓    | ✓           | ✓        | ✓         | N/A          | COVERED |
| Memberships                      | ✓    | ✓           | ✓        | ✓         | ✓            | COVERED |
| Packages                         | ✓    | ✓           | ✓        | ✓         | ✓            | COVERED |
| Credit ledger                    | ✓    | ✓           | ✓        | indirect  | indirect     | COVERED |
| Entitlement selection            | ✓    | ✓           | —        | indirect  | indirect     | COVERED |
| Reservation coverage             | ✓    | ✓           | ✓        | ✓         | ✓            | COVERED |
| Class entitlements               | ✓    | ✓           | ✓        | ✓         | ✓            | COVERED |
| Makeup credits                   | ✓    | ✓           | ✓        | ✓         | ✓            | COVERED |
| Fixed agreements                 | ✓    | ✓           | ✓        | ✓         | indirect     | COVERED |
| Balance                          | ✓    | ✓           | ✓        | ✓         | ✓            | COVERED |
| Expiration                       | ✓    | ✓           | ✓        | ✓         | ✓            | COVERED |
| Reporting                        | ✓    | ✓           | ✓        | ✓         | N/A          | COVERED |
| Reconciliation                   | ✓    | ✓           | —        | N/A       | N/A          | COVERED |
| Activity events                  | ✓    | ✓           | ✓        | indirect  | indirect     | COVERED |
| Authorization / tenant isolation | ✓    | ✓           | ✓        | indirect  | ✓            | COVERED |
| Migration                        | ✓    | ✓           | —        | N/A       | N/A          | COVERED |
| Concurrency / idempotency        | ✓    | ✓           | ✓        | indirect  | indirect     | COVERED |
| Phase 0–2 regression             | ✓    | ✓           | ✓        | ✓         | ✓            | COVERED |

## Canonical scenarios

| Scenario                                           | Integration                    | E2E                                |
| -------------------------------------------------- | ------------------------------ | ---------------------------------- |
| Carlos: monthly class membership + renewal history | `phase3-canonical.test.ts`     | `phase3-workflows.spec.ts`         |
| Maria: court-hour package consume/restore          | `phase3-canonical.test.ts`     | `phase3-workflows.spec.ts`         |
| Partial reservation coverage                       | `phase3-canonical.test.ts`     | `reservation-entitlements.spec.ts` |
| João: fixed recurring court                        | `phase3-workflows.test.ts`     | `fixed-court-agreements.spec.ts`   |
| Membership payment settles outstanding             | `phase3-canonical.test.ts`     | `commercial-canonical.spec.ts`     |
| Package expiry boundary                            | `phase3-workflows.test.ts`     | `commercial-canonical.spec.ts`     |
| Multiple entitlement sources                       | `entitlement-priority.test.ts` | indirect                           |

## Invariant regression tests

| Invariant                                     | Primary tests                                                     |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `remaining credit >= 0`                       | `entitlements.test.ts`, `phase3-repository.test.ts`               |
| `restored <= consumed`                        | `entitlements.test.ts`                                            |
| One activity cannot consume twice             | `entitlement-priority.test.ts`, `entitlements.test.ts`            |
| One period → one charge                       | `memberships.test.ts`                                             |
| Package issuance idempotent                   | `packages.test.ts`, `memberships.test.ts`                         |
| Service credit ≠ payment                      | `customer-commercial-balance.test.ts`, `phase3-canonical.test.ts` |
| Expired entitlement cannot cover              | `packages.test.ts`, `entitlement-priority.test.ts`                |
| Paused membership cannot grant usage          | `memberships.test.ts`, `entitlement-priority.test.ts`             |
| Plan/package snapshots immutable              | `plans.test.ts`, `packages.test.ts`, `commercial.journey.test.ts` |
| Fixed agreement no duplicate reservation debt | `fixed-court-agreements.test.ts`, `phase3-workflows.test.ts`      |
| Customer/org isolation                        | `commercial-authorization.test.ts`, `commercial-security.spec.ts` |
| Non-commercial customers unchanged            | `phase3-regression.journey.test.ts`                               |

## Key test files

### Contracts

- `packages/contracts/src/phase3.test.ts`
- `packages/contracts/src/phase3-extended.test.ts`

### API services / routes

- `apps/api/src/services/*.test.ts` (plans, memberships, packages, entitlements, …)
- `apps/api/src/services/entitlement-priority.test.ts`
- `apps/api/src/services/commercial-reconciliation.test.ts`
- `apps/api/src/credit-adjustments-api.test.ts`
- `apps/api/src/commercial-authorization.test.ts`
- `apps/api/src/commercial-api-lists.test.ts`
- `apps/api/src/journeys/commercial.journey.test.ts`
- `apps/api/src/journeys/phase3-regression.journey.test.ts`

### Integration (DynamoDB Local)

- `apps/api/src/integration/phase3-repository.test.ts`
- `apps/api/src/integration/phase3-workflows.test.ts`
- `apps/api/src/integration/phase3-canonical.test.ts`
- `apps/api/src/integration/phase3-migration.test.ts`

### E2E

- `tests/e2e/commercial-*.spec.ts`
- `tests/e2e/memberships.spec.ts`, `packages.spec.ts`, `fixed-court-agreements.spec.ts`
- `tests/e2e/phase3-workflows.spec.ts`, `customer-commercial-*.spec.ts`

## Maintenance rule

> Any modification to a Phase 3 business rule must update or add the corresponding regression test in the layer that proves that behavior (unit, integration, or E2E).
