import { defineConfig } from "vitest/config";

// Mirrors packages/core/vitest.config.ts so `pnpm test` (turbo) treats this
// package like every other one. Only .test.ts is collected: there are no
// component tests, because the screens are verified by hand on Android rather
// than through a second runner (see src/outbox/README.md).
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
