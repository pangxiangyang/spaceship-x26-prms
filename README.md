# Spaceship X26 · Passenger Resource Management System

A full-stack TypeScript application for the Spaceship X26 Earth → Mars settlement mission.
**Passengers** discover and book the onboard resources their membership tier allows.
**Crew Leads** (exactly three of them) manage passengers, tiers and resources and monitor
usage through an audit trail and reports.

**Live demo: <https://prms-491279436702.asia-southeast1.run.app>**. The login page lists one account per role. The demo
runs on Cloud Run with Firestore and resets to fresh data every day at 04:00 (Singapore time).

```
packages/
  domain/   Pure business rules. No framework, no I/O. Most of the logic and tests live here.
  api/      Express 5 REST API: auth, validation, HTTP mapping, storage adapters, demo seed.
  web/      React 19 + Vite single-page app: passenger app and Crew Lead admin module.
deploy/     Script that provisions and deploys the live demo on Google Cloud.
```

---

## Quick start

Requirements: **Node.js ≥ 22** (see `.nvmrc`).

```bash
npm ci
npm run dev
```

Open **http://localhost:5173**. The API runs on :3000 and the Vite dev server proxies `/api` to it.
Locally the data lives in memory, and the ship comes pre-loaded with ten resources, seven
passengers and a week of realistic activity.

| Role               | Username       | Password       |
| ------------------ | -------------- | -------------- |
| Crew Lead          | `commander`    | `crewlead123`  |
| Crew Lead          | `navigator`    | `crewlead123`  |
| Crew Lead          | `medic`        | `crewlead123`  |
| Silver passenger   | `sam.silver`   | `passenger123` |
| Gold passenger     | `gwen.gold`    | `passenger123` |
| Platinum passenger | `pia.platinum` | `passenger123` |

The login page has the same accounts under _Demo accounts_. On the live demo the Crew Lead
password is different, and the login page shows it.

### Production build

```bash
npm run build      # builds web/dist and api/dist
NODE_ENV=production \
STORAGE=memory \
JWT_SECRET="$(openssl rand -hex 32)" \
PRMS_CREW_LEADS='[{"username":"commander","displayName":"Cmdr. Ava Reyes","password":"<12+ chars>"},{"username":"navigator","displayName":"Lt. Kenji Sato","password":"<12+ chars>"},{"username":"medic","displayName":"Dr. Leila Haddad","password":"<12+ chars>"}]' \
npm start          # http://localhost:3000 serves the API and the web app
```

Or with Docker:

```bash
docker build -t x26-prms .
docker run -p 3000:3000 -e STORAGE=memory -e JWT_SECRET=... -e PRMS_CREW_LEADS='[...]' -e SEED_DEMO_DATA=true x26-prms
```

Configuration is documented in [`.env.example`](.env.example). In production the server
**refuses to start** without a strong `JWT_SECRET`, exactly three Crew Leads, and an explicit
`STORAGE` choice.

### Storage

| `STORAGE`   | Used for                  | Notes                                                       |
| ----------- | ------------------------- | ----------------------------------------------------------- |
| `memory`    | development, tests        | Fast and zero setup. Data is lost on restart.               |
| `firestore` | the live demo, production | Google Cloud Firestore (Native mode), credentials from ADC. |

To run locally against a real Firestore database:

```bash
gcloud auth application-default login
STORAGE=firestore FIRESTORE_PROJECT_ID=<project> FIRESTORE_NAMESPACE=dev npm run dev
```

`FIRESTORE_NAMESPACE` keeps an environment's data under `environments/<namespace>`, so several
people or environments can share one database (the default, empty, uses root collections). Start-up is safe to repeat: existing Crew Leads are kept, and demo data
is seeded only once per data set.

### Scripts

