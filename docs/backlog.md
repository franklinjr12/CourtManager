# Sports Center Court Management — Complete Implementation Backlog

## 0. Project Goal

Build a small, focused web application for sports centers that rent courts by the hour.

The system must primarily solve:

* court scheduling;
* manual reservation management;
* public reservation requests;
* customer organization;
* recurring reservations;
* court blocks and maintenance;
* reservation payment tracking without processing payments;
* simple financial organization;
* operational dashboard and reports.

A secondary feature set should support:

* recurring sports classes;
* coaches;
* student enrollment;
* attendance.

The application should deliberately avoid becoming a large sports-management platform.

The first production deployments are expected to be manually operated and validated with real businesses before adding automation, integrations, or sophisticated infrastructure.

---

# 1. Product Principles

## 1.1 Primary workflow

The most important workflow in the entire system is:

```text
Customer / Employee
        |
        v
Reservation request or manual booking
        |
        v
Availability validation
        |
        v
Court schedule
        |
        v
Confirmed reservation
        |
        v
Attendance / completion / cancellation
        |
        v
Optional payment record
```

Court reservations are the product's primary feature.

Classes, finance, reports, and CRM features must support this workflow rather than compete with it.

---

## 1.2 Employee remains in control

Public users must be able to request reservations.

A public request is **not automatically a confirmed reservation**.

Workflow:

```text
Public user
    |
    v
Select available court/time
    |
    v
Submit reservation request
    |
    v
REQUESTED
    |
    v
Employee reviews request
    |
    +----> Confirm
    |
    +----> Reject
    |
    +----> Suggest/edit another time
```

Employees will manually contact customers through phone, WhatsApp, email, or another external channel.

No messaging integration is required.

---

## 1.3 Pending requests do not reserve courts

A public reservation request must NOT create a court lock.

Multiple people may therefore request the same currently available slot.

Only confirmed reservations, classes, and court blocks occupy the schedule.

When confirming a request, the backend must revalidate availability.

If the slot has become unavailable:

```text
409 SCHEDULE_CONFLICT
```

The UI should tell the employee that the requested time is no longer available and show nearby alternatives where possible.

---

## 1.4 Payments are external

The application must never:

* process credit cards;
* collect PIX;
* integrate with payment gateways;
* store card information;
* automatically charge customers.

It may record that an external payment occurred.

Example:

```text
Reservation: R$ 120

Payments:
R$ 60 PIX
R$ 60 Cash

Status: PAID
```

---

## 1.5 Serverless-first architecture

Production infrastructure:

```text
Browser
   |
   v
Cloudflare Pages
Vanilla TypeScript SPA
   |
   | JSON / HTTP
   v
AWS Lambda Function URL
   |
   v
Hono application
   |
   v
Application services
   |
   v
Repository
   |
   v
DynamoDB
```

Development:

```text
Browser
   |
   v
Vite dev server
   |
   v
Local Node Hono server
   |
   v
Same services
   |
   v
Same repository interface
   |
   v
DynamoDB Local
```

The same application code must run locally and in Lambda.

---

# 2. Explicit Technology Decisions

## 2.1 Workspace

Use:

* pnpm workspace;
* Node.js 22;
* TypeScript 5;
* strict TypeScript configuration;
* ES2022;
* ESLint;
* Prettier;
* Vitest;
* Playwright.

Repository:

```text
.
├── apps/
│   ├── api/
│   └── web/
├── packages/
│   └── contracts/
├── infrastructure/
├── scripts/
├── docs/
├── docker-compose.yml
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── eslint.config.js
├── .prettierrc
├── .env.example
└── README.md
```

---

# 3. Frontend Technology Constraints

Do NOT use:

* React;
* Vue;
* Angular;
* Svelte;
* Solid;
* Tailwind;
* Bootstrap;
* Material UI;
* component libraries;
* frontend state-management libraries;
* frontend router libraries.

Use:

* Vite;
* TypeScript;
* native DOM APIs;
* native History API;
* native Fetch API;
* custom CSS.

A small number of development/test dependencies are acceptable.

The frontend should remain understandable without knowledge of a framework.

---

# 4. Backend Technology

Use:

* Hono;
* `@hono/node-server`;
* `hono/aws-lambda`;
* Zod;
* AWS SDK v3;
* DynamoDBDocumentClient;
* esbuild;
* Node `crypto`.

The backend should use the architecture:

```text
HTTP
 |
 v
Routes / middleware
 |
 v
Services
 |
 v
Repository
 |
 v
DynamoDB
```

Routes must not contain business rules.

---

# 5. Repository Structure

Target structure:

```text
apps/
├── api/
│   ├── package.json
│   └── src/
│       ├── app.ts
│       ├── lambda.ts
│       ├── dev.ts
│       ├── db.ts
│       ├── errors.ts
│       ├── domain.ts
│       ├── security.ts
│       ├── recurrence.ts
│       ├── availability.ts
│       ├── services/
│       │   ├── auth.ts
│       │   ├── organizations.ts
│       │   ├── courts.ts
│       │   ├── reservations.ts
│       │   ├── reservation-requests.ts
│       │   ├── customers.ts
│       │   ├── schedule.ts
│       │   ├── finance.ts
│       │   ├── reports.ts
│       │   └── classes.ts
│       └── scripts/
│           ├── bootstrap-owner.ts
│           └── seed-dev.ts
│
└── web/
    ├── package.json
    ├── index.html
    └── src/
        ├── main.ts
        ├── router.ts
        ├── api.ts
        ├── auth.ts
        ├── state.ts
        ├── format.ts
        ├── dom.ts
        ├── components/
        │   ├── shell.ts
        │   ├── modal.ts
        │   ├── form.ts
        │   ├── toast.ts
        │   ├── status-pill.ts
        │   ├── empty-state.ts
        │   └── loading.ts
        ├── screens/
        │   ├── login.ts
        │   ├── dashboard.ts
        │   ├── schedule.ts
        │   ├── reservations.ts
        │   ├── reservation-detail.ts
        │   ├── requests.ts
        │   ├── customers.ts
        │   ├── customer-detail.ts
        │   ├── finance.ts
        │   ├── classes.ts
        │   ├── settings.ts
        │   └── public-booking.ts
        └── styles/
            ├── reset.css
            ├── tokens.css
            ├── layout.css
            ├── components.css
            ├── schedule.css
            ├── forms.css
            └── responsive.css

packages/
└── contracts/
    └── src/
        ├── auth.ts
        ├── courts.ts
        ├── customers.ts
        ├── reservations.ts
        ├── requests.ts
        ├── finance.ts
        ├── classes.ts
        └── index.ts
```

Avoid creating dozens of tiny files unnecessarily.

Split modules when they have a clear domain responsibility.

---

