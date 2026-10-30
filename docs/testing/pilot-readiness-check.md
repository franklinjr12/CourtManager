# Pilot readiness check (CM-002 / Epic 4 TASK-001)

- Date: 2026-10-30
- Commit: `a76d9957c07f141dd91169942ba3f459dd554073`
  (`a76d995 Merge pull request #5 from franklinjr12/fix/integration-test-isolation`)
- Scope: automated gates (step 1) and manual journeys (step 2). Report only;
  no code, test or config was changed.

## Environment

| Item           | Value                                                        |
| -------------- | ------------------------------------------------------------ |
| Node           | v26.12.1 (production targets Node 22; see note below)        |
| pnpm           | 9.15.5 (via corepack)                                        |
| Docker         | 29.1.3, Compose 2.40.3                                       |
| Playwright     | 1.62.1 (chromium)                                            |
| DynamoDB Local | `docker compose up -d dynamodb` on :8120                     |
| Env vars       | Values of `.env.example` exported into the shell (no `.env`) |

Notes:

- The first `test:integration` run was done without the `.env.example`
  variables and failed with `UnrecognizedClientException` (no tests ran). It
  was re-run with the variables exported; only the re-run is counted below.
- `check` was run once, without the `.env.example` variables (they are not used
  by lint/typecheck/format/unit tests).
- The first full `test:e2e` run was killed by the tool's 10 min background
  limit and was re-run from scratch with a longer limit; only the complete
  re-run is counted below.
- Node v26 differs from the production target (Node 22). Whether this is the
  cause of G-1 and G-3 was **not verified**.

## Gates

| Gate | Command                                          | Result | Summary                                                                                                                                                                |
| ---- | ------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `corepack pnpm check`                            | FAIL   | lint, typecheck and format:check passed; `test` step: 3 files / 16 tests failed, 227 passed (243), 72 files; 10m38s                                                    |
| 2    | `corepack pnpm test:integration`                 | FAIL   | 1 file / 1 test failed, 17 passed (18), 10 files; 40s                                                                                                                  |
| 3    | `corepack pnpm test:e2e`                         | FAIL   | 44 failed, 21 passed (65 tests, chromium); 27m47s                                                                                                                      |
| 4    | `corepack pnpm test:phase3:all`                  | FAIL   | `test:phase3` 31 files / 78 tests passed; `test:phase3:integration` 1 failed, 11 passed; chain stopped (`&&`) so `test:phase3:e2e` did not run inside the chain; 2m04s |
| 4b   | `corepack pnpm test:phase3:e2e` (run separately) | FAIL   | 12 failed, 6 passed; 8m27s                                                                                                                                             |
| 5    | `corepack pnpm build`                            | PASS   | exit 0; API/contracts build and Vite build OK (`dist/assets/index-*.js` 246 kB, gzip 56 kB); 9s                                                                        |

`git status` after all gates was clean (no tracked file was changed).

## Failures

### G-1 (gate 1): web unit tests fail on `localStorage` — severity: blocker

`pnpm check` is the release gate and it is red.

- Files: `apps/web/src/i18n.test.ts` (7/7 tests fail),
  `apps/web/src/customer-auth.test.ts` (1), `apps/web/src/screens/customer-portal.test.ts`
  (8/8).
- Error excerpt:
  `TypeError: Cannot read properties of undefined (reading 'setItem')` at
  `apps/web/src/customer-auth.ts:21` (`setCustomerSession`), and
  `... (reading 'clear')` in the test setup. Log also shows
  `ExperimentalWarning: localStorage is not available because
--localstorage-file was not provided`.
- Possible cause (unverified): Node 26 ships an experimental global
  `localStorage` that shadows the jsdom one. Needs retesting on Node 22.
- Repro: `corepack pnpm check`, or just
  `corepack pnpm exec vitest run apps/web/src/i18n.test.ts
apps/web/src/customer-auth.test.ts apps/web/src/screens/customer-portal.test.ts`.

### G-2 (gates 2 and 4): monthly class membership limit test — severity: major

- Test: `apps/api/src/integration/phase3-workflows.test.ts` > "Phase 3 HTTP
  workflows on DynamoDB Local > covers a monthly class membership, enforces the
  limit, and resets on renewal".
