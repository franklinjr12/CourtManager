# Class entitlement rules

Class commercial coverage is applied at the first `CHECKED_IN` transition for
an enrolled participant. The attendance record remains the authoritative class
usage event; `COMPLETED` does not consume another credit.

`NO_SHOW`, `ABSENT`, `EXCUSED`, enrollment, and class-session cancellation do
not consume class entitlements. A failed eligibility or credit check does not
turn an attendance into a fake payment; staff can continue to use the normal
class charge workflow.

Class benefits may be limited by `classType`, `classId`, or `sportId`.
`CLASS_ATTENDANCE` covers group-class attendance, while `PRIVATE_LESSON`
covers private-class attendance. Package benefits use the package lifetime.
Membership benefits use the active membership period and may use these
windows:

- `WEEK`: Monday through Sunday, based on the organization-local date;
- `MONTH`: calendar month, based on the organization-local date;
- `MEMBERSHIP_PERIOD`: the active commercial membership period.

Periodic membership balances have an explicit `benefitPeriodKey`. This keeps
the credit ledger auditable while allowing a finite allowance to reset at the
next weekly or monthly boundary. Consumption is atomically guarded by the
activity, source, benefit, membership period, and benefit-window key, so a
retry cannot consume the same attendance twice.

## Makeup credits (TASK-010)

Makeup credits are staff-managed, origin-linked class entitlements. Each
credit records the customer, origin class and session, reason, issue time,
optional expiration, and lifecycle status. A credit is represented by a
`MAKEUP_CREDIT` source record and one `ISSUED` transaction in the shared Phase
3 credit ledger; it is not a package edit or mutable counter.

Staff can grant a credit from a class-session roster or customer history. The
class-session cancellation workflow can optionally issue one
`VENUE_CANCELLED` credit for each active enrollee. Credits cover one future
eligible class attendance and are selected by earliest expiration. The normal
activity guard and conditional balance update make repeated attendance or
request retries idempotent. When fully consumed, the source record is marked
`CONSUMED`; expiration is enforced by the ledger and can also be recorded by
staff as `EXPIRED`.
