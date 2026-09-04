# Security and performance review

Passwords use salted Node `scrypt`; session tokens are cryptographically random and only their SHA-256 hashes are persisted. Every staff service receives `AuthContext` and scopes records to its organization. Public APIs return allow-listed data. Zod validates requests, templates escape customer text, and the browser receives no AWS credentials.

Authentication and public request endpoints should be placed behind an edge rate limit before a public launch. Request logs contain request ID, route, method, status, duration, and authenticated IDs, never passwords or authorization headers. Ordinary lists are limited and customer search is an organization-scoped in-memory filter accepted for the initial small dataset. Schedule reads use court/date partitions; reports are the only place where low-volume scans are accepted.
