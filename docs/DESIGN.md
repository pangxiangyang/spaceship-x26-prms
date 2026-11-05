# Design notes

## Guiding idea

Put the rules where they are cheapest to test and hardest to bypass. Every business rule
lives in `packages/domain`, a framework-free TypeScript package. The API and the web client
are thin adapters around it. If someone called the domain services from a CLI, a message
queue or a test, the same permissions and invariants would hold.

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

| Pattern                                       | Where                                                       | Why it earns its place                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repository**                                | `*Repository` ports + in-memory adapters                    | Storage can change without touching rules. Tests need no database.                                                                                                |
| **Composition root / DI**                     | `createPrmsDomain`, `createContainer`                       | One place wires collaborators, and services never construct their dependencies.                                                                                   |
| **Value object**                              | `TimeSlot`                                                  | Interval logic (half-open overlap, clamping, peak concurrency) is subtle, so it lives in one tested place.                                                        |
| **State machine** (in the entity)             | `Booking`                                                   | Illegal transitions such as cancelling after check-in are impossible to express.                                                                                  |
| **Policy object**                             | `BookingPolicy`, `DemandThresholds`                         | Operating rules are configuration, not branching code.                                                                                                            |
| **Execute-around / decorator-style auditing** | `AuditTrail.track(operation, run, describe)`                | Each use case is wrapped once. Success and denial are both recorded without `try/catch` noise in every method, and nothing can skip the audit by returning early. |
| **Guard clauses**                             | `assertCrewLead`, `assertSelfOrCrewLead`                    | Authorization reads as the first line of each use case.                                                                                                           |
| **Presenter / DTO**                           | `http/presenters.ts`                                        | API contracts are explicit. Internal fields like password hashes or mutable entities never leak.                                                                  |
| **Adapter**                                   | `JwtTokenService`, `BcryptPasswordHasher` behind interfaces | Libraries can be swapped, and tests use a cheap bcrypt cost.                                                                                                      |

Deliberately **not** used: a generic event bus for side effects. Today only two admin
operations revoke bookings, and an explicit `BookingRevocation` collaborator is easier to
follow and test than asynchronous subscribers. If more reactions appear (notifications,
analytics), domain events would be the next step.

## Concurrency

Booking is a read-check-write sequence: read overlapping bookings, compare with capacity,
save. Node runs JavaScript on one thread, but every `await` gives another request a chance
to interleave. All operations that change booking state therefore run through one
`AsyncMutex` (`bookingLock`): book, cancel, check-in, tier change, resource update and
decommission. A test fires 10 concurrent requests at a capacity-3 resource and expects
exactly 3 successes. With the lock removed, all 10 succeed, so the test is known to catch the bug.

The mutex is correct for one process. With a real database, the same guarantee would come
from a transaction (`SELECT … FOR UPDATE` on the resource row, or a serializable
transaction), and the mutex would be removed. The service code would otherwise stay the same.

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
