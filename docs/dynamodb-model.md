# DynamoDB model

The table uses `PK` and `SK` with on-demand billing. Organization-owned entities are stored under `ORG#<id>` and global entities use `RESERVATION#`, `REQUEST#`, `PAYMENT#`, `EXPENSE#`, `CLASS#`, `BLOCK#`, or `SESSION#` partitions. Schedule locks use `SCHEDULE#<org>#<court>#<YYYY-MM-DD>` and `LOCK#HH:mm` sort keys.

Sessions store only `sha256(token)` and an `expiresAt` TTL. Records retain audit fields and are archived rather than removed when history matters. Local scans are intentionally bounded at the service boundary for the MVP; operational lists should move to purpose-built indexes once volume warrants it.

## Phase 1 records

Phase 1 adds `CLASS_SESSION#<id>` and `CHARGE#<id>` records plus lifecycle audit fields. Class sessions use deterministic `<classId>-<YYYY-MM-DD>` identifiers. Charges use deterministic reservation or class-session identities so retries are safe. Legacy `CONFIRMED` reservations are normalized to `BOOKED` by `migrate:phase1`; reads tolerate the legacy value during rollout.

## Phase 2 records and access patterns

Rebooking creates no draft record. The customer rebooking endpoint reads the owned historical reservation, calculates the next venue-local weekday candidate within the current booking window, and queries existing court availability. Final submission uses existing customer reservation/request path, so normal reservation, charge, activity, customer-index, and schedule-lock records remain authoritative.

`Organization` records gain `bookingPolicy`. Existing records without this field use the same defaults as `DEFAULT_BOOKING_POLICY` and are backfilled by `migrate:phase2`:

```text
reservationMode: REQUEST_APPROVAL
bookAheadDays: 30
cancellationCutoffHours: 6
minimumReservationMinutes: 60
maximumReservationMinutes: 120
maximumActiveBookings: 3
```

Customer auth is separate from staff auth. `CustomerAccount` is stored at `ORG#<orgId> / CUSTOMER_ACCOUNT#<accountId>` and references existing `Customer` history. Staff `User` records are never reused. Registration atomically writes `CUSTOMER_ACCOUNT_EMAIL#<orgId>#<normalizedEmail> / META` and `CUSTOMER_IDENTITY_PHONE#<orgId>#<normalizedPhone> / META` identity lookups. Customer logins create `CUSTOMER_SESSION#<sha256(token)> / META` records containing tenant, account, customer, and `expiresAt`; DynamoDB TTL removes them eventually, but authentication rejects expired records immediately. Manual activation/reset records use `ORG#<orgId> / CUSTOMER_ACCOUNT_TOKEN#<sha256(token)>`; they retain only hash, scope, type, and `expiresAt`, and are transactionally deleted when password is set. Expired tokens are rejected before TTL removal.

Auth item/access patterns:

| Item/access pattern        | Key                                                        | Purpose                                                      |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| Customer account           | `ORG#<orgId> / CUSTOMER_ACCOUNT#<accountId>`               | Credential status and reference to existing customer         |
| Account by email           | `CUSTOMER_ACCOUNT_EMAIL#<orgId>#<normalizedEmail> / META`  | Venue-scoped login lookup and email uniqueness               |
| Customer identity by phone | `CUSTOMER_IDENTITY_PHONE#<orgId>#<normalizedPhone> / META` | Registration and participant identity-conflict lookup        |
| Account by customer        | `ORG#<orgId> / CUSTOMER_ACCOUNT_CUSTOMER#<customerId>`     | Account-to-customer lookup record when materialized          |
| Customer session           | `CUSTOMER_SESSION#<sha256(token)> / META`                  | Tenant/account/customer session context; TTL is cleanup only |
| Activation/reset token     | `ORG#<orgId> / CUSTOMER_ACCOUNT_TOKEN#<sha256(token)>`     | Single-use scoped token; raw token is never persisted        |

Registration writes customer, account, and uniqueness lookups transactionally.
Existing-customer activation may create the account first, then writes one
single-use token. Password set transactions update the account and delete the
token. No email delivery record or background job is created.

Customer cancellation atomically replaces reservation source and customer index records, writes reservation history, voids an active reservation charge, and deletes shared schedule locks. Customer-originated cancellation records use `cancellationActor: CUSTOMER` plus `cancelledByCustomerAccountId`; staff `cancelledBy` remains staff-user audit data. Customer approval requests are retained with `WITHDRAWN` status and customer-account withdrawal audit fields.