- Error excerpt: `AssertionError: expected [ { sourceType: 'MEMBERSHIP', ... } ]
to deeply equal []`. The received entry has `benefitId:
monthly-class-attendance`, `benefitPeriodKey: MONTH:2026-11`,
  `availableQuantity: 1`, so a membership benefit is still available where the
  test expects none after the limit is used. The test uses dates around the
  current month/next month boundary (today is 2026-10-30), so it may be
  date-sensitive (unverified).
- Repro: `set -a; . ./.env.example; set +a; corepack pnpm test:integration`
  or `corepack pnpm test:phase3:integration` (DynamoDB Local must be up:
  `docker compose up -d dynamodb`).

### G-3 (gates 3 and 4b): browser flows fail — severity: blocker

44 of 65 Playwright tests fail, including the pilot-relevant ones. Failures
are deterministic: `fixed-court-agreements.spec.ts:5` and
`phase2-smoke-v2.spec.ts:47` were re-run alone once and failed again with the
same errors.

- Representative failures:
  - `fixed-court-agreements.spec.ts:5` "staff can create and inspect a fixed
    recurring court agreement": heading `Fixed court agreements` not found.
  - `phase2-smoke-v2.spec.ts:47` "AUTO_CONFIRM booking appears for customer,
    staff, and finance": `getByRole('navigation', { name: 'Customer
navigation' })` not found.
  - `phase2-smoke.spec.ts:123` REQUEST_APPROVAL approved by staff; `:62`
    AUTO_CONFIRM + concurrent slot + cancel; `:154` class waitlist.
  - `customer-portal.spec.ts` (all 5 listed), `reservations.spec.ts`,
    `public-requests.spec.ts`, `phase2-account-lifecycle.spec.ts`,
    `phase2-policy-availability.spec.ts` (2 of 3), `i18n.spec.ts`,
    `memberships.spec.ts`, `makeup-credits.spec.ts`, `operational-pages.spec.ts`.
  - Commonly seen: `waiting for navigation until "load"`,
    `#portal-booking-result` empty (expected `Reservation confirmed.` /
    `Request sent.`), `Test timeout of 30000ms exceeded`.
- Passing e2e tests include: customer register/login (`phase2-smoke-v2:22`),
  waitlist join/leave, availability search rules.
- Cause not diagnosed (report only). Same session-storage area as G-1 is a
  suspect but not confirmed. A Vulkan/GPU warning from chromium
  (`VK_ERROR_INCOMPATIBLE_DRIVER`) appears in the log and is probably unrelated.
- Repro: `set -a; . ./.env.example; set +a; corepack pnpm test:e2e`; single
  spec: `corepack pnpm exec playwright test
tests/e2e/fixed-court-agreements.spec.ts`.
- Full failing list for gate 3 is in the run log (not committed); it covers
  commercial-canonical (3 of 4 listed), commercial-validation:40,
  customer-commercial-balance:11, duration-intervals:12,
  phase2-handoff-security (4 of 5), phase3-workflows:101,
  reservation-api:6, reservation-entitlements:6, reservations (2),
  responsive:8 and the specs above.

### G-4 (gate 4): `test:phase3:all` chain incomplete — severity: major

The script chains with `&&`, so after G-2 `test:phase3:e2e` never ran inside
the chain. It was run separately (gate 4b): 12 failed / 6 passed, same
symptom class as G-3 (fixed-court agreement, memberships, makeup credits,
entitlement specs). Gate 4 therefore cannot pass until G-2 and G-3 are
resolved.

### J-1 (journey C): fixed-court agreement charge cannot be paid from the UI — severity: blocker

For the fixed-court (mensalista) flow, staff have no way to record the external
payment against the agreement charge. The only payment form (Financeiro >
Registrar pagamento) lists reservations, not charges. Recording R$ 400 against
one of the agreement's reservations is accepted (201) but leaves the agreement
charge `UNPAID` and the customer balance unchanged. `grep chargeId apps/web/src`
only matches `core/types.ts`, so no screen sends a `chargeId`.

1. Log in as owner@pilot.test (pt-BR). Comercial > Acordos de quadra fixa >
   Adicionar acordo de quadra fixa: Davi Dois, Quadra 2, Quarta-feira, 19:00,
   60 minutos, 04/11/2026 to 25/11/2026, R$ 400. Result: charge
   `FIXED_COURT_AGREEMENT` R$ 400 and 4 reservations.
2. Financeiro > Registrar pagamento. Reserva `04/11/2026 19:00 · R$ 0,00`,
   Cliente Davi Dois, amount 400, Transferência bancária.
