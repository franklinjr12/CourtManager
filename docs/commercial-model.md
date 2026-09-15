# Commercial model

Phase 3 adds the commercial relationship between a customer and a sports
center. It does not replace reservations, class sessions, attendance, or the
operational finance model. Those remain the authoritative records for the
service delivered, court occupancy, attendance, charges, and external
payments.

The central rule is:

> **A service entitlement is not a payment.**

An entitlement says that a customer may use a service. A payment says that an
external financial transaction was recorded against a charge. Consuming a
credit reduces an entitlement balance; it does not create a payment and must
not be used to calculate cash received.

## Commercial relationship

```text
Plan -------------------------- reusable offering
  |
  v
Membership -------------------- customer-specific agreement and snapshot
  |
  v
Membership Period ------------- one dated usage/billing boundary
  |
  v
Entitlement ------------------- structured benefit rule
  |
  +--> Credit Transactions ----- append-only usage ledger
  +--> Entitlement Allocations - activity coverage/audit link

Package Definition ------------- reusable prepaid offering
  |
  v
Customer Package -------------- issued customer-specific snapshot
  |
  v
Credit Transactions / Balance

Fixed Court Agreement ---------- commercial recurring court arrangement
  |
  +--> recurring reservations -- authoritative court occupancy
  +--> agreement charges ------- operational billing periods

Charge <------------------------ amount owed for an operational service
  ^
  |
Payment ------------------------ external payment recorded by staff
```

## Terms and source of truth

| Term                       | Meaning and boundary                                                                                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan**                   | Reusable organization-owned offering with a name, price, billing interval, and structured benefits. Editing a plan does not rewrite an existing membership.                                                                                                                |
| **Membership**             | Customer-specific relationship created from an active plan. It snapshots the plan name, price, billing interval, and benefits, and owns the lifecycle (`DRAFT`, `ACTIVE`, `PAUSED`, `CANCELLED`, `EXPIRED`).                                                               |
| **Membership Period**      | One dated membership allowance and billing period. Period dates are venue-local calendar dates and are inclusive: the next period starts the day after the previous period ends. Each period has its own price snapshot, status, deterministic charge, and credit history. |
| **Package Definition**     | Reusable prepaid offering with price, validity, and package benefits. It is a template, not a customer purchase.                                                                                                                                                           |
| **Customer Package**       | Issued package for one customer. It snapshots the definition name, price, currency, benefits, issue/start times, and expiry. Later definition changes do not change it.                                                                                                    |
| **Entitlement**            | A structured right to consume a service, such as 8 class sessions per membership period or 120 court minutes. It includes benefit type, unit, quantity (`FINITE` or `UNLIMITED`), scope selectors, and a period boundary.                                                  |
| **Credit Transaction**     | Append-only signed ledger delta for `ISSUED`, `CONSUMED`, `RESTORED`, `EXPIRED`, or `ADJUSTED` credit. A consumed transaction must identify its activity.                                                                                                                  |
| **Entitlement Allocation** | Auditable link from an entitlement source to a reservation or class attendance. It records quantity, covered service amount, currency, and `ACTIVE`/`VOID` status. It is not a payment.                                                                                    |
| **Fixed Court Agreement**  | Customer-specific commercial agreement for a court, weekday, local time, duration, interval, price, timezone, and lifecycle. Its occurrences create normal reservations and shared schedule locks.                                                                         |
| **Charge**                 | Operational amount owed for a reservation, class, membership period, package, or fixed-court billing period. Charges are the basis for outstanding balance calculations.                                                                                                   |
| **Payment**                | Staff-recorded external transaction, such as PIX, cash, or card, linked to a charge. CourtOS does not process or reconcile the external payment.                                                                                                                           |

Benefits are structural, not inferred from names such as “Gold” or “Premium”.
The supported benefit types are `COURT_TIME`, `CLASS_ATTENDANCE`,
`PRIVATE_LESSON`, `OPEN_GAME`, and `FIXED_COURT_SLOT`. Quantities use domain
units: `COURT_MINUTES`, `SESSION`, `GAME`, or `OCCURRENCE`. Membership benefits
may be bounded by `WEEK`, `MONTH`, or `MEMBERSHIP_PERIOD`; package benefits use
`PACKAGE_LIFETIME`. The package issuance workflow currently supports court
time, class attendance, and private-lesson credits.