# 6. Epic 1 — Repository and Development Environment

## Objective

Create a reproducible repository that can be started locally with minimal setup.

---

## Tasks

### 1.1 Initialize pnpm workspace

Create:

```text
apps/api
apps/web
packages/contracts
infrastructure
scripts
docs
```

Add root scripts:

```text
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm bootstrap:owner
pnpm seed:dev
pnpm reset:dev
```

---

### 1.2 TypeScript configuration

Create shared strict TypeScript configuration.

Enable:

```text
strict
noUncheckedIndexedAccess
exactOptionalPropertyTypes
noImplicitOverride
noFallthroughCasesInSwitch
```

Do not use `any` except when unavoidable at external boundaries.

---

### 1.3 Formatting and linting

Configure:

* ESLint;
* Prettier;
* consistent imports;
* unused import detection.

---

### 1.4 Docker Compose

Create DynamoDB Local service.

Suggested local port:

```text
8120
```

Persist its data through a Docker volume.

---

### 1.5 Environment file

Create `.env.example`.

Include:

```text
NODE_ENV=
PORT=
DYNAMODB_ENDPOINT=
DYNAMODB_TABLE=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
SESSION_TTL_SECONDS=
PUBLIC_BASE_URL=
VITE_API_BASE_URL=
```

Never expose AWS credentials to the web application.

---

### 1.6 Root development script

Create:

```text
scripts/dev.mjs
```

It should:

1. start DynamoDB Local;
2. wait for database readiness;
3. start API;
4. start Vite;
5. forward process signals;
6. stop child processes when terminated.

---

## Acceptance criteria

Running:

```bash
pnpm install
cp .env.example .env
pnpm dev
```

must result in:

* DynamoDB Local running;
* API available;
* frontend available;
* table automatically created when missing.

---

# 7. Epic 2 — Shared API Contracts

## Objective

Keep frontend and backend request/response shapes explicitly typed.

Use Zod schemas inside:

```text
packages/contracts
```

---

## Required common schemas

Create:

```text
IdentifierSchema
DateSchema
LocalTimeSchema
MoneySchema
PaginationSchema
```

---

## Response convention

Successful:

```json
{
  "data": {}
}
```

Collection:

```json
{
  "data": [],
  "nextCursor": null
}
```

Failure:

```json
{
  "error": {
    "code": "SCHEDULE_CONFLICT",
    "message": "Court is no longer available.",
    "details": {}
  }
}
```

---

## Standard error codes

Implement:

```text
VALIDATION_ERROR
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
CONFLICT
SCHEDULE_CONFLICT
DUPLICATE
INVALID_STATE
RATE_LIMITED
INTERNAL_ERROR
```

Never send DynamoDB errors directly to clients.

---

# 8. Epic 3 — DynamoDB Foundation

## Objective

Create one table designed around known access patterns.

---

# 8.1 Base table

Use:

```text
PK
SK
```

Additional indexes should only be introduced for specific access patterns.

Enable TTL through:

```text
expiresAt
```

Use on-demand billing in production.

---

# 8.2 Organization

Example:

```text
PK = ORG#<organizationId>
SK = META
```

Fields:

```text
organizationId
name
slug
timezone
currency
phone
email
active
createdAt
updatedAt
```

Initial timezone:

```text
America/Sao_Paulo
```

but do not hard-code it into domain logic.

---

# 8.3 User

Example:

```text
PK = ORG#<organizationId>
SK = USER#<userId>
```

Fields:

```text
userId
organizationId
name
email
role
passwordHash
active
createdAt
updatedAt
```

Roles:

```text
OWNER
STAFF
COACH
```

---

# 8.4 Session

Example:

```text
PK = SESSION#<sessionHash>
SK = META
```

Fields:

```text
userId
organizationId
expiresAt
createdAt
```

Never store raw bearer tokens.

Store a cryptographic hash.

---

# 8.5 Court

```text
PK = ORG#<organizationId>
SK = COURT#<courtId>
```

Fields:

```text
courtId
organizationId
name
sport
active
publiclyRequestable
slotMinutes
defaultHourlyPrice
openingHours
notes
createdAt
updatedAt
```

---

# 8.6 Customer

```text
PK = ORG#<organizationId>
SK = CUSTOMER#<customerId>
```

Fields:

```text
customerId
organizationId
name
normalizedPhone
phone
normalizedEmail
email
tags
notes
archived
createdAt
updatedAt
```

---

# 8.7 Reservation

```text
PK = RESERVATION#<reservationId>
SK = META
```

Fields:

```text
reservationId
organizationId
courtId
customerId
startAt
endAt
status
source
expectedAmount
notes
seriesId
createdBy
createdAt
updatedBy
updatedAt
```

Statuses:

```text
CONFIRMED
COMPLETED
CANCELLED
NO_SHOW
```

Public pending requests are separate records.

---

# 8.8 Reservation request

```text
PK = REQUEST#<requestId>
SK = META
```

Fields:

```text
requestId
organizationId
courtId
requestedStartAt
requestedEndAt
customerName
phone
email
notes
status
linkedCustomerId
linkedReservationId
createdAt
reviewedAt
reviewedBy
```

Statuses:

```text
REQUESTED
CONFIRMED
REJECTED
EXPIRED
```

---

# 8.9 Schedule access records

Create daily/court partitions:

```text
PK = SCHEDULE#<organizationId>#<courtId>#<YYYY-MM-DD>
```

Reservations/classes/blocks can have metadata records such as:

```text
SK = ITEM#<HH:mm>#<type>#<id>
```

---

# 8.10 Slot locks

For every occupied slot:

```text
PK = SCHEDULE#<organizationId>#<courtId>#<YYYY-MM-DD>
SK = LOCK#<HH:mm>
```

Example reservation:

```text
18:00–19:30
slotMinutes = 30
```

creates:

```text
LOCK#18:00
LOCK#18:30
LOCK#19:00
```

Each lock contains:

```text
occupancyType
occupancyId
startAt
endAt
```

---

# 8.11 Repository

Create `Repository`.

Methods:

```text
get
put
update
delete
query
batchGet
batchWrite
transactWrite
```

Application services must not import raw DynamoDB commands.

---

## Acceptance criteria

Integration tests must confirm:

* records can be written/read;
* partitions query correctly;
* TTL field is persisted;
* transaction conditions work;
* local repository behavior matches expected production behavior.

---

# 9. Epic 4 — Authentication and Tenant Isolation

## Objective

Implement simple internal authentication without introducing external identity services.

---

## 9.1 Passwords

Use secure password hashing.

Use Node cryptographic primitives.

Passwords must never be stored directly.

---

## 9.2 Login

Endpoint:

```text
POST /auth/login
```

Input:

```text
email
password
```

Return:

```text
token
user
organization
```

---

