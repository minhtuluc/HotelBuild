# syntax=docker/dockerfile:1
# Image API (kiến trúc §7). Multi-stage: build tsc → `pnpm deploy --prod` chỉ gói phần cần; chạy user `node`.
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @pinehill/api...
RUN pnpm --filter @pinehill/api build && pnpm --filter @pinehill/api deploy --legacy --prod /prod/api

FROM node:22-slim AS runtime
# HOST=0.0.0.0 để nhận kết nối từ ngoài container (mặc định dev 127.0.0.1 — AC6)
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /prod/api ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
