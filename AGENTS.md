# AGENTS.md

## Purpose

This file defines the working rules for AI coding agents contributing to this repository.

CourtOS (currently stored in the `CourtManager` repository) is evolving from a reliable court scheduling and reservation system into a complete operating platform for sports centers. The long-term product must help venues operate facilities, fill capacity, understand customers, improve retention, support sports participation, and build stronger venue communities.

Every implementation should preserve the current working product while making the codebase easier to extend toward that end state.

---

## Product Direction

CourtOS is not just a booking calendar.

The long-term product is a unified sports-center operating platform covering:

- courts and facilities;
- schedules and availability;
- reservations;
- classes and coaching;
- check-in and attendance;
- customers and customer history;
- payments and operational finance;
- memberships, packages, and credits;
- retention and customer health;
- open games, events, rankings, referrals, and loyalty;
- automation and external integrations;
- operational and management reporting.

The fundamental product loop is:

```text
MAKE IT EASY TO PLAY
        |
        v
UNDERSTAND WHO PLAYED
        |
        v
HELP THEM PLAY AGAIN
        |
        v
CREATE MORE REASONS TO RETURN
        |
        v
BUILD A STRONGER SPORTS COMMUNITY
        |
        v
FILL THE SPORTS CENTER
```

When deciding how to implement a feature, prefer designs that strengthen this loop and remain reusable by later product phases.

Do not expand CourtOS into a generic ERP, accounting system, payroll platform, inventory system, social network, messaging application, or generic CRM. External systems may integrate with CourtOS, but the core product must remain sports-center-specific.

---

## Core Product Invariants

These rules are architectural and product invariants. Do not violate them for implementation convenience.

### One authoritative court schedule

Reservations, classes, court blocks, events, maintenance, and future court-occupying activities must use the same availability and conflict-management model.

Do not create a second competing concept of court availability.

Any operation that occupies a court must integrate with the shared schedule locking/conflict mechanism.

### Customer history is durable product data

Customer activity becomes increasingly important as CourtOS evolves.

Preserve enough history to support future:

- customer timelines;
- visit-frequency calculations;
- lifecycle classification;
- retention analysis;
- segmentation;
- recommendations;
- engagement features;
- reporting.

Do not delete historical business records merely because they are no longer active when an archived/cancelled/voided state is more appropriate.

### Manual workflow before automation

Implement a workflow so that staff can operate it manually before introducing automatic behavior.

Automation should execute or improve an already-valid CourtOS workflow rather than define the workflow itself.

### Integrations are adapters

Payment providers, WhatsApp, email, access-control hardware, Wellhub-like platforms, webhooks, and other external systems must be isolated behind adapters/interfaces.

Core domain rules must remain usable and testable without the external provider.

### Multi-tenant isolation is mandatory

Organization-owned data must always be scoped to the authenticated organization.

Never allow a customer ID, reservation ID, class ID, payment ID, or other externally supplied identifier to bypass organization authorization.

Cross-organization data exposure is a release-blocking defect.

---

## Repository Architecture

The repository is a pnpm workspace.

Current high-level structure:

```text
apps/
  api/          Hono API used by local Node server and AWS Lambda
  web/          Vite vanilla TypeScript SPA

packages/
  contracts/    shared API/domain contracts

infrastructure/
  template.yaml AWS SAM resources

tests/
  e2e/          Playwright user-flow tests

docs/           architecture, DynamoDB model, deployment and product notes
scripts/        local development helpers
```

The intended runtime architecture is:

```text
Cloudflare Pages / Vite SPA
          |
          | JSON / HTTP
          v
Hono application
(local Node server or AWS Lambda Function URL)
          |
          v
Domain/application services
          |
          v
Repository interface
          |
          v
DynamoDB / DynamoDB Local
```

Preserve this separation.

---

## Technology Constraints

Current technology choices are intentional.

### Frontend

The web application is:

- TypeScript;
- Vite;
- native DOM APIs;
- native History API;
- native Fetch API;
- custom CSS.

Do not introduce React, Vue, Angular, Svelte, another SPA framework, or a component library unless explicitly requested.

Prefer small reusable TypeScript UI modules and CSS primitives over framework-like abstractions.

### Backend

The API uses:

- TypeScript;
- Hono;
- Zod where runtime validation is required;
- AWS SDK v3;
- DynamoDB;
- esbuild;
- AWS Lambda;
- AWS SAM.

Hono routes should remain thin.

Routes are responsible for HTTP concerns such as:

- authentication context;
- request parsing;
- schema validation;
- status codes;
- response serialization.

Business rules belong in services/domain modules.

DynamoDB SDK calls belong in the repository/data-access layer.

### Shared contracts

Use `packages/contracts` for shapes genuinely shared between API and web.

Do not duplicate request/response types separately in frontend and backend.

Keep contracts focused on transport/domain contracts. Do not move infrastructure-specific implementation details into the shared package.

---

## Modularity Rules

Code must be organized so that future phases can reuse and extend existing capabilities without rewriting them.

### General rules

- Prefer cohesive modules with a clear responsibility.
- Avoid large catch-all files.
- Do not add unrelated functionality to an existing file merely because importing it is convenient.
- Extract reusable domain logic from route handlers and screen event callbacks.
- Separate pure calculations from I/O whenever practical.
- Prefer explicit dependencies over hidden global state.
- Keep side effects at system boundaries.
- Use shared helpers only when the behavior is genuinely shared; do not create generic utility dumping grounds.
- Avoid circular dependencies.
- Prefer composition over duplicating near-identical implementations.

### When touching large existing modules

Some existing central modules are already large.

When a change materially extends one of them:

1. identify a cohesive boundary related to the work;
2. extract that concern into a focused module when doing so is reasonably scoped;
3. preserve behavior with tests;
4. avoid unrelated repository-wide rewrites.

The rule is:

> Leave touched areas at least as modular as you found them, and preferably more modular when the feature creates a natural extraction boundary.

### API service boundaries

Prefer feature-oriented modules such as:

```text
services/
  reservations
  schedule
  customers
  classes
  finance
  reports
  ...
```

A service should expose business operations, not DynamoDB syntax.

If a feature becomes large, split it into a directory with focused internal modules rather than continuing to grow a single file indefinitely.

### Frontend boundaries

Screens should orchestrate a page or workflow.

Reusable concerns should live in focused modules such as:

- `core/` for application-level reusable logic;
- `ui/` for reusable UI behavior;
- `app/` for application shell/routing/bootstrap concerns;
- feature-specific helpers when behavior belongs to one domain.

Do not make individual screen files responsible for unrelated API logic, formatting rules, global navigation, modal infrastructure, and domain calculations simultaneously.

---

## AWS Lambda Requirements

The production API is designed for AWS Lambda and must remain Lambda-friendly.

### Stateless execution

Never depend on in-memory state for correctness across requests.

Lambda execution environments may:

- be reused;
- disappear at any time;
- run concurrently;
- scale horizontally.

Persistent business state belongs in DynamoDB or another explicit external store.

In-memory caches may only be used as optional performance optimizations when stale or missing cache state cannot break correctness.

### Cold-start awareness

Avoid adding heavy dependencies for small functionality.

Before adding a production dependency, consider:

- bundle size;
- startup cost;
- transitive dependencies;
- Node.js Lambda compatibility;
- whether the functionality can be implemented with existing dependencies or platform APIs.

Do not introduce native modules without a strong reason and explicit validation for the Lambda runtime/architecture.

Production currently targets Node.js 22 on arm64.

### Reuse safe clients

AWS SDK clients and other safe stateless infrastructure clients should be constructed outside the hot request path when practical so warm Lambda invocations can reuse them.

Do not move request-specific or tenant-specific mutable state into module globals.

### Bounded request work

A single HTTP request must not perform unbounded work.

Avoid:

- loading entire tables;
- traversing unlimited histories;
- unbounded loops over tenant data;
- serial N+1 reads;
- performing background-job-sized work synchronously.

Use:

- pagination;
- bounded queries;
- batch operations;
- precomputed/materialized records when justified;
- future asynchronous workflows for genuinely long-running work.

### Idempotency

Lambda/API requests may be retried.

Design important write operations so retries are safe.

Prefer:

- deterministic identifiers where the business operation has a natural identity;
- conditional writes;
- transactional writes;
- explicit status transitions;
- deduplication/idempotency keys when needed.

Never assume a client will submit a write exactly once.

---

## DynamoDB Requirements

DynamoDB is a primary architectural constraint, not an interchangeable persistence implementation.

The current model uses a single table with `PK` and `SK`, on-demand billing, TTL for ephemeral records, conditional writes, and transactions for schedule consistency.

### Design from access patterns

Before adding a new DynamoDB-backed feature, identify its important access patterns.

For each feature, determine:

- what item is read by ID;
- what lists must be queried;
- what records are accessed together;
- expected cardinality;
- required sort order;
- required time ranges;
- tenant scope;
- whether pagination is required.

Then design keys/indexes/materialized lookup items around those patterns.

Do not first model relational tables and then emulate joins with scans.

### Prefer targeted operations

Prefer, in order when appropriate:

1. `GetItem`;
2. `Query`;
3. `BatchGetItem`;
4. targeted transactional operations;
5. deliberately designed secondary indexes/materialized access records.

`Scan` is a last resort.

Existing bounded scans may remain for low-volume MVP workflows, but new high-volume or frequently executed access paths must not depend on full-table scans.

If touching an existing scan-backed workflow that is expected to grow substantially, consider replacing it with a queryable access pattern as part of the change.

### No client-side filtering as a scaling strategy

Do not retrieve a broad dataset from DynamoDB and rely on JavaScript filtering as the normal production access pattern.

Filtering after a bounded query can be acceptable.

Filtering after an unbounded table scan is not an acceptable long-term design.

### Avoid N+1 access

When multiple known records are required, use batch reads or restructure the access pattern.

Do not issue one DynamoDB request per row from a previously returned collection when the same workflow can be represented efficiently.

### Atomic schedule consistency

Court occupancy conflicts must be prevented atomically.

Do not implement availability as:

```text
check availability
then
write reservation
```

without a conditional/transactional lock protecting against concurrent requests.

Preserve the shared schedule-lock semantics for every court-occupying feature.

### Transactions

Remember DynamoDB transaction limits.

Do not construct transactions with more than the supported number of actions.

For workflows that can exceed transaction limits:

- redesign the operation;
- chunk only when atomicity is not required across chunks;
- or use a different durable workflow.

Never silently weaken atomicity.

### Pagination

Repository methods and API endpoints returning potentially growing collections should support bounded results/pagination.

Do not return an organization’s complete lifetime dataset by default.

### Denormalization is expected

Duplicating selected fields into access records is acceptable when it creates an efficient DynamoDB access pattern.

When denormalizing:

- define the source of truth;
- update dependent records transactionally when correctness requires it;
- make eventual consistency explicit when acceptable;
- test update behavior.

### TTL

Use TTL only for genuinely ephemeral records such as sessions or temporary tokens.

Do not use TTL to remove business history that may later be required for reporting, auditing, retention, customer timelines, or analytics.

### Backward-compatible data evolution

There is no relational migration engine protecting every deployed record.

When changing stored shapes:

- preserve compatibility with deployed data;
- tolerate old representations during rollout when needed;
- make migration scripts idempotent;
- make retrying migrations safe;
- document required production migration steps;
- add tests covering legacy data when the change can encounter it.

---

## Domain Rules

### Time and timezone

Sports-center operations are timezone-sensitive.

Do not assume UTC calendar dates are the venue’s local dates.

Keep a clear distinction between:

- stored timestamps;
- venue-local date;
- venue-local time;
- UTC conversion.

Add tests around date boundaries when a feature depends on:

- Today screens;
- recurring reservations;
- classes;
- attendance;
- reporting periods;
- cancellation cutoffs;
- booking windows.

### State transitions

Model important lifecycle changes explicitly.

Examples include:

- reservation status;
- attendance/check-in;
- class-session status;
- membership status;
- package/credit consumption;
- payment/charge state;
- customer lifecycle state.

Do not allow arbitrary state mutation that bypasses domain rules.

Prefer named service operations that validate allowed transitions.

### Financial scope

CourtOS operational finance is not full accounting.

Keep financial functionality centered on sports-center operations such as:

- charges;
- payments;
- credits;
- outstanding balances;
- reservation/class/membership revenue;
- operational expenses;
- summaries.

Do not build general-ledger/accounting behavior unless explicitly requested.

### Commercial relationships and entitlements

Phase 3 commercial records must preserve these distinctions:

- A `Plan` is a reusable offering; a `Membership` is a customer-specific
  snapshot of that offering; a `MembershipPeriod` is its dated usage and
  billing boundary.
- A `PackageDefinition` is a reusable offering; a `CustomerPackage` is the
  issued customer-specific snapshot.
- An entitlement is a service right, not a payment. A credit transaction is an
  append-only signed ledger entry, and an entitlement allocation is the
  auditable link between that right and a reservation or class attendance.
- A materialized credit balance may accelerate reads and conditional writes,
  but the durable credit ledger remains authoritative. Never replace it with
  an unexplained mutable `remainingCredits` field.
