# Epic: Phase 2 — Customer Self-Service & Online Booking

## Context

CourtOS has completed the foundations required for Phase 2.

The existing system already provides:

- organization-scoped staff authentication;
- `OWNER`, `STAFF`, and `COACH` staff roles;
- customer records;
- sports and preferred customer sport;
- courts and court opening hours;
- atomic schedule locking;
- staff-created reservations;
- recurring reservations;
- reservation lifecycle states;
- customer profiles and reservation history;
- public venue pages;
- public court availability;
- anonymous reservation requests;
- staff approval/rejection of reservation requests;
- classes and materialized class sessions;
- class capacity and enrollment;
- attendance/check-in;
- charges and externally recorded payments;
- responsive vanilla TypeScript frontend;
- Hono API;
- DynamoDB repository abstraction;
- shared contracts in `packages/contracts`.

The current public reservation flow is:

```text
Anonymous visitor
      |
      v
Public availability
      |
      v
Submit request
      |
      v
REQUESTED
      |
      v
Staff confirmation
      |
      v
BOOKED reservation
```

A pending request does **not** occupy a court. Only confirmation creates the reservation and acquires the shared schedule locks.

Phase 2 changes CourtOS from primarily an employee-operated system into a platform also used directly by customers.

The target customer workflow becomes:

```text
Customer account
      |
      v
Customer portal
      |
      +----------------------------+
      |                            |
      v                            v
Availability                  My activities
      |                            |
      v                            +--> Reservations
Booking policy                     +--> Classes
      |                            +--> History
      |
      +--> STAFF_ONLY
      |       |
      |       v
      |    No online booking
      |
      +--> REQUEST_APPROVAL
      |       |
      |       v
      |    REQUESTED
      |
      +--> AUTO_CONFIRM
              |
              v
      Atomic reservation
```

Phase 2 must continue using the existing authoritative court schedule.

There must not be a customer-specific availability implementation, a second reservation model, or a separate booking calendar.

All customer-created reservations must ultimately use the same schedule locking and reservation lifecycle used by staff reservations.

## Product Goal

At the end of this epic:

> Customers can authenticate into the sports center, find availability, book or request courts according to venue policy, cancel eligible reservations, manage participants, interact with classes and waitlists, reuse previous bookings, and see their upcoming activities without routine front-desk intervention.

The Phase 2 gate is:

> **Can customers handle routine interactions themselves?**

## Scope Decisions

### Customer authentication is separate from staff authorization

Do not add `CUSTOMER` to the existing staff `OWNER | STAFF | COACH` permission model and then scatter additional role checks throughout staff services.

Customer accounts represent a different actor type with fundamentally different permissions.

A customer session must resolve:

```text
organizationId
customerId
customerAccountId
```

and must never allow arbitrary customer IDs supplied by the browser to choose which customer's data is accessed.

### Customer accounts attach to existing Customer records

`Customer` remains the business/customer-history entity.

Authentication credentials belong to a separate customer-account record.

Conceptually:

```text
Customer
   |
   | 1
   |
   | 0..1
CustomerAccount
```

Do not duplicate reservation history, class history, phone, sports, or other customer business information into the account merely because authentication requires another entity.

### Existing anonymous reservation requests remain supported

The `/book/:slug` flow is already useful and should not be broken.

Phase 2 can evolve it according to venue booking policy while the authenticated customer portal becomes the primary self-service experience.

### Packages, memberships, and events are future-ready but not implemented here

The customer portal architecture must be ready to expose:

```text
Packages
Memberships
Events
```

but this epic must not implement the Phase 3 membership/package/credit domain or the Phase 5 event/community domain.

Do not add fake placeholder business records.

Navigation may hide unavailable modules until their feature capability exists.

### Payments remain external

AUTO_CONFIRM means:

```text
customer confirms booking
        ->
reservation immediately exists
```

It does **not** mean:

```text
payment gateway
PIX checkout
credit-card processing
```

Existing charge generation and external payment recording remain unchanged.

### Customer booking policies do not restrict staff

Venue policies defined in this phase govern customer self-service.

Staff must retain the ability to manually create or modify bookings using the operational workflows already available.

---

## TASK-001 — Introduce Phase 2 Domain Contracts and Persistence Model

### Goal

Define the reusable Phase 2 domain entities and shared contracts before adding customer-facing workflows.

### Requirements

Extend `packages/contracts` with Phase 2 concepts.

Introduce a customer account model conceptually similar to:

```text
CustomerAccount

customerAccountId
organizationId
customerId
email
normalizedEmail
passwordHash
status
createdAt
updatedAt
lastLoginAt?
```

Supported account states should include at least:

```text
ACTIVE
DISABLED
```

Introduce customer-session records separate from staff sessions.

Introduce booking policy configuration attached to the organization.

Suggested shape:

```text
bookingPolicy:
  reservationMode:
    STAFF_ONLY
    REQUEST_APPROVAL
    AUTO_CONFIRM

  bookAheadDays: 30
  cancellationCutoffHours: 6
  minimumReservationMinutes: 60
  maximumReservationMinutes: 120
  maximumActiveBookings: 3
```

Add sensible defaults for organizations created before Phase 2.

The safest backward-compatible default should preserve the current behavior:

```text
reservationMode = REQUEST_APPROVAL
bookAheadDays = 30
cancellationCutoffHours = 6
minimumReservationMinutes = 60
maximumReservationMinutes = 120
maximumActiveBookings = 3
```