Customer-facing access records use queryable customer partitions; no customer list operation should scan the table:

| Access pattern                    | Key pattern                                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Customer upcoming reservations    | `CUSTOMER#<orgId>#<customerId> / RESERVATION#<startAt>#<reservationId>`; query by sort-key time range             |
| Customer reservation history      | `CUSTOMER#<orgId>#<customerId> / RESERVATION_HISTORY#<updatedAt>#<reservationId>`; bounded cursor pagination      |
| Customer pending booking requests | `CUSTOMER#<orgId>#<customerId> / RESERVATION_REQUEST#<createdAt>#<requestId>`                                     |
| Customer reservation payments     | `CUSTOMER_PAYMENT#<orgId>#<customerId>#<reservationId> / PAYMENT#<paidAt>#<paymentId>`                            |
| Customer sport preferences        | `CUSTOMER#<orgId>#<customerId> / SPORT_PREFERENCES`; `SPORT_PREFERENCE#<orgId>#<sportId> / CUSTOMER#<customerId>` |
| Reservation participants          | `RESERVATION#<reservationId> / PARTICIPANT#<participantId>`                                                       |
| Customer active waitlists         | `CUSTOMER#<orgId>#<customerId> / WAITLIST#ACTIVE#<joinedAt>#<waitlistId>`                                         |
| Customer waitlist duplicate guard | `CUSTOMER#<orgId>#<customerId> / WAITLIST#ACTIVE_KEY#<waitlistIdentity>`                                          |
| Court/time waitlists              | `WAITLIST#<orgId>#COURT#<courtId>#<date>#<startTime> / ENTRY#<joinedAt>#<waitlistId>`                             |
| Class waitlists                   | `WAITLIST#<orgId>#CLASS#<classId> / ENTRY#<joinedAt>#<waitlistId>`                                                |
| Staff waitlists                   | `WAITLIST#<orgId>#ALL / ENTRY#<joinedAt>#<waitlistId>`                                                            |
| Customer activity                 | `CUSTOMER#<orgId>#<customerId> / ACTIVITY#<startAt>#<type>#<activityId>`                                          |
| Class catalog                     | `ORG#<orgId>#CLASSES / CLASS#<classId>`                                                                           |
| Customer class enrollment         | `ORG#<orgId>#CLASS#<classId> / CUSTOMER#<customerId>`                                                             |

Each waitlist also has a durable `WAITLIST#<waitlistId> / META` source record. Historical records are retained; active customer indexes are updated transactionally with status changes. Reservation activity records and reservation lookup records are written with the same schedule-lock transaction as their source reservation. Terminal reservation transitions write durable history lookup records, so `GET /customer/reservations/history` remains bounded and paginated. Customer-originated approval requests materialize a request lookup record; `GET /customer/reservations/upcoming` returns them separately from confirmed reservations. Active enrollments materialize future class-session records in that customer partition. `GET /customer/activities` queries a bounded ISO timestamp range in this partition and returns a cursor for further pages, never an organization-wide activity scan. The key builders live in `apps/api/src/persistence/phase2-keys.ts`.

Customer waitlist creation writes source, customer-active, resource, and
organization staff, and per-customer duplicate-guard records in one transaction.
The Phase 2 migration backfills the organization staff index for existing
waitlists. Leaving, expiring, or fulfilling a waitlist marks its source and
staff/resource records with the terminal status, removes active customer access
and duplicate guard, and never deletes history. Staff listing queries the
organization staff partition and batch-resolves customers, courts, and classes.
Court fulfillment writes the reservation, charge, activity, waitlist terminal
state, and active-index cleanup in the same schedule-lock transaction. Class
fulfillment passes equivalent waitlist writes into the shared class enrollment
transaction, so capacity races cannot create an unlinked fulfillment. No
notification or messaging is sent.

`GET /customer/waitlists` uses the customer partition query. No reservation or
enrollment is created merely when a slot or capacity opens.

Phase 2 migration is additive and idempotent. Run production backfill with `corepack pnpm migrate:phase2`. It preserves organizations, customers, staff users, staff sessions, reservations, and anonymous public request records.

## Reservation participants (TASK-011)

Durable participant items use `PK=RESERVATION#<reservationId>` and `SK=PARTICIPANT#<participantId>`. They are separate from reservation META and schedule locks. Each item stores `participantId`, `organizationId`, `reservationId`, submitted `name`, optional `email`/`phone`, optional internal `customerId`, `createdByActorType=CUSTOMER`, timestamps, `status=ACTIVE|REMOVED`, and an optimistic `revision`. Removal adds `removedAt`; no TTL or physical deletion. Completion/cancellation never changes participant records. Existing reservations require no migration and initially have no participants.