- Consumption must be idempotent and tenant-scoped. The logical usage key must
  prevent a retry from consuming the same source/benefit for the same activity
  twice.
- Reservation coverage is applied after the existing atomic schedule lock is
  acquired. Keep the reservation and class attendance records authoritative;
  do not create a second booking or attendance model.
- For reservation coverage, a matching fixed-court agreement is considered
  first. Other eligible sources are ordered by earliest expiry, then makeup
  credit, membership, package, and other source priority, with stable IDs as
  tie-breakers. Partial coverage is allowed and must be recorded per source.
- Restore active reservation allocations on eligible pre-cutoff cancellation
  exactly once, including staff cancellation. Do not restore a no-show. Keep
  the original consumption and restoration reason in the ledger.
- Membership periods use venue-local inclusive calendar dates. Renewal creates
  a new period and charge; it does not rewrite historical period usage. Package
  expiry writes `EXPIRED` ledger entries for remaining finite credit and keeps
  the package and history.
- Fixed-court agreements are commercial contracts. Their recurring occurrences
  use the one authoritative reservation/schedule-lock model; agreement billing
  is separate from occurrence occupancy.
- Customer balances are financial: active charges minus linked recorded
  payments. Credits, allocations, and service coverage are never cash
  payments. Payment processing remains external and manual.
- Staff manage commercial terms, issuance, renewal, adjustment, restoration,
  and cancellation. Customer portal commercial views are read-only and must
  derive organization/customer identity from authentication context.
- Existing Phase 2 data must migrate additively. `migrate:phase3` may create
  missing access indexes, but must not invent memberships, packages, balances,
  allocations, usage, or other artificial commercial relationships.
- Commercial lifecycle facts should remain available as durable customer
  activity events so later retention/intelligence work can consume them
  without reconstructing history from mutable records.

---

## API Design Rules

- Validate external input at the boundary.
- Use shared contracts for public request/response shapes.
- Return consistent error structures.
- Keep domain errors distinct from unexpected infrastructure failures.
- Do not leak internal DynamoDB keys or infrastructure implementation details unless intentionally part of a public contract.
- Maintain backwards compatibility for existing endpoints unless the task explicitly authorizes a breaking change.
- Prefer resource-oriented endpoints and explicit action endpoints for lifecycle transitions.
- Authentication and tenant authorization must be enforced server-side.
- Never trust tenant/organization identity supplied by the browser when it can be derived from authenticated context.

When changing an API contract, update in the same change:

1. shared contract;
2. API validation/handler;
3. service behavior;
4. frontend API client;
5. affected UI;
6. Vitest coverage;
7. Playwright coverage when the user flow materially changes.

---

## Frontend and UX Rules

CourtOS is operational software used repeatedly during busy sports-center workflows.

Prioritize:

- fast comprehension;
- few clicks for frequent tasks;
- clear current state;
- obvious primary actions;
- good empty states;
- clear validation messages;
- responsive layouts;
- keyboard-friendly forms when practical;
- accessible labels and controls;
- visible loading/error/success feedback.

Do not optimize visual novelty over operational clarity.

### Reusable UI

When a pattern repeats across multiple screens, prefer a reusable TypeScript/CSS primitive rather than copy-pasting markup/event logic.

Examples:

- modal behavior;
- form rows;
- status badges;
- loading/error states;
- confirmation flows;
- date/time presentation;
- shared table/list patterns.

Keep reusable primitives small and understandable.

### Browser state

Do not introduce hidden global mutable state when URL state, explicit application context, or local feature state is sufficient.

Route-relevant state should be reflected in the URL when doing so improves navigation, refresh behavior, or deep linking.

---

## Security Rules

Treat these as release blockers:

- cross-tenant access;
- authentication bypass;
- insecure direct object reference;
- plaintext password storage;
- leaked secrets;
- storing authentication tokens insecurely without justification;
- trusting client-supplied authorization state;
- exposing sensitive internal errors.

Never commit real secrets.

Use `.env.example` for documented configuration.

Authentication/session changes require explicit Vitest coverage and, when they change real user behavior, Playwright coverage.

---

## Testing Policy

Testing is mandatory implementation work, not optional cleanup.

### Vitest requirement for every relevant change

Every relevant code change must have at least one associated Vitest test that validates the behavior being introduced, changed, or fixed.

This includes:

- new business rules;
- bug fixes;
- API behavior changes;
- repository behavior;
- state transitions;
- validation changes;
- date/time logic;
- frontend reusable logic;
- meaningful DOM behavior;
- regression fixes.

