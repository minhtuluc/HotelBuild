# syntax=docker/dockerfile:1
# Image worker (kiến trúc §7). Cùng cách gói như image api, entrypoint khác.
# Alpine: bản quét Trivy 07/11/2026 cho OS = 0 HIGH/CRITICAL (Debian 12 = 35, Debian 13 = 48 chưa có bản vá).
# `openssl` cần cho engine Prisma (không có thì Prisma đoán nhầm libssl 1.1). npm/corepack/yarn chỉ dùng
# lúc build; xoá khỏi ảnh chạy vì runtime chỉ cần `node` và bộ phụ thuộc nội bộ của npm là nguồn CVE.
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
# `pnpm.patchedDependencies` (query-string@7.1.3) cần file vá ngay lúc `pnpm install --frozen-lockfile`.
COPY patches ./patches
COPY packages ./packages
# worker phụ thuộc `@pinehill/api` (workspace, composition runtime HB-127/129): cần mã API để sinh Prisma client và build dist
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @pinehill/worker...
RUN pnpm --filter @pinehill/worker... build && pnpm --filter @pinehill/worker deploy --legacy --prod /prod/worker
# `pnpm deploy --prod` bỏ CLI `prisma` (devDependency) nên `postinstall` không sinh client: ảnh sẽ thoát với
# "@prisma/client did not initialize yet". Sinh client vào thư mục deploy bằng CLI của build stage.
# Schema nằm ngoài thư mục deploy sẽ khiến Prisma sinh client vào /repo (build stage): chép vào /prod/worker rồi xoá.
RUN cd /prod/worker && mkdir prisma && cp /repo/apps/api/prisma/schema.prisma prisma/ \
 && node /repo/node_modules/prisma/build/index.js generate --schema prisma/schema.prisma && rm -rf prisma

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

# pinehill-dist: đọc dist/ của gói dùng chung khi worker import chúng
ENV NODE_ENV=production NODE_OPTIONS=--conditions=pinehill-dist
WORKDIR /app
COPY --from=build --chown=node:node /prod/worker ./
USER node
CMD ["node", "dist/main.js"]