Introduce contracts for:

- customer account;
- customer session response;
- customer profile update;
- customer sport preferences;
- customer reservation creation;
- customer reservation cancellation eligibility;
- reservation participants;
- waitlist records;
- customer activity items;
- customer booking policy/public policy representation.

Extend `ReservationSourceSchema` with a customer-self-service source such as:

```text
CUSTOMER_PORTAL
```

Keep `PUBLIC_REQUEST` for the existing anonymous request workflow.

Identify DynamoDB access patterns before implementation.

At minimum support efficient access for:

```text
customer account by organization + email
customer account by customer ID
customer's upcoming reservations
customer's reservation history
customer's active waitlists
waitlists for a court/time
waitlists for a class
participants for reservation
customer sport preferences
```

Do not create new high-volume workflows that depend on whole-table scans.

Prefer queryable organization/customer partitions or deliberately materialized lookup records.

Add a Phase 2 migration script following the existing `migrate-phase1.ts` pattern.

The migration must:

- be idempotent;
- populate missing booking policies;
- preserve existing organizations;
- preserve existing customers;
- preserve existing staff sessions/users;
- preserve existing public request behavior.

### Acceptance Criteria

- [ ] Shared contracts compile for all new Phase 2 entities.
- [ ] Existing organization data remains readable.
- [ ] Existing organizations receive backward-compatible booking-policy defaults.
- [ ] Customer authentication data is separate from `Customer`.
- [ ] Staff `User` records are not reused as customer accounts.
- [ ] DynamoDB key/access patterns are documented.
- [ ] New customer-facing list operations do not require unrestricted table scans.
- [ ] Phase 2 migration can be run repeatedly without duplicating or corrupting data.
- [ ] Existing Phase 0/1 tests continue passing.

---

## TASK-002 — Implement Secure Customer Account Creation and Activation

### Goal

Allow customers to obtain authenticated portal accounts without allowing an arbitrary person to claim an existing customer record.

### Requirements

Create a dedicated customer-account service.

Support self-registration for genuinely new customers through a venue-specific route such as:

```text
/portal/:slug/register
```

Registration collects at least:

```text
name
email
phone
password
```

Registration must:

1. resolve the organization from the venue slug;
2. normalize email and phone;
3. check whether a customer/account already exists;
4. create both Customer and CustomerAccount when there is no existing identity conflict;
5. preserve organization isolation.

Do **not** automatically attach a newly supplied password to an existing customer merely because the submitted email matches that customer's email.

For existing customers, implement a manual activation workflow compatible with CourtOS's "manual before automation" principle.

Staff should be able to:

```text
Customer profile
      |
      v
Enable portal access
      |
      v
Generate one-time activation token
      |
      v
Copy activation link
```

The customer can use the link to set a password.

Activation tokens must:

- use cryptographically random values;
- store only a hash when feasible;
- expire;
- be single-use;
- be organization/customer scoped;
- never be returned again after activation.

Add a corresponding manual password-reset-token workflow for accounts that cannot log in.

Do not require email infrastructure in this phase.

Staff can copy the generated activation/reset link and deliver it through the venue's existing communication channel.

### Acceptance Criteria

- [ ] A new customer can register for a specific venue.
- [ ] Registration creates exactly one Customer and one CustomerAccount.
- [ ] Registration cannot claim an existing customer solely by knowing their email.
- [ ] Existing customers can be given portal access through a one-time activation flow.
- [ ] Activation tokens expire.
- [ ] Activation tokens cannot be reused.
- [ ] Staff can manually generate a password-reset link.
- [ ] Customer passwords use the repository's secure password hashing facilities.
- [ ] Cross-organization activation or reset attempts fail.
- [ ] Account-management tests cover duplicate email and identity-conflict cases.

---

## TASK-003 — Add Customer Authentication and Authorization Boundaries

### Goal

Create an authentication boundary that makes customer-facing services safe by default.

### Requirements

Add customer authentication endpoints such as:

```text
POST /customer-auth/login
POST /customer-auth/logout
POST /customer-auth/register
POST /customer-auth/activate
POST /customer-auth/reset-password
GET  /customer-auth/session
```

Login must identify both:

```text
venue
customer account
```

because the same email address may legitimately be used at multiple sports centers.

A suitable login request is:

```text
slug
email
password
```

Introduce a customer authentication context distinct from the current staff `AuthContext`.

Example concept:

```text
CustomerAuthContext

organizationId
customerId
customerAccountId
actorType = CUSTOMER
```

Do not expose staff-only authorization methods through customer contexts.

Add customer route middleware.

Customer endpoints should live under a clearly isolated namespace such as:

```text
/customer/*
```

Every customer resource operation must derive the customer ID from the authenticated session.

Never implement APIs such as:

```text
GET /customer/reservations?customerId=<browser supplied id>
```

when the identity can instead come from the authenticated context.

Use TTL for customer sessions.

Logout must invalidate the current session.

Disabled accounts must not authenticate.

### Acceptance Criteria

- [ ] Customer and staff sessions use distinct authorization paths.
- [ ] Customer login is scoped to a venue.
- [ ] Customer routes derive customer identity from the session.
- [ ] Changing a URL or body customer ID cannot expose another customer's data.
- [ ] Disabled customer accounts cannot authenticate.
- [ ] Expired sessions are rejected.
- [ ] Logout invalidates the customer session.
- [ ] Existing staff login behavior remains unchanged.
- [ ] Security tests explicitly verify cross-customer and cross-organization isolation.

