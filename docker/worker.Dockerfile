# syntax=docker/dockerfile:1
# Image worker (kiến trúc §7). Cùng cách gói như image api, entrypoint khác.
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @pinehill/worker...
RUN pnpm --filter @pinehill/worker build && pnpm --filter @pinehill/worker deploy --legacy --prod /prod/worker

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod/worker ./
USER node
CMD ["node", "dist/main.js"]
