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

## Phase 2 identity and booking foundations

CourtOS has two actor types with separate authorization boundaries:

```text
Staff user
  User -> staff session -> AuthContext -> OWNER | STAFF | COACH services

Customer
  Customer history record
      ^
      | referenced by
  CustomerAccount -> customer session -> CustomerAuthContext
```

Staff identity remains `User` plus `SESSION#<tokenHash>` records. Customer
identity remains the existing `Customer` history record; credentials live in a
separate `CustomerAccount` (zero or one account per customer). Staff `User`
records are never reused as customer accounts, and `CUSTOMER` is not added to
the staff role enum.

Customer login resolves venue slug plus normalized email/password. A successful
login creates a bearer session backed by `CUSTOMER_SESSION#<tokenHash>` and
returns a context containing exactly:

```text
organizationId
customerId
customerAccountId
actorType: CUSTOMER
```

`CustomerAuthContext` is never passed to staff services. `/customer-auth/*`
owns customer login, logout, registration, activation, reset, and session
endpoints. `/customer/*` accepts only customer sessions. Customer resource
handlers derive organization and customer identity exclusively from the
authenticated context; browser-supplied customer IDs are rejected or ignored.

Customer account lifecycle is manual where staff involvement is required:
new customers may self-register for one venue, while staff can enable portal
access for an existing customer and copy a one-time activation link. Staff can
also generate a one-time reset link. Links contain a raw token only at
generation time; the database stores its hash, scope, organization/customer
identity, and expiry. Venue staff deliver links through an existing channel.
Automated email is intentionally deferred until a durable outbound delivery
workflow exists.

Customer portal routes are venue-scoped in the web app:

```text
/book/:slug                         anonymous public booking
/portal/:slug/login                 customer login
/portal/:slug/register              customer registration
/portal/:slug/activate              activation link
/portal/:slug/reset-password        reset link
/portal/:slug                       customer home
/portal/:slug/book                  availability and booking
/portal/:slug/reservations          upcoming/history activities
/portal/:slug/reservations/:id      reservation detail/participants
/portal/:slug/classes               class discovery/enrollment
/portal/:slug/waitlists             customer waitlists
/portal/:slug/profile               profile and sports
```

HTTP adapters expose the corresponding `/customer-auth/*` and `/customer/*`
API resources. Portal reads are customer-scoped; reservation, class,
participant, and waitlist IDs cannot select another organization's or
customer's data.

### Booking-policy decision tree

Each organization stores one customer self-service policy. Staff workflows
remain available regardless of this policy.

```text
Customer selects public court/date/time
              |
              v
        reservationMode?
        /       |        \
       v        v         v
 STAFF_ONLY REQUEST_APPROVAL AUTO_CONFIRM
       |        |              |
 contact venue  create durable  create reservation
                 REQUESTED       with schedule lock
```

`STAFF_ONLY` disables customer online booking and returns no customer-bookable
availability. `REQUEST_APPROVAL` exposes availability and creates a pending
request; it does not occupy a court until staff confirmation revalidates and
acquires the shared schedule locks. `AUTO_CONFIRM` exposes availability and
creates a `CUSTOMER_PORTAL` reservation immediately through the existing
reservation service and atomic schedule-lock transaction. Payment is not part
of auto-confirm.

Customer policy also limits booking horizon, duration, and active commitments.
Active booking count includes future `BOOKED` reservations, applicable current
`CHECKED_IN` reservations, and `REQUESTED` pending approval requests. Staff
manual reservations do not consume or obey this customer-only limit.

### Customer reservation lifecycle

Customer cancellation is allowed only for an owned future reservation in an
eligible state and before the venue-local `cancellationCutoffHours` deadline.
It uses the existing `CANCELLED` lifecycle state, atomically releases schedule
locks, preserves history, and applies existing charge-void behavior. A pending
customer request can be withdrawn to durable `WITHDRAWN` state. Cancellation
audit fields identify the customer account without pretending it is a staff
user.

### Participants and waitlists

Reservation owner is implicit. Participant records are separate durable child
records containing submitted name and optional contact data, with optional
private customer linking. Owners may add/edit/remove participants while a
reservation is `BOOKED` and before start; removed participants remain history.
Participants remain readable after reservation completion or cancellation.

Waitlists represent demand, not bookings. Court waitlists target a concrete
court/date/start/duration; class waitlists target a full active class. Entries
move through `ACTIVE`, `FULFILLED`, `CANCELLED`, or `EXPIRED`; leaving a list
marks it cancelled without deleting history. Capacity or availability opening
does not auto-book, auto-enroll, or notify customers. Staff inspect
organization-scoped waitlists and manually fulfill a court entry through the
normal atomic reservation flow or a class entry through the normal capacity
transaction, then link the resulting reservation/enrollment. Races return
normal schedule/capacity conflicts.

Organizations carry `BookingPolicy` with `STAFF_ONLY`, `REQUEST_APPROVAL`, or `AUTO_CONFIRM` mode. Customer reservation workflows will feed the existing reservation service and authoritative `ScheduleService`; policy does not restrict staff operations. `PUBLIC_REQUEST` remains reserved for anonymous `/book/:slug` requests, while authenticated bookings use `CUSTOMER_PORTAL`.