## 9.3 Session middleware

Protected requests use:

```text
Authorization: Bearer <token>
```

Middleware:

1. hashes incoming token;
2. retrieves session;
3. validates expiration;
4. retrieves user;
5. validates active user;
6. creates authenticated context.

---

## 9.4 Logout

```text
POST /auth/logout
```

Delete current session.

---

## 9.5 Authorization

Every business service must receive:

```text
AuthContext {
  organizationId
  userId
  role
}
```

Never trust `organizationId` provided by frontend requests.

---

## 9.6 Role rules

### OWNER

Can access everything.

### STAFF

Can:

* manage schedule;
* manage reservations;
* process requests;
* manage customers;
* record payments;
* manage classes.

Cannot:

* change owner;
* perform organization-destructive operations.

### COACH

Initially restricted to:

* own classes;
* attendance.

If classes are not yet implemented, COACH may remain unused.

---

## Tests

Test:

* valid login;
* invalid password;
* missing token;
* expired session;
* disabled user;
* cross-organization access;
* authorization by role.

---

# 10. Epic 5 — Organization Setup

## Objective

Support one sports center organization per initial account.

---

## Settings

Allow editing:

```text
business name
public slug
timezone
currency
phone
email
```

Public slug example:

```text
arena-central
```

Public URL:

```text
/book/arena-central
```

---

## Bootstrap command

Implement:

```bash
pnpm bootstrap:owner
```

Interactive or environment-driven bootstrap must create:

* organization;
* owner.

Must be idempotent.

---

# 11. Epic 6 — Court Management

## Objective

Allow staff to define courts that can be scheduled.

---

## Court fields

Required:

```text
name
sport
slot duration
default hourly price
public availability
active
opening hours
```

Optional:

```text
notes
```

---

## Opening hours

Represent per weekday.

Example:

```text
MONDAY:
  open: 07:00
  close: 23:00
```

Support closed days.

---

## Slot duration

Initially allow:

```text
30
60
```

minutes.

Design domain code so additional values can be added later.

---

## Endpoints

```text
GET    /courts
POST   /courts
GET    /courts/:id
PATCH  /courts/:id
POST   /courts/:id/archive
POST   /courts/:id/restore
```

Do not hard delete courts with history.

---

## Frontend

Settings → Courts.

Show:

```text
Court 1
Beach volleyball
R$ 80/hour
30-minute slots
Public booking enabled
Active
```

---

# 12. Epic 7 — Schedule Domain

## Objective

Create the central court occupancy model.

This is the core business domain.

---

# 12.1 Occupancy types

```text
RESERVATION
CLASS
BLOCK
```

---

# 12.2 Availability service

Implement pure helpers:

```text
expandSlots()
isWithinOpeningHours()
calculateDuration()
calculatePrice()
```

Example:

```ts
expandSlots(
  "18:00",
  "19:30",
  30
)
```

returns:

```text
18:00
18:30
19:00
```

---

# 12.3 Schedule locking

Creating occupancy must:

1. determine required locks;
2. construct transactional writes;
3. condition each lock with `attribute_not_exists`;
4. create occupancy metadata;
5. commit atomically.

If any lock exists:

```text
SCHEDULE_CONFLICT
```

---

# 12.4 Editing time

Changing:

```text
18:00–19:00
```

to:

```text
19:00–20:00
```

must atomically:

* create new locks;
* update occupancy;
* remove old locks.

Make sure failures cannot leave the reservation without locks.

---

# 12.5 Cancellation

Cancellation must:

* preserve reservation history;
* change reservation status;
* remove active schedule locks;
* retain schedule/audit information where useful.

---

# 12.6 Schedule read API

Endpoint:

```text
GET /schedule?date=YYYY-MM-DD
```

Return:

```text
courts
opening hours
schedule items
```

Optional range:

```text
GET /schedule?from=...&to=...
```

Initially limit range to seven days.

---

# 12.7 Nearby availability

Create:

```text
GET /availability
```

Input:

```text
courtId
date
durationMinutes
```

Return free start times.

Useful during request conflicts.

---

## Critical tests

Test:

* reservation A blocks reservation B;
* different courts may overlap;
* cancellation releases slot;
* class blocks reservation;
* block prevents reservation;
* concurrent creation produces one winner;
* reservations outside opening hours fail;
* invalid durations fail.

---

# 13. Epic 8 — Manual Reservations

## Objective

Allow staff to create and operate court bookings quickly.

---

# 13.1 Create reservation

Endpoint:

```text
POST /reservations
```

Input:

```text
courtId
customerId
startAt
endAt
expectedAmount
source
notes
```

Sources:

```text
STAFF
WHATSAPP
PHONE
WALK_IN
PUBLIC_REQUEST
OTHER
```

---

# 13.2 Automatic pricing

When opening the form:

```text
court hourly price × reservation duration
```

should calculate a suggested amount.

Employee may override it.

Store final price in reservation.

Historical prices must never change when court pricing changes.

---

# 13.3 Reservation detail

Show:

```text
customer
court
date
time
duration
status
source
expected amount
payment summary
notes
audit information
```

Actions:

```text
Edit
Cancel
Mark completed
Mark no-show
Record payment
```

---

# 13.4 Reservation status transitions

Allowed:

```text
CONFIRMED -> COMPLETED
CONFIRMED -> CANCELLED
CONFIRMED -> NO_SHOW
```

Do not permit arbitrary transitions.

---

# 13.5 Search/list

Endpoint:

```text
GET /reservations
```

Filters:

```text
date
from
to
court
customer
status
source
```

---

# 14. Epic 9 — Schedule UI

## Objective

Make the schedule the main operational interface.

This is the most important frontend screen.

---

# 14.1 Desktop schedule

Display:

```text
time | Court 1 | Court 2 | Court 3
```

Example:

```text
17:00 |          | João     |
17:30 |          | João     |
18:00 | Maria    |          | Beginner Class
18:30 | Maria    |          | Beginner Class
19:00 |          |          |
```

---

# 14.2 Item appearance

Differentiate:

```text
Reservation
Class
Block
```

Do not rely only on color.

Include text/icon/label.

---

# 14.3 Empty-slot action

Clicking an empty slot opens:

```text
New reservation
Block court
Class session
```

If classes are not implemented yet:

```text
New reservation
Block court
```

---

# 14.4 Reservation click

Click occupied reservation to show compact detail drawer/modal.

Actions:

```text
Open details
Edit
Complete
Cancel
```

---

# 14.5 Date controls

Support:

```text
Previous day
Today
Next day
Date picker
```

---

# 14.6 Mobile schedule

Do NOT squeeze the desktop grid onto a phone.

Mobile layout:

```text
[ Court 1 ] [ Court 2 ] [ Court 3 ]

Court 1 — Today

07:00 Available
08:00 João Silva
09:00 João Silva
10:00 Available
...
```