3. Expected: the agreement charge is paid and Davi's balance drops by R$ 400.
   Actual: "Pagamento registrado.", but `GET /charges` shows the agreement charge
   `paidAmount 0, outstanding 400, UNPAID` and `GET /finance/balances` shows
   Davi `charges 570, payments 0, outstanding 570`.
4. Workaround, API only: `POST /payments {chargeId, customerId, amount: 400,
method}` gives 201; the charge becomes `PAID` and the balance becomes
   `payments 400, outstanding 170`. Staff cannot do this from the UI.

Calling this a blocker because the task lists the fixed-court flow "create
agreement -> recurring reservations -> record external payment" as part of the
pilot; if the pilot does not bill mensalistas, treat it as major.

### J-2 (journeys B/staff regression): editing a reservation time always fails — severity: major

`PATCH /reservations/:id` fails for every booked reservation I tried with
`400 VALIDATION_ERROR "A DynamoDB transaction cannot contain more than 100
actions."` (11 of 11 reservations whose new time was inside opening hours). The
UI only shows "Algumas informações são inválidas." and the reservation does not
change. The raw DynamoDB message is also returned by the API. Workaround: cancel
and rebook.

1. Staff (ana@pilot.test) > Reservas > Abrir on any `Agendada` reservation
   (e.g. 29/12/2026 10:00, Quadra 1).
2. Change Início to 11:00 and Fim to 12:00 (or leave unchanged) and click
   Salvar horário.
3. Expected: time saved. Actual: error toast above; request body was
   `{"startAt":"2026-12-29T14:00:00.000Z","endAt":"2026-12-29T15:00:00.000Z"}`
   and the API answered 400 with the DynamoDB message. Not diagnosed.

### J-3 (staff regression): a checked-in reservation cannot be completed or marked no-show from the UI — severity: major

1. Staff > Reservas > Abrir on a `Agendada` reservation > Check-in (works,
   status "Check-in feito").
2. Reopen the reservation. Expected: Concluir / Não compareceu available.
   Actual: the dialog has only "Fechar" (no Concluir, Não compareceu, Cancelar
   or Registrar pagamento); `apps/web/src/screens/reservations.ts` only renders
   them when the reservation is editable (BOOKED).
3. On a still-`Agendada` reservation the Concluir button is shown, but clicking
   it gives "Esta ação não está disponível no estado atual."
4. `POST /reservations/:id/complete` on the checked-in reservation returns 200,
   so completion works through the API only. No-show works from `Agendada`
   (see journey B).

### J-4 (journey A, both modes): Reports "Em aberto" ignores payments recorded outside the period — severity: major

The owner's metrics page contradicts the Financeiro page after a payment is
recorded before the service date.

1. Create two R$ 80 reservations (31/10 and 01/11/2026) and, on 30/10/2026,
   record R$ 80 against one of them.
2. Owner > Relatórios, De 31/10/2026, Até 30/11/2026, Aplicar filtros.
3. Expected: Receita prevista R$ 160, Em aberto R$ 80 (two R$ 80 reservations,
   one paid). Actual: Em aberto R$ 160. `GET /reports/operations` returns
   `recordedPayments 0, outstanding 160` for that range and `recordedPayments
130, outstanding 80` for 30/10 to 30/11; `GET /finance/summary` returns
   outstanding 80. Payments are filtered by `paidAt` inside the range while
   charges are filtered by service date. The page also has no "payments
   recorded" metric.
4. Related: the owner's default view (Hoje, and Relatórios 1 Oct to today) shows
   0 reservations and R$ 0,00 when all bookings are in the future. This is by
   design, but the owner must change the date range to see pilot activity.

### J-5 (journeys A/B/C): some screens format times in the browser timezone, not the venue timezone — severity: major (only when the device timezone differs from the venue)

The venue is `America/Sao_Paulo`. Staff tables and the staff schedule show venue
time, but these places use the device timezone:

- Customer portal Atividades, the cancellation-cutoff copy and the waitlist
  entry time.
- Staff Acordos de quadra fixa > Detalhes, "Reservas vinculadas".

1. Customer Carla books Quadra 1, 02/11/2026 07:00 (venue time; the staff
   schedule shows 07:00–08:00).