A change is not considered complete merely because existing unrelated tests pass.

The new or updated test must exercise the behavior that justified the code change.

Documentation-only, comment-only, formatting-only, or equivalent non-behavioral changes do not require a new Vitest test.

### Test at the lowest useful level

Prefer the fastest test that proves the behavior:

- pure domain logic -> unit test;
- service orchestration -> service test using `MemoryRepository`;
- repository behavior -> repository/integration test;
- DOM behavior -> jsdom/Vitest;
- complete user workflow -> Playwright.

Do not use Playwright as a substitute for missing domain/service tests.

### Repository parity

`MemoryRepository` exists so fast tests can exercise the same repository contract as DynamoDB.

When changing repository semantics:

- update both implementations;
- keep their externally observable behavior aligned;
- add integration coverage against DynamoDB Local when the behavior depends on DynamoDB semantics.

### Regression tests

Every bug fix should include a test that fails for the bug and passes after the fix whenever technically reasonable.

---

## Playwright Policy

Major changes must include a Playwright test that validates the affected user flow.

A change is considered major when it introduces or materially changes one or more of:

- a complete screen;
- a primary workflow;
- navigation behavior;
- authentication flow;
- reservation creation/edit/cancellation;
- public booking/request flow;
- class enrollment/attendance;
- check-in;
- payments or customer balance workflows;
- settings affecting user behavior;
- customer self-service;
- memberships/packages;
- retention workflows;
- events/open games/community flows;
- any multi-step workflow whose regression would materially affect users.

Playwright tests belong under:

```text
tests/e2e/
```

Prefer user-visible selectors such as roles, labels, and accessible names.

Do not couple E2E tests to implementation details when the same behavior can be asserted through the UI/API contract.

A major change is not complete until its Playwright user flow passes.

---

## Formatting, Linting, Type Safety, and Validation

The repository uses Prettier, ESLint, TypeScript, Vitest, integration tests, esbuild/Vite builds, and Playwright.

Use the repository scripts instead of inventing alternate command sequences.

### Mandatory end-of-prompt validation

At the end of every implementation prompt, after code changes are complete, the agent must apply repository formatting and run validation.

Run:

```bash
corepack pnpm format
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:integration
corepack pnpm build
```

For every major change or user-flow change, also run:

```bash
corepack pnpm test:e2e
```

Formatting is mandatory.

Do not finish an implementation prompt after tests without also running the repository formatter.

Run formatting before the final validation commands so the tested/linted result is the formatted result.

If formatting modifies files, include those modifications in the final change.

### Do not hide failures

Never:

- disable a failing test just to make the suite green;
- weaken an assertion without explaining the behavioral reason;
- add broad ignores to ESLint/TypeScript instead of fixing the issue;
- silently skip integration or E2E validation required by the change;
- claim a command passed if it was not run.

If a required command cannot run because of an environment/tooling limitation, report:

1. the exact command;
2. the exact blocker/error;
3. which validation did run successfully.

---

## Formatting Style

Prettier is authoritative.

Current repository formatting includes:

- semicolons;
- single quotes;
- trailing commas;
- 80-column print width.

Do not hand-format against Prettier.

Run:

```bash
corepack pnpm format
```

before final validation.

---

## Dependency Policy

Do not add a dependency by default.

Before adding one, determine whether:

- the platform already provides the capability;
- an existing repository dependency already solves the problem;
- a small local implementation is clearer;
- the dependency materially increases Lambda bundle size;
- the dependency is maintained and compatible with Node.js 22;
- it introduces a browser framework or UI abstraction contrary to project direction.

When a dependency is justified:

- add it to the correct workspace package;
- update the lockfile;
- add tests covering the behavior enabled by it;
- confirm build output remains Lambda/browser compatible.

---

## Documentation Requirements

Update documentation when a change alters:

- architecture;
- DynamoDB access patterns;
- stored entity shapes;
- environment variables;
- deployment steps;
- migration steps;
- security assumptions;
- operational procedures;
- important user flows.

Useful existing docs include:

```text
docs/architecture.md
docs/dynamodb-model.md
docs/deployment.md
docs/production-smoke-test.md
docs/schedule-locking.md
docs/security-review.md
```

Do not leave architectural decisions discoverable only by reading implementation code.

---

## Infrastructure Changes

Production infrastructure is defined with AWS SAM in:

```text
infrastructure/template.yaml
```

