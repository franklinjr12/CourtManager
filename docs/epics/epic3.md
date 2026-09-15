# Epic: Phase 3 — Memberships, Packages & Commercial Relationships

## Context

CourtOS has completed Phase 2 — Customer Self-Service & Online Booking.

The application already provides the operational and customer-facing foundations required for Phase 3:

- organization-scoped staff authentication;
- `OWNER`, `STAFF`, and `COACH` staff roles;
- authenticated customer accounts separate from staff users;
- customer portal sessions;
- customer profiles and sport preferences;
- courts and sports;
- authoritative unified court scheduling;
- atomic schedule locking;
- staff-created reservations;
- recurring reservations;
- customer-created reservations;
- configurable customer booking policies;
- reservation lifecycle states;
- reservation participants;
- customer cancellations;
- public reservation requests;
- classes and materialized class sessions;
- class capacity and enrollment;
- class attendance;
- class waitlists and court waitlists;
- customer activity views;
- customer portal navigation;
- reservation and class charges;
- externally recorded payments;
- customer outstanding balances;
- operational financial reporting;
- responsive vanilla TypeScript frontend;
- Hono API;
- DynamoDB repository abstraction;
- shared Zod contracts in `packages/contracts`;
- phase-specific migration scripts and tests.

The existing financial model is transaction-oriented.

Conceptually:

```text
Reservation / Class
        |
        v
      Charge
        |
        v
      Payment
```

This is sufficient when a customer pays separately for each activity.

It is not sufficient for recurring commercial relationships such as:

```text
João pays R$ 500/month
for Court 2
every Wednesday
19:00–21:00
```

or:

```text
Maria bought
10 court hours

Remaining:
3 hours
```

or:

```text
Carlos pays monthly
for 8 classes

Used:
7 / 8
```

Phase 3 introduces a commercial entitlement layer between the customer and the activities they consume.

The target conceptual model becomes:

```text
                     +-------------------+
                     | Commercial Plan   |
                     +---------+---------+
                               |
                               v
                     +-------------------+
                     |    Membership     |
                     +---------+---------+
                               |
                    +----------+----------+
                    |                     |
                    v                     v
              Entitlements          Recurring terms
                    |                     |
                    +----------+----------+
                               |
                               v
Customer ---> Reservation / Class / Attendance
                               |
                               v
                         Usage / Consumption
                               |
                               v
                         Customer Balance
```

Packages form a parallel commercial mechanism:

```text
Commercial offering
       |
       v
    Package
       |
       v
 Credit ledger
       |
       +--> ISSUED
       +--> CONSUMED
       +--> RESTORED
       +--> EXPIRED
       +--> ADJUSTED
```

The existing reservation schedule remains authoritative.

The existing class session and attendance model remains authoritative.

The existing charge/payment records remain the operational finance foundation.

Phase 3 must not create:

- a second reservation model;
- a separate class attendance system;
- an accounting ledger pretending to be an ERP;
- automatic payment processing;
- external payment gateway integration;
- automated recurring card billing;
- WhatsApp automation;
- retention campaigns.

Those belong to later phases.

---

## Product Goal

At the end of this epic:

> CourtOS understands the ongoing commercial relationship between a customer and a sports center, including memberships, packages, service credits, recurring fixed court arrangements, class entitlements, renewals, and customer balances.

The system should be able to answer questions such as:

```text
"What plan does João have?"

"When does Maria's membership renew?"

"How many court hours does Carlos have remaining?"

"Which package paid for this reservation?"

"Has this class attendance already consumed a credit?"

"Who has memberships expiring next week?"

"Which packages expire soon?"

"João pays monthly for Wednesday nights — where is that represented?"

"How much does this customer currently owe?"

"Which recurring customers have an overdue membership?"
```

The Phase 3 gate is:

> **Can CourtOS represent how regular customers actually pay and consume services?**

---

## Core Design Decisions

### Commercial offerings and customer relationships are different entities

A reusable offering defined by the sports center is not the same thing as the commercial relationship purchased by an individual customer.

Conceptually:

```text
Plan
"8 classes/month"
R$ 280
        |
        v
Membership
Customer: Carlos
Start: 2026-09-01
Next renewal: 2026-10-01
Price agreed: R$ 260
Status: ACTIVE
```

The membership must snapshot commercially important values.

Changing the plan later must not silently rewrite historical customer agreements.

---

### Entitlements must be explicit

Do not infer entitlement from plan names such as:

```text
"Gold"
"Monthly"
"Premium"
```

Represent benefits structurally.

Examples:

```text
COURT_TIME
quantity = 4
unit = HOUR
period = MONTH

CLASS_ATTENDANCE
quantity = 8
unit = SESSION
period = MONTH

CLASS_ATTENDANCE
quantity = 2
unit = SESSION
period = WEEK

OPEN_GAME
quantity = UNLIMITED
period = MONTH

FIXED_COURT_SLOT
weekday = WEDNESDAY
19:00–21:00
courtId = ...
```

The UI may provide friendly presets, but backend behavior must operate on structured rules.

---

### Usage must be auditable

Never maintain only a mutable field such as:

```text
remainingCredits = 3
```

without recording how it became `3`.

Use append-oriented consumption/credit records so CourtOS can answer:

```text
10 issued
-1 reservation
-2 reservation
+1 cancellation restoration
-5 reservation
= 3 remaining
```

Cached or materialized balance fields are acceptable for performance, but the durable ledger is authoritative.

---

### Entitlement consumption must be idempotent

A reservation update, class check-in retry, Lambda retry, browser retry, or duplicated request must never consume the same benefit twice.

Consumption records need a stable relationship to the activity being covered.

Conceptually:

```text
entitlement source:
membershipId / packageId

usage source:
reservationId / classSessionId / attendanceId

unique logical consumption:
entitlement source + usage source + benefit
```

---

### Commercial coverage and financial charges are related but different

A reservation may cost:

```text
R$ 100
```

but be covered by:

```text
1 package court hour
```

The reservation still has economic value, but the customer should not owe another R$ 100 for the same activity.

Phase 3 must define a consistent relationship between:

```text
service amount
commercial entitlement
charge
payment
customer outstanding balance
```

Do not simply create the normal charge and later pretend a package credit is a cash payment.

