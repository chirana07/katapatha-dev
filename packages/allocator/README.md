# @katapatha/allocator

`src/allocate.ts` is a **pure, deterministic** function: no I/O, no randomness,
ties broken by identifier. `stats.hash` is a regression fingerprint — an
identical input must always produce an identical hash.

`src/scenario.ts` and `src/csv.ts` are **node-only** (they use `node:fs`). They
build an `AllocatorInput` from CSV files on disk. Do not import them from the
web or mobile clients; only `apps/api` and the seeder use them.

Everything else in this package is isomorphic. `@katapatha/core` is, by design,
entirely free of Node and Prisma.