Phase 2 customer activities, reservations, waitlists, sport preferences, and participant records use materialized customer/resource access records described in `docs/dynamodb-model.md`. Durable source records remain separate from read indexes so history survives status changes.

Historical reservation cards expose `Book again`. `GET /customer/reservations/:id/rebook` derives a venue-local future date, preserves historical sport/time/duration, and performs fresh customer availability lookup. It omits inactive, archived, or private source courts from preferred choice while returning compatible public courts. Submission uses normal customer booking endpoint, keeping current policy, active-booking limits, and atomic schedule locking authoritative.

## Phase 1 operations

`/today` is the authenticated operational landing page backed by one timezone-aware aggregation endpoint. Reservations use `BOOKED -> CHECKED_IN -> COMPLETED` with explicit cancellation and no-show transitions. Classes are definitions plus materialized `ClassSession` occurrences; both reservations and classes occupy the same `ScheduleService` locks. Finance is operational rather than accounting: activities create `Charge` records, payments reduce balances, and cancellation voids applicable future charges.

### Reservation participant self-service

The Activities portal exposes Participants for owned reservations, including historical ones. The owner is implicit. Customers can add names and optional contact information, edit their submitted participant details, and remove participants only while BOOKED and before startAt. Linked and unresolved entries expose identical fields and editing behavior to avoid a customer-existence oracle; edits recompute the optional private link. A removed entry remains historical and cannot be restored through its old ID.

`GET /customer/reservations/:id/participants?cursor=...` returns an explicit shared participant page (`participants`, `mutable`, `nextCursor`). `PUT /customer/reservations/:id/participants/:participantId` creates/updates an entry using a client-generated UUID, so retried creates do not duplicate participants. `DELETE` soft-removes it and is retry-safe. Request schemas reject customer IDs and other undeclared properties. Customer and organization identity always come from customer authentication. Staff authorization and the shared reservation schedule are unchanged.

Participant lifecycle writes check the parent state transactionally and protect participant changes with optimistic revisions. The reservation detail endpoint includes the first participant page and its cursor. Lists remain readable after completion or cancellation. Participant services use bounded queries and batch reads, with no added production runtime dependency (the web package now references the existing shared contracts workspace).

## Customer class self-service

`GET /customer/classes?cursor=...` returns a customer-safe paginated catalog
(active classes only): sport, coach display name, court, venue-local recurring
schedule, per-session price/currency, capacity/count/full state, and only the
authenticated customer's enrollment state. The response data contains `data`
and `nextCursor`; inactive rows can yield an empty page with a next cursor.

`POST /customer/classes/:id/enroll` and `POST /customer/classes/:id/leave` derive
customer identity exclusively from the customer session. Request-body customer
IDs cannot select another person. `ClassService` authorizes staff or selects the
authenticated customer, then delegates both paths to `ClassEnrollmentService`;
no customer role is added to staff authorization. Staff/coach management and
attendance routes retain their existing permission checks.

The portal Classes screen supports discovery, enrollment, cancellation, error
feedback, pagination, and full-class waitlist join/leave without staff controls.
Customer waitlists are durable demand records; capacity opening never enrolls a
customer automatically. The booking screen offers a concrete court/date/time
waitlist action when no matching slot is available. The anonymous booking flow
and external payment recording remain unchanged. Deployment requires the class
discovery backfill documented in `dynamodb-model.md`.

## Customer waitlists (TASK-013)

`WaitlistService` owns court-slot and class waitlists. Customer routes derive
customer identity from `CustomerAuthContext`; no request body customer ID is
accepted. Court entries validate public court eligibility, booking horizon,
policy duration, opening hours, and current unavailability. Class entries
require an active full class. A per-customer identity marker prevents duplicate
active entries transactionally. Durable source records and resource indexes are
retained after customer cancellation; only active customer indexes and identity
markers are removed. Fulfillment is manual. Staff waitlist operations are
exposed at `GET /waitlists`, `POST /waitlists/:id/fulfill`, and
`POST /waitlists/:id/expire`. Staff listing queries an organization-scoped
waitlist index, marks current court availability/class capacity as actionable,
and resolves fulfillment through existing reservation and class-enrollment
services. Court fulfillment shares the schedule-lock transaction; class
fulfillment shares the capacity transaction. No customer notification is sent.

## Phase 2 service and route boundaries

Phase 2 customer concerns are isolated from the staff service registry:
`services/customer-auth` owns customer credentials, sessions, and self-profile
operations; `services/customer-portal` exposes the customer booking, class,
activity, participant, policy, and waitlist services. These modules depend on
small actor-neutral ports where they call shared staff operations, so they do
not import `services/index` or duplicate reservation/class rules. The shared
`ScheduleService` remains the only court-locking boundary.

`routes/customer-portal.ts` registers customer-auth and `/customer/*` HTTP
adapters. `app.ts` keeps middleware, public venue routes, and staff routes;
customer route handlers only parse requests, select authenticated context, and
serialize service results.