Commercial coverage should be represented explicitly.

---

### Historical financial records must remain stable

Once an activity has been covered by a membership/package or charged directly, future changes to:

- plan price;
- package price;
- benefit configuration;
- class price;
- court price;

must not retroactively alter that historical allocation.

---

### External payments remain external

CourtOS may record:

```text
Membership renewal charge: R$ 300
Payment recorded: PIX R$ 300
```

but does not process the PIX.

No:

- payment gateway;
- recurring credit card;
- automatic PIX generation;
- bank reconciliation;

is required in Phase 3.

---

### Staff controls commercial relationships

Customers may inspect their memberships and credits in the portal.

They must not be able to arbitrarily:

- issue credits;
- change membership prices;
- activate memberships;
- forgive balances;
- restore consumed credits;
- alter fixed court contracts.

Those remain staff-managed operations.

---

### Manual workflows before automation

Membership renewals should initially be manageable manually.

For example:

```text
Membership renewal due
        |
        v
CourtOS shows renewal needed
        |
        v
Staff records renewal/payment
        |
        v
Next period becomes active
```

Do not build recurring billing automation in this epic.

---

### Phase 4 must be able to consume Phase 3 data

Membership lifecycle and commercial usage are important customer-behavior signals.

Design records so later customer intelligence can produce activity events such as:

```text
MEMBERSHIP_STARTED
MEMBERSHIP_RENEWED
MEMBERSHIP_CANCELLED
MEMBERSHIP_EXPIRED
PACKAGE_PURCHASED
PACKAGE_EXPIRED
CREDIT_CONSUMED
```

Do not implement Phase 4 retention logic yet.

---

## TASK-001 — Introduce the Phase 3 Commercial Domain Contracts

### Goal

Define a coherent commercial domain in shared contracts before implementing workflows.

### Requirements

Extend `packages/contracts` with first-class Phase 3 concepts.

At minimum introduce:

```text
Plan
PlanBenefit

Membership
MembershipPeriod

PackageDefinition
CustomerPackage

CreditTransaction

EntitlementAllocation

FixedCourtAgreement
FixedCourtOccurrence

CustomerBalanceSummary
CommercialActivitySummary
```

Plan status should support at least:

```text
ACTIVE
INACTIVE
ARCHIVED
```

Membership status should support at least:

```text
DRAFT
ACTIVE
PAUSED
CANCELLED
EXPIRED
```

Customer package status should support:

```text
ACTIVE
CONSUMED
EXPIRED
CANCELLED
```

Define structured benefit types instead of relying on free-form plan descriptions.

Support at least:

```text
COURT_TIME
CLASS_ATTENDANCE
PRIVATE_LESSON
OPEN_GAME
FIXED_COURT_SLOT
```

Define benefit periods where applicable:

```text
WEEK
MONTH
MEMBERSHIP_PERIOD
PACKAGE_LIFETIME
```

Define quantity semantics.

Support:

```text
FINITE
UNLIMITED
```

For finite benefits store normalized units.

Court-time benefits should use minutes internally rather than floating-point hours.

Example:

```text
4 court hours
=
240 COURT_MINUTES
```

Class benefits should use integer attendance/session units.

Define commercial money values using the existing money schema and organization currency.

Do not introduce floating-point credit calculations.

Add contracts for API inputs/responses needed throughout this epic.

Export Phase 3 contracts from focused package files consistent with the existing contracts organization.

Add contract-level validation tests.

### Acceptance Criteria

- [ ] Shared Phase 3 schemas compile.
- [ ] Benefits are represented structurally rather than parsed from names.
- [ ] Court-time quantities are stored using integer minutes.
- [ ] Unlimited benefits have an explicit representation.
- [ ] Membership, package, credit, and fixed-slot lifecycle states are validated.
- [ ] Historical/customer-specific price snapshots are supported.
- [ ] New contracts do not break existing Phase 0–2 schemas.
- [ ] Contract tests cover invalid combinations and boundary values.

---

## TASK-002 — Design DynamoDB Access Patterns and Add Phase 3 Persistence

### Goal

Add Phase 3 persistence without introducing table scans for normal commercial workflows.

### Requirements

Before implementing services, document the new access patterns in `docs/dynamodb-model.md`.

Support efficient lookup for at least:

```text
plans by organization

active plans by organization

membership by ID

memberships by customer

active membership by customer

memberships by plan

memberships renewing in date range

memberships by status

packages by customer

active packages by customer

packages expiring in date range

credit transactions by package

credit transactions by membership period

usage allocation by reservation

usage allocation by class attendance/session

fixed court agreements by customer

active fixed court agreements by organization

fixed court occurrences by agreement

customer commercial records

charges/payments by customer
```

Where dashboard workflows require organization/date queries, create deliberate date/status indexes rather than scanning every organization record.

Implement repository interfaces and DynamoDB repositories following the current persistence abstraction.

Add any required transactional write helpers.

Usage consumption must support atomic/idempotent writes.

Create a Phase 3 migration script following prior migration conventions.

The migration must be idempotent.

Existing Phase 0–2 records require no fake memberships or packages.

If Charge source enums or related financial records are extended, old records must remain readable unchanged.

Update persistence documentation.

### Acceptance Criteria

- [ ] Normal Phase 3 list/detail workflows use queryable access patterns.
- [ ] Expiring membership/package queries do not require unrestricted table scans.
- [ ] Customer commercial history can be queried efficiently.
- [ ] Entitlement usage can be written atomically.
- [ ] Duplicate consumption can be prevented at persistence level.
- [ ] Migration is idempotent.
- [ ] Existing records remain readable.
- [ ] DynamoDB documentation includes every new key/index pattern.
- [ ] DynamoDB Local integration tests cover new repositories.

---

## TASK-003 — Build Commercial Plan Management

### Goal

Allow staff to define reusable recurring commercial offerings.

### Requirements

Create a plan service and owner/staff management APIs.

Suggested routes:

```text
GET    /plans
POST   /plans
GET    /plans/:id
PATCH  /plans/:id
POST   /plans/:id/archive
```

A plan should include at least:

```text
planId
organizationId
name
description?
status
billingInterval
basePrice
benefits[]
createdAt
updatedAt
```

