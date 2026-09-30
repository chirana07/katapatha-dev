# Multi-stage: the runtime image carries no toolchain and no source.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/core/package.json        packages/core/
COPY packages/allocator/package.json   packages/allocator/
COPY packages/contracts/package.json   packages/contracts/
COPY packages/api-client/package.json  packages/api-client/
COPY packages/tokens/package.json      packages/tokens/
COPY apps/api/package.json             apps/api/
RUN pnpm install --frozen-lockfile --filter @katapatha/api...

FROM deps AS build
COPY packages/ packages/
COPY apps/api/ apps/api/
WORKDIR /repo/apps/api
RUN pnpm exec prisma generate && pnpm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/packages /repo/packages
COPY --from=build /repo/apps/api /repo/apps/api
WORKDIR /repo/apps/api
EXPOSE 3001
# Migrate and seed on boot: the demo database must be reproducible from empty.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm run db:seed && node dist/main.js"]