When a code change requires:

- a new DynamoDB index;
- new permissions;
- a new environment variable;
- another AWS resource;
- different Lambda configuration;

update the SAM template in the same change.

Use least-privilege IAM where practical.

Do not grant broad AWS permissions merely to make development easier.

Infrastructure changes require corresponding documentation updates and validation of the packaged/bundled application where applicable.

---

## Implementation Workflow for Agents

For each prompt:

### 1. Understand the existing behavior

Before editing:

- inspect the relevant modules;
- inspect related tests;
- inspect shared contracts;
- inspect the DynamoDB access pattern if persistence is involved;
- inspect existing E2E coverage if a user flow is involved.

Do not build a parallel implementation without understanding the existing path.

### 2. Define the smallest coherent change

Implement the requested behavior completely, but avoid unrelated scope.

Prefer a coherent vertical slice:

```text
contract
-> domain/service
-> persistence
-> API
-> UI
-> tests
```

when all layers are required.

### 3. Preserve extensibility

Ask whether the design can reasonably support the next product phases.

Examples:

- reservation participants should not be modeled in a way that prevents future player relationships;
- attendance should produce durable history useful for retention;
- memberships should not be hardcoded only to one sport;
- integrations should not leak provider concepts into core domain types;
- schedule occupancy should remain shared across all activity types.

Do not prematurely implement future phases, but avoid designs that obviously block them.

### 4. Add tests with the implementation

Do not postpone tests until the end.

For relevant changes, add/update Vitest coverage with the code.

For major changes, add/update Playwright coverage for the user flow.

### 5. Validate DynamoDB/Lambda implications

For backend changes, explicitly check:

- number of DynamoDB calls per request;
- whether any scan was introduced;
- whether the operation is bounded;
- whether retries are safe;
- whether concurrency can create conflicts;
- whether tenant scoping is enforced;
- whether Lambda cold-start/bundle cost materially changed.

### 6. Update docs when required

Keep architecture and operational documentation synchronized with behavior.

### 7. Format and validate

Run the mandatory end-of-prompt commands.

### 8. Report completion precisely

Final response should summarize:

- what changed;
- important design decisions;
- tests added/updated;
- validation commands run;
- any remaining limitation or follow-up that is genuinely outside the requested scope.

Do not describe work as complete when required validation is failing.

---

## Definition of Done

A code change is done only when all applicable items below are true:

- requested behavior is implemented;
- behavior fits existing architecture;
- organization isolation is preserved;
- Lambda execution remains safe and stateless;
- DynamoDB access is deliberate and bounded;
- shared schedule consistency is preserved where applicable;
- code is modular and reusable enough for expected future extension;
- shared contracts are synchronized;
- at least one relevant Vitest test was added or updated for behavioral changes;
- major/user-flow changes include a Playwright test;
- required docs are updated;
- `corepack pnpm format` was run;
- lint passes;
- typecheck passes;
- Vitest passes;
- integration tests pass;
- build passes;
- Playwright passes when required;
- failures or environment blockers are explicitly reported rather than hidden.

---

## Commands Reference

Install dependencies:

```bash
corepack pnpm install
```

Local development:

```bash
corepack pnpm dev
```

Formatting:

```bash
corepack pnpm format
```

Lint:

```bash
corepack pnpm lint
```

Typecheck:

```bash
corepack pnpm typecheck
```

Vitest:

```bash
corepack pnpm test
```

DynamoDB integration tests:

```bash
corepack pnpm test:integration
```

Build:

```bash
corepack pnpm build
```

Playwright:

```bash
corepack pnpm test:e2e
```

Phase 3 commercial regression:

```bash
corepack pnpm test:phase3
corepack pnpm test:phase3:integration
corepack pnpm test:phase3:e2e
corepack pnpm test:phase3:all
corepack pnpm test:coverage
```

See `docs/testing/phase3-coverage.md` for the coverage matrix, fixtures, and thresholds.

Development seed:

```bash
corepack pnpm seed:dev
```

Reset local development data:

```bash
corepack pnpm reset:dev
```

---

## Final Guideline

Prefer boring, explicit, testable code over clever abstractions.

CourtOS is expected to grow substantially across reservations, operations, self-service, commercial relationships, retention, engagement, and integrations. Every change should therefore optimize for:

```text
correctness
+ operational clarity
+ DynamoDB/Lambda efficiency
+ tenant safety
+ modularity
+ testability
+ future extension
```

without overengineering features that the current product phase does not yet need.