---

## TASK-004 — Implement Configurable Venue Booking Policies

### Goal

Give each venue control over how customer reservations behave.

### Requirements

Create a focused booking-policy domain/service rather than scattering checks between routes and UI code.

Support:

```text
Reservation mode
- STAFF_ONLY
- REQUEST_APPROVAL
- AUTO_CONFIRM

Book up to
- configurable number of days

Cancellation allowed until
- configurable hours before start

Minimum reservation
- configurable minutes

Maximum reservation
- configurable minutes

Maximum active bookings
- configurable count
```

Validate policy configuration.

At minimum:

```text
bookAheadDays > 0

cancellationCutoffHours >= 0

minimumReservationMinutes > 0

maximumReservationMinutes >= minimumReservationMinutes

maximumActiveBookings > 0
```

Keep customer booking duration increments compatible with the existing schedule model.

Use 30-minute increments for the customer booking UI unless the existing court configuration requires a stricter interval.

Implement reusable domain methods similar to:

```text
assertCustomerCanBook(...)
customerCancellationEligibility(...)
customerBookingWindow(...)
customerAllowedDurations(...)
customerActiveBookingCount(...)
```

The server is authoritative.

UI restrictions are convenience only.

Define "active booking limit" consistently.

For self-service purposes, count future customer commitments that can consume or reasonably lead to capacity consumption, including:

```text
BOOKED future reservations
CHECKED_IN current reservations where applicable
REQUESTED pending reservation requests
```

Ensure a customer cannot bypass the limit by repeatedly submitting approval requests.

Add booking-policy controls to the existing organization Settings screen.

Only owners can modify policy.

### Acceptance Criteria

- [ ] Owner can switch between all three reservation modes.
- [ ] Policy values persist on the organization.
- [ ] Existing organizations use documented defaults.
- [ ] Customer APIs enforce booking horizon.
- [ ] Customer APIs enforce minimum duration.
- [ ] Customer APIs enforce maximum duration.
- [ ] Customer APIs enforce maximum active bookings.
- [ ] Pending requests cannot be used to bypass the active-booking limit.
- [ ] Staff manual reservations remain unaffected by customer policy.
- [ ] Policy logic has timezone-boundary tests.

---

## TASK-005 — Build the Customer Portal Shell and Responsive Navigation

### Goal

Create a distinct responsive customer experience while continuing to use the existing Vite/native-DOM application.

### Requirements

Add customer routes under a venue-specific URL structure.

Suggested structure:

```text
/portal/:slug/login
/portal/:slug/register
/portal/:slug
/portal/:slug/book
/portal/:slug/reservations
/portal/:slug/reservations/:id
/portal/:slug/classes
/portal/:slug/waitlists
/portal/:slug/profile
```

Do not introduce React, Vue, Svelte, or another framework.

Create a customer-specific shell rather than forcing the staff sidebar/navigation onto customers.

Optimize primarily for mobile usage while retaining desktop usability.

Customer navigation should expose:

```text
Home
Book
Activities
Classes
Profile
```

Structure the navigation so later phases can add:

```text
Packages
Memberships
Events
```

without redesigning the portal.

Do not display inactive future modules yet.

Implement authenticated-route redirect behavior.

Preserve the existing public `/book/:slug` route.

Ensure customer and staff session storage cannot accidentally overwrite each other.

### Acceptance Criteria

- [ ] Customer portal has an independent responsive shell.
- [ ] Customer login and registration work well on mobile widths.
- [ ] Staff navigation is not shown in customer routes.
- [ ] Customer navigation does not expose staff-only URLs.
- [ ] Existing `/book/:slug` route still works.
- [ ] Staff and customer browser sessions do not overwrite each other.
- [ ] Browser refresh works on nested customer portal routes.
- [ ] No frontend framework or component library is introduced.

---

## TASK-006 — Implement Customer Profile and Sport Preferences

### Goal

Allow authenticated customers to maintain their own basic information and sports.

### Requirements

Create:

```text
GET   /customer/me
PATCH /customer/me
```

Customers may update safe self-service fields such as:

```text
name
phone
email
```

Do not allow customers to modify staff-controlled fields such as:

```text
notes
tags
archived
outstanding balance
attendance
history
```

Handle email changes carefully because customer-account login email and customer contact email may need to remain synchronized.

Any uniqueness/identity implications must be validated before changing account email.

Replace the current single `preferredSportId` concept for customer self-service with a Phase-2-compatible multi-sport preference model.

Do this without deleting the legacy field immediately.

Support:

```text
GET /customer/me/sports
PUT /customer/me/sports
```

Customers should select from the venue's active sports.

Store durable customer-to-sport preference records or another queryable model that can later support segmentation and engagement.

Optionally retain one sport as primary/preferred if useful for backward compatibility.

Do not expose another customer's sport preferences.

### Acceptance Criteria

- [ ] Customer can view their own profile.
- [ ] Customer can edit allowed personal fields.
- [ ] Customer cannot edit staff notes or tags.
- [ ] Customer can select multiple venue sports.
- [ ] Inactive sports cannot be newly selected.
- [ ] Legacy preferred-sport data remains compatible.
- [ ] Customer/account email changes remain internally consistent.
- [ ] Profile APIs never accept an arbitrary customer ID.

