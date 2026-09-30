# Conventions

Read this before you create a file or open a pull request. Most of it exists for
one reason: **nine people, five days, and merge conflicts are the thing most
likely to cost us a day.** The rules are structural, so following them is mostly
a matter of putting files in the right place.

## The eleven conflict rules

1. **One owner per directory.** `.github/CODEOWNERS` is the map. If you need a
   change in someone else's directory, ask them — do not reach in.

2. **No central registries.** There is no route list, no module array, no nav
   array that everyone appends to. Everything is discovered from the
   filesystem: `@fastify/autoload` for API plugins and routes, the Next App
   Router for pages, Expo Router for mobile screens, a Prisma schema *folder*
   for models. **Adding an endpoint means adding a file.** This is the main
   reason the API uses Fastify rather than a framework with a root module.

3. **No barrel files.** No `index.ts` that re-exports a package. Every shared
   package uses `"exports": { "./*": "./src/*.ts" }`, so you import the deep
   path:
   ```ts
   import { tripMinutes } from "@katapatha/core/domain/tripTime";  // yes
   import { tripMinutes } from "@katapatha/core";                  // no
   ```
   A barrel is a magnet that pulls all nine of us onto one line.

4. **The Prisma schema is split by owner** into
   `apps/api/prisma/schema/*.prisma`. Edit only your file. A relation that
   crosses files needs a line on both sides — that is fine, they are different
   lines. Put `[schema:relation]` in the PR title so LEAD looks.

5. **BE1 is the only migration author this week.** Everyone else uses
   `prisma db push` against their own local database. Editing a schema file is
   free; *generating a migration* is not. Two windows: Day 1 late afternoon,
   Day 3 midday.

6. **Generated files are never hand-merged.** `packages/contracts/dist/` and
   `src/schema.gen.d.ts` are marked `merge=binary` in `.gitattributes`, so git
   refuses to merge them. Resolve with `pnpm gen && git add`. CI runs
   `pnpm gen:check`.

7. **Dependencies go through LEAD.** They are all installed already.
   `save-exact=true`, and CI runs `pnpm install --frozen-lockfile`.

8. **The contract is frozen.** Changes are additive only — a new optional field
   or a new endpoint. A breaking change needs LEAD plus one consumer, and the
   Prism examples change in the same PR. See [CONTRACT.md](CONTRACT.md).

9. **Branch `<owner>/<slice>`, maximum 24 hours old.** Rebase onto `main` every
   morning and before every push. Never merge `main` into your branch.
   ```bash
   git config pull.rebase true
   git config rerere.enabled true
   ```

10. **Tests sit next to the code** as `*.test.ts`. No shared mega-spec.

11. **Styling is Tailwind utilities inline.** There is exactly one
    `globals.css` and one token file, both LEAD-owned. Never add a second
    palette — the previous repo had two that disagreed on the brand colours,
    and that is why `docs/DESIGN.md` is binding.

## Pull requests

- Under ~400 changed lines, excluding generated files. One resource per PR.
- Required checks: `contract:lint`, `gen:check`, `typecheck`, `lint`, `test`,
  the schema drift gate, migrate + seed.
- Squash merge, linear history, delete the branch.
- Review within 30 minutes during work hours. **Unreviewed for two hours: LEAD
  merges.** A five-day project cannot afford review as a bottleneck.
- A PR that both *moves* code and *changes* it gets bounced. Do one or the other
  so the diff is reviewable.

## Code

- TypeScript strict everywhere. No `any` in a PR without a comment saying why.
- Clock times are `"HH:MM"` strings. Calendar dates are `YYYY-MM-DD`. **Never**
  a `Date`/`date-time` for a wall-clock time — see [DOMAIN.md](DOMAIN.md).
- Comment the *why*, not the *what*. The code already says what.
- Never log a password, a session token, or a signature or photo payload.