Initial billing intervals:

```text
WEEKLY
MONTHLY
CUSTOM
```

If `CUSTOM` is supported, represent the actual duration structurally.

Benefits can include examples such as:

```text
8 classes/month

240 court minutes/month

2 classes/week

unlimited open games

fixed court slot
```

Plan editing rules must preserve existing memberships.

When a plan is modified:

```text
existing memberships
-> retain their agreed snapshot

new memberships
-> receive the new plan definition
```

Do not mutate existing memberships to match the modified plan automatically.

Allow plans to become inactive or archived without deleting them.

Plans already referenced by commercial history must not be hard-deleted.

Build a staff UI under a commercial area such as:

```text
Commercial
  Plans
```

The UI should clearly display:

- name;
- current price;
- billing interval;
- benefits;
- active member count when reasonably queryable;
- status.

Provide a plan creation/editing form capable of creating multiple structured benefits.

### Acceptance Criteria

- [ ] Staff can create commercial plans.
- [ ] Plans can contain multiple benefits.
- [ ] Finite and unlimited benefits are supported.
- [ ] Plan definitions can be edited without modifying historical membership snapshots.
- [ ] Referenced plans cannot be destructively deleted.
- [ ] Archived plans cannot be assigned to new memberships.
- [ ] Staff UI clearly describes plan benefits.
- [ ] Organization isolation is enforced.
- [ ] Plan service tests cover snapshot behavior.

---

## TASK-004 — Implement Membership Lifecycle and Periods

### Goal

Represent the ongoing commercial agreement between a customer and a sports center.

### Requirements

Implement membership creation and lifecycle management.

Suggested staff APIs:

```text
GET    /memberships
POST   /memberships
GET    /memberships/:id
PATCH  /memberships/:id
POST   /memberships/:id/activate
POST   /memberships/:id/pause
POST   /memberships/:id/resume
POST   /memberships/:id/cancel
POST   /memberships/:id/renew
```

Membership must record at least:

```text
membershipId
organizationId
customerId
planId

planNameSnapshot
price
billingInterval

startDate
currentPeriodStart
currentPeriodEnd
nextRenewalDate?

status

benefitSnapshot[]

createdAt
updatedAt

cancelledAt?
cancelledBy?
cancellationReason?
```

Introduce explicit membership periods.

Conceptually:

```text
Membership
    |
    +--> Sep 01–Sep 30
    |
    +--> Oct 01–Oct 31
    |
    +--> Nov 01–Nov 30
```

Each period provides the boundary for periodic benefit usage.

Do not reset mutable counters in-place on renewal without preserving prior periods.

Renewal must create/advance a period.

Support staff-overridden customer pricing.

Example:

```text
Plan list price:
R$ 300

Carlos agreed price:
R$ 270
```

The membership must use the agreed price until explicitly changed.

Define cancellation semantics clearly.

At minimum distinguish:

```text
cancel immediately

cancel at end of current period
```

If only one behavior is implemented initially, prefer an explicit `effectiveDate` rather than ambiguous cancellation.

A paused membership must not grant new entitlements while paused.

Historical usage remains visible.

### Acceptance Criteria

- [ ] Staff can create a membership for an existing customer.
- [ ] Membership snapshots plan name, price, interval, and benefits.
- [ ] Membership periods are preserved historically.
- [ ] Membership renewal creates/advances the commercial period.
- [ ] Paused memberships stop granting entitlement.
- [ ] Cancelled memberships preserve historical usage.
- [ ] Expired memberships are distinguishable from cancelled memberships.
- [ ] Individual membership price overrides are supported.
- [ ] Editing the underlying plan does not modify existing membership terms.
- [ ] Lifecycle transitions are validated server-side.

---

## TASK-005 — Generate Membership Charges and Manual Renewals

### Goal

Integrate memberships into CourtOS's existing operational financial model.

### Requirements

Extend the existing charge model so commercial charges can originate from memberships.

Support charge source types including:

```text
RESERVATION
CLASS
MEMBERSHIP
```

If necessary, refactor charge-source references so the model remains clean rather than adding many unrelated optional foreign keys indefinitely.

A membership period should be able to create exactly one expected renewal charge.

Conceptually:

```text
Membership period
2026-10-01 -> 2026-10-31

Agreed price:
R$ 280

        |
        v

Charge
MEMBERSHIP
R$ 280
```

Charge creation must be idempotent.

Retrying renewal must not create duplicate charges.

Continue using existing external payment recording.

Payments may reference the membership charge through the existing `chargeId` relationship.

Do not automatically mark a membership active merely because arbitrary customer payments total the expected value unless the workflow deliberately records that payment against the membership charge.

Provide staff renewal workflow:

```text
Membership
   |
   v
Renew
   |
   +--> create next period
   +--> create renewal charge
   +--> set next renewal
```

Define whether renewal may occur with an outstanding prior period.

Allow it operationally if needed, but surface the overdue balance clearly.

Do not block the entire business workflow unnecessarily.

### Acceptance Criteria

- [ ] Membership periods create membership charges.
- [ ] Retrying renewal cannot duplicate the period charge.
- [ ] Existing external payment recording can settle membership charges.
- [ ] Reservation and class charges continue working.
- [ ] Historical membership prices remain reflected in their original charges.
- [ ] Outstanding previous membership charges remain visible after renewal.
- [ ] No external payment processing is introduced.

---

## TASK-006 — Implement Package Definitions and Customer Package Issuance

### Goal

Support prepaid bundles such as court hours, class credits, and private lessons.

### Requirements

Separate reusable package offerings from customer-owned package instances.

Conceptually:

```text
PackageDefinition
"10 Court Hours"
R$ 700
Validity: 90 days
Benefit: 600 court minutes

       |
       v

CustomerPackage
Maria
Purchased: 2026-09-10
Expires: 2026-12-09
```

Create package-definition management.

Suggested routes:

```text
GET    /package-definitions
POST   /package-definitions
GET    /package-definitions/:id
PATCH  /package-definitions/:id
POST   /package-definitions/:id/archive
```

Support package benefits including:

```text
COURT_TIME
CLASS_ATTENDANCE
PRIVATE_LESSON
```

Create customer package issuance.

