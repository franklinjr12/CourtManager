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

Authentication and public request endpoints should be placed behind an edge rate limit before a public launch. Request logs contain request ID, route, method, status, duration, and authenticated IDs, never passwords or authorization headers. Ordinary lists are limited and customer search is an organization-scoped in-memory filter accepted for the initial small dataset. Schedule reads use court/date partitions; reports are the only place where low-volume scans are accepted.
