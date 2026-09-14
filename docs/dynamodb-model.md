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
