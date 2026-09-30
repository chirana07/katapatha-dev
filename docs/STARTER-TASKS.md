# First tasks

One per person, sized to land on Day 1 and prove your environment works. Each
names the file you own, so none of these nine pull requests can conflict.

Do [ONBOARDING.md](ONBOARDING.md) first.

---

### BE1 — `apps/api/src/routes/reference.ts`
Replace the four `501` stubs with real handlers.
- `GET /reference/outlets`, `/vehicles` — scope by the caller's `depotCode`
- `GET /reference/vocabularies` — return the lists from
  `@katapatha/core/domain/reasons`. Every client renders these instead of
  hardcoding copies, so this one unblocks web and mobile.
- `GET /reference/calendar/next-operating-day` — wrap `nextOperatingDate` from
  `../services/store.js`

Attach the contract schema to each route so Fastify validates. Add a test that
`vocabularies` matches `reasons.ts` exactly — that is the drift guard.

### BE2 — `apps/api/src/routes/orders.ts`
`GET /orders` and `POST /orders`.
- A store manager sees their own outlet; a dispatcher sees their depot. Use the
  predicates in `../lib/authorization.js`.
- `POST` is **idempotent on `requestId`** — 201 first, 200 with the same body on
  replay. Derive outlet, brand, district and depot from the session, never the
  request body.
- The logic is already in `../services/store.js`. Call it.

### BE3 — design review, then `apps/api/src/routes/trips.ts`
First: write the shared stop-event applier design on paper and get BE1 and LEAD
to read it **before** you write code. It is the one genuinely new subsystem and
the newest code in the repo; a 30-minute review now is worth a day later.

Then `GET /trips` and `GET /trips/{tripId}/load-list`. The load list returns
stops in **reverse** delivery order — the driver unloads from the back. That
ordering belongs in the API, not the client.

### WEB1 — `apps/web/src/app/(shell)` and sign-in
The desktop rail (212px, navy), the app shell, and a working sign-in posting to
`POST /v1/auth/session`. Redirect to `HOME_FOR_ROLE` from
`@katapatha/core/domain/authPaths`. Do not show credentials on the page.

### WEB2 — prove `packages/api-client`, then the store console
Write a small script that calls three endpoints against the Prism mock and
prints the results, so we know the generated client works end to end. Then start
`apps/web/src/app/store/` — the order list at 390px, no horizontal scroll.

### WEB3 — `apps/web/src/app/loader/`
The dock board against the mock, grouped by wave. Every control at least 44px
high: this runs on a shared tablet, sometimes with gloves.

### MOB1 — Expo shell and the outbox skeleton
Sign in, keep the token in SecureStore, render the run from the mock. Then the
outbox storage schema in `apps/mobile/src/outbox/` — read that directory's
README first; it is the hardest work in the project and you own it alone.

### MOB2 — run list and stop detail
`apps/mobile/src/screens/` against the mock. One-handed: the dominant action
sits in the thumb zone.

### LEAD
Freeze the contract. Verify CI on a real pull request. Confirm every developer
has a green commit before the end of Day 1.

---

## Reminders

- Build against the mock (`pnpm mock`, port 4010, paths at the root) — do not
  wait for an endpoint.
- Do not add a dependency; ask LEAD.
- Do not run `prisma migrate dev`; that is BE1's, twice this week.
- Keep the PR under ~400 lines and rebase before pushing.