## Memberships and periods

Creating a membership is staff-only. The service validates the customer and
active plan, snapshots the commercial terms, creates the first active period,
creates one deterministic `MEMBERSHIP` charge for that period, issues the
period benefits to the credit ledger, and records a `MEMBERSHIP_STARTED`
activity event.

The period boundary is calculated from the period start date:

- `WEEKLY`: seven calendar days;
- `MONTHLY`: one calendar month, clamped to the last valid day of the target
  month;
- `CUSTOM`: the configured number of calendar days.

The next period starts on the day after the prior period ends. Usage is
evaluated against the venue-local date, not the UTC date. Weekly benefit keys
use ISO weeks (Monday through Sunday); monthly keys use the venue-local
`YYYY-MM` value. A membership must be `ACTIVE`, its current period must be
active, and the activity date must be within the current period to grant a
membership benefit.

Renewal is manual. Staff may renew an active membership, optionally supplying
a new agreed price and an idempotency key. Renewal completes the prior period,
creates the next period and charge, issues the next period’s benefits, and
records `MEMBERSHIP_RENEWED`. An earlier unpaid charge does not prevent
renewal; the outstanding balance remains visible. There is no recurring card
billing or automatic renewal.

Pausing, resuming, cancellation, and expiry are explicit lifecycle actions.
Historical periods and their ledger/charge records remain. If a period ends
without renewal, the membership becomes `EXPIRED` when evaluated or
reconciled; remaining period credit is written off with `EXPIRED` ledger
transactions, not deleted.

## Packages and credit ledger

Issuing a package is staff-only and requires an active package definition. The
service creates the customer-package snapshot and its `PACKAGE` charge, then
issues one credit source per finite or unlimited benefit. The package is not
paid merely because it was issued. Staff must record an external payment
against its charge when payment occurs.

Finite balances are materialized for conditional updates and fast display, but
the ledger remains authoritative:

```text
10 ISSUED
-2 CONSUMED
+1 RESTORED
-5 CONSUMED
----------------
 4 remaining
```

Unlimited benefits still write usage and allocation history. Their balance
reports usage but does not pretend there is a finite remaining number.
Manual adjustments require a staff actor and a reason. Consumption is
idempotent: the durable usage guard is keyed by organization, activity type
and ID, source, membership period, and benefit. A retry returns the original
allocation rather than consuming again.

### Entitlement selection order

For a reservation, a matching active fixed-court agreement is considered
first. The remaining eligible sources are ordered by earliest expiration
(`expiresAt`), then by source priority:

1. makeup credit;
2. active membership benefit;
3. active package credit;
4. other eligible sources.

Stable source and benefit IDs break remaining ties. A reservation may use more
than one source when the first finite source only covers part of its court
minutes. Fixed-court agreement coverage is unlimited for its matching
occurrence and is checked before the regular candidate list.

For class attendance, the same eligible-source ordering applies without a
fixed-court match. Attendance is the authoritative class usage event. A
covered class charge is reduced or voided for the covered amount; it is never
marked paid by pretending the entitlement was a cash payment.

Reservation coverage is applied after the reservation has acquired the normal
atomic schedule locks. The reservation keeps its original `serviceAmount`;
only the uncovered amount remains in its direct operational charge.

### Credit restoration policy

An active reservation allocation is restored exactly once when the reservation
is cancelled before the venue cancellation cutoff. Staff cancellation also
restores active allocations. The restoration appends a `RESTORED` transaction
linked to the original consumption and voids the allocation when it has been
fully restored. Repeated cancellation or retries are safe.

No-show does not restore the entitlement: the service opportunity was consumed.
Class attendance is not automatically restored by this reservation policy;
staff may use the class makeup-credit workflow when the venue grants a makeup
credit. Restorations preserve the original consumption and the reason for the
decision.

### Package expiration

Package timestamps are instants; expiration is evaluated using the package
expiry instant. The customer package becomes `EXPIRED` when it is read after
expiry or when `corepack pnpm reconcile:commercial` materializes the change.
Any remaining finite balance is appended to the ledger as `EXPIRED` and its
remaining quantity becomes zero. The package, its charge, allocations, and all
credit transactions remain available for history. Expiration does not create a
payment or retroactively alter a completed allocation.

## Fixed-court agreements