Suggested routes:

```text
GET  /customers/:customerId/packages
POST /customers/:customerId/packages
GET  /customer-packages/:id
POST /customer-packages/:id/cancel
```

A customer package must snapshot:

```text
definition name
price
benefits
issued quantity
issuedAt
expiresAt?
```

Expiration must support:

```text
fixed expiry date

N days after issuance

no expiry
```

Generate an appropriate package-purchase charge when staff issues/sells a package.

Package issuance and purchase charge creation should be atomic or safely idempotent.

Do not require a payment before the package can exist unless staff chooses to enforce that operationally.

Package payment remains externally recorded.

### Acceptance Criteria

- [ ] Staff can define reusable package offerings.
- [ ] Staff can issue packages to customers.
- [ ] Customer package terms are snapshotted.
- [ ] Package validity may be finite or non-expiring.
- [ ] Package issuance creates an operational charge.
- [ ] Package issuance does not require an online payment gateway.
- [ ] Editing a package definition does not modify packages already issued.
- [ ] Expired/archived definitions cannot be newly issued.
- [ ] Customer package history remains visible after consumption or expiration.

---

## TASK-007 — Build the Credit Ledger and Atomic Entitlement Consumption Engine

### Goal

Create the authoritative mechanism that tracks issued, consumed, restored, expired, and manually adjusted commercial credits.

### Requirements

Implement append-oriented credit transactions.

Transaction types should support at least:

```text
ISSUED
CONSUMED
RESTORED
EXPIRED
ADJUSTMENT
```

Each transaction should record enough information to explain itself.

Conceptually:

```text
creditTransactionId
organizationId
customerId

sourceType
MEMBERSHIP | PACKAGE | MANUAL

sourceId
benefitId

transactionType

quantity
unit

usageSourceType?
RESERVATION | CLASS_SESSION | ATTENDANCE

usageSourceId?

reason?
createdBy
createdAt
```

Credit quantities must be integer normalized units.

Examples:

```text
COURT_MINUTE: 60
CLASS_ATTENDANCE: 1
PRIVATE_LESSON: 1
```

Implement a reusable entitlement service capable of:

```text
getAvailableEntitlements(customer, activity)

calculateCoverage(activity, entitlement)

consume(...)

restore(...)

expire(...)

getRemainingBalance(...)
```

Do not put consumption calculations independently in:

- reservation routes;
- class routes;
- frontend pages.

The entitlement service should own these rules.

Consumption must be atomic and idempotent.

Examples:

```text
Reservation A
consumes 60 package minutes

retry Reservation A consumption
-> no additional consumption
```

Ensure concurrent consumption cannot overspend finite credits.

Example:

```text
Package balance = 60 minutes

Request A tries to consume 60
Request B tries to consume 60

Only one may succeed.
```

Unlimited benefits should still produce a usage record even though no finite balance is reduced.

This is necessary for usage reporting such as:

```text
Carlos used 7 of his 8 monthly classes
```

### Acceptance Criteria

- [ ] Credits are auditable through immutable transaction history.
- [ ] Remaining balance can be derived from transactions.
- [ ] Finite credits cannot become negative through concurrent usage.
- [ ] Duplicate retries cannot consume credits twice.
- [ ] Unlimited benefits produce usage history.
- [ ] Restorations reference the original consumption where appropriate.
- [ ] Manual adjustments record actor and reason.
- [ ] Entitlement logic is centralized in a dedicated service.
- [ ] Concurrency and idempotency tests exist.

---

## TASK-008 — Apply Court-Time Entitlements to Reservations

### Goal

Allow reservations to consume membership or package court-time benefits instead of always producing a direct customer debt.

### Requirements

Integrate the entitlement engine with reservation creation and lifecycle.

When a reservation is created, determine eligible coverage from:

```text
active memberships
active customer packages
fixed commercial agreements
```

Do not automatically select arbitrary credit sources without a deterministic rule.

Provide an explicit or predictable allocation policy.

Recommended initial behavior:

```text
1. fixed court agreement matching this reservation
2. membership benefits expiring at current period end
3. package credits with earliest expiry
4. otherwise direct charge
```

If multiple eligible sources remain ambiguous, staff/customer UI may allow selection.

Create an `EntitlementAllocation` record linking the activity and commercial source.

Conceptually:

```text
Reservation
   |
   +--> 60 min covered by Package A
   |
   +--> 30 min charged directly
```

Support partial coverage.

Example:

```text
Reservation duration:
120 minutes

Package remaining:
60 court minutes

Result:
60 minutes package consumption
60 minutes direct charge
```

Do not represent entitlement consumption as a fake `Payment`.

The resulting direct charge should correspond only to uncovered value.

If partial monetary allocation is needed, use the reservation's effective hourly amount consistently and document rounding behavior.

Cancellation must restore eligible credits according to commercial rules.

For Phase 3, use a simple default:

```text
customer cancellation allowed by venue policy
before cutoff
-> consumed reservation entitlement restored

staff cancellation
-> restore by default

no-show
-> do not restore automatically
```

Keep restoration logic centralized and explicit.

### Acceptance Criteria

- [ ] Reservations can consume court-time membership benefits.
- [ ] Reservations can consume package court minutes.
- [ ] The same reservation cannot consume twice.
- [ ] Partial entitlement coverage is supported.
- [ ] Only uncovered service value becomes additional customer debt.
- [ ] Commercial credit is not recorded as cash payment.
- [ ] Eligible cancellations restore credits once.
- [ ] No-shows do not automatically restore consumed credits.
- [ ] Allocation source is visible from reservation details.
- [ ] Existing reservations without entitlements continue using existing charge behavior.

---

## TASK-009 — Implement Class Entitlements, Monthly Limits, and Enrollment Commercial Rules

### Goal

Connect class memberships/packages with enrollment and attendance.

### Requirements

Allow benefits such as:

```text
8 classes/month

2 classes/week

20 class credits

5 private lessons
```

Eligibility must consider:

- benefit type;
- class type;
- class identity if restricted;
- sport if restricted;
- membership status;
- membership period;
- package status;
- package expiration;
- remaining quantity.

Do not consume a class credit merely because someone is enrolled in a recurring class.

Consumption should correspond to actual service usage.

