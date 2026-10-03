import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * The web app's pure-logic tests.
 *
 * These files existed for weeks without a runner: apps/web had no `test`
 * script, so `turbo run test` skipped it and ~470 lines covering the order,
 * loader and driver state machines never ran in CI.
 *
 * `.test.ts` only, matching packages/core. There are no component tests — the
 * screens are verified against the responsive criteria in DESIGN.md by hand,
 * and a second runner with a DOM environment would be a bigger commitment than
 * the coverage would justify today.
 */
export default defineConfig({
  // The same `@/` alias tsconfig and Next use, so a tested module can import
  // from `@/lib/...` like the rest of the app instead of counting `../`.
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
