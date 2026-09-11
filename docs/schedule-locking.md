# Schedule locking

`ScheduleService.occupy` expands a booking into court-duration slots and writes every `LOCK#HH:mm` record plus occupancy metadata in one transaction. Each lock uses `attribute_not_exists(PK)`, making a double booking a `409 SCHEDULE_CONFLICT`. The in-memory implementation serializes transactions to test the same one-winner rule.

Pending public requests are separate `REQUEST#` records and do not create locks. Confirmation revalidates through the same reservation workflow. Cancellation removes active locks while retaining the reservation record and status.
## Operational sessions

Reservations, class sessions, and blocks all use `ScheduleService`. Cancellation, no-show, and cancelled class sessions release locks while retaining history; completed reservations retain occupancy history. Class creation materializes finite sessions and rolls back created sessions if occupancy conflicts occur.