Recommended lifecycle:

```text
Enrollment
    |
    v
Class session
    |
    v
Customer expected
    |
    v
CHECKED_IN / PRESENT
    |
    v
Consume entitlement
```

If current attendance architecture uses a different authoritative completion point, integrate there consistently.

Avoid consuming both:

```text
class participant status
and
attendance record
```

for the same session.

There must be exactly one commercial consumption event per attended service.

Support monthly and weekly benefit windows.

Example:

```text
2 classes/week

Week 1:
Mon = used 1
Wed = used 2
Fri = no remaining weekly entitlement
```

Define week boundaries using the organization timezone and a documented week convention.

Support restrictions such as:

```text
GROUP classes only

PRIVATE lessons only

specific class

specific sport
```

where useful without creating a generic rule engine.

### Acceptance Criteria

- [ ] Class attendance can consume membership class allowance.
- [ ] Class attendance can consume package credits.
- [ ] `N per week` benefits reset according to organization-local period boundaries.
- [ ] `N per month` benefits use membership/commercial periods consistently.
- [ ] A single attendance cannot consume twice.
- [ ] Class cancellation does not consume entitlement.
- [ ] Absence/no-show behavior is explicitly defined and tested.
- [ ] Private lesson credits cannot accidentally cover unrelated group classes when restricted.
- [ ] Existing class enrollment/capacity behavior remains unchanged.

---

## TASK-010 — Add Makeup Credits for Classes

### Goal

Support the common class business workflow where an excused or venue-caused missed class can create a replacement entitlement.

### Requirements

Introduce a specific makeup-credit mechanism rather than hiding these credits as arbitrary package edits.

A makeup credit should record:

```text
customerId
originClassId
originSessionId
reason
issuedAt
expiresAt?
status
```

Possible reasons:

```text
VENUE_CANCELLED
EXCUSED_ABSENCE
STAFF_GRANTED
OTHER
```

Makeup credits should ultimately participate in the same entitlement/credit engine.

Do not create an independent mutable `makeupCredits` counter.

Staff should be able to grant a makeup credit manually.

Where deterministic:

```text
venue cancels eligible session
-> optionally issue makeup credit
```

Do not introduce complex automatic class cancellation policies unless necessary.

Provide staff controls on enrollment/customer/class views.

Allow makeup credits to cover eligible future class attendance.

Use earliest-expiring entitlement selection where appropriate.

### Acceptance Criteria

- [ ] Makeup credits are ledger-backed.
- [ ] Makeup credits identify their origin.
- [ ] Staff can manually issue a makeup credit with reason.
- [ ] Makeup credits may expire.
- [ ] Makeup credits can be consumed by eligible class attendance.
- [ ] The same makeup credit cannot be consumed twice.
- [ ] Makeup history is visible to staff and customer.
- [ ] Makeup credit implementation does not duplicate the package ledger architecture.

---

## TASK-011 — Implement Fixed Recurring Court Commercial Agreements

### Goal

Represent customers who pay a recurring amount for a guaranteed recurring court slot as a proper commercial relationship.

### Requirements

Do not represent this only as a generic recurring reservation series.

Introduce `FixedCourtAgreement`.

At minimum record:

```text
agreementId
organizationId
customerId

courtId
weekday
startTime
durationMinutes
intervalWeeks

startDate
endDate?

monthlyPrice

status

reservationSeriesId?
membershipId?

createdAt
updatedAt
```

Status should support at least:

```text
ACTIVE
PAUSED
CANCELLED
EXPIRED
```

The agreement defines the commercial relationship.

The existing recurring reservation/schedule mechanism defines actual court occupancy.

Conceptually:

```text
FixedCourtAgreement
Every Wednesday 19:00–21:00
R$ 600/month
           |
           v
Recurring reservations
           |
           v
Shared schedule locks
```

Never create a separate commercial calendar.

Creating an agreement should preview schedule conflicts before committing.

Staff should choose how to handle conflicting occurrences using existing recurring-reservation semantics where possible.

Provide:

```text
create agreement
pause agreement
resume agreement
change future slot
cancel agreement
```

Historical reservations must not move when future contract terms change.

Changing court/time should apply from an effective date and create/update future occurrences only.

The agreement should generate recurring commercial charges based on its billing interval.

Do not create one separate customer charge for every occurrence when the business agreement is explicitly monthly.

The monthly agreement charge is authoritative for the commercial relationship.

Reservations covered by the agreement should not additionally generate ordinary reservation debt.

### Acceptance Criteria

- [ ] Staff can create a fixed recurring court agreement.
- [ ] Agreement uses the existing schedule/recurrence implementation for court occupancy.
- [ ] Schedule conflicts are detected before creation.
- [ ] Agreement price is represented separately from individual reservation price.
- [ ] Covered occurrences do not generate duplicate reservation debt.
- [ ] Agreement renewal/billing produces the expected recurring charge.
- [ ] Future slot changes do not rewrite historical reservations.
- [ ] Pausing/cancelling affects future behavior without deleting history.
- [ ] Agreement details show linked reservation occurrences.

---

## TASK-012 — Build a Unified Customer Commercial Balance

### Goal

Give staff a clear operational answer to what a customer owes, has paid, and has available without turning CourtOS into accounting software.

### Requirements

Create a customer balance service.

The customer financial summary should expose:

```text
Charges
Payments
Commercial credits
Outstanding
```

Clarify terminology.

`Credits` in the financial balance must not be confused with service credits such as:

```text
3 court hours remaining
```

Prefer separate labels in the UI:

```text
Financial

Charges
Payments
Outstanding

Entitlements

Court time
Class credits
Makeup credits
```

If true financial credit/overpayment exists, represent it explicitly.

Calculate financial outstanding from active charges and associated payments according to existing finance rules.

Do not count commercial entitlement consumption as payment.

Provide commercial summary:

```text
Memberships
Packages
Fixed court agreements
Available service credits
Upcoming renewals
Expiring benefits
```

Add this information to the staff customer profile.

Example:

```text
João

COMMERCIAL

Membership
Wednesday Fixed Court
ACTIVE
Renews Oct 1
R$ 600/month

Credits
Court time       120 min
Class credits    3

FINANCIAL

Active charges   R$ 800
Payments         R$ 600
Outstanding      R$ 200
```