2. Open /portal/arena-piloto/reservations with the browser timezone UTC.
3. Expected: 07:00 and "Cancelamento disponível até 02/11/2026 01:00".
   Actual: `02/11/2026 10:00` and "até 02/11/2026 04:00". With the browser set to
   `America/Sao_Paulo` the same reservation is correct (22:00 stays 22:00); with
   `Asia/Tokyo` it shows 31/10/2026 10:00. The waitlist entry shows 21:57 in the
   portal and 18:57 in the staff list. The agreement for 19:00 lists its
   reservations as 22:00–23:00.
4. No effect for devices already in the venue timezone, which is why this is not
   a blocker.

### J-6 (journey A): payment form accepts zero and over-payments — severity: minor

1. Reservas > Abrir > Registrar pagamento on an already paid reservation.
   Amount defaults to 0 (outstanding). Click Registrar pagamento.
2. Expected: validation error. Actual: "Pagamento registrado." with R$ 0,00. A
   R$ 50 payment on the same paid R$ 80 reservation was also accepted
   (`POST /payments`: 201). The reservation then shows `OVERPAID` and the
   customer has payments 130 against charges 80. Staff can delete the payment
   ("Excluir").

### J-7 (journeys A/B/C): raw IDs shown instead of names — severity: minor

- Solicitações: the Quadra column shows the court UUID (also missing from
  Revisar).
- Financeiro: the "Reserva/aula" table's Cliente column and the payments
  history's "Reserva/aula" column show UUIDs.
- Listas de espera (staff): after fulfilling, the Ações column shows the
  enrollment UUID.
- Portal Listas de espera: "Aula f216264a-…" instead of the class name.
- Agreement Detalhes: linked reservation shows the UUID and `BOOKED`.

### J-8 (all journeys): untranslated strings in the pt-BR locale — severity: minor

- Public `/book/:slug` in AUTO_CONFIRM: "Sign in or register to reserve an
  available court instantly." and "Sign in to book".
- Portal navigation: "Memberships" (staff UI says "Mensalidades").
- Portal Atividades: "Reservation is already cancelled." (cancelled card) and
  "Cancellation period has ended." (reservation inside the cutoff).
- Raw enum values: `OVERPAID` (Reservas payment status), `BOOKED` (agreement
  Detalhes), `STAFF`/`COACH`/`OWNER` (Equipe role column and the role select).
- Classes list (staff) and portal show ISO dates ("2026-11-10 18:00") instead of
  dd/mm/aaaa.
- No raw i18n keys (for example `common.close`) were found on 16 staff pages and
  8 portal pages.

### J-9 (journey C): missing accents in pt-BR copy — severity: minor

"Visao geral", "Pacotes e creditos" (sidebar and page titles); fixed-court
screens: "Horarios recorrentes com cobranca no nivel do acordo", "Alterar horario
futuro", "Proxima ocorrencia", "Cobranca", "R$ 400,00/mes", "Criar ocorrencias
disponiveis e ignorar conflitos".

### J-10 (various): confusing or wrong labels — severity: minor

- Reservation detail Check-in asks the native confirm "Concluir reserva?"
  (completion text is reused for check-in).
- The payment dialog and the payments table call the amount "Preço".
- Classes form: the coach select is labelled "Função".
- Portal Reservar shows the green banner "Reserva confirmada. Esta quadra está
  reservada para você." before anything is booked.
- Public `/book/:slug` shows "Algumas informações são inválidas." as the content
  of the time field until a date is chosen.
- Toast after blocking a court reads "Bloquear quadra" (the action name).
- Phone portal nav (390 px) wraps to two lines and breaks words ("Atividade s",
  "Members hips").

### J-11 (journey A): customer select pre-selects the first customer — severity: minor

The customer select in Nova reserva and Reserva recorrente has no empty
"Selecione um cliente" option, so the first customer in the list is preselected
(Maria Silva in my data). The form can be saved without an explicit choice, so a
busy employee can book for the wrong customer. In my own runs the first
reservation was saved this way, and my AUTO_CONFIRM staff booking went to Maria
because my script left the first option selected.

### J-12 (journey B): unknown portal URL shows a generic failure — severity: minor

`/portal/arena-piloto/activities` (the route is `/reservations`) renders "Local
indisponível / Falha na solicitação" after `GET /public/venues/` (empty slug)
returns 404, instead of a not-found page.

## Manual journeys

