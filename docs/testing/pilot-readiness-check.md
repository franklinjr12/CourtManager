# Pilot readiness check (CM-002 / Epic 4 TASK-001)

- Date: 2026-10-30
- Commit: `a76d9957c07f141dd91169942ba3f459dd554073`
  (`a76d995 Merge pull request #5 from franklinjr12/fix/integration-test-isolation`)
- Scope of this step: automated gates only. Report only; no code, test or
  config was changed.

## Environment

| Item           | Value                                                        |
| -------------- | ------------------------------------------------------------ |
| Node           | v26.12.1 (production targets Node 22; see note below)        |
| pnpm           | 9.15.5 (via corepack)                                        |
| Docker         | 29.1.3, Compose 2.40.3                                       |
| Playwright     | 1.62.1 (chromium)                                            |
| DynamoDB Local | `docker compose up -d dynamodb` on :8120                     |
| Env vars       | Values of `.env.example` exported into the shell (no `.env`) |

Notes:

- The first `test:integration` run was done without the `.env.example`
  variables and failed with `UnrecognizedClientException` (no tests ran). It
  was re-run with the variables exported; only the re-run is counted below.
- `check` was run once, without the `.env.example` variables (they are not used
  by lint/typecheck/format/unit tests).
- The first full `test:e2e` run was killed by the tool's 10 min background
  limit and was re-run from scratch with a longer limit; only the complete
  re-run is counted below.
- Node v26 differs from the production target (Node 22). Whether this is the
  cause of G-1 and G-3 was **not verified**.

## Gates

| Gate | Command                                          | Result | Summary                                                                                                                                                                |
| ---- | ------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `corepack pnpm check`                            | FAIL   | lint, typecheck and format:check passed; `test` step: 3 files / 16 tests failed, 227 passed (243), 72 files; 10m38s                                                    |
| 2    | `corepack pnpm test:integration`                 | FAIL   | 1 file / 1 test failed, 17 passed (18), 10 files; 40s                                                                                                                  |
| 3    | `corepack pnpm test:e2e`                         | FAIL   | 44 failed, 21 passed (65 tests, chromium); 27m47s                                                                                                                      |
| 4    | `corepack pnpm test:phase3:all`                  | FAIL   | `test:phase3` 31 files / 78 tests passed; `test:phase3:integration` 1 failed, 11 passed; chain stopped (`&&`) so `test:phase3:e2e` did not run inside the chain; 2m04s |
| 4b   | `corepack pnpm test:phase3:e2e` (run separately) | FAIL   | 12 failed, 6 passed; 8m27s                                                                                                                                             |
| 5    | `corepack pnpm build`                            | PASS   | exit 0; API/contracts build and Vite build OK (`dist/assets/index-*.js` 246 kB, gzip 56 kB); 9s                                                                        |

`git status` after all gates was clean (no tracked file was changed).

## Failures

### G-1 (gate 1): web unit tests fail on `localStorage` — severity: blocker

`pnpm check` is the release gate and it is red.

- Files: `apps/web/src/i18n.test.ts` (7/7 tests fail),
  `apps/web/src/customer-auth.test.ts` (1), `apps/web/src/screens/customer-portal.test.ts`
  (8/8).
- Error excerpt:
  `TypeError: Cannot read properties of undefined (reading 'setItem')` at
  `apps/web/src/customer-auth.ts:21` (`setCustomerSession`), and
  `... (reading 'clear')` in the test setup. Log also shows
  `ExperimentalWarning: localStorage is not available because
--localstorage-file was not provided`.
- Possible cause (unverified): Node 26 ships an experimental global
  `localStorage` that shadows the jsdom one. Needs retesting on Node 22.
- Repro: `corepack pnpm check`, or just
  `corepack pnpm exec vitest run apps/web/src/i18n.test.ts
apps/web/src/customer-auth.test.ts apps/web/src/screens/customer-portal.test.ts`.