Alternatively use court tabs plus chronological cards.

---

# 14.7 Refresh behavior

After schedule mutation:

* refetch schedule;
* show success toast;
* preserve selected date.

---

# 15. Epic 10 — Court Blocks

## Objective

Allow employees to make a court unavailable without creating fake customers.

---

## Block fields

```text
courtId
startAt
endAt
reason
notes
```

Suggested reasons:

```text
MAINTENANCE
CLEANING
PRIVATE_EVENT
TOURNAMENT
WEATHER
STAFF_USE
OTHER
```

---

## Requirements

Blocks:

* use normal schedule locks;
* prevent reservations;
* appear on calendar;
* can be edited;
* can be cancelled/deleted while preserving relevant history.

---

# 16. Epic 11 — Customers

## Objective

Provide lightweight customer organization.

Avoid becoming a sophisticated CRM.

---

# 16.1 Customer fields

```text
name
phone
email
tags
notes
```

At least one contact method should normally exist, but staff-created walk-ins may be allowed without one.

---

# 16.2 Normalization

Normalize:

* phone;
* email.

Use normalization for duplicate suggestions.

---

# 16.3 Customer list

Show:

```text
Name
Phone
Last reservation
Upcoming reservations
Lifetime reservations
Outstanding amount
```

Filters:

```text
search
tags
archived
```

---

# 16.4 Customer detail

Sections:

```text
Profile
Upcoming reservations
Reservation history
Classes
Payments
Notes
```

Summary:

```text
24 reservations
1 no-show
R$ 1,920 expected
R$ 1,840 recorded
R$ 80 outstanding
```

---

# 16.5 Duplicate detection

When creating customer:

```text
Possible existing customer:
João Silva
(41) ...
```

Allow staff to continue anyway.

Do not automatically merge records.

---

# 17. Epic 12 — Public Reservation Requests

## Objective

Allow customers to request court times without creating accounts.

---

# 17.1 Public venue page

Route:

```text
/book/:slug
```

Separate minimal layout.

No employee navigation.

---

# 17.2 Public venue information

Show:

```text
venue name
sports
courts
business contact
booking instructions
```

Avoid exposing internal information.

---

# 17.3 Availability flow

User selects:

```text
sport/court
date
duration
available time
```

Then provides:

```text
name
phone
email optional
notes optional
```

---

# 17.4 Explicit language

Before submission show:

```text
This is a reservation request.

Your reservation is not confirmed yet.
The venue will contact you after reviewing it.
```

---

# 17.5 Public API

Only expose:

```text
GET  /public/venues/:slug
GET  /public/venues/:slug/availability
POST /public/venues/:slug/requests
```

Never expose:

* customer details;
* booking names;
* financial data;
* employee accounts;
* internal notes.

Availability response contains free slots only.

---

# 17.6 Abuse protection

Add basic protections:

* maximum request body size;
* server validation;
* request rate limiting strategy;
* hidden honeypot field;
* reject obviously invalid phone/email values.

Do not add CAPTCHA unless abuse actually becomes a problem.

---

# 18. Epic 13 — Reservation Request Inbox

## Objective

Give staff a simple queue for reviewing incoming requests.

---

## Screen

Top indicator:

```text
Reservation requests
4 pending
```

Cards/table:

```text
João Silva
Saturday, 18:00–19:00
Court 2
Requested 18 minutes ago
```

Actions:

```text
Review
Confirm
Reject
```

---

# 18.1 Request detail

Show:

```text
customer contact
requested court
requested date/time
requested duration
notes
request age
possible existing customer
```

---

# 18.2 Confirm workflow

When employee confirms:

1. verify availability again;
2. select existing customer or create new customer;
3. create reservation;
4. create schedule locks;
5. change request to `CONFIRMED`;
6. link request to reservation.

Use a transaction for related records where practical.

---

# 18.3 Conflict workflow

If slot became occupied:

```text
Requested time is no longer available.
```

Show nearby alternatives:

```text
17:00
19:00
20:00
```

Allow employee to edit requested time and confirm.

---

# 18.4 Reject workflow

Allow optional internal rejection reason.

Do not require communication integration.

---

# 18.5 Convenience contact actions

Provide:

```text
Copy phone
Copy customer name
Copy confirmation message
```

Optional:

```text
Open WhatsApp
```

may simply use a normal URL if implemented.

Do not integrate with WhatsApp APIs.

---

# 19. Epic 14 — Recurring Reservations

## Objective

Support customers with fixed weekly court times.

---

# 19.1 Recurrence input

Support initially:

```text
Never
Weekly
```

Fields:

```text
frequency
interval weeks
until date
```

Example:

```text
Every 1 week
Wednesday
19:00–21:00
Until December 18
```

---

# 19.2 Preview

Before creation show:

```text
Sep 09 ✓
Sep 16 ✓
Sep 23 X conflict
Sep 30 ✓
...
```

---

# 19.3 Conflict behavior

Do not silently overwrite conflicting bookings.

Allow user to:

```text
Cancel operation
Create only available occurrences
```

Make partial behavior explicit.

---

# 19.4 Series model

Create:

```text
reservationSeries
```

with recurrence definition.

Each actual reservation remains independent.

---

# 19.5 Series editing

Initially support:

```text
Edit only this reservation
```

and:

```text
Edit future reservations in this series
```

The second operation may regenerate future occurrences while preserving past reservations.

Document behavior clearly.

---

# 20. Epic 15 — Manual Payment Records

## Objective

Track payment state without handling payments.

---

# 20.1 Payment entity

Fields:

```text
paymentId
organizationId
reservationId optional
classId optional
customerId
amount
method
paidAt
notes
recordedBy
createdAt
```

Methods:

```text
PIX
CASH
CREDIT_CARD
DEBIT_CARD
BANK_TRANSFER
OTHER
```

These represent payments already performed externally.

---

# 20.2 Reservation payment summary

Calculate:

```text
expectedAmount
paidAmount
remainingAmount
```

Status:

```text
UNPAID
PARTIAL
PAID
OVERPAID
```

Derive status rather than duplicating it unnecessarily.

---

# 20.3 Payment operations

```text
POST /payments
DELETE /payments/:id
```

Deleting should require confirmation.

Prefer void/archive semantics if audit requirements grow.

---

# 21. Epic 16 — Basic Expense Records

## Objective

Give owners basic operational financial visibility.

---

## Fields

```text
expenseId
date
description
category
amount
notes
createdBy
```

Categories:

```text
MAINTENANCE
UTILITIES
STAFF
EQUIPMENT
CLEANING
MARKETING
OTHER
```

---

## Explicit non-goal

Do not implement:

* double-entry accounting;
* taxation;
* fiscal documents;
* invoice generation;
* bank reconciliation;
* payroll.

---

# 22. Epic 17 — Dashboard

## Objective

Show what requires employee attention today.

---

# 22.1 Today's operations

Display:

```text
Reservations today
Classes today
Court occupancy
Pending requests
Outstanding reservations
```

---

# 22.2 Action required

Example:

```text
4 reservation requests
3 unpaid completed reservations
1 court block starting soon
```

---

# 22.3 Upcoming

Chronological list:

```text
12:00 Court 1 — João
13:00 Court 3 — Carlos
14:00 Court 2 — Maintenance
```

---

# 22.4 Monthly summary

Show:

```text
Reservations
Court occupancy
Expected revenue
Recorded payments
Outstanding
Expenses
Approximate net
```

Avoid sophisticated analytics.

---

# 23. Epic 18 — Reports

## Objective

Provide a few useful management insights.

---

## Required reports

### Court utilization

By:

```text
court
date range
weekday
hour
```

Metrics:

```text
available minutes
occupied minutes
occupancy percentage
```

---

### Reservation volume

By:

```text
court
source
status
```

---

### Reservation sources

Show counts:

```text
PUBLIC_REQUEST
WHATSAPP
PHONE
WALK_IN
STAFF
OTHER
```

This should help determine whether the public request page is useful.

---

### Revenue

Show:

```text
expected reservation revenue
recorded payments
outstanding
expenses
approximate net
```

---

# 24. Epic 19 — CSV Export

## Objective

Prevent users from feeling trapped inside the application.

---

## Exports

Support CSV export for:

```text
customers
reservations
payments
expenses
```

Date filters where applicable.

CSV generation can happen synchronously for MVP-sized datasets.

---

# 25. Epic 20 — Class System

## Priority

Secondary.

Implement only after the reservation workflow is stable.

The application must already be usable without classes.

---

# 25.1 Class definition

Fields:

```text
classId
name
sport
coachId
courtId
capacity
price
schedule
active
notes
```

---

# 25.2 Recurring class schedule

Support:

```text
weekly recurrence
weekday
start time
duration
start date
optional end date
```

---

# 25.3 Class sessions

Do not need to persist every future class indefinitely.

Use:

```text
recurring class definition
+
dated operational overrides
```

Persist dated session records when:

* cancelled;
* attendance recorded;
* time changed;
* court changed;
* notes added.

---

# 25.4 Court occupancy

Class sessions must participate in the exact same court conflict logic.

The employee must never be able to book:

```text
reservation vs class
```

or:

```text
class vs class
```

for the same court/time.

---

# 25.5 Enrollment

Create:

```text
ClassEnrollment
```

Fields:

```text
classId
customerId
status
joinedAt
leftAt
```

Statuses:

```text
ACTIVE
INACTIVE
```

Enforce class capacity.

---

# 25.6 Attendance

For each dated session/customer:

```text
PRESENT
ABSENT
EXCUSED
```

---

# 25.7 Class screen

Show:

```text
Beach Volleyball Beginner

Mon / Wed
18:00–19:00
Court 2
Coach Pedro

6 / 8 students

Next session:
Today 18:00
```

Actions:

```text
Take attendance
Add student
Remove student
Cancel session
Edit class
```

---

# 26. Epic 21 — Vanilla TypeScript Frontend Foundation

## Objective

Provide maintainable frontend architecture without a framework.

---

# 26.1 Router

Implement small History API router.

API example:

```ts
router.add("/dashboard", renderDashboard);
router.add("/schedule", renderSchedule);
router.add("/customers/:id", renderCustomerDetail);
```

Support:

```text
navigate()
back/forward
popstate
route params
query params
404 screen
```

Intercept internal `<a>` links.

Do not intercept:

* external URLs;
* downloads;
* modifier-clicks.

---

# 26.2 Screen lifecycle

Every screen renderer should return cleanup behavior where necessary.

Example conceptual interface:

```ts
interface Screen {
  mount(container: HTMLElement): void;
  destroy?(): void;
}
```

This prevents leaked event listeners and timers.

---

# 26.3 DOM utilities

Create small helpers for:

```text
querying required elements
escaping text
rendering templates
event delegation
loading states
empty states
```

Never place untrusted strings directly into HTML templates.

Prefer:

```text
textContent
```

for user content.

---

# 26.4 API client

Centralize:

```text
base URL
JSON serialization
authentication header
HTTP errors
network errors
401 handling
file downloads
AbortSignal
```

Example:

```ts
api.get(...)
api.post(...)
api.patch(...)
api.delete(...)
```

---

# 26.5 Authentication state

Store token in local storage for MVP parity with the reference architecture.

Create one place responsible for:

```text
getSession()
setSession()
clearSession()
```

If API returns unauthorized:

1. clear auth;
2. clear in-memory cached data;
3. navigate to login;
4. show session expired message.

---

# 26.6 Server state

Do not recreate Redux or React Query.

Use simple explicit patterns:

```text
load screen
fetch data
render
mutation
refetch affected screen data
```

Optionally create a tiny in-memory cache only if repeated network calls become a measurable UX problem.

Do not prematurely build a state-management framework.

---

# 27. Epic 22 — CSS Design System

## Objective

Create a professional operational interface using custom CSS only.

---

# 27.1 Design tokens

Define CSS variables for:

```text
background
surface
surface-muted
text
text-muted
border
primary
danger
warning
success
radius
shadow
spacing
font sizes
```

---

# 27.2 Visual direction

Use:

* light main workspace;
* strong readable typography;
* dark/navy navigation shell;
* restrained primary accent;
* white content cards;
* subtle borders;
* subtle shadows;
* clear status indicators;
* generous but efficient spacing.

Do not make it look like a marketing website.

It is an operational business tool.

---

# 27.3 Components

Create CSS patterns for:

```text
button
button-secondary
button-danger
card
table
form
field
select
checkbox
modal
drawer
toast
status-pill
tabs
toolbar
empty-state
loading-state
error-state
metric-card
```

---

# 27.4 Accessibility

Ensure:

* keyboard navigation;
* visible focus states;
* labels for every input;
* adequate contrast;
* modal focus management;
* Escape closes appropriate overlays;
* buttons are real buttons;
* links are real links.

---

# 28. Epic 23 — Application Shell

## Desktop

Layout:

```text
236px sidebar
+
content
```

Navigation:

```text
Dashboard
Schedule
Requests
Reservations
Customers
Finance
Classes
Reports
Settings
```

Classes may be hidden until enabled.

---

## Mobile

Use:

```text
compact top bar
+
bottom navigation
```

Primary mobile navigation:

```text
Today
Schedule
Requests
Customers
More
```

---

## Responsive breakpoint

Use approximately:

```text
800px
```

