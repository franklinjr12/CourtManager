# Public booking flow

`GET /public/venues/:slug` returns only public venue and court information. `GET /public/venues/:slug/availability` returns free start times. Public duration choices use 30-minute increments from 30 minutes through four hours. `POST /public/venues/:slug/requests` validates the court, opening hours, duration, future timestamp, and contact information, then stores `REQUESTED` without reserving the court. Staff reservations may use any whole-minute duration from 1 through 240 minutes.

Staff review the inbox and confirm or reject. Confirmation creates a customer when needed, revalidates and locks the requested slot, creates a reservation, and links it to the request. The public response never contains customer names, occupancy reasons, employee details, or financial data.

## Booking-policy decision tree

Venue `bookingPolicy.reservationMode` controls customer self-service:

```text
/book/:slug
    |
    +-- STAFF_ONLY
    |     availability response = empty / onlineBookingAvailable=false
    |     request write = rejected
    |     customer action = contact venue staff
    |
    +-- REQUEST_APPROVAL
    |     availability response = free public court times
    |     anonymous submit = REQUESTED request
    |     court occupancy = only after staff confirmation and schedule lock
    |
    +-- AUTO_CONFIRM
          availability response = free public court times
          anonymous submit = rejected
          customer action = sign in/register at /portal/:slug
          authenticated submit = immediate locked reservation
```

`STAFF_ONLY` keeps `/book/:slug` as a public venue page but disables online
booking. `REQUEST_APPROVAL` is the existing anonymous flow: availability is
informational, contact details are collected, and a pending request never
occupies a court. `AUTO_CONFIRM` keeps public availability visible but routes
booking to the authenticated customer portal; it does not process payment.

Authenticated customer availability uses `/customer/availability` and searches
active, publicly requestable courts for a date, duration, and optional sport or
court. `/customer/booking-policy` returns the current customer rules. Customer
writes use the shared reservation/request services and schedule locks, so there
is no customer-specific calendar or conflict model.

Staff review `REQUESTED` items and confirm or reject. Confirmation revalidates
availability, creates a customer when needed, and acquires the authoritative
schedule locks. A customer may withdraw their own pending request; the request
becomes durable `WITHDRAWN`, never deleted.

## Customer cancellation and active bookings

Customers may cancel only their own eligible future reservation before the
venue-local cancellation cutoff. Cancellation uses the normal `CANCELLED`
state, releases schedule locks immediately, preserves history, and applies
existing charge-void behavior. Pending requests may be withdrawn separately.

Active-booking limit counts future `BOOKED` reservations, applicable current
`CHECKED_IN` reservations, and `REQUESTED` pending requests. Cancelled,
completed, no-show, and withdrawn records do not count. Staff-created bookings
are not restricted by customer policy.
