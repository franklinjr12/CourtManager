# Epic: Phase 4 - Pilot Readiness

## Context

CourtManager is preparing a 90-day staff-operated pilot with 1-3 Curitiba sand arenas. Phase 4 does not add feature areas: it verifies, hardens and closes two small front-desk gaps before the pilot.

Sources:

- Product Roadmap: https://docs.google.com/document/d/1w5bhC5aBk5ZbitxAX9wcAoDWKSraUaPCXhzkjrmIVD8/edit
- Pilot Readiness Review: https://docs.google.com/document/d/1QFlP5coobMjAb2Dsq0IshrHaxPq-t_a00zhnxD9tchc/edit

## Scope

- TASK-001 — Pilot readiness verification run (report only)
- TASK-002 — Production hardening (template and config; no deploy)
- TASK-003 — Throttle login and public endpoints
- TASK-004 — Request inbox contact actions (backlog section 18.5)
- TASK-005 — Staff reservation durations 30-240 min

Rule for every task: keep the existing architecture rules (backlog section 77), add no new feature areas, run `corepack pnpm check` locally, keep pt-BR and en-US strings complete.

## Non-goals

The backlog section 72 out-of-scope list is unchanged: no Pix/payment gateway, WhatsApp API, automated email, recurring billing or new feature areas in this phase.

## TASK-001 — Pilot readiness verification run (report only)

**Objective:** prove the pilot workflow works end to end on current master before anything else changes.

**Requirements:** on a machine with Docker and Playwright, run `corepack pnpm check`, `test:integration`, `test:e2e`, `test:phase3:all` and `build`. In the local dev environment (pt-BR UI), walk the backlog section 74 MVP validation milestone once with REQUEST_APPROVAL and once with AUTO_CONFIRM, then walk docs/phase2-manual-journeys.md. Also record the fixed-court agreement (mensalista) flow: create an agreement, see the recurring reservations, record an external payment. Do not fix code in this row. Output: docs/testing/pilot-readiness-check.md with the result of each gate, a pass/fail line per journey step, and repro steps for every failure.

**Dependencies:** none.

**Acceptance:** the report exists and covers every gate and step listed. Each failure has repro steps and a severity (blocker/major/minor). If Docker or Playwright are not available, the row goes to blocked with that reason. Do not mark steps as passed without running them.

## TASK-002 — Production hardening (template and config; no deploy)

**Objective:** make a production deploy safe for real customer data.

**Requirements:** (a) the API answers CORS only for configured web origin(s) (production Pages domain from configuration) and local dev keeps working; (b) remove the reserved `AWS_REGION` Lambda environment variable from the SAM template; (c) the production DynamoDB table has point-in-time recovery and deletion protection on; (d) update docs/deployment.md (new parameter/variable) and docs/backups.md (PITR restore steps). Implementation choices belong to software-exec.

**Dependencies:** none.

**Acceptance:** a test shows that a request from a non-allowed origin gets no allow-origin header and an allowed origin does; the template has no `AWS_REGION` env, and PITR and deletion protection are set; `corepack pnpm check` and build pass; nothing is deployed (Franklin deploys).

## TASK-003 — Throttle login and public endpoints

**Objective:** limit brute force and spam before the URL is public.

**Requirements:** throttle staff login, customer login, customer registration, activation/password set and public reservation-request submission, both per client and per account/venue. Normal front-desk and customer use must not hit the limits. Throttled requests get a clear error response with the existing error format. The mechanism (application or edge) is software-exec's choice and is documented in docs/security-review.md. Add no web UI strings in this row (the existing error display is enough).

**Dependencies:** TASK-002 (same API bootstrap/config files).

**Acceptance:** tests show repeated failed logins rejected after the threshold and accepted again after the window; a burst of public requests is rejected; normal login/booking tests still pass; security-review.md updated; check passes.

## TASK-004 — Request inbox contact actions (backlog section 18.5)

**Objective:** staff can confirm a public request with the customer in one click from the inbox, through the venue's own WhatsApp.

**Requirements:** in the request review view add Copy phone, Copy customer name, Copy confirmation message and Open WhatsApp. The confirmation message is a short template in the UI language (pt-BR default, en-US) with venue name, court, date, start time and duration. Open WhatsApp opens `https://wa.me/<digits>?text=<encoded message>` in a new tab and shows only when the request has a phone. Phone digits are normalized; if the number has no country code, 55 is assumed (Assumption: Brazilian venues; to confirm). No WhatsApp API.

**Dependencies:** none.

**Acceptance:** DOM tests cover the clipboard content of each copy action, the correct encoded wa.me URL, and the WhatsApp button hidden without a phone; both locales have all new strings; check passes. Pass the screen to product-owner for functional acceptance.

## TASK-005 — Staff reservation durations 30-240 min

**Objective:** staff can book 90/120+ minute slots without the recurring workaround.

**Requirements:** the staff single-reservation and recurring-reservation forms offer durations in 30-minute steps from 30 to 240 min, as in the public flow (docs/public-booking-flow.md). The expected amount prefill keeps scaling with duration. Default stays 60 min (Assumption: pilots book 60/90/120; to confirm).

**Dependencies:** TASK-004 (shared i18n/web files).

**Acceptance:** both forms list 30, 60, 90 ... 240; picking 90 min on a R$100/h court prefills R$150; a 90-min booking saves and blocks the right slots on the schedule; DOM tests updated; check passes.