### Acceptance Criteria

- [ ] Customer profile clearly separates money from service entitlements.
- [ ] Outstanding balance uses existing charge/payment records.
- [ ] Membership and package charges appear in the same financial summary as existing charges.
- [ ] Service-credit consumption is not treated as cash payment.
- [ ] Customer commercial summary includes active relationships.
- [ ] Staff can navigate from summary items to underlying records.
- [ ] Existing finance screens continue to work.

---

## TASK-013 — Build Staff Commercial Operations Screens

### Goal

Make Phase 3 usable in daily sports-center operations rather than exposing only APIs.

### Requirements

Introduce a coherent staff navigation area.

Suggested structure:

```text
Commercial
  Overview
  Plans
  Memberships
  Packages
  Fixed Slots
```

Do not scatter all commercial workflows across unrelated screens.

Commercial Overview should show actionable information such as:

```text
Active memberships
Renewals due
Overdue memberships
Memberships expiring soon
Packages expiring soon
Active fixed court agreements
Commercial outstanding amount
```

Provide filters for membership lists:

```text
status
plan
customer
renewal range
```

Provide filters for packages:

```text
status
definition
customer
expiration range
remaining balance
```

Membership detail should show:

- customer;
- plan;
- agreed price;
- lifecycle status;
- current period;
- next renewal;
- benefit allowance;
- benefit usage;
- charge/payment state;
- lifecycle actions;
- history.

Package detail should show:

- customer;
- source definition;
- issued date;
- expiration;
- price;
- issued quantity;
- consumed quantity;
- remaining;
- credit transaction history;
- charge/payment state.

Fixed agreement detail should show:

- customer;
- court;
- recurrence;
- monthly price;
- next occurrence;
- linked reservations;
- billing information;
- status.

Maintain current frontend constraints:

- vanilla TypeScript;
- existing styling system;
- no React/Vue/Svelte;
- responsive layout.

### Acceptance Criteria

- [ ] Staff can perform Phase 3 workflows through the UI.
- [ ] Owner can understand upcoming renewals from one screen.
- [ ] Expiring packages are discoverable without opening customers individually.
- [ ] Membership usage is readable at a glance.
- [ ] Fixed court agreements are manageable separately from generic recurring reservations.
- [ ] Screens remain responsive.
- [ ] Existing staff navigation remains coherent.

---

## TASK-014 — Expose Memberships and Credits in the Customer Portal

### Goal

Allow customers to understand what they have purchased, what remains, and when commercial relationships renew or expire.

### Requirements

Activate the Phase 2 portal architecture for:

```text
Memberships
Packages / Credits
```

Suggested routes:

```text
/portal/:slug/memberships
/portal/:slug/memberships/:id
/portal/:slug/credits
/portal/:slug/packages/:id
```

Customer endpoints must derive identity exclusively from the authenticated customer session.

A customer membership view should show:

```text
plan name
status
current period
next renewal
price
benefits
usage
remaining allowance
```

Example:

```text
8 Classes / Month

Current period
Sep 1 – Sep 30

Used
7 / 8

Next renewal
Oct 1
```

Package view should show:

```text
10 Court Hours

Issued
10h

Used
7h

Remaining
3h

Expires
Dec 10
```

Show ledger/history in customer-friendly language where useful.

Do not expose staff-only information such as:

- internal notes;
- adjustment actor IDs;
- internal cancellation reasoning not intended for customers;
- other customers;
- organization-wide commercial data.

Allow portal reservation/class views to show when an activity was paid/covered using an entitlement.

Example:

```text
Covered by:
10 Court Hours package

60 minutes used
```

Customers do not need self-service package purchasing or membership enrollment in this phase.

### Acceptance Criteria

- [ ] Customer can see their active memberships.
- [ ] Customer can see current membership usage.
- [ ] Customer can see package balances.
- [ ] Customer can see expiration dates.
- [ ] Customer can see relevant entitlement usage history.
- [ ] Customer cannot view another customer's commercial records.
- [ ] Customer cannot issue or adjust credits.
- [ ] Customer cannot change membership commercial terms.
- [ ] Portal remains mobile-first and consistent with Phase 2 UX.

---

## TASK-015 — Implement Expiration, Renewal-Due, and Overdue Evaluation

### Goal

Allow CourtOS to reliably identify commercial relationships that need staff attention.

### Requirements

Create reusable evaluation logic for:

```text
membership renewal due

membership overdue

membership expired

package expired

package expiring soon

membership expiring soon
```

Do not rely exclusively on scheduled background jobs.

Read-time/domain evaluation should remain correct even if no scheduler has run.

Where materialized status changes improve queries, provide an idempotent reconciliation command/script.

Define overdue explicitly.

Recommended initial definition:

```text
Membership is overdue when:

current renewal charge
has an outstanding amount

AND

its due/renewal date
has passed

AND

membership has not been cancelled/expired
```

Do not infer overdue merely from:

```text
nextRenewalDate < today
```

without considering the financial record.

Define configurable or query-time windows such as:

```text
expiring within 7 days
expiring within 30 days
```

Use organization timezone when evaluating dates.

Provide staff queries/endpoints for:

```text
renewals due
overdue memberships
packages expiring soon
memberships expiring soon
```

### Acceptance Criteria

- [ ] Membership overdue state is based on actual commercial/financial state.
- [ ] Expiration logic uses organization timezone.
- [ ] Package expiration prevents future consumption.
- [ ] Existing historical consumption remains visible after expiration.
- [ ] Staff can query upcoming renewals efficiently.
- [ ] Staff can query expiring packages efficiently.
- [ ] Reconciliation is idempotent.
- [ ] Correctness does not depend entirely on a background scheduler.

---

## TASK-016 — Add Commercial Activity Events for Future Customer Intelligence

### Goal

Make Phase 3 lifecycle information usable by Phase 4 without implementing retention features prematurely.

### Requirements

Extend the existing customer activity/history architecture with commercial events.

Support at least:

```text
MEMBERSHIP_STARTED
MEMBERSHIP_RENEWED
MEMBERSHIP_PAUSED
MEMBERSHIP_RESUMED
MEMBERSHIP_CANCELLED
MEMBERSHIP_EXPIRED

PACKAGE_ISSUED
PACKAGE_CONSUMED
PACKAGE_EXPIRED

CREDIT_ISSUED
CREDIT_CONSUMED
CREDIT_RESTORED

FIXED_AGREEMENT_STARTED
FIXED_AGREEMENT_CHANGED
FIXED_AGREEMENT_CANCELLED
```

Events should contain stable references to their source entities.

Do not copy sensitive internal details unnecessarily.

Avoid duplicate activity events when operations are retried.

Do not implement:

- lifecycle classification;
- churn scoring;
- at-risk detection;
- campaigns;
- follow-up tasks;

in this epic.

Those belong to Phase 4.

### Acceptance Criteria

- [ ] Commercial lifecycle events appear in customer history.
- [ ] Retried operations do not duplicate logical events.
- [ ] Events link to their commercial source.
- [ ] Phase 4 can later query membership/package lifecycle activity.
- [ ] No retention scoring is introduced prematurely.

---

## TASK-017 — Add Commercial Reporting

### Goal

Provide basic owner visibility into recurring commercial revenue and service-credit utilization.

### Requirements

Extend operational reporting with Phase 3 metrics.

At minimum support:

```text
active memberships

memberships by plan

new memberships

cancelled memberships

membership expected revenue

membership recorded payments

membership outstanding amount

packages issued

package sales value

package credits issued

package credits consumed

package credits expired

package utilization %

fixed court agreements

fixed court expected revenue
```

Keep reporting operational.

Do not add:

- accounting statements;
- tax reports;
- accrual accounting;
- balance sheets;
- complex revenue recognition;
- invoice issuance.

Clearly distinguish:

```text
expected / charged revenue

recorded payments
```

Do not label charges as cash revenue.

Allow date-range filtering where meaningful.

Use organization timezone for reporting boundaries.

Package utilization should use service quantities, not financial price.

Example:

```text
600 court minutes issued
420 consumed

Utilization = 70%
```

Do not mix incompatible benefit units into one meaningless utilization number.

Report separately by benefit/unit when required.

### Acceptance Criteria

- [ ] Owner can see active membership count.
- [ ] Owner can see expected membership charges separately from payments.
- [ ] Owner can see outstanding commercial balances.
- [ ] Package utilization is measurable.
- [ ] Different entitlement units are not incorrectly aggregated.
- [ ] Fixed court commercial value is reportable.
- [ ] Reports use organization-local date boundaries.
- [ ] Reporting does not evolve CourtOS into accounting software.

---

## TASK-018 — Harden Permissions, Concurrency, and Commercial Invariants

### Goal

Ensure Phase 3 cannot produce incorrect balances, duplicated credits, cross-customer access, or inconsistent commercial records.

### Requirements

Perform a dedicated Phase 3 correctness/security pass.

Verify staff permissions.

Recommended baseline:

```text
OWNER
- full commercial configuration
- plan/package definition management
- price changes
- manual adjustments
- reporting

STAFF
- create memberships
- issue packages
- record renewals
- manage fixed agreements
- operational credit actions

COACH
- view class-related entitlement state where required
- record attendance
- must not alter prices or general commercial contracts
```

Use existing authorization conventions.

Test organization isolation for every new repository/service/API.

Test customer isolation for portal endpoints.

Protect manual credit adjustments with:

- authenticated staff actor;
- reason;
- immutable transaction record.

Validate cross-entity ownership.

Example:

```text
membership.organizationId
must match
customer.organizationId
and
plan.organizationId
```

Perform concurrency tests for:

```text
two reservations consuming final package credit

two class check-ins consuming final class credit

duplicate membership renewal

duplicate package issuance retry

duplicate cancellation restoration
```

Ensure cancellation/restoration cannot create more credits than originally consumed.

Add invariant checks around negative balances.

### Acceptance Criteria

- [ ] Cross-organization commercial references are impossible.
- [ ] Customers cannot access another customer's commercial records.
- [ ] Coaches cannot change commercial prices or contracts.
- [ ] Manual adjustments have actor and reason.
- [ ] Concurrent usage cannot overspend entitlement.
- [ ] Duplicate retries are idempotent.
- [ ] Restored quantity cannot exceed consumed quantity.
- [ ] Finite credit balance cannot become negative.
- [ ] Existing Phase 0–2 authorization tests continue passing.

---

## TASK-019 — Add End-to-End Phase 3 Workflows

### Goal

Verify that Phase 3 works as complete sports-center workflows rather than isolated services.

### Requirements

Add API integration and Playwright coverage for the major scenarios.

At minimum cover:

### Scenario A — Monthly class membership

```text
Staff creates:
8 Classes / Month
R$ 280

Staff assigns plan to Carlos.

Carlos attends:
7 classes.

Customer portal shows:
7 / 8 used.

Carlos attends eighth:
8 / 8 used.

A ninth covered attendance:
must not silently consume unavailable credit.

Renew membership.

New period:
0 / 8 used.

Previous period:
8 / 8 retained historically.
```

### Scenario B — Court-hour package

```text
Staff sells Maria:
10 court hours.

Maria books:
2 hours.

Remaining:
8 hours.

Maria books:
1 hour.

Remaining:
7 hours.

Eligible reservation cancellation:
restores 1 hour.

Remaining:
8 hours.
```

### Scenario C — Partial coverage

```text
Package remaining:
60 minutes.

Reservation:
120 minutes.

Result:
60 minutes consumed.
Remaining package: 0.
Remaining 60 minutes creates direct charge.
```

### Scenario D — Fixed recurring customer

```text
João agreement:

Every Wednesday
19:00–21:00
Court 2

R$ 600/month.

CourtOS creates linked recurring reservation occurrences.

Monthly commercial charge:
R$ 600.

Individual covered occurrences:
no duplicate reservation charges.
```

### Scenario E — External payment

```text
Membership renewal charge:
R$ 280.

Staff records:
PIX R$ 280.

Customer balance:
R$ 0 outstanding.

Membership:
commercial relationship remains linked to charge/payment history.
```

### Scenario F — Expiration

```text
Package:
expires Sep 30.

Sep 29:
credit usable.

Oct 1:
unused amount shown as expired.
Cannot cover new activity.

Historical transactions:
still visible.
```