---

## TASK-007 — Create the Customer Home and Unified Upcoming Activities Read Model

### Goal

Answer the customer question:

> "Show me all my upcoming activities."

### Requirements

Create a customer-oriented activity read model.

At minimum combine:

```text
Reservations
Class sessions for active enrollments
```

Return a normalized activity shape such as:

```text
activityType
activityId
startAt
endAt
title
subtitle
status
court
sport
actions
```

The endpoint should conceptually support:

```text
GET /customer/activities?from=...&to=...
```

or separate bounded upcoming/history endpoints.

Keep results bounded and paginate history.

Do not load the organization's complete reservations/classes and filter them entirely in the browser.

Customer Home should show:

```text
Greeting

Next activity

Upcoming activities

[Book a court]

Useful status/action indicators
```

Reservation actions can include:

```text
View
Cancel
Book again
```

where eligible.

Class activities should expose class name, coach/court when appropriate, and enrollment status.

Design the union so future phases can add:

```text
EVENT
OPEN_GAME
```

without replacing the endpoint.

### Acceptance Criteria

- [ ] Customer Home shows the next upcoming activity.
- [ ] Upcoming reservation and class activities appear chronologically.
- [ ] Cancelled reservations are not shown as upcoming.
- [ ] Customer sees only their own activities.
- [ ] History retrieval is bounded/paginated.
- [ ] Read model can later represent additional activity types.
- [ ] Mobile layout remains usable with several upcoming activities.

---

## TASK-008 — Implement Policy-Aware Customer Availability and Booking

### Goal

Support both approval-based and instant online reservations through one booking workflow.

### Requirements

Reuse the existing availability and shared schedule services.

Do not create another availability engine.

Customer flow:

```text
Select date
    |
    v
Select duration
    |
    v
View available courts/times
    |
    v
Select slot
    |
    v
Confirm
```

Prefer a customer-first search such as:

```text
"What is available Saturday?"
```

rather than requiring the customer to choose a court before seeing anything.

The UI should allow filtering by sport where useful.

API should support querying available courts/times for a date and duration using existing court opening hours and schedule locks.

Apply booking policies.

### `STAFF_ONLY`

Customer sees that online booking is unavailable.

Do not allow request or reservation creation through customer endpoints.

Existing staff workflows remain available.

### `REQUEST_APPROVAL`

Confirmation creates a reservation request associated directly with the authenticated customer.

Do not ask the authenticated customer to re-enter:

```text
name
phone
email
```

unless information is missing and must first be completed in profile.

Pending request does not occupy the court, preserving the existing request semantics.

Store `linkedCustomerId` immediately because identity is already known.

### `AUTO_CONFIRM`

Confirmation immediately attempts to create a regular reservation using the existing atomic schedule-lock flow.

Use source:

```text
CUSTOMER_PORTAL
```

Do not perform:

```text
check availability
then write later
```

without the shared atomic occupancy transaction.

If another booking wins the slot concurrently, return a schedule conflict and refresh availability.

Generate the same reservation charge currently created for staff reservations.

Do not add online payment processing.

### Anonymous `/book/:slug`

Preserve the existing route.

Adapt it to policy:

```text
STAFF_ONLY
-> explain that online booking/request is unavailable

REQUEST_APPROVAL
-> retain current anonymous request behavior

AUTO_CONFIRM
-> show availability but require login/registration before instant reservation
```

Do not permit anonymous instant reservations.

### Acceptance Criteria

- [ ] Customer can search availability by date without first knowing a court.
- [ ] Only publicly eligible active courts are returned.
- [ ] Booking policy is applied server-side.
- [ ] `STAFF_ONLY` blocks customer booking.
- [ ] `REQUEST_APPROVAL` creates a request linked to the authenticated customer.
- [ ] `AUTO_CONFIRM` creates a normal reservation immediately.
- [ ] AUTO_CONFIRM uses existing atomic schedule locks.
- [ ] Concurrent attempts at the same slot cannot double-book.
- [ ] Customer booking generates the normal reservation charge.
- [ ] Anonymous visitors cannot create instant reservations.
- [ ] Existing approval-request workflow remains functional.

---

## TASK-009 — Add Customer Reservation History and Reservation Detail

### Goal

Give customers complete visibility into their own reservation lifecycle.

### Requirements

Create customer-specific reservation endpoints such as:

```text
GET /customer/reservations/upcoming
GET /customer/reservations/history
GET /customer/reservations/:id
```

History must be bounded and paginated.

Reservation detail should safely expose:

```text
court
sport
start/end
duration
status
source
expected amount
payment status when appropriate
participants
cancellation eligibility
```

Do not expose:

```text
staff internal notes
employee IDs
unrelated customer data
internal schedule lock details
staff-only audit data
```

Customer history should retain:

```text
COMPLETED
CANCELLED
NO_SHOW
```

rather than deleting records.

Show pending approval requests separately or as clearly distinct booking-request items.

### Acceptance Criteria

- [ ] Customer can see future reservations.
- [ ] Customer can browse reservation history.
- [ ] Customer can inspect one reservation.
- [ ] Pending requests are clearly distinguished from confirmed reservations.
- [ ] Historical cancelled/no-show records remain visible.
- [ ] Internal staff-only fields are not returned.
- [ ] Customer cannot access another customer's reservation by changing the reservation ID.
- [ ] History pagination works.

---

