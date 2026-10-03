import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 3001);

const fastify = await buildServer();

// localhost, not 0.0.0.0, in development: the dev proxy and Playwright both
// reach the API over IPv6 loopback, and binding only IPv4 breaks them.
//
// HOST overrides it, which is what testing the driver app on a real handset
// needs: the phone reaches this machine over the LAN, so a localhost-only
// bind is unreachable no matter what base URL the app is given. Opt-in, so
// the default for `pnpm dev` is unchanged.
const host =
  process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "localhost");

try {
  await fastify.listen({ port, host });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await fastify.close();
    process.exit(0);
  });
}
