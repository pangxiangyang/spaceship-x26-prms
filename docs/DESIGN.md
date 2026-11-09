# Design notes

## Guiding idea

Put the rules where they are cheapest to test and hardest to bypass. Every business rule
lives in `packages/domain`, a framework-free TypeScript package. The API and the web client
are thin adapters around it. The domain exposes its services, not its storage, so a caller
from a CLI, a message queue or a test gets the same permissions and invariants. Code that
holds the storage itself (the API's composition root, the demo seed, tests) could write
around the services, so storage enforces the two identity invariants too: unique usernames
and at most three Crew Leads.

## Layers

| Layer                                                                                 | Responsibility                                                                                                | Depends on |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------- |
| **Entities & value objects** (`Passenger`, `Resource`, `Booking`, `TimeSlot`)         | Protect their own invariants: valid names, capacity range, state transitions such as `CONFIRMED → CHECKED_IN` | nothing    |
| **Policies** (`MembershipTier`, `BookingPolicy`, `authorization`)                     | Small, pure rules                                                                                             | entities   |
| **Application services** (`BookingService`, `PassengerService`, …)                    | Orchestrate a use case: authorize → load → apply rules → persist → audit                                      | ports      |
| **Ports** (`UserRepository`, `BookingRepository`, `AuditLog`, `Clock`, `IdGenerator`) | Interfaces the domain needs from the outside world                                                            | —          |
| **Adapters** (in-memory repositories, Express routes, JWT, bcrypt, React)             | Implement ports, or expose services                                                                           | domain     |

## SOLID in practice

- **Single responsibility.** Each service owns one area: crew roster, passengers,
  resources, bookings, reports, audit reads. Cross-cutting work has its own class:
  `BookingRevocation` cancels bookings invalidated by admin changes, and `AuditTrail` writes
  events. Presenters convert entities to DTOs, so neither routes nor entities know the JSON
  shape.
- **Open/closed.** Adding a tier means adding one entry to `TIER_RANK`, and every comparison,
  list and report picks it up. Booking limits are data (`BookingPolicy`), not code. The HTTP
  status table is a `Record<DomainErrorCode, number>`, so a new domain error code won't
  compile until it is mapped.
- **Liskov substitution.** `CrewLead` and `Passenger` both extend `User` and can be used
  wherever a `User` is expected (`AnyUser`). Role-specific behaviour (`tier`, `hasAccessTo`)
  exists only on `Passenger`, rather than as no-op methods on the base class.
- **Interface segregation.** Repository ports expose only what the services need. The web
  client's `ApiClient` takes just `getToken` and `onUnauthorized` instead of the whole auth
  context.
- **Dependency inversion.** Services depend on ports that are injected through
  `createPrmsDomain` (the domain composition root) and `createContainer` (the API composition
  root). Tests inject a fixed clock and sequential ids. Production injects the system clock
  and UUIDs.

## Patterns used, and why

| Pattern                                       | Where                                                          | Why it earns its place                                                                                                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Repository**                                | `*Repository` ports + in-memory adapters                       | Storage can change without touching rules. Tests need no database.                                                                                                                                                       |
| **Composition root / DI**                     | `createPrmsDomain`, `createContainer`                          | One place wires collaborators, and services never construct their dependencies.                                                                                                                                          |
| **Value object**                              | `TimeSlot`                                                     | Interval logic (half-open overlap, clamping, peak concurrency) is subtle, so it lives in one tested place.                                                                                                               |
| **State machine** (in the entity)             | `Booking`                                                      | Illegal transitions such as cancelling after check-in are impossible to express.                                                                                                                                         |
| **Policy object**                             | `BookingPolicy`, `DemandThresholds`                            | Operating rules are configuration, not branching code.                                                                                                                                                                   |
| **Execute-around / decorator-style auditing** | `AuditTrail.track(operation, work, describe)`                  | Each use case is wrapped once. Success and denial are both recorded without `try/catch` noise in every method. The SUCCESS event commits in the same unit of work as the change, so no change exists without its record. |
| **Unit of Work**                              | `UnitOfWork` port, Firestore transactions, the in-memory store | A use case commits all its writes, and its audit record, or none of them, and is isolated from concurrent use cases in any process.                                                                                      |
| **Guard clauses**                             | `assertCrewLead`, `assertSelfOrCrewLead`                       | Authorization reads as the first line of each use case.                                                                                                                                                                  |
| **Presenter / DTO**                           | `http/presenters.ts`                                           | API contracts are explicit. Internal fields like password hashes or mutable entities never leak.                                                                                                                         |
| **Adapter**                                   | `JwtTokenService`, `BcryptPasswordHasher` behind interfaces    | Libraries can be swapped, and tests use a cheap bcrypt cost.                                                                                                                                                             |

Deliberately **not** used: a generic event bus for side effects. Today only two admin
operations revoke bookings, and an explicit `BookingRevocation` collaborator is easier to
follow and test than asynchronous subscribers. If more reactions appear (notifications,
analytics), domain events would be the next step.

## Concurrency and atomicity

Every use case that changes state runs in one **unit of work** (the `UnitOfWork` port).
`AuditTrail.track` opens it, the service reads, checks and writes through the transaction it
is given, and the SUCCESS audit event is appended in the same unit of work. All of it commits
or none of it does:

- a booking never exists without its audit record;
- a downgrade commits together with the bookings it revokes (a Firestore transaction allows
  500 writes, so about 250 revocations at once);
- an account and its password hash are written together (a `TransactionHook`).

The guarantee holds across processes, because the storage provides it, not the process:

- **Firestore.** Each unit of work is a Firestore transaction: reads come first, writes are
  buffered and applied at the end, and Firestore runs the work again after a conflict (up to
  10 attempts). Booking reads a resource's bookings and the passenger's bookings, so it first
  locks both schedules by reading and rewriting their documents in `scheduleLocks`. Two
  units of work that lock the same schedule conflict, so one waits or retries and then sees
  the other's booking. Tier changes lock the passenger's schedule, and resource updates and
  decommissioning lock the resource's. Real Firestore also detects the conflict through the
  bookings query itself (we checked by disabling the lock), but the lock documents make the
  guarantee explicit instead of relying on how Firestore locks query results.
- **In memory.** The store owns one lock, so all units of work on it are serialised,
  whichever domain instance runs them. Writes are buffered and applied only if the work
  succeeds. Entities are stored as snapshots and handed out as copies, so a failed unit of
  work leaves nothing behind, not even a changed object in memory.

`persistenceContract.ts › never overbooks when two processes book the same resource at once`
builds two domain instances on one store and sends 10 bookings at a capacity-3 resource.
Exactly 3 succeed on both backends. With the old in-process lock, 4 got through.

Because the work may run more than once, it has no side effects outside the transaction. A
business-rule refusal changes nothing, so its DENIED event is written on its own afterwards.
Infrastructure failures are not business events: they go to the structured logs
(`http/errorHandler.ts`), not to the audit trail.

Storage also enforces two invariants itself, in the same transaction as the user it writes:
unique usernames (a claim document per username in `usernames`) and at most three Crew Leads
(`system/crewRoster`). Code that holds the storage directly cannot break them either.

**Instances.** The Cloud Run service still runs at most one instance: it costs nothing while
idle, and the sign-in rate limiter keeps its counts in memory, per instance. Correctness no
longer depends on that limit. The daily reset job and the old and new revisions that overlap
during a deploy are writers too, and units of work keep them consistent. The one exception is
the demo reset itself: it deletes one collection at a time and then reseeds, so a visitor's
write in those seconds at 04:00 can survive into the fresh data. That is accepted for a demo.

## Persistence

The domain defines four repository ports and a unit-of-work port. The in-memory store lives
in the domain package; the API package adds Firestore and chooses between them with
`STORAGE`:

- **In-memory** for development and tests: fast, and nothing to set up.
- **Firestore** for the live demo. Each port maps to one collection (`users`, `resources`,
  `bookings`, `auditEvents`), plus `credentials` for password hashes, `usernames` and
  `scheduleLocks` (see [Concurrency](#concurrency-and-atomicity)) and `system` for the
  Crew Lead roster and the demo-seed marker.

Choices worth noting:

- **Entities are rebuilt through the domain, not deserialised blindly.** `User`, `Resource`
  and `Booking` expose `toSnapshot()` and a restore function. `restore()` re-runs the entity's validation,
  so a corrupt document is rejected at the boundary instead of leaking into business logic.
- **No index configuration to deploy.** Every query filters on a single field, which
  Firestore serves from its automatic single-field indexes. The audit log pushes its most
  selective filter to Firestore and applies the rest with the same `matchesAuditQuery`
  function the in-memory store uses, so both behave identically.
- **Integrity in storage.** Username uniqueness and the Crew Lead limit are checked and
  written in the user's transaction. Audit events use `create()`, so an event can never be
  overwritten.
- **One contract, two backends.** `persistenceContract.ts` specifies the behaviour every store
  must have, and runs against both. The whole API suite can also run on Firestore. Both
  stores hand out copies, so a service that changes an entity and forgets to save it fails in
  memory too, instead of "working" because the store holds the same object.
- **Start-up is idempotent.** Configured Crew Leads are reconciled on every start (created if
  missing, password updated if the configuration rotated it). Demo data is seeded only by the
  process that wins an atomic `create()` of a marker document, so two instances starting
  together can't both seed.

### Live demo operations

The live demo resets daily. A Cloud Run **job** built from the same image wipes the collections
and reseeds a fresh week ending "now", so reports always have recent data and whatever
visitors changed is undone. The reset refuses to run unless demo mode is on, so it can never
wipe real data. Sessions from before a reset stop working straight away, because
authentication checks that the account still exists.

## Capacity is peak simultaneous use

A naive check counts bookings that overlap the requested slot. That is wrong in both
directions. Bookings at `09:00–10:00` and `10:00–11:00` both overlap a request for
`09:00–11:00`, yet only one seat is ever in use at a time. `peakConcurrency` sweeps start
and end edges (ends before starts at the same instant) to find the true maximum. The web
client mirrors it to show "N of M places free" before the passenger submits, but the server
remains the authority.

## Error handling

- Domain errors carry a stable `code` (`TIER_ACCESS_DENIED`, `CAPACITY_EXCEEDED`, …) and a
  message written for a person.
- Request-shape problems (zod) become `INVALID_REQUEST` with per-field `issues`.
- Unknown errors are logged with a stack trace and returned as a generic `INTERNAL_ERROR`,
  so internals never leak.
- Entities validate everything **before** mutating, so a failed update leaves no partial
  state (see `Resource.apply`).

## Demo data

The seed doesn't write rows directly. It **replays a week of activity through the real
services** using an `OffsetClock` that temporarily shifts "now" into the past. As a result the
demo data obeys every rule, appears in the audit trail, and exercises the code paths the
reports rely on (including real capacity turn-aways at the Luxury O2 Pod).

## Front end

- `useApiData` and `useAction` are small hooks that handle loading, error and stale
  responses, so pages stay declarative without a data-fetching library.
- Role-based routes are a UX convenience. The API is the security boundary.
- No UI framework, just a plain CSS design system with tokens. It is responsive down to phone width,
  uses the native `<dialog>` for accessible modals, and has visible focus styles.
