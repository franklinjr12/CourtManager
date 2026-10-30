# Security and performance review

Passwords use salted Node `scrypt`; session tokens are cryptographically random and only their SHA-256 hashes are persisted. Staff sessions resolve `AuthContext`; customer sessions resolve the separate `CustomerAuthContext` and cannot call staff routes. Customer login requires venue slug plus email/password, so same email may exist in different organizations. Customer routes derive customer ID from session, reject disabled accounts and expired records before TTL cleanup, and delete session records on logout. Every staff service receives `AuthContext` and scopes records to its organization. Public APIs return allow-listed data. Zod validates requests, templates escape customer text, and the browser receives no AWS credentials.

Customer authorization guarantee: every protected customer request resolves
`organizationId`, `customerId`, and `customerAccountId` from the hashed bearer
session. Services verify the session's account still belongs to that customer,
the customer belongs to that organization, and the customer is not archived.
Reservation, participant, class, enrollment, and waitlist operations compare
the target record to that context; changing an ID in the browser cannot select
another customer or organization. Customer request bodies do not accept a
customer ID for self-service operations. Staff and customer actor contexts are
not interchangeable.

Existing-customer portal access uses staff-generated, organization-scoped,
single-use activation or reset tokens. Only token hashes are stored, tokens
expire, and password-setting deletes the token transactionally. Staff manually
copy and deliver links through the venue's existing channel. Automated email is
deferred because Phase 2 has no outbound delivery, retry, bounce, or audit
workflow.

Login and public endpoints are throttled in the API (`apps/api/src/rate-limit.ts`) with fixed-window counters stored in DynamoDB, so limits hold across Lambda instances. Each counter is an item `RATE#<rule>#<sha256(subject)> / WINDOW#<windowStart>` incremented atomically (`Repository.increment`, one `UpdateItem`) with an `expiresAt` TTL; subjects are hashed, never stored raw. The client IP comes from the Lambda `sourceIp` (falling back to `x-forwarded-for` locally). Exceeding a limit returns HTTP 429 `RATE_LIMITED` in the standard error format. Staff and customer login count only failed attempts (5 per account and 30 per IP per 15 minutes; a success clears the account counter), so normal front-desk use is unaffected. Public request submission is limited to 20 per IP per 10 minutes and 300 per venue per hour; customer registration to 20 per IP and 200 per venue per hour; activation/reset to 20 per IP and 200 per venue per 15 minutes. An edge/WAF limit may be added later as defence in depth. Request logs contain request ID, route, method, status, duration, and authenticated IDs, never passwords or authorization headers. Ordinary lists are limited and customer search is an organization-scoped in-memory filter accepted for the initial small dataset. Schedule reads use court/date partitions; reports are the only place where low-volume scans are accepted.

Phase 3 commercial records are organization-scoped at every repository and
service boundary. Customer portal commercial routes derive the customer from
the authenticated customer session and return not-found for another
customer's membership or package. Commercial sources validate their customer,
organization, and current membership-period relationships before usage is
recorded. Only authenticated owners and staff can make manual credit
adjustments; the actor and a non-empty reason are persisted in the immutable
credit transaction.

Finite credit consumption and balance changes use conditional transactions,
with an activity/source guard making retries idempotent. Membership renewal,
package issuance, and cancellation restoration use stable logical identities;
renewal period advancement is transactional. Historical balances are rejected
if their durable ledger would become negative, and restoration is bounded by
the original allocation quantity.