Owner-authorized reads query at most 51 items for a 50-item page, ordered by participant ID, including removed records. Cursor is the last participant ID. Ownership is checked against reservation META on every request. Writes use a two-action transaction: parent organization/customer/BOOKED/startAt condition check plus participant put with creation or revision condition. Concurrent lifecycle/ownership changes reject stale writes. The owner remains implicit in reservation.customerId.

Optional internal linking uses existing tenant-specific `CUSTOMER_ACCOUNT_EMAIL` and `CUSTOMER_IDENTITY_PHONE` exact-contact lookups, followed by a batch read of at most two current customers. Stale, absent, ambiguous, archived, owner-self, or foreign matches remain unresolved. Customers without these existing lookup records can remain unresolved; no directory scan or new index is introduced. Submitted contact values remain the public source of truth; linked customer fields and match status are never returned. No SAM changes required.

## Phase 3 commercial records and access patterns

Phase 3 keeps the single `PK/SK` table and uses materialized access records
instead of organization-wide scans or a second availability model. Source
records are addressed by their stable IDs. Index records copy the fields needed
by list screens, so normal list requests do not perform an N+1 batch of source
reads. A source update replaces its old index keys and its new index keys in
one transaction.

The source/index split is intentional:

| Source entity          | Stable source key                              | Important durable facts                                                             |
| ---------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| Plan                   | `PLAN#<planId> / META`                         | reusable offering, price, billing interval, structured benefits                     |
| Membership             | `MEMBERSHIP#<membershipId> / META`             | customer relationship, lifecycle, plan/price/benefit snapshots                      |
| Membership period      | `MEMBERSHIP_PERIOD#<periodId> / META`          | inclusive venue-local dates, period status, price snapshot, period charge           |
| Package definition     | `PACKAGE_DEFINITION#<definitionId> / META`     | reusable prepaid offering and validity                                              |
| Customer package       | `CUSTOMER_PACKAGE#<packageId> / META`          | customer-specific definition snapshot, issue/start/expiry, package charge           |
| Credit transaction     | `CREDIT_TRANSACTION#<transactionId> / META`    | append-only signed `ISSUED`, `CONSUMED`, `RESTORED`, `EXPIRED`, or `ADJUSTED` delta |
| Entitlement allocation | `ENTITLEMENT_ALLOCATION#<allocationId> / META` | auditable service coverage and activity relationship                                |
| Fixed-court agreement  | `FIXED_COURT_AGREEMENT#<agreementId> / META`   | recurring commercial terms and lifecycle                                            |
| Fixed-court occurrence | `FIXED_COURT_OCCURRENCE#<occurrenceId> / META` | dated agreement occurrence and linked reservation                                   |

`CreditBalance` items are materialized conditional-update state, not the
authority for history. The ledger and allocation records are retained even
when a package, membership, or agreement becomes inactive. A service
entitlement/allocation is never a payment. Charges and payments remain the
financial records used for customer outstanding balance.

The key builders and repository façade live in
`apps/api/src/persistence/phase3-keys.ts` and
`apps/api/src/persistence/phase3-repository.ts`.