Run existing Phase 0–2 E2E suites as regression coverage.

### Acceptance Criteria

- [ ] All major Phase 3 workflows have integration coverage.
- [ ] Critical customer-facing paths have Playwright coverage.
- [ ] Commercial consumption produces correct financial outcomes.
- [ ] Cancellation restoration works end-to-end.
- [ ] Membership renewal period reset works end-to-end.
- [ ] Fixed agreement billing does not duplicate reservation charges.
- [ ] Expired credits cannot be consumed.
- [ ] Existing booking/class/customer E2E behavior remains functional.

---

## TASK-020 — Update Documentation, Migration Guide, and Phase 3 Operational Smoke Test

### Goal

Finish Phase 3 with enough documentation that its commercial model can be safely maintained and extended by later agents.

### Requirements

Update:

```text
README.md
AGENTS.md
docs/architecture.md
docs/dynamodb-model.md
docs/backlog.md
```

where appropriate.

Create dedicated documentation such as:

```text
docs/commercial-model.md
```

Document the difference between:

```text
Plan
Membership
Membership Period

Package Definition
Customer Package

Entitlement
Credit Transaction
Entitlement Allocation

Fixed Court Agreement

Charge
Payment
```

Document the key rule:

```text
A service entitlement is not a payment.
```

Document entitlement selection order.

Document credit restoration policy.

Document membership-period boundaries.

Document package expiration behavior.

Document fixed-court agreement versus reservation recurrence.

Document manual renewal workflow.

Document how Phase 3 prepares data for Phase 4.

Create or update production smoke-test instructions covering:

```text
create plan
assign membership
renew membership
record payment
create package
consume credit
restore credit
expire package
create fixed court agreement
verify customer portal
verify customer balance
```

Verify migration from an existing Phase 2 dataset.

### Acceptance Criteria

- [ ] Commercial-domain architecture is documented.
- [ ] Future Codex agents can distinguish entitlement from payment.
- [ ] DynamoDB patterns match actual implementation.
- [ ] Migration instructions exist.
- [ ] Production smoke test covers critical Phase 3 workflows.
- [ ] Existing Phase 2 data migrates without artificial commercial records.
- [ ] `AGENTS.md` contains relevant Phase 3 invariants.
- [ ] Full repository test/typecheck/lint/build suites pass.

---

# Phase 3 Completion Validation

Phase 3 must not be considered complete merely because all tasks have been implemented.

Validate the roadmap's practical gate directly:

> **Can CourtOS represent how regular customers actually pay and consume services?**

The answer should be convincingly **yes** for all of the following.

## Membership customer

```text
Carlos
8 classes/month
R$ 280

CourtOS knows:

- his plan;
- his agreed price;
- current membership period;
- renewal date;
- payment state;
- 7 / 8 classes used;
- which seven attendances consumed the allowance;
- whether he has remaining entitlement.
```

## Package customer

```text
Maria
10 court hours
90-day validity

CourtOS knows:

- when the package was issued;
- its price;
- original 600 minutes;
- each consumption;
- each restoration;
- current remaining minutes;
- expiration date;
- whether expired credits remain.
```

## Fixed recurring customer

```text
João
Court 2
Wednesday
19:00–21:00
R$ 600/month

CourtOS knows:

- this is a commercial agreement;
- its price;
- its lifecycle;
- its billing periods;
- its recurring reservations;
- its payments;
- its outstanding amount;
- future occurrences;
- historical occurrences.
```

## Class customer

```text
Ana
2 classes/week

CourtOS knows:

- which weekly period applies;
- how many attendances were used;
- what remains;
- whether a future attendance is entitled;
- whether a makeup credit exists;
- which commercial source covered each attendance.
```

## Financial relationship

For any regular customer, staff can answer:

```text
What have we charged?

What have they paid?

What do they still owe?

Which services are prepaid?

Which credits remain?

When do those credits expire?

When does their membership renew?
```

without consulting:

- WhatsApp history;
- spreadsheets;
- paper notes;
- a separate membership application.

---

# Out of Scope for Phase 3

Do not expand this epic into later roadmap phases.

Explicitly exclude:

```text
automatic credit-card billing
payment gateway integration
PIX checkout
automatic bank reconciliation

WhatsApp automation
email automation
push notifications

customer churn prediction
at-risk scoring
retention dashboard
follow-up tasks
customer segmentation
campaigns

open games
community groups
events
rankings
referrals
loyalty points

access-control hardware
QR door access
Wellhub integration
generic external API/webhooks
```

Phase 3 should establish the commercial facts those later systems will consume.

---

# Architectural Invariants After Phase 3

The following must remain true.

```text
Court schedule
=
one authoritative schedule
```

```text
Reservation recurrence
!=
fixed commercial agreement

but a fixed commercial agreement
uses reservation recurrence for occupancy.
```

```text
Class attendance
=
authoritative record of class service usage.
```

```text
Plan
!=
Membership
```

```text
Package Definition
!=
Customer Package
```

```text
Entitlement
!=
Payment
```

```text
Service credit
!=
financial credit
```

```text
Credit remaining
=
ledger-derived state,
not an unexplained mutable number.
```

```text
Commercial consumption
=
idempotent + auditable.
```

```text
Customer outstanding balance
=
financial charges minus applicable recorded payments,
not package consumption.
```

```text
Historical agreements
must survive future plan/configuration changes.
```

```text
Payment processing
remains external.
```

```text
CourtOS
remains sports-center operational software,
not an accounting ERP.
```

---

# Definition of Done

Phase 3 is done when a sports center can use CourtOS as the authoritative operational record for its recurring commercial customers and confidently stop maintaining separate spreadsheets for:

```text
memberships
monthly class plans
class allowances
court-hour packages
private-lesson packages
makeup credits
fixed recurring court customers
renewal dates
package expiration
remaining credits
commercial outstanding balances
```

At that point CourtOS has moved from:

```text
"What did this customer book?"
```

to:

```text
"What commercial relationship do we have with this customer,
what are they entitled to use,
what have they already consumed,
and what do they currently owe?"
```

That is the required foundation for Phase 4 — Customer Intelligence & Retention.