## TASK-010 — Implement Policy-Aware Customer Cancellation

### Goal

Allow customers to cancel eligible bookings themselves and immediately release court availability.

### Requirements

Create a customer cancellation operation.

Conceptually:

```text
POST /customer/reservations/:id/cancel
```

Authorization requires:

```text
reservation.customerId === authenticated customerId
```

Only eligible reservation states can be cancelled.

Apply venue:

```text
cancellationCutoffHours
```

using the venue timezone and actual reservation timestamp.

Return cancellation eligibility in reservation read models so the UI can explain why cancellation is unavailable.

Examples:

```text
Cancellation available until 13:00 tomorrow

Cancellation period has ended

Already cancelled

Reservation already completed
```

Use the existing reservation lifecycle and schedule-release mechanism.

Do not implement a special "customer cancellation" state.

Store actor/audit information in a way that distinguishes customer actions from staff actions without pretending a customer account is a staff `userId`.

Ensure cancellation also follows the existing charge-void behavior.

After cancellation:

```text
reservation status = CANCELLED
schedule locks released
availability updated
charge handled consistently
```

Cancellation of a pending approval request should also be supported.

A customer cancelling their own `REQUESTED` request should move it to a durable cancelled/withdrawn state rather than deleting it.

Add an appropriate request status if required.

### Acceptance Criteria

- [ ] Customer can cancel their own eligible reservation.
- [ ] Customer cannot cancel another customer's reservation.
- [ ] Cancellation cutoff is enforced server-side.
- [ ] Cancelling immediately releases court availability.
- [ ] Reservation history remains intact.
- [ ] Existing charge cancellation behavior remains consistent.
- [ ] Customer can withdraw their own pending reservation request.
- [ ] Staff cancellation behavior is unaffected.
- [ ] Timezone/cutoff boundary tests exist.

---

## TASK-011 — Add Reservation Participants

### Goal

Allow reservation owners to answer:

> "Who is playing with me?"

while creating durable foundations for future customer-relationship analysis.

### Requirements

Introduce a reservation participant entity rather than storing an uncontrolled array directly in the reservation.

Suggested conceptual fields:

```text
reservationParticipantId
organizationId
reservationId
displayName
linkedCustomerId?
phone?
email?
createdByActorType
createdAt
updatedAt
```

Reservation owner should automatically be understood as the owner and should not need to add themselves again.

Allow the owner to:

```text
view participants
add participant
edit unresolved participant
remove participant
```

only while the reservation is in a sensible mutable state.

Do not expose the venue's customer directory to customers.

A customer must not be able to search arbitrary customers by name, phone, or email.

If participant contact information exactly matches an existing organization customer, the backend may internally link the participant to that customer.

Do not reveal whether a supplied phone/email matched another customer.

Allow unresolved participants to remain durable records.

This supports future relationship derivation:

```text
João regularly plays with Maria
```

without requiring Phase 4/5 analytics now.

Keep participants after reservation completion/cancellation as historical data.

### Acceptance Criteria

- [ ] Reservation owner can add participant names.
- [ ] Reservation owner can see their reservation's participants.
- [ ] Participant records can optionally link to an existing customer internally.
- [ ] Customer directory is never exposed through participant entry.
- [ ] Exact-contact matching does not leak whether another customer exists.
- [ ] Customers cannot edit participants of another reservation.
- [ ] Participant history survives reservation completion.
- [ ] Participant history survives reservation cancellation.
- [ ] Participant data is organization scoped.

---

## TASK-012 — Add Customer Class Discovery and Self-Service Enrollment

### Goal

Make the existing class module useful from the customer portal.

### Requirements

Expose customer-safe class discovery.

Customers should be able to view:

```text
active classes
sport
coach display name
court
schedule
capacity
current enrollment count
price
their enrollment state
```

Do not expose staff-only class management controls.

Allow a customer to enroll themselves when:

```text
class is active
capacity is available
customer is not already enrolled
```

Reuse the existing enrollment and charge behavior.

Do not duplicate class enrollment logic inside customer routes.

Refactor ClassService where necessary so the same underlying business operation can safely be invoked by staff or by the authenticated customer with the correct actor authorization.

Allow the customer to leave/cancel their own enrollment.

Cancellation should use the existing durable enrollment status transition and future-charge voiding behavior rather than deleting enrollment history.

If the class is full, show:

```text
[Join waitlist]
```

instead of failing with an unexplained capacity error.

### Acceptance Criteria

- [ ] Customer can browse active classes.
- [ ] Customer can see capacity/full status.
- [ ] Customer can enroll themselves in an available class.
- [ ] Customer cannot enroll another customer.
- [ ] Existing charge generation occurs for paid classes.
- [ ] Customer can leave their own enrollment.
- [ ] Historical enrollment is retained.
- [ ] Full classes expose a waitlist action.
- [ ] Existing staff and coach class workflows continue working.

---

## TASK-013 — Implement Court and Class Waitlists

### Goal

Allow customers to express demand when capacity is unavailable while keeping fulfillment manual during Phase 2.

### Requirements

Introduce a reusable waitlist domain.

Support at least:

```text
COURT_SLOT
CLASS
```

Suggested lifecycle:

```text
ACTIVE
FULFILLED
CANCELLED
EXPIRED
```

### Court waitlist

Customer should be able to join a waitlist for a concrete desired booking configuration such as:

```text
courtId
desiredDate
desiredStartTime
durationMinutes
```

Optionally support sport-level demand later, but do not overcomplicate the first implementation.

Validate that:

- date is within the customer booking horizon;
- court is publicly eligible;
- the customer does not already have the same active waitlist entry.

### Class waitlist

Customer can join when a class is at capacity.

Store:

```text
classId
customerId
joinedAt
status
```

Prevent duplicate active entries.

### Customer management

Customers can:

```text
view my waitlists
leave waitlist
```

No automatic reservation or enrollment must occur when capacity opens.

No automatic notification integration is required.

Preserve entries as history after fulfillment/cancellation.

### Acceptance Criteria

- [ ] Customer can join an unavailable court-slot waitlist.
- [ ] Customer can join a full-class waitlist.
- [ ] Duplicate active entries are prevented.
- [ ] Customer can see all active waitlists.
- [ ] Customer can leave an active waitlist.
- [ ] Waitlist records are not deleted when completed.
- [ ] Court cancellation does not automatically book a waitlisted customer.
- [ ] Class capacity opening does not automatically enroll a waitlisted customer.
- [ ] Waitlist access patterns do not depend on organization-wide table scans.

---

## TASK-014 — Build Staff Waitlist Management and Opportunity Workflow

### Goal

Give staff a manual operational workflow for acting on waitlists before any future notification automation is introduced.

### Requirements

Add a staff-facing Waitlists screen or a clearly integrated operational section.

Staff should see:

```text
Court waitlists
Class waitlists
Customer
Requested activity
Joined time
Current availability/capacity
Status
```

Identify actionable opportunities.

Examples:

```text
Court 2
Saturday 10:00–11:00
Now available
3 customers waiting
```

and:

```text
Intermediate Class
7 / 8 enrolled
2 customers waiting
```

For a court-slot opportunity, allow staff to:

```text
Create reservation
```

using the existing staff/customer reservation service.

The final creation must still acquire schedule locks atomically.

If the court became unavailable again, show a normal schedule conflict.

For a class waitlist, allow staff to:

```text
Enroll customer
```

using the existing class enrollment operation.

When successfully handled, mark the waitlist entry:

```text
FULFILLED
fulfilledAt
fulfilledBy
linkedReservationId? / linkedEnrollmentId?
```

Allow staff to dismiss/expire obsolete entries without deleting history.

Optionally include actionable waitlists in the Today attention count when the computation remains reasonably bounded.

Do not send automatic customer messages.

### Acceptance Criteria

- [ ] Staff can list court and class waitlists.
- [ ] Staff can identify currently actionable entries.
- [ ] Staff can create a reservation from a court waitlist.
- [ ] Staff can enroll a customer from a class waitlist.
- [ ] Fulfillment links the resulting business record.
- [ ] Races still produce schedule/capacity conflicts safely.
- [ ] Obsolete waitlists can be expired/cancelled without deletion.
- [ ] No email/WhatsApp/SMS automation is introduced.

---

## TASK-015 — Implement Rebooking / “Book Again”

### Goal

Make repeat reservations fast for returning customers.

### Requirements

Add:

```text
Book again
```

to appropriate reservation-history items.

The rebooking workflow should reuse:

```text
same court
same sport
same start time
same duration
```

Do **not** blindly copy the historical absolute date.

Generate a useful new booking draft.

For a weekly regular customer, the default date should preferably be the next future occurrence of the same weekday.

Example:

```text
Previous:
Saturday 10:00
Court 2
90 minutes

Book again:
Next Saturday
10:00
Court 2
90 minutes
```

If that date is outside the venue booking horizon, select the nearest valid candidate or require the customer to choose another date.

Opening the draft must perform current availability lookup.

Completing rebooking must go through the exact same policy flow as a fresh booking:

```text
STAFF_ONLY
REQUEST_APPROVAL
AUTO_CONFIRM
```

Do not create a separate "rebooking reservation" backend path that bypasses policy or schedule locking.

If the previous court is no longer public/active, allow the customer to choose another compatible court.

### Acceptance Criteria

- [ ] Eligible historical reservations show Book Again.
- [ ] Court, time, and duration are prefilled.
- [ ] Suggested date is in the future.
- [ ] Current availability is always checked.
- [ ] Rebooking obeys current venue policy.
- [ ] Rebooking obeys current booking horizon and active-booking limits.
- [ ] Concurrent booking conflicts are handled normally.
- [ ] Archived/private courts do not produce invalid rebooking attempts.

---

## TASK-016 — Refactor Phase 2 Service Boundaries and Growing Modules

### Goal

Implement Phase 2 without making the existing large API service and route modules significantly harder to maintain.

### Requirements

The current codebase contains large central modules such as:

```text
apps/api/src/services/index.ts
apps/api/src/app.ts
```

Phase 2 introduces enough cohesive functionality to justify extraction.

Create focused service modules/directories for new concerns, for example:

```text
services/
  customer-auth/
  customer-portal/
  booking-policy/
  waitlists/
  reservation-participants/
```

Move existing related functionality only where necessary to establish clean boundaries.

Avoid an unrelated repository-wide rewrite.

Keep Hono route handlers thin.

Business rules must remain in services/domain modules.

Keep DynamoDB operations inside repository/data-access boundaries.

Do not copy existing schedule logic into the new modules.

Where staff/customer workflows share business operations, expose actor-neutral internal operations and perform actor-specific authorization at the correct boundary rather than duplicating implementations.

