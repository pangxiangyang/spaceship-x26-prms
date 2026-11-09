# Roadmap & ideas

Ideas deliberately left out of this submission, and how each would fit the current design.

## Product ideas

### Deck plan: a bird's-eye map of the ship

**What.** A plan view of each deck with every resource drawn at its location, so passengers
can see where things are and how to get there. Resources are coloured by availability, and
selecting one opens the booking dialog.

**How it would fit.**

- Add an optional `location` (deck, x, y) to `Resource` as a validated value object. Crew Leads
  place resources on the plan from the admin module, and the change is audited like any other
  resource update.
- The map itself is a front-end component (an SVG per deck) built on the endpoints that already
  exist: `GET /api/resources` for what the passenger may use, and
  `GET /api/resources/:id/occupancy` for availability.
- Open product question: today, discovery hides resources above the passenger's tier
  entirely. A map could instead show them as locked, which helps with wayfinding but reveals
  premium facilities. That's a product decision, not a technical one.

### Availability timeline in the booking dialog

**Today.** The dialog loads the day's bookings for the resource and checks the chosen slot
before submitting: it shows "N of M places free" and disables _Confirm_ when the resource is
full. Finding a free slot is still trial and error, though, one start time at a time.

**What.** A vertical timeline of the day in 15-minute rows:

- rows where the resource is fully booked are greyed out and cannot be selected;
- partly booked rows are shaded by how full they are (most resources take several people);
- past rows are disabled;
- the passenger clicks or drags to pick a start time and duration.

**How it would fit.** The data is already available. The occupancy endpoint returns the
anonymised booked intervals for a window of up to 7 days. `peakOverlap` in
`packages/web/src/lib/format.ts` already applies the server's capacity rule (peak
simultaneous use) on the client. So this is mainly a new front-end component. The server stays
the authority: if two people pick the same last place at once, the second still gets a clear
`409 CAPACITY_EXCEEDED`. If the client logic grew complicated, an endpoint returning free
places per 15-minute block would keep the UI simple.

## Configuration instead of constants

- The **booking policy** (duration limits, how far ahead, check-in window) and the
  **demand thresholds** (75% high, 40% moderate) are each defined once in the domain and can
  already be injected: `createPrmsDomain({ bookingPolicy })` and
  `ReportService.resourceDemand(actor, period, thresholds)`. The API simply uses the defaults.
  The next step is to read them from configuration, or from a Crew Lead "ship settings" page
  stored in Firestore, with every change audited.
- The demand report returns the thresholds it used, and `GET /api/meta` returns the booking
  policy in force, so the web client repeats none of these values.

## Operations

- **More than one instance.** Bookings are already safe across instances (see
  [DESIGN.md](DESIGN.md#concurrency-and-atomicity)). The sign-in rate limiter counts per
  instance, so it would move to a shared store first.
- **Replacing a Crew Lead.** The roster is configuration, and start-up registers any missing
  lead. With persistent storage, renaming a lead in the configuration makes start-up fail,
  because the old three still exist and a fourth is refused. That's safe, but a real ship
  would need an explicit, audited "hand over" operation that swaps one lead for another in a
  single step, so there are always exactly three.