Adjust based on actual testing rather than strictly preserving one number.

---

# 29. Epic 24 — UX Feedback

Every asynchronous action must visibly represent:

```text
idle
loading
success
error
```

Buttons must disable while mutation is pending.

Avoid duplicate form submission.

Use toast/inline feedback consistently.

---

# 30. Epic 25 — Confirmation UX

Require explicit confirmation for:

```text
cancel reservation
reject request
delete payment
cancel class
archive court
archive customer
```

Do not require confirmation for harmless navigation or simple edits.

---

# 31. Epic 26 — Empty States

Every major screen needs meaningful empty states.

Examples:

Schedule:

```text
No reservations yet today.
Click an available time to create one.
```

Requests:

```text
No pending reservation requests.
```

Customers:

```text
No customers yet.
Customers are created automatically from bookings or manually here.
```

---

# 32. Epic 27 — Date, Time, and Timezone Rules

## Objective

Avoid common scheduling bugs.

---

## Rules

Store absolute timestamps where appropriate.

Organization owns its timezone.

Display dates in organization timezone.

Never rely on browser timezone for business logic.

Date-only values must remain date-only.

Time-only schedule values must remain explicit local times.

---

## Tests

Include DST-safe domain tests even if the first deployment uses Brazil.

---

# 33. Epic 28 — Audit Metadata

Business records should contain where applicable:

```text
createdAt
createdBy
updatedAt
updatedBy
```

Important state changes should preserve sufficient history to answer:

```text
Who changed this?
When?
```

Do not build a full event-sourcing system.

---

# 34. Epic 29 — Local Seed Data

Implement:

```bash
pnpm seed:dev
```

Create representative data:

```text
1 organization
1 owner
2 staff members
4 courts
20 customers
today's reservations
future reservations
completed reservations
cancelled reservation
court maintenance block
public requests
partial/unpaid/paid examples
expenses
optional class examples
```

Must be idempotent.

---

# 35. Epic 30 — Reset Development Environment

Implement:

```bash
pnpm reset:dev
```

It should:

1. stop local DynamoDB;
2. remove development volume;
3. restart DynamoDB;
4. recreate table.

Do not accidentally target production resources.

Require an explicit local endpoint.

---

# 36. Epic 31 — Backend Unit Tests

Use Vitest.

Focus heavily on pure business logic.

Test:

```text
slot expansion
price calculations
opening hours
time validation
reservation state transitions
payment status
recurrence
availability
customer normalization
class capacity
role authorization helpers
```

---

# 37. Epic 32 — Service Tests

Mock the Repository interface.

Test workflows:

```text
create reservation
edit reservation
cancel reservation
complete reservation
no-show
confirm public request
reject request
create customer
duplicate suggestion
record payment
create expense
create recurring reservations
create block
class enrollment
attendance
```

Test both successful and invalid state transitions.

---

# 38. Epic 33 — DynamoDB Integration Tests

Use actual DynamoDB Local.

Test:

```text
repository query behavior
conditional writes
transactions
schedule locking
concurrent booking race
request confirmation transaction
indexes
TTL fields
organization scoping
```

Concurrency test is mandatory.

Example:

```text
Two simultaneous requests attempt Court 1 at 18:00.

Expected:
one succeeds;
one receives SCHEDULE_CONFLICT.
```

---

# 39. Epic 34 — Frontend DOM Tests

Use:

```text
Vitest
jsdom
```

Test behavior rather than implementation details.

Examples:

```text
login form validates
schedule renders items
reservation modal submits
request conflict displays message
customer form handles errors
navigation updates active state
unauthorized response returns to login
```

---

# 40. Epic 35 — End-to-End Tests

Use Playwright Chromium.

Maintain a small but valuable E2E suite.

---

## Critical journey 1

```text
Owner login
-> open schedule
-> choose empty slot
-> create customer
-> create reservation
-> reservation appears on calendar
```

---

## Critical journey 2

```text
Public booking page
-> select slot
-> submit request
-> staff login
-> open requests
-> confirm request
-> reservation appears on calendar
```

---

## Critical journey 3

```text
Create reservation
-> record partial payment
-> record remaining payment
-> reservation shows paid
```

---

## Critical journey 4

```text
Create reservation
-> attempt overlapping reservation
-> conflict shown
```

---

## Optional class journey

```text
Create class
-> enroll customer
-> open session
-> record attendance
```

---

# 41. Epic 36 — Production Build

## API

Use esbuild.

Produce one Lambda bundle.

Do not bundle development/test dependencies.

---

## Web

Use:

```bash
vite build
```

Output:

```text
dist/
```

Ensure History API fallback is configured for Cloudflare Pages.

---

# 42. Epic 37 — AWS SAM Infrastructure

Create:

```text
infrastructure/template.yaml
```

Resources:

```text
DynamoDB table
Lambda function
Lambda Function URL
IAM permissions
environment variables
```

---

## Lambda settings

Start with:

```text
Node.js 22
arm64
512 MB
30-second timeout
```

Adjust later only based on measurements.

---

## DynamoDB

Use:

```text
PAY_PER_REQUEST
TTL enabled
```

---

## IAM

Grant only required table/index actions.

Do not use broad:

```text
dynamodb:*
```

unless temporarily required during development and subsequently removed.

---

# 43. Epic 38 — Manual API Deployment

Initial deployment must be manual.

Do not create:

* GitHub Actions;
* CI deployment;
* automatic production deployment;
* push-to-deploy.

---

## Manual flow

Document:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build