Examples include:

```text
create reservation
cancel reservation
enroll class
cancel enrollment
```

Preserve test behavior while extracting.

### Acceptance Criteria

- [ ] New Phase 2 domain logic is not added as another massive block in `services/index.ts`.
- [ ] New Hono routes contain HTTP concerns rather than business rules.
- [ ] Shared booking/class operations are reused rather than duplicated.
- [ ] Schedule locking remains centralized.
- [ ] No circular service dependencies are introduced.
- [ ] Existing tests continue passing after extraction.

---

## TASK-017 — Complete Customer Portal UX, Accessibility, and Internationalization

### Goal

Make self-service practical on a phone rather than merely exposing the backend functionality.

### Requirements

Extend the existing i18n system for all new customer-facing strings.

Do not hardcode English-only customer text into screen modules.

Support the languages already supported by CourtOS.

Design responsive customer workflows for common mobile widths.

Pay particular attention to:

```text
availability results
date/time selection
booking confirmation
upcoming activity cards
reservation actions
class cards
waitlists
profile forms
participants
```

Use clear states for:

```text
loading
empty
success
validation error
policy restriction
schedule conflict
full class
expired session
network failure
```

For AUTO_CONFIRM, confirmation screen should make the action explicit before creating the reservation.

For REQUEST_APPROVAL, clearly explain that the slot is:

```text
requested
not yet confirmed
not guaranteed until staff approval
```

For cancellation, show cutoff information before the user attempts the action.

Maintain keyboard usability and meaningful labels.

Use existing UI primitives where appropriate instead of adding a component library.

### Acceptance Criteria

- [ ] All Phase 2 customer flows are usable at mobile viewport sizes.
- [ ] New UI strings use the existing localization system.
- [ ] REQUEST_APPROVAL is visually distinct from a confirmed reservation.
- [ ] AUTO_CONFIRM clearly communicates successful confirmation.
- [ ] Policy restrictions explain why an action is unavailable.
- [ ] Empty states exist for reservations, classes, and waitlists.
- [ ] Forms have usable labels and error messages.
- [ ] Keyboard navigation remains functional.
- [ ] Existing staff responsive tests continue passing.

---

## TASK-018 — Add Comprehensive Phase 2 Automated Tests

### Goal

Make customer self-service safe enough that customers can modify production schedule data without staff acting as a guardrail.

### Requirements

Add domain/unit tests for:

- booking horizon;
- cancellation cutoff;
- minimum duration;
- maximum duration;
- maximum active bookings;
- pending-request counting;
- booking modes;
- next-week rebooking date;
- participant rules;
- waitlist state transitions;
- customer sport preferences;
- timezone boundaries.

Add service tests for:

- registration;
- existing-customer account activation;
- login/logout;
- token expiration;
- customer profile updates;
- REQUEST_APPROVAL booking;
- AUTO_CONFIRM booking;
- STAFF_ONLY rejection;
- customer cancellation;
- pending request withdrawal;
- participant changes;
- class self-enrollment;
- class enrollment cancellation;
- court waitlist;
- class waitlist;
- manual waitlist fulfillment.

Add concurrency tests proving that two simultaneous AUTO_CONFIRM customer requests cannot both obtain the same court slot.

Add authorization tests proving:

```text
customer A cannot read customer B
customer A cannot cancel customer B
customer A cannot edit customer B participants
customer A cannot access customer B waitlists
organization A cannot access organization B
customer routes cannot call staff-only operations
```

Add integration tests against DynamoDB Local for new access patterns.

Add Playwright flows for at least:

```text
register -> login -> view portal

login -> search availability -> AUTO_CONFIRM -> reservation appears

login -> REQUEST_APPROVAL -> request appears

login -> cancel reservation -> slot returns to availability

login -> Book Again

full class -> join waitlist

staff -> fulfill waitlist
```

Extend responsive E2E coverage to customer portal screens.

### Acceptance Criteria