A fixed-court agreement is a commercial contract, not a reservation recurrence.
It records the customer’s guaranteed slot and price, its lifecycle, billing
interval, and local timezone. The agreement’s recurring occurrences are
represented by ordinary reservations using the existing authoritative schedule
and atomic court locks. Each occurrence also has a durable fixed-court
occurrence record. The agreement stores `reservationSeriesId`; each generated
reservation links with `seriesId`, `fixedCourtAgreementId`, and
`fixedCourtOccurrenceId`.

This distinction matters:

```text
Reservation recurrence = how future court occupancy is generated.
Fixed-court agreement  = why the customer has the recurring commercial right.
```

Agreement billing is separate from occurrence coverage. The service creates
one idempotent `FIXED_COURT_AGREEMENT` charge per billing period. A matching
occurrence can be covered by the agreement while retaining its service value
for history; it does not create a second ordinary reservation charge for the
same covered service.

## Charges, payments, and balance

The customer balance is financial only:

```text
outstanding = active charges - payments linked to those charges
```

Entitlement consumption, credit restoration, package issuance, and allocation
values are not payments. A covered reservation or attendance can still retain
economic service value for reporting, but its direct charge is reduced to the
uncovered value. Membership, package, and fixed-agreement charges remain
separate operational charges and can be paid manually through the existing
payment-record workflow using `chargeId`.

Payment processing remains external. There is no gateway, automatic billing,
PIX checkout, card storage, bank reconciliation, or accounting general ledger.

## Customer portal and staff boundaries

Staff manage plans, definitions, memberships, packages, adjustments,
restorations, and fixed-court agreements. Customer portal reads expose
customer-safe membership periods, benefit usage, package balances, credit
history, and covered activity. Customer identity and organization scope come
from the customer session; customers cannot issue, restore, adjust, or alter
commercial terms.

The staff commercial area is available at `/commercial`, with dedicated views
for plans, memberships, packages, fixed courts, and customer summaries. The
customer portal exposes `/portal/:slug/memberships`,
`/portal/:slug/packages/:id`, and `/portal/:slug/credits`.

## Phase 3 migration and operations

Deploy the Phase 3 code before running the migration. With the production
region, credentials, and `DYNAMODB_TABLE` configured, run:

```bash
corepack pnpm migrate:phase3
```

The migration is additive and idempotent. It scans existing records only to
create missing materialized query indexes for already-present Phase 3 source
records and customer charge/payment indexes. It does **not** invent plans,
memberships, membership periods, packages, balances, allocations, or usage for
Phase 2 data, and it never deletes historical records. Existing Phase 2
customers, reservations, classes, attendance, charges, and payments therefore
continue to work without artificial commercial relationships.

Run the migration again to verify that the second run creates no additional
indexes. Run the independent reconciliation command when operators need
bulk lifecycle materialization:

```bash
corepack pnpm reconcile:commercial
```

Reconciliation is retry-safe. It evaluates expiry in each organization’s
timezone and appends expiry ledger transactions for remaining eligible credit.
Read-time evaluators remain authoritative if reconciliation has not run.
Back up the production table before either backfill and never use
`reset:dev` against production.

## Phase 4 readiness

Phase 3 records durable customer behavior without implementing retention
logic. Membership lifecycle, package issuance/consumption/expiry, credit
issuance/consumption/restoration, and fixed-agreement changes produce
append-oriented commercial activity events under the customer activity
partition. The event source and source ID allow Phase 4 to build timelines,
frequency measures, and lifecycle analysis without reconstructing history from
mutable screens.

Current event types include:

```text
MEMBERSHIP_STARTED       MEMBERSHIP_RENEWED
MEMBERSHIP_PAUSED        MEMBERSHIP_RESUMED
MEMBERSHIP_CANCELLED     MEMBERSHIP_EXPIRED
PACKAGE_ISSUED           PACKAGE_CONSUMED
PACKAGE_EXPIRED          CREDIT_ISSUED
CREDIT_CONSUMED          CREDIT_RESTORED
FIXED_AGREEMENT_STARTED  FIXED_AGREEMENT_CHANGED
FIXED_AGREEMENT_CANCELLED
```

Phase 4 may consume these facts, credit transactions, allocations,
attendance, reservations, and payments. It must not reinterpret an
entitlement as a payment or replace the authoritative schedule and attendance
records.
