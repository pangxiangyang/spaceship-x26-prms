# Assumptions & interpretations

The brief leaves several decisions open. This file records how each one was resolved, so
reviewers can see what was decided on purpose and what is out of scope.

## Roles & accounts

| Question                                        | Decision                                                                                                                           | Why                                                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| How are the "exactly three" Crew Leads created? | Defined in configuration (`PRMS_CREW_LEADS`) and registered at start-up. There is **no API** to add, remove or promote Crew Leads. | "Prevent unauthorized administrative expansion": the safest admin-creation endpoint is one that does not exist. |
| What if the configuration has 2 or 4?           | The server refuses to start (`CREW_ROSTER_INCOMPLETE` / `CREW_LEAD_LIMIT_REACHED`).                                                | "Exactly three" is an invariant, so the system fails fast rather than running degraded.                         |
| Are Crew Leads also passengers?                 | No. They are a separate role and do not book resources.                                                                            | Keeps the two roles and their permissions distinct.                                                             |
| Who creates passenger accounts?                 | Crew Leads, with an initial password.                                                                                              | "Create and manage passenger profiles" is listed as a Crew Lead permission.                                     |
| Usernames                                       | Unique across _all_ users, case-insensitive, 3–32 chars.                                                                           | Prevents a passenger account impersonating `commander`.                                                         |

## Tiers & access

| Question                                                                                      | Decision                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inheritance                                                                                   | Tiers are ranked Silver < Gold < Platinum. A passenger may use a resource when their rank ≥ the resource's minimum tier.                                                                              |
| Life-support resources not assigned a tier in the brief (oxygen refill, medical bay, fitness) | Seeded as **Silver**, available to everyone. Withholding basic oxygen or medical care by tier would be unsafe. Only the _premium_ variants (Luxury O2 Pod, Advanced Medical Bay) are tier-restricted. |
| What happens to bookings on a **downgrade**?                                                  | Pending bookings for resources the new tier doesn't cover are **cancelled automatically** (reason `TIER_DOWNGRADE`) and audited.                                                                      |
| …and to a session **in progress**?                                                            | It is allowed to finish. Interrupting someone mid-use of a life-support resource is never the safe default.                                                                                           |
| Raising a resource's minimum tier                                                             | Same treatment as a downgrade (reason `RESOURCE_TIER_RAISED`).                                                                                                                                        |
| Upgrades                                                                                      | Take effect immediately. There are no side effects on bookings.                                                                                                                                       |

## Resources

| Question                     | Decision                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Provision and decommission" | Provision creates an active resource. Decommission is **terminal** (no re-commission). Historical bookings stay for reporting, and pending ones are cancelled (`RESOURCE_DECOMMISSIONED`). |
| Capacity                     | The number of passengers who can use the resource **at the same moment**, from 1 to 500.                                                                                                   |
| Reducing capacity            | Refused if upcoming bookings would exceed the new capacity at any instant. A Crew Lead must cancel bookings first, so the reduction is a deliberate choice, not a silent overbooking.      |

## Bookings ("Active usage")

The brief says passengers "initiate the use of accessible resources with real-time
validation". This is modelled as **booking a time slot** followed by **checking in**:

| Rule                | Value                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Slot duration       | 15 min – 4 h                                                                                                                                  |
| Booking horizon     | Start between now (1-minute grace) and 14 days ahead                                                                                          |
| Capacity check      | Peak simultaneous bookings during the requested slot must be below capacity. Back-to-back slots (`09:00–10:00`, `10:00–11:00`) don't overlap. |
| Personal overlap    | A passenger cannot hold two overlapping bookings, even on different resources.                                                                |
| Check-in window     | From 15 minutes before the start until the end of the slot                                                                                    |
| Check-in validation | Tier and resource status are **re-checked** at check-in, so a booking made before a downgrade can't be used after it.                         |
| Cancellation        | Only while `CONFIRMED` and before the slot ends. Passengers can cancel their own bookings and Crew Leads can cancel any.                      |
| "Usage" for reports | A checked-in booking counts as its full booked duration. There is no explicit check-out.                                                      |
| Missed bookings     | A confirmed booking whose slot ends without a check-in shows as `MISSED`. It is still counted as _booked_ time, because it blocked capacity.  |

These values live in one place (`BookingPolicy`) and can be changed without touching the rules.

## Reporting

| Question                                 | Decision                                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Which tier does a booking count towards? | The tier the passenger held **when booking** (a snapshot stored on the booking). `passengerCount` per tier is the _current_ population. |
| Utilisation                              | Booked seat-minutes ÷ (capacity × period length). Periods default to the last 7 days and may span up to 90 days.                        |
| "High demand"                            | Utilisation ≥ 75%, **or** at least one booking turned away for capacity in the period. Moderate demand starts at 40%.                   |
| Turn-aways                               | Read from `DENIED / CAPACITY_EXCEEDED` audit events whose _requested slot_ overlaps the period.                                         |
| Trends                                   | The personal 7-day trend uses UTC calendar days.                                                                                        |

## Audit

- Events are append-only and immutable (frozen). There is no update or delete API.
- Both successful and **denied** attempts are recorded, along with the business rule
  that denied them.
- Only Crew Leads can read the trail.

## Security

- Passwords are hashed with bcrypt. The domain model never sees them.
- JWT (HS256) with an 8-hour default lifetime. The browser keeps the session in
  `sessionStorage`, which is cleared when the tab closes. That suits a shared ship terminal.
- Login is rate-limited per IP and gives the same answer for unknown usernames and wrong
  passwords, with comparable timing.
- Authorization is enforced **inside the domain services**. The route-level role gate and
  the client-side route guards are defence in depth and UX only.
- Every authenticated request checks that the account still exists, so a valid token for a
  removed account (for example after a demo reset) is rejected.
- Behind Cloud Run, the client address comes from `X-Forwarded-For` (`TRUST_PROXY=1`), so the
  sign-in limit applies per visitor rather than to everyone at once.

## Live demo

| Question                             | Decision                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where is data stored?                | Firestore (Native mode) in `asia-southeast1`, the same region as the Cloud Run service.                                                           |
| Demo credentials                     | Published on the login page (demo mode only). The Crew Lead password lives in Secret Manager like a real one, but its value is public on purpose. |
| Keeping the demo fresh               | A scheduled job wipes and reseeds daily at 04:00 Singapore time. Anything visitors change lasts until then.                                       |
| Instances                            | At most one: capacity checks rely on an in-process lock (see DESIGN.md).                                                                          |
| Visitors interfering with each other | Accepted for a shared demo. The daily reset bounds the damage.                                                                                    |

## Out of scope

- Multi-instance deployment (the booking lock is in-process)
- Password reset, account deactivation, token revocation
- Recurring bookings, waitlists, notifications
- Time zones beyond the browser's local zone for display (all API times are ISO-8601 UTC)
