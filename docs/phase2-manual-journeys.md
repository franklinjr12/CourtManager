# Phase 2 manual journeys

Automated Playwright and Vitest cover the Phase 2 user journeys and
policy/security edges. Use this checklist for the remaining visual, timezone,
and two-browser checks that still need a person.

Run against a non-production venue. Note the slug, a public court, a future
date inside the booking window, and an active class. Use a disposable customer
account.

## Short smoke (8 flows)

These are automated in `tests/e2e/phase2-smoke.spec.ts`. Repeat manually when
signing off a production-like environment:

- [ ] Register a new customer and sign in
- [ ] `AUTO_CONFIRM` booking appears in Activities, staff schedule, and charges
- [ ] Two browsers booking the same slot: only one succeeds
- [ ] Cancel an eligible reservation; slot returns; history keeps `CANCELLED`
- [ ] `REQUEST_APPROVAL` stays available until staff confirms
- [ ] Enroll in a class, then join the waitlist when it is full
- [ ] Staff fulfill a waitlist; status stays `FULfilled` / `Atendida`
- [ ] Customer A cannot read Customer B reservation IDs

## Visual and device

- [ ] Open the portal on desktop and a phone; Home → Book → Activities →
      Classes → Profile remain usable
- [ ] Nested portal URLs survive refresh
- [ ] Profile edits name/phone/email only; tags and notes are not shown
- [ ] Sport filter on Book (profile multi-sport selection is API-only)

## Two-browser / timing

- [ ] Two real browser windows on the same `AUTO_CONFIRM` slot; confirm staff
      schedule shows a single occupancy
- [ ] Cancellation exactly around the venue-local cutoff (unit tests cover the
      timestamp; confirm the Activities copy in the venue timezone)
- [ ] Booking exactly on the last horizon day vs the day after

## Staff regression

- [ ] Today, schedule, reservations, requests inbox, customers, classes,
      finance, settings
- [ ] Public anonymous `/book/:slug` request when mode is `REQUEST_APPROVAL`
- [ ] Check-in, no-show, completion
- [ ] Recurring reservations and court blocks

## Product notes

- Account `DISABLED` has no staff UI; disable is verified by seeding status
  and attempting login
- Customer tokens must not authorize staff endpoints
- Staff and customer sessions use separate storage keys and should coexist