cd infrastructure
sam build
sam deploy --guided
```

Capture resulting Function URL.

---

## Deployment verification

Manually verify:

```text
health endpoint
login
courts
schedule
create reservation
public availability
public reservation request
```

---

# 44. Epic 39 — Manual Frontend Deployment

Build:

```bash
VITE_API_BASE_URL=<production-api-url> pnpm --filter web build
```

Deploy manually using Wrangler:

```bash
wrangler pages deploy apps/web/dist
```

or configure equivalent manual Cloudflare Pages upload.

No automatic deploy yet.

---

# 45. Epic 40 — Production Bootstrap

After API deployment:

Create production owner with explicit script.

Never include known default production passwords.

Allow:

```text
OWNER_EMAIL
OWNER_PASSWORD
ORGANIZATION_NAME
```

through secure local environment variables when running bootstrap.

---

# 46. Epic 41 — Production Smoke Test Checklist

Create:

```text
docs/production-smoke-test.md
```

Checklist:

```text
[ ] Login works
[ ] Logout works
[ ] Court creation works
[ ] Schedule loads
[ ] Reservation creation works
[ ] Double booking prevented
[ ] Reservation edit works
[ ] Cancellation releases slot
[ ] Customer creation works
[ ] Public page loads
[ ] Public availability correct
[ ] Public request succeeds
[ ] Request confirmation works
[ ] Payment recording works
[ ] Dashboard totals reasonable
[ ] Mobile layout usable
```

Run this manually after each early deployment.

---

# 47. Epic 42 — README

README must explain:

```text
project purpose
architecture
repository structure
requirements
local development
environment variables
bootstrap
seed
tests
production build
manual API deployment
manual web deployment
known limitations
```

Include an architecture diagram.

---

# 48. Epic 43 — Developer Documentation

Create:

```text
docs/
├── architecture.md
├── dynamodb-model.md
├── schedule-locking.md
├── public-booking-flow.md
├── deployment.md
└── production-smoke-test.md
```

---

# 49. Epic 44 — Security Review

Before first real customer deployment verify:

* passwords hashed;
* tokens cryptographically random;
* raw tokens not persisted;
* organization isolation tested;
* authorization enforced in services;
* public endpoints expose only safe information;
* request inputs validated;
* HTML does not interpolate unsafe customer content;
* AWS credentials never reach frontend;
* Lambda permissions scoped;
* production errors do not expose stack traces;
* session expiration enforced in application code;
* rate limiting strategy exists for authentication/public requests.

---

# 50. Epic 45 — Performance Review

Do not prematurely optimize.

Before first production use confirm:

* schedule query does not scan entire table;
* customer listing is bounded;
* request inbox is indexed/queryable;
* reservation list filters do not require unrestricted scans for ordinary operations;
* dashboard scans are acceptable for initial dataset.

Broad scans may be accepted temporarily for low-volume reports.

Document each accepted scan.

---

# 51. Epic 46 — Observability

Use structured server logs.

Each request should include:

```text
requestId
route
method
status
duration
organizationId if authenticated
userId if authenticated
```

Never log:

```text
passwords
session tokens
full authorization headers
sensitive financial credentials
```

Log domain errors with stable error codes.

---

# 52. Epic 47 — Health Endpoint

Implement:

```text
GET /health
```

Return:

```json
{
  "status": "ok"
}
```

Do not expose environment secrets or infrastructure details.

---

# 53. Epic 48 — MVP Feature Flags

Classes are optional for initial venue validation.

Add a simple organization feature configuration:

```text
features:
  classes: false
  finance: true
```

Do not build a generalized feature-flag platform.

This allows first deployments to focus almost completely on:

```text
courts
schedule
reservations
requests
customers
payments
```

---

# 54. Epic 49 — Data Archive Behavior

Prefer archive over deletion for:

```text
courts
customers
users
classes
```

Historical reservations must remain readable.

Archived entities must not normally appear in creation selectors.

---

# 55. Epic 50 — Search UX

Customer search should support:

```text
name
phone
email
```

Use server-side search strategies appropriate for the initial dataset.

If the dataset is very small, a scoped organization query plus in-memory filtering is acceptable initially.

Document this tradeoff.

Do not introduce Elasticsearch or external search infrastructure.

---

# 56. Epic 51 — Reservation Creation UX

Optimize this workflow heavily.

Target interaction:

```text
Schedule
-> click time
-> select duration
-> select/create customer
-> price prefilled
-> Save
```

An experienced employee should be able to create a normal booking rapidly.

Avoid large multi-page forms.

Use one modal/drawer where practical.

---

# 57. Epic 52 — Quick Customer Creation

Inside reservation flow provide:

```text
Search customer

João Silva
Maria Souza

+ New customer
```

New customer form should require only:

```text
name
phone
```

with optional email.

After creation immediately continue reservation workflow.

---

# 58. Epic 53 — Request Notification Indicator

The UI shell should display pending request count.

Example:

```text
Requests  [4]
```

Refresh:

* when requests screen opens;
* when navigating dashboard;
* periodically only if needed.

Do not add WebSockets.

A simple periodic fetch such as every few minutes may be added after observing need.

---

# 59. Epic 54 — Dashboard Data Strategy

Create one backend dashboard endpoint:

```text
GET /dashboard?date=YYYY-MM-DD
```

Backend should aggregate the necessary operational data.

Do not make the browser independently fetch ten resources for the dashboard.

---

# 60. Epic 55 — Public Availability Rules

Public availability must account for:

```text
court opening hours
active court
publicly requestable court
schedule locks
minimum slot duration
maximum request duration
past time
```

Public availability must not expose occupancy reason.

Return:

```text
available
```

not:

```text
occupied by João Silva
```

---

# 61. Epic 56 — Reservation Request Validation

Server must reject:

```text
past dates
closed courts
inactive courts
non-public courts
times outside opening hours
invalid slot boundaries
unreasonably long reservations
```

Suggested configurable maximum duration:

```text
4 hours
```

---

# 62. Epic 57 — Public Request Expiration

Old unresolved requests should eventually be marked expired.

For MVP this may happen lazily:

When requests are queried:

```text
if REQUESTED and older than configured threshold
-> display as stale/expired
```

Do not add scheduled Lambda jobs unless operationally necessary.

---

# 63. Epic 58 — Price Rules Extension Point

MVP uses:

```text
defaultHourlyPrice
```

Design price calculation service so future rules could support:

```text
weekday pricing
peak/off-peak pricing
weekend pricing
```

Do not implement a generic rules engine now.

---

# 64. Epic 59 — Schedule Range Limits

Prevent expensive arbitrary queries.

Examples:

```text
daily schedule
7-day maximum range
```

Reports may allow larger date ranges using dedicated endpoints.

---

# 65. Epic 60 — API Pagination

Any potentially growing collection should support bounded results.

Use cursor-based pagination.

Apply particularly to:

```text
customers
reservations
payments
expenses
requests history
```

Operational pending-request screen may retrieve all pending items if volume is naturally small.

---

# 66. Epic 61 — Optimistic UI Policy

Do NOT optimistically assume reservation creation succeeds.

Schedule mutations are concurrency-sensitive.

Flow:

```text
submit
-> show pending state
-> server confirms transaction
-> refresh schedule
```

For harmless metadata changes optimistic behavior may be considered later.

---

# 67. Epic 62 — Conflict UX

Map backend:

```text
SCHEDULE_CONFLICT
```

to specific frontend messaging.

Do not display:

```text
TransactionCanceledException
```

Display:

```text
This time is no longer available.