| Command                               | What it does                                        |
| ------------------------------------- | --------------------------------------------------- |
| `npm run dev`                         | API (watch mode) + web dev server                   |
| `npm test`                            | All test suites (domain, api, web)                  |
| `npm run test:coverage`               | Tests with coverage reports                         |
| `npm run verify`                      | Lint + typecheck + tests                            |
| `npm run build`                       | Production build                                    |
| `npm run test:firestore -w @prms/api` | API suite on Firestore (emulator or a test project) |
| `npm run demo:reset -w @prms/api`     | Wipe and reseed the configured storage (demo only)  |

---

## Live demo deployment

[`deploy/cloud-run.sh`](deploy/cloud-run.sh) provisions and deploys everything. It is safe to
re-run, so the same command ships each new version:

```bash
PROJECT_ID=<project> ./deploy/cloud-run.sh     # REGION defaults to asia-southeast1
```

```
                 Cloud Scheduler (daily 04:00)
                            │ runs
                            ▼
 browser ──HTTPS──▶ Cloud Run service "prms"        Cloud Run job "prms-demo-reset"
                    (API + web app, 0–1 instances)  (wipe + reseed, same image)
                            │                                  │
                            └──────────────┬───────────────────┘
                                           ▼
                         Firestore (asia-southeast1) · Secret Manager
```

What it sets up:

- **Firestore** (Native mode) and an **Artifact Registry** repository. **Cloud Build** builds
  the `Dockerfile`, so no local Docker is needed.
- A **runtime service account** with only `datastore.user` and access to its two secrets
  (`JWT_SECRET`, the Crew Lead roster) in **Secret Manager**.