| Access pattern                                | Key                                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Plan by ID                                    | `PLAN#<planId> / META`                                                                        |
| Plans by organization                         | `ORG#<orgId>#COMMERCIAL / PLAN#<createdAt>#<planId>`                                          |
| Active plans by organization                  | same partition, `PLAN_STATUS#ACTIVE#<createdAt>#<planId>`                                     |
| Plans by status                               | same partition, `PLAN_STATUS#<status>#<createdAt>#<planId>`                                   |
| Membership by ID                              | `MEMBERSHIP#<membershipId> / META`                                                            |
| Memberships by customer                       | `CUSTOMER#<orgId>#<customerId> / MEMBERSHIP#<startDate>#<membershipId>`                       |
| Active membership by customer                 | same partition, `MEMBERSHIP_ACTIVE#<startDate>#<membershipId>`                                |
| Memberships by plan                           | `PLAN#<planId> / MEMBERSHIP#<startDate>#<membershipId>`                                       |
| Memberships by organization                   | `ORG#<orgId>#MEMBERSHIPS / MEMBERSHIP#<startDate>#<membershipId>`                             |
| Memberships by status                         | same partition, `MEMBERSHIP_STATUS#<status>#<startDate>#<membershipId>`                       |
| Memberships renewing in a date range          | same partition, `MEMBERSHIP_RENEWAL#<nextRenewalDate>#<membershipId>` with a sort-key range   |
| Memberships expiring in a date range          | same partition, `MEMBERSHIP_EXPIRY#<currentPeriodEnd>#<membershipId>` with a sort-key range   |
| Membership period by ID                       | `MEMBERSHIP_PERIOD#<periodId> / META`                                                         |
| Membership periods by membership              | `MEMBERSHIP#<membershipId> / PERIOD#<periodId>`                                               |
| Package definition by ID                      | `PACKAGE_DEFINITION#<definitionId> / META`                                                    |
| Package definitions by organization           | `ORG#<orgId>#COMMERCIAL / PACKAGE_DEFINITION#<createdAt>#<definitionId>`                      |
| Active package definitions by organization    | same partition, `PACKAGE_DEFINITION_STATUS#ACTIVE#<createdAt>#<definitionId>`                 |
| Customer package by ID                        | `CUSTOMER_PACKAGE#<customerPackageId> / META`                                                 |
| Packages by customer                          | `CUSTOMER#<orgId>#<customerId> / PACKAGE#<startsAt>#<customerPackageId>`                      |
| Active packages by customer                   | same partition, `PACKAGE_ACTIVE#<startsAt>#<customerPackageId>`                               |
| Packages expiring in a date range             | `ORG#<orgId>#PACKAGES / PACKAGE_EXPIRY#<expiresAt>#<customerPackageId>` with a sort-key range |
| Credit transactions by package                | `PACKAGE#<customerPackageId> / CREDIT#<occurredAt>#<transactionId>`                           |
| Credit transactions by membership period      | `MEMBERSHIP_PERIOD#<periodId> / CREDIT#<occurredAt>#<transactionId>`                          |
| Credit balance by source/benefit              | `ENTITLEMENT_BALANCE#<sourceType>#<sourceId>#<periodId> / BENEFIT#<benefitId>`                |
| Customer credit balances                      | `CUSTOMER#<orgId>#<customerId> / CREDIT_BALANCE#<sourceType>#...`                             |
| Allocation by source                          | `<sourceType>#<sourceId> / ALLOCATION#<createdAt>#<allocationId>`                             |
| Usage allocation by reservation               | `USAGE#<orgId>#RESERVATION#<reservationId> / ALLOCATION#...`                                  |
| Usage allocation by class attendance/session  | `USAGE#<orgId>#CLASS_ATTENDANCE#<attendanceOrSessionId> / ALLOCATION#...`                     |
| Fixed court agreement by customer             | `CUSTOMER#<orgId>#<customerId> / FIXED_AGREEMENT#<startDate>#<agreementId>`                   |
| Fixed court agreement by organization         | `ORG#<orgId>#FIXED_AGREEMENTS / AGREEMENT#<startDate>#<agreementId>`                          |
| Active fixed court agreements by organization | `ORG#<orgId>#FIXED_AGREEMENTS / ACTIVE#<startDate>#<agreementId>`                             |
| Fixed court occurrences by agreement          | `FIXED_COURT_AGREEMENT#<agreementId> / OCCURRENCE#<date>#<occurrenceId>`                      |
| Customer commercial history                   | `CUSTOMER#<orgId>#<customerId> / COMMERCIAL#<occurredAt>#<type>#<id>`                         |
| Makeup credits by customer                    | `CUSTOMER#<orgId>#<customerId> / MAKEUP_CREDIT#<issuedAt>#<creditId>`                         |
| Active makeup credits by customer             | same partition, `MAKEUP_CREDIT_ACTIVE#<issuedAt>#<creditId>`                                  |
| Makeup credits by origin session              | `ORG#<orgId>#CLASS_SESSION#<sessionId> / MAKEUP_CREDIT#<issuedAt>#<creditId>`                 |
| Charges by customer                           | `CUSTOMER#<orgId>#<customerId> / CHARGE#<serviceAt>#<chargeId>`                               |
| Payments by customer                          | `CUSTOMER#<orgId>#<customerId> / PAYMENT#<paidAt>#<paymentId>`                                |

The staff customer commercial summary reads memberships, packages, fixed
court agreements, credit balances, customer charges, customer payments, and
active entitlement allocations from these customer-scoped query records. An
allocation is also written to customer commercial history so covered service
value can be reported without treating it as a payment. Reservation and class
charge writes maintain the customer charge index; payment writes maintain the
customer payment index. Existing Phase 2 records should be backfilled with the
Phase 3 migration before relying on the summary for historical data.