Environment: local stack from `corepack pnpm dev` (DynamoDB Local on :8120, API
:8787, Vite :5173) on a freshly reset DB; Node v26.12.1; Chromium driven by
throwaway Playwright scripts (kept outside the repo, not committed); locale
pt-BR; the browser timezone is UTC unless stated. Venue: "Arena Piloto" slug
`arena-piloto`, `America/Sao_Paulo`, created with `corepack pnpm bootstrap:owner`
(owner@pilot.test). Data created through the UI unless the table says API: employee
Ana (STAFF), coach Beto, courts Quadra 1 and 2 (Tênis) and Quadra Areia (Vôlei;
it exists twice because my script ran twice, which is not an app defect),
customers Maria, Pedro, João (request), Lia (request), Carla and Davi
(portal accounts). Today was 30/10/2026 (Friday). "API" in the notes means the
step was verified by `curl`/fetch instead of the UI. Mode switches were made
in Configurações > Modo de reserva.

### A-REQUEST_APPROVAL (section 74 milestone)

| Step                                            | Result | Evidence / notes                                                                                                                                                                                                                                                                                |
| ----------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner creates organization                      | PASS   | Via CLI `bootstrap:owner` (ORGANIZATION_NAME=Arena Piloto); there is no UI/API for creating an organization (README documents the CLI). Owner login works, default mode REQUEST_APPROVAL.                                                                                                       |
| Owner creates courts                            | PASS   | Configurações > Adicionar quadra: Quadra 1 and Quadra 2, 60-min slots; "Quadra adicionada." and listed with R$ 80,00/hora.                                                                                                                                                                      |
| Employee opens schedule                         | PASS   | Owner created employee Ana (Equipe, STAFF); Ana logs in, Agenda loads; her menu has no Equipe/Configurações.                                                                                                                                                                                    |
| Employee creates customer                       | PASS   | Clientes > Adicionar cliente: Maria Silva; "Cliente criado.", listed.                                                                                                                                                                                                                           |
| Employee reserves court                         | PASS   | Agenda > Nova reserva, Quadra 1, 31/10/2026 20:00, 60 min; "Reserva criada."; schedule shows "20:00–21:00 — Maria Silva · Agendada · Não pago". Customer was preselected (J-11).                                                                                                                |
| Double booking is prevented                     | PASS   | UI: the taken 20:00 is no longer offered (120-min list also hides 19:00). API: second `POST /reservations` for the same slot returns 409 `SCHEDULE_CONFLICT` ("Court is no longer available."). Stale-form race in the UI shows "Este horário não está mais disponível. Escolha outro horário." |
| Public customer sees availability (/book/:slug) | PASS   | Anonymous page lists courts/dates; for 31/10 Quadra 1 the 20:00 start is missing, free starts shown. (Time field shows an odd validation message before a date is chosen, J-10.)                                                                                                                |
| Public customer requests court                  | PASS   | Quadra 1, 01/11/2026 10:00, 60 min, João Público 11955554444: "Solicitação enviada. O local entrará em contato após analisá-la." The slot stayed available (no occupancy).                                                                                                                      |
| Employee sees request                           | PASS   | Solicitações de reserva: "1 pendentes", João Público, 11955554444, 01/11/2026 10:00–11:00, Solicitada. Court column is a UUID (J-7).                                                                                                                                                            |
| Employee contacts customer externally           | PASS   | Contact info is visible: phone in the row; Revisar shows phone, e-mail and the customer's note. No click-to-call/WhatsApp link and no "contacted" marker; contact happens outside the app as specified.                                                                                         |
| Employee confirms request                       | PASS   | Confirmar > Confirmar solicitação ("Criar cliente a partir da solicitação" preselected): "Solicitação confirmada.", status Confirmada, 0 pendentes.                                                                                                                                             |
| Reservation appears on schedule                 | PASS   | Agenda 01/11: "10:00–11:00 — João Público · Agendada · Não pago"; also in Reservas.                                                                                                                                                                                                             |
| Employee records external payment               | PASS   | Reservas > Abrir > Registrar pagamento, R$ 80, PIX: "Pagamento registrado."; Financeiro shows the payment. (A repeated attempt recorded R$ 0, see J-6.)                                                                                                                                         |
| Owner sees reservation/revenue metrics          | FAIL   | Hoje shows 0 (bookings are in the future). Relatórios 31/10 to 30/11: Reservas 2, Receita prevista R$ 160, but Em aberto R$ 160 although R$ 80 was paid (J-4). Financeiro/`/finance/summary` is correct (paid R$ 80, outstanding R$ 80).                                                        |