Someone may have created another reservation while you were editing.
Choose another time.
```

---

# 68. Epic 63 — Mobile Operational UX

Explicitly test common actions on phone-width screens:

```text
check today's bookings
confirm request
find customer
create reservation
record payment
call/copy customer contact
```

Do not assume desktop-only usage.

---

# 69. Epic 64 — Accessibility and Keyboard Workflow

Desktop schedule should allow reasonable keyboard operation.

At minimum:

```text
Tab between actionable items
Enter opens action
Escape closes modal
focus returns to originating control
```

Forms must be fully keyboard usable.

---

# 70. Epic 65 — Production Data Safety

Before deployment:

* no reset command can target production accidentally;
* seed command must refuse production environment by default;
* destructive scripts require explicit confirmation;
* table names differ between local/staging/production;
* bootstrap does not overwrite existing owner.

---

# 71. Epic 66 — Manual Backup Documentation

For early deployments document how to create DynamoDB backups through AWS.

No automated backup workflow is required initially.

Document:

```text
on-demand backup
restore process
```

Consider point-in-time recovery later when real businesses depend on the application.

---

# 72. Explicit Out-of-Scope Features

Do NOT implement during this backlog unless required by a later specification:

```text
online payments
payment gateway
PIX integration
WhatsApp Business API
SMS
automatic email marketing
native mobile apps
push notifications
player matchmaking
player rankings
tournament brackets
league management
inventory
POS
payroll
fiscal invoices
full accounting
bank integration
access-control hardware
smart locks
automatic door access
complex membership plans
discount engines
coupon systems
multiple branches
franchise management
advanced analytics
WebSockets
GraphQL
microservices
event streaming
Kafka
Redis
Elasticsearch
background job infrastructure
automatic CI/CD
```

---

# 73. Recommended Implementation Order

Codex should implement in this order.

## Phase 1 — Foundation

```text
1. Repository/workspace
2. DynamoDB Local
3. Contracts
4. Repository
5. Auth
6. Organization
7. Court management
```

---

## Phase 2 — Core scheduling

```text
8. Schedule domain
9. Slot locks
10. Court blocks
11. Reservation service
12. Reservation API
13. Schedule API
```

This phase should receive extensive tests before proceeding.

---

## Phase 3 — Core UI

```text
14. Vanilla TS router
15. API client
16. authentication frontend
17. shell
18. CSS system
19. schedule screen
20. reservation creation
21. reservation detail
```

At this point the app should already be usable internally.

---

## Phase 4 — Customers

```text
22. customer backend
23. customer list
24. customer detail
25. quick-create customer
26. history
```

---

## Phase 5 — Public booking requests

```text
27. public venue API
28. public availability
29. public booking page
30. request creation
31. request inbox
32. confirm request
33. request conflicts
```

At this point the core product should be ready for real venue testing.

---

## Phase 6 — Operational improvements

```text
34. recurring reservations
35. payment records
36. expenses
37. dashboard
38. reporting
39. CSV exports
```

---

## Phase 7 — Optional classes

```text
40. class definitions
41. recurring class sessions
42. class court occupancy
43. enrollments
44. attendance
45. class UI
```

---

## Phase 8 — Production readiness

```text
46. integration tests
47. E2E tests
48. security review
49. infrastructure
50. manual API deployment
51. manual frontend deployment
52. smoke tests
53. documentation
```

---

# 74. MVP Validation Milestone

Before implementing optional classes, the application should be able to demonstrate the following complete real-world workflow:

```text
Owner creates organization
        |
        v
Owner creates courts
        |
        v
Employee opens schedule
        |
        v
Employee creates customer
        |
        v
Employee reserves court
        |
        v
Double booking is prevented
        |
        v
Public customer sees availability
        |
        v
Public customer requests court
        |
        v
Employee sees request
        |
        v
Employee contacts customer externally
        |
        v
Employee confirms request
        |
        v
Reservation appears on schedule
        |
        v
Employee records external payment
        |
        v
Owner sees reservation/revenue metrics
```

If this workflow is not smooth, do not prioritize additional feature areas.

---

# 75. Definition of Done for Every Feature

A backlog item is not complete merely because the happy path works.

Every feature should satisfy where applicable:

```text
[ ] TypeScript types are strict
[ ] request schema exists
[ ] response schema exists
[ ] authorization enforced in service
[ ] organization scoping enforced
[ ] input validation implemented
[ ] business rules live outside route handler
[ ] repository abstraction used
[ ] loading state implemented
[ ] empty state implemented
[ ] error state implemented
[ ] mobile behavior considered
[ ] keyboard accessibility considered
[ ] unit tests exist
[ ] service tests exist
[ ] integration tests exist when persistence-sensitive
[ ] E2E updated when workflow is critical
[ ] lint passes
[ ] typecheck passes
[ ] tests pass
[ ] production build passes
```

---

# 76. Quality Gates

Codex must keep the repository passing:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Before production deployment additionally run:

```bash
pnpm test:e2e
```

Do not leave known broken tests behind to continue implementing later tasks.

---

# 77. Architectural Rules Codex Must Preserve

1. The browser never contains business invariants.

2. Route handlers remain thin.

3. Services implement workflows and authorization.

4. Persistence remains behind the repository boundary.

5. AWS SDK implementation details do not leak into services.

6. Local and production use the same Hono application.

7. Local and production use the same DynamoDB record model.

8. Schedule conflicts are resolved using atomic DynamoDB operations.

9. Public reservation requests do not occupy courts.

10. Only confirmed reservations, classes, and court blocks create locks.

11. Customer payment records describe external transactions only.

12. Historical reservation prices remain immutable when court pricing changes.

13. Organization identity comes from authentication context, never browser input.

14. Vanilla TypeScript frontend remains simple; do not rebuild a framework internally.

15. Do not add infrastructure until the actual product requires it.

16. Do not introduce external services for problems that can reasonably remain manual during validation.

17. Court reservation UX has higher priority than classes, reporting, or financial sophistication.

18. Early deployments remain explicit, manual, and inspectable.

---

# 78. Final Product Shape

The completed initial system should conceptually be:

```text
                         SPORTS CENTER
                               |
       +-----------------------+----------------------+
       |                       |                      |
     COURTS                 CUSTOMERS              STAFF
       |                       |                      |
       +-----------------------+----------------------+
                               |
                            SCHEDULE
                               |
          +--------------------+-------------------+
          |                    |                   |
    RESERVATIONS          COURT BLOCKS        CLASSES
          |
          |
   +------+-------------------+
   |                          |
STAFF BOOKINGS       PUBLIC REQUESTS
                              |
                              v
                      EMPLOYEE REVIEW
                              |
                  +-----------+-----------+
                  |                       |
               CONFIRM                  REJECT
                  |
                  v
             RESERVATION
                  |
                  v
            PAYMENT RECORD
                  |
                  v
              REPORTING
```

The system should feel primarily like a **fast digital front desk for a sports center**, not like a generic CRM, accounting system, social network, or sports marketplace.

The key measure of product quality is how quickly an employee can answer:

```text
What courts are available?
Who is playing today?
Can I reserve this court?
Who requested a reservation?
Who is this customer?
Has this reservation been paid?
What requires my attention right now?
```

Everything implemented should improve one of those answers.