Customer portal commercial reads use the same bounded customer partition:
`GET /customer/memberships` and `GET /customer/credits` query the membership,
package, and credit-balance access records for the authenticated customer.
Detail reads query the selected membership/package source and its credit
ledger, then verify the source organization and customer before returning a
customer-safe projection. No customer write path exists for issuing,
adjusting, restoring, or changing commercial terms.

All list methods use bounded queries (100 records by default) and accept a
limit. Organization and customer IDs are part of every access partition, and
ID reads verify the organization on the source record. Existing reservation
payment indexes remain intact; the Phase 3 financial indexes are additive.

Membership source records are written at `MEMBERSHIP#<id> / META` and period
source records at `MEMBERSHIP_PERIOD#<periodId> / META`; period access records
are also stored under the membership partition. Lifecycle writes preserve prior
period records. Price and benefit snapshots live on the membership and each
period, while plan definitions remain reusable offerings. Each period stores its
deterministic `chargeId` and has one `CHARGE#membership-<periodId> / META`
record with `sourceType: MEMBERSHIP`, `sourceId` equal to the period ID, and a
customer charge index. Retrying charge creation is safe because the period ID
is the idempotency identity; payments continue to reference that charge.

Customer packages snapshot the definition name, price, currency, benefits,
issue/start timestamps, and expiry. Package issuance writes the customer
package and its operational charge transactionally. Package charges use
`sourceType: PACKAGE`, with `sourceId` and `packageId` equal to the customer
package ID. Benefits create an append-only `ISSUED` credit transaction and a
materialized balance; the ledger remains authoritative for finite and
unlimited usage. Staff-created recovery or promotional credits use
`sourceType: MANUAL` and retain the actor and reason on the ledger transaction.

Makeup credits use a dedicated `MAKEUP_CREDIT#<id> / META` source record and
`sourceType: MAKEUP` ledger records. The source snapshots the origin class and
session, reason, issue/expiry timestamps, and status. Its customer and origin
indexes are written transactionally with lifecycle updates. The corresponding
`CLASS_ATTENDANCE` consumption uses the same usage guard, allocation, and
conditional credit-balance update as membership and package entitlements.

Fixed court agreements are the commercial source for guaranteed recurring
court slots. Their reservations still use the shared schedule locks and are
linked through the agreement's `reservationSeriesId`, plus each reservation's
`seriesId`, `fixedCourtAgreementId`, and `fixedCourtOccurrenceId`. The
agreement creates one idempotent `FIXED_COURT_AGREEMENT` charge per billing
period; covered reservations retain their service value for history but do
not create ordinary reservation charges.

## Commercial customer activity events (TASK-016)

Commercial lifecycle facts are stored as append-oriented customer activity
events. The source event is written at
`CUSTOMER_ACTIVITY_EVENT#<eventId> / META`; its customer history index is
written transactionally under
`CUSTOMER#<organizationId>#<customerId> /
ACTIVITY#<occurredAt>#COMMERCIAL#<eventType>#<eventId>`. Events retain only
the tenant/customer, event type, source type and source ID, occurrence time,
and creation time. The deterministic event ID is derived from the logical
source and optional operation key, so retries are safe and do not create
duplicate history rows. The existing customer activity query includes these
indexed rows, while `listCustomerActivityEvents` provides a bounded,
source-oriented Phase 4 query without adding lifecycle classification or
retention behavior.

### Atomic credit consumption

`CreditBalance` is a materialized balance used only to make ledger updates
conditional; append-only `CreditTransaction` records remain the authoritative
ledger. Issuance, restoration, expiration, and manual adjustment append a
transaction and update the balance together. A consumption transaction also
writes the logical usage guard, allocation source and activity index,
consumption transaction and indexes, and the balance together. The balance
write is conditional on the previous quantities, preventing concurrent
overspending.

The guard is keyed by organization, activity type/id, source, membership
period, and benefit. A retry that encounters the guard returns the original
allocation, even if the retry supplied a different allocation ID. Unlimited
benefits still write usage and credit history; their materialized balance
reports usage while remaining explicitly non-finite.

Reservation allocations use the `USAGE#<orgId>#RESERVATION#<reservationId>`
partition and are read for reservation detail and customer activity summaries.
Reservation creation first writes the normal schedule, reservation, and direct
charge records, then consumes eligible credits. The direct charge is
subsequently reduced to the uncovered service value; it is not replaced by a
payment. `serviceAmount` preserves the original reservation value for
historical allocation calculations. Cancellation restoration is keyed by the
reservation ID, making repeated cancellation/retry handling idempotent; no-show
does not restore the allocation.