- The **Cloud Run service**: public, scales to zero, at most one instance (see
  [docs/DESIGN.md](docs/DESIGN.md#concurrency-and-atomicity) for why).
- A **Cloud Run job** running the same image with `reset-demo.js`, and a **Cloud Scheduler**
  trigger with its own service account that is only allowed to run that job.

To reset the demo by hand: `gcloud run jobs execute prms-demo-reset --region asia-southeast1`.

---

## What it does, mapped to the brief

### Level 1: Basic passenger & resource management

- **Crew Lead enforcement.** Exactly three Crew Leads. The roster is defined in
  configuration only; there is no API to add administrators. Registering a fourth is
  rejected with `CREW_LEAD_LIMIT_REACHED`, and the attempt is audited. Storage enforces
  the limit too, in the same transaction as the write, so it holds even when registrations
  race or code writes to storage directly. The server will not boot with fewer or more than three.
- **Resource definition.** Each resource has a category, a **minimum tier** and a
  **capacity** (how many passengers can use it at once). The seed follows the brief: Food
  Stations, Sleeping Pods and Basic Hygiene are Silver; Private Cabins and the Advanced
  Medical Bay are Gold; Luxury O2 Pods and the VIP Rec Deck are Platinum.
- **Passenger discovery.** Passengers see only active resources their tier grants.
  Higher tiers inherit lower-tier access through a single rank comparison.

### Level 2: Dynamic access & validation

- **Permission validation.** Every booking is checked in real time: role, tier
  entitlement, resource status, slot policy (15 min – 4 h, not in the past, ≤ 14 days ahead),
  the passenger's own overlapping bookings, and capacity. Capacity is measured as
  **peak simultaneous use**, not as a raw count of overlapping bookings. **Check-in re-validates
  entitlement** at the moment of use.
- **Tier management.** Crew Leads upgrade and downgrade passengers. A downgrade
  automatically cancels pending bookings the new tier no longer covers, and so does raising a
  resource's minimum tier or decommissioning it. Sessions already in progress are allowed to
  finish. A capacity reduction that would overbook future slots is refused.
- **Audit logging.** Every interaction is recorded as an immutable event with an
  outcome of `SUCCESS` or `DENIED` (plus the rule that denied it). That covers bookings,
  cancellations, check-ins, tier changes, provisioning and even rejected admin attempts.
  Crew Leads can filter and page through the trail.

### Level 3: Advanced reporting & insights

- **Personal history.** Each passenger sees their bookings with lifecycle (upcoming,
  in progress, completed, missed, cancelled), total time used, time by resource type and a
  7-day trend.
- **Aggregated reports.** Usage grouped by the tier **held at booking time**, so a later
  upgrade doesn't rewrite history.
- **Usage analytics.** For each resource: **average use** (booked seat-minutes ÷ available
  seat-minutes), **peak use** (how full it got at its busiest moment), and the number of
  bookings **refused because it was full**, with how many different passengers that was.
  Two or more turned-away passengers mark a resource as HIGH demand, the earliest shortage
  signal, and the report says which rule set each level. In the demo data, the two-seat
  Luxury O2 Pod shows how average use can mislead: it is full every afternoon (100% peak)
  and turns two other regulars away, yet its average over the week is about 7% because it is
  empty at night. The booking form hides full slots, so with real passengers refusals come
  only from races for the last place or stale availability; the seed books through the
  domain directly to show the signal.

---

## Architecture

```
            ┌──────────────── web (React) ─────────────────────┐
            │ pages → hooks (useApiData/useAction) → ApiClient │
            └───────────────────────┬──────────────────────────┘
                                    │ HTTP/JSON  (Bearer JWT)
┌──────────────────────── api (Express) ──────────────────────────────┐
│ routes → zod validation → domain services → presenters (DTOs)       │
│ authenticate / requireRole · errorHandler (DomainError → HTTP)      │
│ AuthService (bcrypt, JWT) · composition root · demo seed and reset  │
│ Storage adapters: in-memory │ Firestore   (chosen by STORAGE)       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ depends on (never the reverse)
┌────────────────────────── domain ───────────────────────────────────┐
│ Services: CrewLead · Passenger · Resource · Booking · Report · Audit │
│ Entities & value objects: Passenger, Resource, Booking, TimeSlot    │
│ Policies: MembershipTier, BookingPolicy, authorization guards       │
│ Ports: UserRepository, ResourceRepository, BookingRepository,       │
│        AuditLog, Clock, IdGenerator                                 │
└─────────────────────────────────────────────────────────────────────┘
```

Dependencies point inward. The domain knows nothing about HTTP, Express, React, JWTs or
Firestore, so it can be tested quickly and in isolation (134 tests run in about 1.5 s). Adding
Firestore didn't change a single domain service. It only needed new adapters for the
existing ports.

Design decisions, the patterns used and why, and the trade-offs are written up in
**[docs/DESIGN.md](docs/DESIGN.md)**. Every interpretation of the brief is listed in
**[docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md)**.

### REST API

All endpoints except health, meta and login require `Authorization: Bearer <token>`.
Errors share one shape: `{ "error": { "code": "CAPACITY_EXCEEDED", "message": "…", "issues"?: [...] } }`.

| Method & path                                | Who        | Purpose                                     |
| -------------------------------------------- | ---------- | ------------------------------------------- |
| `POST /api/auth/login`                       | anyone     | Sign in (rate-limited)                      |
| `GET /api/meta`                              | anyone     | Tiers, categories, policy, demo accounts    |
| `GET /api/me`                                | signed in  | Current user                                |
| `GET /api/resources`                         | passenger  | Resources the tier grants                   |
| `GET /api/resources/:id/occupancy?from&to`   | passenger  | Anonymised booked slots (≤ 7 days)          |
| `GET /api/bookings`                          | passenger  | Own bookings                                |
| `POST /api/bookings`                         | passenger  | Book `{resourceId, start, end}`             |
| `POST /api/bookings/:id/check-in`            | passenger  | Start usage (re-validated)                  |
| `POST /api/bookings/:id/cancel`              | owner/crew | Cancel a pending booking                    |
| `GET /api/history`                           | passenger  | Personal history and trends                 |
| `GET/POST /api/admin/passengers`             | crew       | List / create passenger accounts            |
| `PATCH /api/admin/passengers/:id`            | crew       | Rename                                      |
| `PUT /api/admin/passengers/:id/tier`         | crew       | Upgrade / downgrade                         |
| `GET /api/admin/passengers/:id/history`      | crew       | A passenger's history                       |
| `GET/POST /api/admin/resources`              | crew       | Inventory / provision                       |
| `PATCH /api/admin/resources/:id`             | crew       | Edit (capacity, tier, …)                    |
| `POST /api/admin/resources/:id/decommission` | crew       | Retire a resource                           |
| `GET /api/admin/crew-leads`                  | crew       | The three Crew Leads                        |
| `GET /api/admin/audit`                       | crew       | Filter by action/outcome/actor/subject/time |
| `GET /api/admin/reports/tier-usage`          | crew       | Usage grouped by tier                       |
| `GET /api/admin/reports/resource-demand`     | crew       | Average/peak use, turn-aways, demand level  |

Status codes: `400` invalid input · `401` not signed in, or the account no longer exists ·
`403` role or tier not allowed · `404` unknown · `409` conflicts with current state (full,
overlapping, wrong state, duplicate username) · `429` too many sign-in attempts.

---

## Testing

| Suite  | Tests | Style                                                                     |
| ------ | ----- | ------------------------------------------------------------------------- |
| domain | 134   | Unit and service tests with a controllable clock, no mocks of the domain  |
| api    | 61    | Integration tests over real HTTP (supertest) and a storage contract suite |
| web    | 15    | API client, formatting rules, login and role-based routing                |

The domain was built test-first, level by level (see the commit history). Domain coverage
is about 98% of lines.

**Storage is tested against both backends.** One contract suite defines how every store must
behave, and it runs against the in-memory stores and against Firestore. The whole API suite
can also run on Firestore (`npm run test:firestore -w @prms/api`). CI does this on the
Firestore emulator. Locally it runs against a real project when `PRMS_FIRESTORE_TEST_PROJECT`
is set, writing under a throwaway prefix that is deleted afterwards. CI also starts the built
production bundle as a smoke test.

Some tests worth reading:

- `persistenceContract.ts › never overbooks when two processes book the same resource at once`:
  two domain instances on one store (like two servers) send 10 bookings at a capacity-3
  resource, and exactly 3 succeed, in memory and on Firestore.
- `atomicUseCases.test.ts`: a booking whose audit record can't be written is not stored, and
  a downgrade that fails partway through changes nothing.
- `TimeSlot.test.ts › counts simultaneous use, not the number of overlapping bookings`
- `PassengerService.test.ts › on downgrade, revokes only pending bookings the new tier no longer covers`
- `ReportService.test.ts › groups usage by the tier held at booking time`
- `bootstrap.test.ts › restarts on the same storage without duplicating crew leads or demo data`

---

## Known limitations & next steps

Product ideas (a deck map of the ship, an availability timeline when booking) and other
follow-ups are described in **[docs/ROADMAP.md](docs/ROADMAP.md)**.

- **One instance, by choice.** Bookings are safe across processes (each use case is a
  Firestore transaction), but the service runs one instance to stay free while idle, and
  the sign-in rate limiter counts per instance. A shared limiter store would come first when
  scaling out. See [docs/DESIGN.md](docs/DESIGN.md#concurrency-and-atomicity).
- The demo reset deletes and reseeds one collection at a time, so a write made in those
  seconds can survive the reset. Accepted for a demo.
- Every authenticated request reads the user's document, so tokens of removed accounts are
  rejected. A short-lived cache would save those reads if traffic grew.
- Passwords are set by Crew Leads at creation. There's no self-service reset yet.
- JWTs are stateless, so sign-out is client-side. Tokens stop working as soon as their
  account no longer exists, but a revocation list or refresh tokens would harden this further.

---

## AI usage disclosure

See **[docs/AI_USAGE.md](docs/AI_USAGE.md)**.
