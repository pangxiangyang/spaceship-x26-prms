# Spaceship X26 · Passenger Resource Management System

A full-stack TypeScript application for the Spaceship X26 Earth → Mars settlement mission.
**Passengers** discover and book the onboard resources their membership tier allows.
**Crew Leads** (exactly three of them) manage passengers, tiers and resources and monitor
usage through an audit trail and reports.

```
packages/
  domain/   Pure business rules. No framework, no I/O. Most of the logic and tests live here.
  api/      Express 5 REST API: auth, validation, HTTP mapping, composition root, demo seed.
  web/      React 19 + Vite single-page app: passenger app and Crew Lead admin module.
```

---

## Quick start

Requirements: **Node.js ≥ 20.11** (22 recommended, see `.nvmrc`).

```bash
npm ci
npm run dev
```

Open **http://localhost:5173**. The API runs on :3000 and the Vite dev server proxies `/api` to it.
In development the ship comes pre-loaded with ten resources, seven passengers and a week of
realistic activity.

| Role               | Username       | Password       |
| ------------------ | -------------- | -------------- |
| Crew Lead          | `commander`    | `crewlead123`  |
| Crew Lead          | `navigator`    | `crewlead123`  |
| Crew Lead          | `medic`        | `crewlead123`  |
| Silver passenger   | `sam.silver`   | `passenger123` |
| Gold passenger     | `gwen.gold`    | `passenger123` |
| Platinum passenger | `pia.platinum` | `passenger123` |

The login page also has a _Demo accounts_ shortcut.

### Production build

```bash
npm run build      # builds web/dist and api/dist
NODE_ENV=production \
JWT_SECRET="$(openssl rand -hex 32)" \
PRMS_CREW_LEADS='[{"username":"commander","displayName":"Cmdr. Ava Reyes","password":"<12+ chars>"},{"username":"navigator","displayName":"Lt. Kenji Sato","password":"<12+ chars>"},{"username":"medic","displayName":"Dr. Leila Haddad","password":"<12+ chars>"}]' \
npm start          # http://localhost:3000 serves the API and the web app
```

Or with Docker:

```bash
docker build -t x26-prms .
docker run -p 3000:3000 -e JWT_SECRET=... -e PRMS_CREW_LEADS='[...]' -e SEED_DEMO_DATA=true x26-prms
```

Configuration is documented in [`.env.example`](.env.example). In production the server
**refuses to start** without a strong `JWT_SECRET` and exactly three Crew Leads.

### Scripts

| Command                 | What it does                                      |
| ----------------------- | ------------------------------------------------- |
| `npm run dev`           | API (watch mode) + web dev server                 |
| `npm test`              | All test suites (domain, api, web)                |
| `npm run test:coverage` | Tests with coverage reports                       |
| `npm run verify`        | Lint + typecheck + tests, the same checks CI runs |
| `npm run build`         | Production build                                  |

---

## What it does, mapped to the brief

### Level 1: Basic passenger & resource management

- **Crew Lead enforcement.** Exactly three Crew Leads. The roster is defined at
  start-up only; there is no API to add administrators. Registering a fourth is
  rejected with `CREW_LEAD_LIMIT_REACHED`, even when registrations race, and the attempt
  is audited. The server will not boot with fewer or more than three.
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
- **Usage analytics.** Per-resource utilisation (booked seat-minutes ÷ available
  seat-minutes) plus the number of passengers **turned away because it was full**. Any
  turn-away marks a resource as HIGH demand, which is the earliest shortage signal. In the demo
  data, the two-seat Luxury O2 Pod is flagged this way.

---

## Architecture

```
            ┌──────────────── web (React) ────────────────┐
            │ pages → hooks (useApiData/useAction) → ApiClient │
            └───────────────────────┬─────────────────────┘
                                    │ HTTP/JSON  (Bearer JWT)
┌──────────────────────── api (Express) ─────────────────────────┐
│ routes → zod validation → domain services → presenters (DTOs)  │
│ authenticate / requireRole · errorHandler (DomainError → HTTP) │
│ AuthService (bcrypt, JWT) · composition root · demo seed       │
└───────────────────────────────┬────────────────────────────────┘
                                │ depends on (never the reverse)
┌────────────────────────── domain ──────────────────────────────┐
│ Services: CrewLead · Passenger · Resource · Booking · Report · Audit │
│ Entities & value objects: Passenger, Resource, Booking, TimeSlot │
│ Policies: MembershipTier, BookingPolicy, authorization guards  │
│ Ports: UserRepository, ResourceRepository, BookingRepository,  │
│        AuditLog, Clock, IdGenerator   ← in-memory adapters     │
└────────────────────────────────────────────────────────────────┘
```

Dependencies point inward. The domain knows nothing about HTTP, Express, React, JWTs or
storage, so it can be tested quickly and in isolation (125 tests run in about 1.5 s).

Design decisions, the patterns used and why, and the trade-offs are written up in
**[docs/DESIGN.md](docs/DESIGN.md)**. Every interpretation of the brief is listed in
**[docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md)**.

### REST API

All endpoints except health, meta and login require `Authorization: Bearer <token>`.
Errors share one shape: `{ "error": { "code": "CAPACITY_EXCEEDED", "message": "…", "issues"?: [...] } }`.

| Method & path                                | Who        | Purpose                                     |
| -------------------------------------------- | ---------- | ------------------------------------------- |
| `POST /api/auth/login`                       | anyone     | Sign in (rate-limited)                      |
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
| `GET /api/admin/reports/resource-demand`     | crew       | Utilisation, turn-aways, demand level       |

Status codes: `400` invalid input · `401` not signed in · `403` role or tier not allowed ·
`404` unknown · `409` conflicts with current state (full, overlapping, wrong state, duplicate
username) · `429` too many sign-in attempts.

---

## Testing

| Suite  | Tests | Style                                                                    |
| ------ | ----- | ------------------------------------------------------------------------ |
| domain | 125   | Unit and service tests with a controllable clock, no mocks of the domain |
| api    | 27    | Integration tests over real HTTP with supertest                          |
| web    | 12    | API client, formatting rules and role-based routing (Testing Library)    |

The domain was built test-first, level by level (see the commit history). Domain coverage
is about 98% of lines. Some tests worth reading:

- `BookingService.test.ts › never overbooks under concurrent requests`: 10 simultaneous
  requests on a capacity-3 resource produce exactly 3 bookings. With the lock removed,
  this test fails and all 10 succeed.
- `TimeSlot.test.ts › counts simultaneous use, not the number of overlapping bookings`
- `PassengerService.test.ts › on downgrade, revokes only pending bookings the new tier no longer covers`
- `ReportService.test.ts › groups usage by the tier held at booking time`

---

## Known limitations & next steps

- **Persistence is in-memory**, behind repository interfaces, so data resets on restart.
  A database adapter (e.g. PostgreSQL) would implement the same four ports. Capacity would then
  be protected by a transaction or row lock instead of the in-process mutex, which is correct
  only for a single API instance.
- Passwords are set by Crew Leads at creation. There's no self-service reset yet.
- JWTs are stateless, so sign-out is client-side. A revocation list or short-lived tokens
  with refresh would harden this.
- Report queries scan in memory, which is fine for a ship's population but would need
  database-side aggregation at scale.

---

## AI usage disclosure

See **[docs/AI_USAGE.md](docs/AI_USAGE.md)**.