- [ ] New domain rules have unit tests.
- [ ] Customer-service authorization is covered.
- [ ] AUTO_CONFIRM race condition has a test.
- [ ] DynamoDB integration tests cover Phase 2 access patterns.
- [ ] Customer booking has Playwright coverage.
- [ ] Customer cancellation has Playwright coverage.
- [ ] Rebooking has Playwright coverage.
- [ ] Waitlist has customer and staff Playwright coverage.
- [ ] Responsive portal test exists.
- [ ] `pnpm lint` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm test:integration` passes.
- [ ] `pnpm build` passes.
- [ ] `pnpm test:e2e` passes.

---

## TASK-019 — Seed Phase 2 Data and Developer Workflows

### Goal

Make Phase 2 easy to run and evaluate locally.

### Requirements

Extend the development seed with representative customer accounts.

Include at least:

```text
active customer account
customer with reservation history
customer with upcoming booking
customer enrolled in class
customer with pending request
customer on class waitlist
customer on court waitlist
```

Seed organizations/policies that exercise different modes when practical.

At minimum make it simple to switch the primary development venue between:

```text
REQUEST_APPROVAL
AUTO_CONFIRM
STAFF_ONLY
```

Provide documented development credentials for a customer account.

Keep seed data clearly non-production.

Update reset/seed scripts if new Phase 2 item types require cleanup.

### Acceptance Criteria

- [ ] Fresh `seed:dev` produces a usable Phase 2 environment.
- [ ] Developer can log in as a customer immediately.
- [ ] Developer can test AUTO_CONFIRM locally.
- [ ] Developer can test REQUEST_APPROVAL locally.
- [ ] Developer can test waitlists locally.
- [ ] Reset workflow removes/recreates Phase 2 development records safely.
- [ ] Seed script continues refusing unsafe production execution.

---

## TASK-020 — Document Phase 2 Architecture, Security, and Production Migration

### Goal

Leave the repository ready for deployment and for future phases to build on Phase 2 intentionally.

### Requirements

Update architecture documentation with:

```text
Staff identity
Customer identity
CustomerAccount -> Customer relationship
Customer session model
Customer portal routes
Booking policy flow
Waitlist lifecycle
Reservation participant model
```

Update the DynamoDB model documentation with every new item/access pattern.

Document the booking-policy decision tree:

```text
STAFF_ONLY
REQUEST_APPROVAL
AUTO_CONFIRM
```

Update public-booking documentation to explain how `/book/:slug` behaves under each mode.

Document:

- account activation;
- password reset;
- manual delivery of activation links;
- why automated email is intentionally deferred;
- customer authorization guarantees;
- cancellation rules;
- active-booking definition;
- waitlist manual fulfillment.

Document the production migration command.

Update production smoke tests.

Smoke test should include at least:

```text
staff login
customer login
public venue page
customer availability
REQUEST_APPROVAL or AUTO_CONFIRM booking
customer reservation visibility
customer cancellation
schedule availability after cancellation
class discovery
waitlist join
staff waitlist view
```

Update README's known limitations.

Explicitly retain limitations such as:

```text
no payment gateway
no automated email
no WhatsApp integration
no automatic waitlist notification
no automatic waitlist fulfillment
packages not yet implemented
memberships not yet implemented
events not yet implemented
```

### Acceptance Criteria

- [ ] Architecture documentation describes both staff and customer actors.
- [ ] DynamoDB documentation contains Phase 2 access patterns.
- [ ] Public booking documentation reflects all reservation modes.
- [ ] Production migration steps are documented.
- [ ] Production smoke test covers customer self-service.
- [ ] Deferred Phase 3/5/6 functionality is clearly documented.
- [ ] README accurately describes the product after Phase 2.

---

# Implementation Order

The recommended implementation sequence is:

```text
TASK-001
Domain/contracts/data model
        |
        v
TASK-002
Customer account creation/activation
        |
        v
TASK-003
Customer authentication boundary
        |
        +----------------------+
        |                      |
        v                      v
TASK-004                 TASK-005
Booking policy           Portal shell
        |                      |
        +----------+-----------+
                   |
                   v
              TASK-006
          Profile + sports
                   |
                   v
              TASK-007
          Activities read model
                   |
                   v
              TASK-008
          Booking workflow
                   |
           +-------+-------+
           |               |
           v               v
       TASK-009        TASK-010
       History         Cancellation
           |               |
           +-------+-------+
                   |
                   v
              TASK-011
             Participants
                   |
                   v
              TASK-012
          Class self-service
                   |
                   v
              TASK-013
              Waitlists
                   |
                   v
              TASK-014
       Staff waitlist workflow
                   |
                   v
              TASK-015
              Rebooking

TASK-016 should be performed alongside affected backend tasks.

TASK-017 should be performed alongside affected frontend tasks.

TASK-018 validates the complete feature set.

TASK-019 prepares repeatable local evaluation.

TASK-020 closes the phase for deployment.
```

# Phase 2 End-State

After this epic, the primary CourtOS customer journey should be:

```text
Customer opens venue
        |
        v
Login / Register
        |
        v
Customer Home
        |
        +---------------------------+
        |                           |
        v                           v
Find court                    Upcoming activities
        |                           |
        v                           +--> Reservation
Choose time                       |       |
        |                           |       +--> Cancel
        v                           |       +--> Participants
Booking policy                    |       +--> Book again
        |                           |
        |                           +--> Class
        |
        +--> STAFF_ONLY
        |       |
        |       v
        |    Contact venue
        |
        +--> REQUEST_APPROVAL
        |       |
        |       v
        |    Request submitted
        |       |
        |       v
        |    Staff approval
        |
        +--> AUTO_CONFIRM
                |
                v
        Atomic reservation
                |
                v
        Court immediately occupied
```

When no capacity exists:

```text
Unavailable court / Full class
              |
              v
        Join waitlist
              |
              v
        Staff opportunity
              |
              v
        Manual fulfillment
```

The system should reach the Phase 2 completion condition when a meaningful amount of:

```text
availability checking
booking
booking requests
cancellations
participant management
class interactions
waitlist creation
rebooking
activity/history lookup
profile maintenance
```

can happen directly between the customer and CourtOS without requiring an employee to manually perform the routine action.

# Explicitly Deferred Beyond Phase 2

Do not include these as hidden scope inside this epic:

```text
Membership plans
Membership renewals
Packages / credit ledgers
Package consumption
Online payment processing
PIX/card integrations
Events domain
Open games
Rankings
Referral programs
Loyalty
Customer lifecycle scoring
At-risk detection
Automated waitlist notifications
Automated email
Automated WhatsApp
Push notifications
Marketing campaigns
Automatic waitlist booking
```

Those belong to later CourtOS phases and should build on the customer identity, activity, sports, participants, booking, and waitlist foundations created here.