### A-AUTO_CONFIRM (section 74 milestone)

Same organization and courts reused; mode switched in Configurações ("Organização
salva.", reload shows AUTO_CONFIRM). Booking window set to 60 days.

| Step                                            | Result | Evidence / notes                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner creates organization                      | N/A    | Organization already created in the first pass; the milestone's mode switch is the only change.                                                                                                                                                                                                         |
| Owner creates courts                            | N/A    | Courts already exist from the first pass.                                                                                                                                                                                                                                                               |
| Employee opens schedule                         | PASS   | Ana opens Agenda for 02/11 and 03/11.                                                                                                                                                                                                                                                                   |
| Employee creates customer                       | PASS   | Pedro Souza created, "Cliente criado."                                                                                                                                                                                                                                                                  |
| Employee reserves court                         | PASS   | Quadra 2, 03/11/2026 20:00: "Reserva criada." (customer left at the first list entry, Maria; J-11).                                                                                                                                                                                                     |
| Double booking is prevented                     | PASS   | API: same slot returns 409 `SCHEDULE_CONFLICT`. Customer-side race (two browsers) in journey B: one booking wins, the other gets "Este horário não está mais disponível. Escolha outro horário."                                                                                                        |
| Public customer sees availability (/book/:slug) | PASS   | Page shows the form plus "Sign in or register to reserve an available court instantly." and "Sign in to book" (English, J-8). API availability returns `onlineBookingAvailable: true` and omits booked slots (02/11 Quadra 1 07:00 absent).                                                             |
| Public customer requests court                  | PASS   | Behavior differs by design: anonymous request is refused (API 403 "Sign in to reserve this court."; UI link goes to the portal login). Carla registered ("Conta criada. Entrar", no auto login), signed in, picked Quadra 1 02/11 07:00 and clicked Confirmar reserva: "Reserva confirmada." instantly. |
| Employee sees request                           | N/A    | No `REQUESTED` record exists in this mode; the booking is created directly as Agendada.                                                                                                                                                                                                                 |
| Employee contacts customer externally           | N/A    | No request to review; the customer's phone/e-mail are in Clientes.                                                                                                                                                                                                                                      |
| Employee confirms request                       | N/A    | No confirmation step in AUTO_CONFIRM.                                                                                                                                                                                                                                                                   |
| Reservation appears on schedule                 | PASS   | Agenda 02/11: "07:00–08:00 — Carla Cliente · Agendada · Não pago"; also in Reservas and the customer's Atividades (shown as 10:00 with a UTC browser, J-5).                                                                                                                                             |
| Employee records external payment               | PASS   | Reservas > Abrir > Registrar pagamento, R$ 80, Dinheiro: "Pagamento registrado."; row changes to "Pago".                                                                                                                                                                                                |
| Owner sees reservation/revenue metrics          | FAIL   | Relatórios 02/11 to 30/11 shows Reservas 2, Receita prevista R$ 160 and Em aberto R$ 160 with R$ 80 paid; same defect as J-4.                                                                                                                                                                           |

### B: docs/phase2-manual-journeys.md checklist

Two-browser items used two isolated browser contexts, not two physical windows;
"phone" used a 390×844 mobile viewport, not a real device.

| Step                                                                                             | Result | Evidence / notes                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Short smoke: Register a new customer and sign in                                                 | PASS   | /portal/arena-piloto/register (Carla, Davi): "Conta criada. Entrar"; sign-in at /portal/arena-piloto/login works and lands on Início.                                                                                                                                                                                                       |
| Short smoke: AUTO_CONFIRM booking in Activities, staff schedule, charges                         | PASS   | Atividades lists it as Agendada; staff Agenda shows it; Financeiro has the R$ 80 charge (Carla). Time shown with the browser timezone (J-5).                                                                                                                                                                                                |
| Short smoke: two browsers, same slot, only one succeeds                                          | PASS   | Carla and Davi, Quadra 1 04/11 14:00, confirmed concurrently: "Reserva confirmada." vs "Este horário não está mais disponível. Escolha outro horário."; Reservas has a single 04/11 14:00 entry.                                                                                                                                            |
| Short smoke: cancel eligible reservation; slot returns; history keeps CANCELLED                  | PASS   | Atividades > Cancelar reserva (native confirm "Cancelar esta reserva?"): card moves to history as Cancelada; 14:00 is available again (API); staff Reservas keeps the row as Cancelada. The card note "Reservation is already cancelled." is English (J-8).                                                                                 |
| Short smoke: REQUEST_APPROVAL stays available until staff confirms                               | PASS   | Mode switched back. Anonymous request for Quadra 1 06/11 11:00: 11:00 stayed in availability while Solicitada; after "Solicitação confirmada." it was gone.                                                                                                                                                                                 |
| Short smoke: enroll in a class, then waitlist when full                                          | PASS   | Enabled "Habilitar aulas"; owner created coach Beto and class "Tênis Iniciantes" (capacity 1). Carla: "Inscrição confirmada."; Davi sees "Lotada" and "Entrar na lista de espera": "Você entrou na lista de espera."                                                                                                                        |
| Short smoke: staff fulfill a waitlist; status stays Atendida                                     | PASS   | Carla left the class ("Inscrição cancelada."); staff Listas de espera > Matricular cliente: "Cliente matriculado."; status Atendida. (Ações column then shows a UUID, J-7.)                                                                                                                                                                 |
| Short smoke: Customer A cannot read Customer B reservation IDs                                   | PASS   | API: Davi's token on Carla's reservation id: GET, cancel and participants all 404. Carla's token on /customers, /payments, /reservations: 401; a staff token on /customer/me: 401.                                                                                                                                                          |
| Visual: portal on desktop and phone; Home > Book > Activities > Classes > Profile                | PASS   | Walked Início, Reservar, Atividades, Aulas, Perfil at 1280×900 and 390×844; no horizontal overflow, content readable. Phone nav labels wrap mid-word (J-10).                                                                                                                                                                                |
| Visual: nested portal URLs survive refresh                                                       | PASS   | Reload on /portal/arena-piloto, /book, /reservations, /classes, /profile kept the page (desktop and phone). An unknown path shows a generic failure (J-12).                                                                                                                                                                                 |
| Visual: profile edits name/phone/email only                                                      | PASS   | Perfil has Nome, E-mail, Telefone only (no tags/notes); save: "Perfil atualizado."; value persists after reload.                                                                                                                                                                                                                            |
| Visual: sport filter on Book                                                                     | PASS   | Added a Vôlei court; filter Vôlei lists only Quadra Areia slots (UI). API `sport=Tênis`, `sport=Vôlei` and no filter return the expected courts.                                                                                                                                                                                            |
| Two-browser: same AUTO_CONFIRM slot, staff schedule shows single occupancy                       | PASS   | Same run as the smoke race; staff Reservas shows one reservation for the slot.                                                                                                                                                                                                                                                              |
| Timing: cancellation around the venue-local cutoff (6 h)                                         | FAIL   | Inside the cutoff (today 22:00, browser in America/Sao_Paulo): "Cancellation period has ended." (English) and no cancel button. Outside: "Cancelamento disponível até …" but computed in the browser timezone, not the venue's (J-5). The exact-boundary moment was NOT RUN: the venue is open 07:00–23:00 so no slot sat exactly 6 h away. |
| Timing: booking on last horizon day vs day after                                                 | PASS   | API only (window 60 days, today 30/10): 29/12 availability is returned and `POST /customer/reservations` gives 201; 30/12 returns no courts and the POST gives 400 "Requested time is outside the customer booking window." UI date limit not exercised.                                                                                    |
| Staff regression: Today, schedule, reservations, requests, customers, classes, finance, settings | PASS   | Sweep as owner: all 16 staff routes (also relatórios, equipe, the four comercial pages) load with a heading and no console error or HTTP 4xx/5xx. The employee used Hoje, Agenda, Reservas, Solicitações, Listas de espera, Clientes and Financeiro in the other runs.                                                                      |
| Staff regression: public anonymous /book request in REQUEST_APPROVAL                             | PASS   | Anonymous request from /book/arena-piloto (twice, João and Lia) created `Solicitada` requests that staff confirmed.                                                                                                                                                                                                                         |
| Staff regression: check-in                                                                       | PASS   | Reservas > Abrir > Check-in: "Status da reserva atualizado.", status "Check-in feito". The confirm text says "Concluir reserva?" (J-10).                                                                                                                                                                                                    |
| Staff regression: no-show                                                                        | PASS   | On an `Agendada` reservation: Não compareceu > confirm: status "Não compareceu".                                                                                                                                                                                                                                                            |
| Staff regression: completion                                                                     | FAIL   | See J-3: no Concluir on a checked-in reservation; on `Agendada` it is rejected. API complete works.                                                                                                                                                                                                                                         |
| Staff regression: recurring reservations                                                         | PASS   | Reservas > Reserva recorrente, Quadra 1, 09/11 to 23/11, 15:00, weekly: "Reservas recorrentes criadas." with 09/11, 16/11, 23/11.                                                                                                                                                                                                           |
| Staff regression: court blocks                                                                   | PASS   | Bloquear quadra, Quadra 2, 12/11 08:00–10:00 Manutenção: shown "Bloqueada · Manutenção"; a booking in the window via API gives 409 `SCHEDULE_CONFLICT`. (Toast text, J-10.)                                                                                                                                                                 |
| Reservation time edit (extra check on the Reservas detail dialog)                                | FAIL   | See J-2.                                                                                                                                                                                                                                                                                                                                    |

The "Product notes" at the end of the doc are not checklist items; only the
customer-token isolation checks above were run. Account `DISABLED` was NOT RUN.

### C: fixed-court agreement (mensalista) flow

| Step                                                           | Result  | Evidence / notes                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open Comercial > Acordos de quadra fixa                        | PASS    | Empty state "Nenhum acordo de quadra fixa cadastrado."; accent typos (J-9).                                                                                                                                                                           |
| Create agreement for customer/court/weekday                    | PASS    | Davi Dois, Quadra 2, Quarta-feira 19:00, 60 min, 04/11 to 25/11/2026, R$ 400/mês: "Acordo de quadra fixa criado."; row Ativo.                                                                                                                         |
| Recurring reservations on schedule / reservations list         | PASS    | Reservas and Agenda show 04/11, 11/11, 18/11, 25/11 19:00–20:00 Quadra 2, Davi Dois, Agendada (expected R$ 0,00 each; covered by the agreement). Detalhes lists the 4 linked reservations but in UTC (22:00–23:00) with UUIDs (J-5, J-7).             |
| Agreement charge created                                       | PASS    | `GET /charges`: `FIXED_COURT_AGREEMENT` R$ 400, ACTIVE; Detalhes shows "Não pago · R$ 0,00 / R$ 400,00".                                                                                                                                              |
| Record external payment against the agreement charge (UI)      | FAIL    | See J-1: the payment form has no charge option; no screen sends `chargeId`.                                                                                                                                                                           |
| Balance updates after the payment                              | FAIL    | UI path: R$ 400 payment recorded against an occurrence reservation leaves charge UNPAID and Davi `payments 0, outstanding 570`. API path with `chargeId` (workaround): charge PAID, balance `payments 400, outstanding 170`. Verified by API, not UI. |
| Agreement conflict handling, pause, change future time, cancel | NOT RUN | Not part of the requested flow.                                                                                                                                                                                                                       |

## Overall verdict

**Pilot-ready: NO.**

The core milestone from backlog section 74 works by hand in both modes: owner
bootstrap, courts, employee, customer, reservation, double-booking prevention,
public availability, public request (REQUEST_APPROVAL) or instant portal booking
(AUTO_CONFIRM), request review and confirmation, schedule, external payment.
The only milestone step that failed is the owner's revenue metrics (J-4, major).
The release gates are not green and one pilot flow is unusable from the UI.

Blockers:

1. G-1: `corepack pnpm check` is red (16 web unit tests fail on `localStorage`;
   not verified whether this is only a Node 26 problem; needs a Node 22 re-run).
2. G-3: `corepack pnpm test:e2e` has 44 of 65 failures (12 of 18 in
   `test:phase3:e2e`), so there is no automated proof of the pilot flows. The
   same flows worked by hand in pt-BR (the e2e specs run in en-US, which I did not
   walk), so the cause may be in the test setup; not diagnosed.
3. J-1: staff cannot record payment against a fixed-court agreement charge from
   the UI (blocker only if the pilot bills mensalistas).

Majors to fix or accept before go-live: G-2 and G-4 (phase 3 integration test and
chain), J-2 (reservation time edit fails), J-3 (cannot complete a checked-in
reservation), J-4 (Relatórios show wrong outstanding), J-5 (times in browser
timezone). Minors: J-6 to J-12 (copy, raw IDs, accents, form defaults).

Not run: the gates were not re-run on Node 22; `test:phase3:all` only ran
partially (G-4); exact-boundary cancellation cutoff; account `DISABLED`; agreement
pause/change/cancel; the en-US locale walk.
