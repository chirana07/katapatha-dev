# Your first pull request

## 1. Get it running (about ten minutes)

```bash
nvm use                    # Node 24
pnpm install
pnpm db:up                 # Postgres 17 in Docker
pnpm --filter @katapatha/api exec prisma migrate deploy
pnpm db:seed
pnpm dev
```

Check it:

```bash
curl -s localhost:3001/v1/health
curl -s -X POST localhost:3001/v1/auth/session \
  -H 'content-type: application/json' \
  -d '{"email":"nimal@waypoint.lk","password":"waypoint"}'
```

Then confirm the whole repo is green — this is what CI runs:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm contract:lint && pnpm gen:check
```

## 2. Set up git the way this project expects

```bash
git config pull.rebase true
git config rerere.enabled true
```

## 3. Read three things

1. [WORK-BREAKDOWN.md](WORK-BREAKDOWN.md) — what you own, and which day it is due
2. [CONVENTIONS.md](CONVENTIONS.md) — the eleven conflict rules
3. [DOMAIN.md](DOMAIN.md) — skim it now; come back when a status confuses you

## 4. Find your file

Your directory is already created and listed in `.github/CODEOWNERS`. Nobody
else will touch it this week.

**Backend:** your routes are in `apps/api/src/routes/<resource>.ts`. They
currently return `501`. Replace each stub with a real handler; **do not change
the paths** — they are the contract. The business logic you need is very likely
already in `apps/api/src/services/`, taking `(args, actor)`. Call it; do not
rewrite it.

**Web:** your route group is `apps/web/src/app/<role>/`. Pages stay server
components — only the data line changes:

```ts
const { data: trip } = await (await api()).GET("/trips/{tripId}/load-list", {
  params: { path: { tripId } },
});
```

**Mobile:** `apps/mobile/src/` — MOB1 owns `api/` and `outbox/`, MOB2 owns
`screens/`.

## 5. You are not blocked by the backend

```bash
pnpm mock      # Prism on :4010, every endpoint, realistic examples
```

Point your base URL at it (the mock serves paths at the root; the real API
mounts them under `/v1`). Prism enforces auth, so send
`Authorization: Bearer anything`. Build the screen, then switch the URL when the
endpoint lands.

## 6. Open a small pull request

```bash
git checkout -b web2/store-order-list
# ... work ...
git rebase main
git push -u origin web2/store-order-list
```

Under ~400 lines, one resource, squash merge. Reviewed within 30 minutes during
work hours.

## Things that will trip you up

- **Do not `import { PrismaClient }` outside `apps/api`.** It will not resolve,
  and that is deliberate.
- **Do not add a dependency.** Ask LEAD. CI runs `--frozen-lockfile`.
- **Do not run `prisma migrate dev`.** BE1 owns migrations. Use
  `prisma db push` against your own local database.
- **Do not hand-merge a generated file.** `pnpm gen && git add`.
- **Do not turn `"HH:MM"` into a `Date`.** See [DOMAIN.md](DOMAIN.md).
- **Do not import `@katapatha/core` bare.** Import the deep path.
