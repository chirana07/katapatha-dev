FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/core/package.json       packages/core/
COPY packages/contracts/package.json  packages/contracts/
COPY packages/api-client/package.json packages/api-client/
COPY packages/tokens/package.json     packages/tokens/
COPY apps/web/package.json            apps/web/
RUN pnpm install --frozen-lockfile --filter @katapatha/web...

FROM deps AS build
COPY packages/ packages/
COPY apps/web/ apps/web/
WORKDIR /repo/apps/web
RUN pnpm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/packages /repo/packages
COPY --from=build /repo/apps/web /repo/apps/web
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "run", "start"]