### Phase 3 migration

`corepack pnpm migrate:phase3` is an additive, idempotent backfill. It creates
missing Phase 3 query indexes for any already-present Phase 3 source records
and creates customer charge/payment indexes for existing financial records. It
does not create memberships, packages, balances, or usage for Phase 0-2
records, and it never deletes historical data. Run it after deployment with
the deployed table configuration; take a DynamoDB backup before production
backfills.

The migration uses a deliberate full-table scan because it is an offline
backfill over unknown legacy item shapes; normal commercial list and detail
requests use the query-shaped access records in the table above. Run it with
production writes paused if the deployment procedure requires a stable
backfill window, then run it a second time. The second run should report zero
new indexes. Existing Phase 2 customers and activities remain unchanged and
do not receive artificial plans, memberships, packages, balances, or usage.

Lifecycle materialization is separate from the index migration. Run
`corepack pnpm reconcile:commercial` to evaluate and materialize expired
memberships/packages and their remaining credit expiry transactions. The
command is safe to retry; read-time evaluators remain authoritative if it has
not been run.

## Customer class discovery (TASK-012)

Class primary records remain `CLASS#<classId> / META`. They now contain
`enrolledCount` and the bounded materialized `sessionIds` list. Session primary
records remain authoritative for current session status. The customer catalog
uses `ORG#<organizationId>#CLASSES / CLASS#<classId>` references (20 per page);
batch reads resolve active classes and display names without disclosing staff
records. Related keys are deduplicated and batches contain at most 100 keys.

`ORG#<organizationId>#CLASS#<classId> / CUSTOMER#<customerId>` points to the
customer's latest enrollment and status. Original `ENROLLMENT#<id> / META`
records remain durable, including cancelled enrollments. Enrollment and
cancellation update the primary class counter, enrollment, and customer pointer
transactionally. Conditional counter and pointer checks prevent over-capacity
and duplicate concurrent enrollment. These records have no TTL.

Enrollment uses the same charge identity (`class-<sessionId>-<customerId>`) for
staff and customers. Re-enrollment reactivates voided future charges. Requests
read known session/charge/activity keys in batches, never scan. Class session
work is capped at 500 references. Common enrollments commit charges and
activities in the enrollment transaction. Larger sets use guarded transactions
of at most 93 actions; a durable `materializing` pointer flag allows a retry to
finish effects after interruption. Cancellation retains history and voids future
charges; retried cancellation completes outstanding effects. Future activity
records become cancelled as well. Schedule locks remain on class sessions and
are not changed by individual enrollment.

Before enabling these endpoints for existing data, pause class/enrollment writes
and run `corepack pnpm migrate:class-discovery`. The offline migration scans
existing classes, sessions and enrollment history to rebuild references,
counters and current customer pointers. It is idempotent; rerun under the same
write pause if interrupted. Resume writes only after success. No new index, IAM
permission, environment variable, or SAM resource is required.

## Class entitlement consumption (TASK-009)

Class attendance consumption uses the existing `CREDIT_TRANSACTION` and
`ENTITLEMENT_ALLOCATION` records. Periodic membership benefits add an optional
`benefitPeriodKey` to source, allocation, transaction, and balance records; the
key is part of the usage guard and balance key. Existing records without a
window key retain their legacy key shape. Weekly keys are venue-local ISO weeks
(Monday start), and monthly keys are venue-local calendar months. A missing
period balance is issued lazily for the eligible membership window, then
consumed by the same atomic transaction used by reservation entitlements.

Attendance is consumed once at `CHECKED_IN`; completion is not a second usage
event. No-show and cancelled-session paths do not write entitlement usage.

## Staff commercial operations (TASK-013)

Staff package lists use the organization package partition
`ORG#<organizationId>#PACKAGES / PACKAGE#<startsAt>#<customerPackageId>`.
The source package, customer index, expiration index, and commercial history
record are kept in sync transactionally. The Phase 3 migration backfills this
organization index for existing customer package records.

The staff `GET /customer-packages` endpoint queries that bounded organization
index and supports status, definition, customer, expiration, and remaining
balance filters. Credit balances are queried from the package entitlement
partition, while `GET /customer-packages/:id/transactions` exposes the durable
credit history used by the package detail screen. These records remain tenant
scoped through the authenticated staff context.
