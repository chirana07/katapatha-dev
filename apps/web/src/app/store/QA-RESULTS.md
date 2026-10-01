# Store Manager QA results

Verified on 2026-10-01 from `web2/store-final-qa`. Contract-level browser checks used the Prism mock generated from the repository OpenAPI document. These checks prove the WEB2 interface and request wiring; they do not prove database persistence or another role's unfinished workflow.

## Automated gates

| Check | Result |
| --- | --- |
| Store ESLint | Pass, no warnings |
| Web TypeScript | Pass |
| Store workflow rules | 27 tests passed |
| Next.js production build | Pass with Webpack; all Store routes compiled |
| Impeccable detector | Pass, no findings |
| axe WCAG A/AA scan | No violations at 390 px and 1280 px on all three Store routes |

The workflow tests cover every contract order status, server projection precedence, attention states, order quantity boundaries, receipt issue requirements, and recovery messages for expired sessions, denied access, and rejected input.

## Browser matrix

The following routes were rendered at 320, 390, 768, 1024, 1280, and 1440 px:

- `/store`
- `/store/new`
- `/store/orders/clx0ord1a2b3c4d5e6f7g8h9`

All 18 combinations had one main landmark, one page heading, no document-level horizontal overflow, and no standalone interactive target below 24 by 24 px. The mobile order card, desktop order table, order form, progress view, and receipt form were also inspected from captured screenshots.

## Contract workflow checks

- A zero-unit order starts with its submit action disabled.
- A valid order submission reached the mock `POST /orders`, redirected to `/store`, and displayed the server-owned success message.
- A delivered order loaded its expected receipt quantity.
- Receipt confirmation reached the mock `PUT /orders/{orderId}/receipt`, returned to the order detail, displayed confirmation, and removed the form.
- Removing the session cookie caused `/store` to render **Session expired**, a no-data-changed message, and a retry action.
- Success messages are accepted only from short-lived HTTP-only cookies set after a successful server action; query parameters cannot manufacture success.

## Local production profile

Measured with the production build, cache disabled, and the local Prism API:

| Route | DOM content loaded | Load | Transferred |
| --- | ---: | ---: | ---: |
| `/store` | 13 ms | 30 ms | 156,114 bytes |
| `/store/new` | 17 ms | 32 ms | 152,289 bytes |
| `/store/orders/[orderId]` | 20 ms | 34 ms | 151,927 bytes |

These local timings are a regression reference, not a field performance claim. Production hosting, network latency, and the real API still need measurement after deployment.

## Repository baseline observations

The focused Store checks above pass. The repository-wide commands currently stop outside WEB2:

- `pnpm lint` reaches `@katapatha/web` but its existing `next lint` script is not supported by Next.js 16 and is interpreted as a directory.
- `pnpm typecheck` stops in `@katapatha/mobile` because Expo, React Native, and workspace module types are unavailable in the current install.
- `pnpm test` stops in `@katapatha/allocator` because its Vitest executable is unavailable in the current install.
- Turborepo warns that the committed lockfile contains two YAML documents and cannot resolve workspace metadata from it.
- `pnpm audit --prod` reports two moderate transitive advisories in the mobile Expo dependency tree: `uuid` below 11.1.1 and `decode-uri-component` through `query-string`. The reported paths do not enter the WEB2 package.

The reported errors do not reference the Store files. They require the repository lead because the affected package scripts, mobile setup, and lockfile are outside WEB2 ownership.

## Integration gates still owned outside WEB2

Final end-to-end acceptance requires the upstream repository to merge the stacked Store pull requests and provide:

1. WEB1 sign-in and role routing for a real Store Manager session.
2. BE1 next-operating-day reference data.
3. BE2 order creation, outlet-scoped reads, idempotency, and receipt persistence.
4. Dispatcher, Loader, and Driver transitions for the same order.
5. A deployment environment for production performance, persistence evidence, and the demo video.

The current Order response does not expose whether a receipt has already been confirmed. The short-lived success message proves the mutation completed, while durable receipt state must be verified through BE2 or added to the frozen contract by the repository lead.

Use [TESTING.md](./TESTING.md) for the final multi-role manual run after those gates are available.
