# syntax=docker/dockerfile:1
# Image migration (HB-175): chạy `scripts/migrate.mjs` một lần trước khi api/worker khởi động, bằng role chủ
# (`DATABASE_MIGRATION_URL`), rồi đặt mật khẩu login cho role runtime `app_rw` từ `DATABASE_URL`
# (`infra/prod/runtime-role.mjs`). Image API không có CLI `prisma` (devDependency) nên tách image riêng.
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY patches ./patches
COPY packages ./packages
COPY apps/api ./apps/api
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @pinehill/api
# Bố cục giống repo: `scripts/migrate.mjs` import `../apps/api/prisma/*.mjs`; `pg`/`prisma` từ node_modules của api.
RUN pnpm --filter @pinehill/api deploy --legacy /prod/apps/api

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod/apps/api ./apps/api
COPY --chown=node:node scripts/migrate.mjs ./scripts/migrate.mjs
COPY --chown=node:node infra/prod/runtime-role.mjs ./infra/prod/runtime-role.mjs
RUN ln -s /app/apps/api/node_modules /app/node_modules
USER node
CMD ["sh", "-c", "node scripts/migrate.mjs && node infra/prod/runtime-role.mjs"]
