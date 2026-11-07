# syntax=docker/dockerfile:1
# Image API (kiến trúc §7). Multi-stage: build tsc → `pnpm deploy --prod` chỉ gói phần cần; chạy user `node`.
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
COPY packages ./packages
COPY apps/api ./apps/api
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @pinehill/api...
RUN pnpm --filter @pinehill/api... build && pnpm --filter @pinehill/api deploy --legacy --prod /prod/api
# `pnpm deploy --prod` bỏ CLI `prisma` (devDependency) nên `postinstall` không sinh client: ảnh sẽ thoát với
# "@prisma/client did not initialize yet". Sinh client vào thư mục deploy bằng CLI của build stage.
RUN cd /prod/api && node /repo/node_modules/prisma/build/index.js generate --schema prisma/schema.prisma

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

# HOST=0.0.0.0 để nhận kết nối từ ngoài container (mặc định dev 127.0.0.1 — AC6)
# pinehill-dist: runtime Node đọc dist/ của @pinehill/contracts + @pinehill/domain (frontend/typecheck vẫn đọc src)
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 NODE_OPTIONS=--conditions=pinehill-dist
WORKDIR /app
COPY --from=build --chown=node:node /prod/api ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
