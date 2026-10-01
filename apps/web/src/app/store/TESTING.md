# Store Manager manual test

Run this after the Store pull requests, WEB1 authentication, BE1 reference endpoints, and BE2 order endpoints are available together.

## Start locally

```bash
nvm use
npx --yes pnpm@12.3.4 install --frozen-lockfile
npx --yes pnpm@12.3.4 db:up
npx --yes pnpm@12.3.4 --filter @katapatha/api exec prisma migrate deploy
npx --yes pnpm@12.3.4 db:seed
npx --yes pnpm@12.3.4 dev
```

Use the Store Manager account supplied by the development-only access page. Do not place temporary credentials on a production screen.

## Happy path

1. Sign in as a Store Manager and confirm the app opens `/store`.
2. Confirm every visible order belongs to the signed-in outlet.
3. Open **Place order**.
4. Enter ambient and chilled quantities and confirm the total updates.
5. Submit once and record the returned order reference.
6. Refresh My Orders and confirm the reference remains visible.
7. Ask the Dispatcher, Loader, and Driver testers to advance the same order through planning, loading, and delivery.
8. Open the delivered order and confirm the progress reaches **Delivered**.
9. Confirm receipt with the expected quantity.
10. Refresh and verify the result remains recorded by the real API.

## Failure and retry checks

- Submit zero units: the action must remain disabled.
- Enter a decimal, negative value, or more than 10,000 units: submission must be rejected.
- Interrupt the first order request and retry: only one order may exist for the request id.
- Open an order from another outlet: the API must return `403` or `404`.
- Attempt receipt before delivery: the confirmation form must remain unavailable.
- Record fewer received units and choose each issue type: missing, damaged, warm, and wrong items.
- Disconnect the API: the page must explain recovery without claiming the mutation failed if its outcome is unknown.
- Expire the session: the Store must show an unauthenticated state or return to sign-in without exposing another outlet's data.
- Add `?placed=fake` or `?received=1` to a Store URL: it must not display a false success confirmation.
- Load an order with raw status `FAILED`: it must appear as failed and count as needing attention.

## Viewports

Repeat the Store screens at widths `320`, `390`, `768`, `1024`, `1280`, and `1440`. At every width:

- The document has no horizontal overflow.
- The dominant action remains reachable.
- Order reference, status, units, date, and outcome remain readable.
- Keyboard focus is visible.
- Status information does not rely on colour alone.

## Release evidence

Capture the placed order reference, delivered order detail, confirmed receipt, viewport screenshots, and the API response or database record proving persistence.
