# Schedule locking

`ScheduleService.occupy` expands a booking into court-duration slots and writes every `LOCK#HH:mm` record plus occupancy metadata in one transaction. Each lock uses `attribute_not_exists(PK)`, making a double booking a `409 SCHEDULE_CONFLICT`. The in-memory implementation serializes transactions to test the same one-winner rule.

Pending public requests are separate `REQUEST#` records and do not create locks. Confirmation revalidates through the same reservation workflow. Cancellation removes active locks while retaining the reservation record and status.