### G-2 (gates 2 and 4): monthly class membership limit test — severity: major

- Test: `apps/api/src/integration/phase3-workflows.test.ts` > "Phase 3 HTTP
  workflows on DynamoDB Local > covers a monthly class membership, enforces the
  limit, and resets on renewal".
- Error excerpt: `AssertionError: expected [ { sourceType: 'MEMBERSHIP', ... } ]
to deeply equal []`. The received entry has `benefitId:
monthly-class-attendance`, `benefitPeriodKey: MONTH:2026-11`,
  `availableQuantity: 1`, so a membership benefit is still available where the
  test expects none after the limit is used. The test uses dates around the
  current month/next month boundary (today is 2026-10-30), so it may be
  date-sensitive (unverified).
- Repro: `set -a; . ./.env.example; set +a; corepack pnpm test:integration`
  or `corepack pnpm test:phase3:integration` (DynamoDB Local must be up:
  `docker compose up -d dynamodb`).

### G-3 (gates 3 and 4b): browser flows fail — severity: blocker

44 of 65 Playwright tests fail, including the pilot-relevant ones. Failures
are deterministic: `fixed-court-agreements.spec.ts:5` and
`phase2-smoke-v2.spec.ts:47` were re-run alone once and failed again with the
same errors.

- Representative failures:
  - `fixed-court-agreements.spec.ts:5` "staff can create and inspect a fixed
    recurring court agreement": heading `Fixed court agreements` not found.
  - `phase2-smoke-v2.spec.ts:47` "AUTO_CONFIRM booking appears for customer,
    staff, and finance": `getByRole('navigation', { name: 'Customer
navigation' })` not found.
  - `phase2-smoke.spec.ts:123` REQUEST_APPROVAL approved by staff; `:62`
    AUTO_CONFIRM + concurrent slot + cancel; `:154` class waitlist.
  - `customer-portal.spec.ts` (all 5 listed), `reservations.spec.ts`,
    `public-requests.spec.ts`, `phase2-account-lifecycle.spec.ts`,
    `phase2-policy-availability.spec.ts` (2 of 3), `i18n.spec.ts`,
    `memberships.spec.ts`, `makeup-credits.spec.ts`, `operational-pages.spec.ts`.
  - Commonly seen: `waiting for navigation until "load"`,
    `#portal-booking-result` empty (expected `Reservation confirmed.` /
    `Request sent.`), `Test timeout of 30000ms exceeded`.
- Passing e2e tests include: customer register/login (`phase2-smoke-v2:22`),
  waitlist join/leave, availability search rules.
- Cause not diagnosed (report only). Same session-storage area as G-1 is a
  suspect but not confirmed. A Vulkan/GPU warning from chromium
  (`VK_ERROR_INCOMPATIBLE_DRIVER`) appears in the log and is probably unrelated.
- Repro: `set -a; . ./.env.example; set +a; corepack pnpm test:e2e`; single
  spec: `corepack pnpm exec playwright test
tests/e2e/fixed-court-agreements.spec.ts`.
- Full failing list for gate 3 is in the run log (not committed); it covers
  commercial-canonical (3 of 4 listed), commercial-validation:40,
  customer-commercial-balance:11, duration-intervals:12,
  phase2-handoff-security (4 of 5), phase3-workflows:101,
  reservation-api:6, reservation-entitlements:6, reservations (2),
  responsive:8 and the specs above.

### G-4 (gate 4): `test:phase3:all` chain incomplete — severity: major

The script chains with `&&`, so after G-2 `test:phase3:e2e` never ran inside
the chain. It was run separately (gate 4b): 12 failed / 6 passed, same
symptom class as G-3 (fixed-court agreement, memberships, makeup credits,
entitlement specs). Gate 4 therefore cannot pass until G-2 and G-3 are
resolved.

## Manual journeys

Pending (step 2)

## Overall verdict

Pending manual journeys
