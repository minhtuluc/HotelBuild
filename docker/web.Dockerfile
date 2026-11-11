# syntax=docker/dockerfile:1
# Image web Next.js (HB-175, QĐ-08: hai web chạy trên VPS sau Caddy, không dùng Vercel).
# Dùng chung cho hai app: `--build-arg APP=customer-web` hoặc `APP=operations-web`.
# `output: 'standalone'` (next.config.mjs) gói `server.js` + đúng phụ thuộc được truy vết từ gốc monorepo.
# Cấu hình đọc lúc chạy (`webEnv()` server-side): một image dùng được cho mọi môi trường.
# Ngoại lệ: `NEXT_PUBLIC_FRONT_DESK_CONTACT` của customer-web được nhúng lúc build (truyền qua build-arg).
FROM node:22-alpine AS build
ARG APP
ARG NEXT_PUBLIC_FRONT_DESK_CONTACT=""
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN test -n "$APP" && corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY patches ./patches
COPY packages ./packages
COPY apps/${APP} ./apps/${APP}
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter "@pinehill/${APP}..."
RUN NEXT_PUBLIC_FRONT_DESK_CONTACT="$NEXT_PUBLIC_FRONT_DESK_CONTACT" pnpm --filter "@pinehill/${APP}" build

FROM node:22-alpine AS runtime
ARG APP
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
# `server.js` nằm theo đường dẫn monorepo; symlink cố định để CMD không phụ thuộc tên app.
RUN ln -s /app/apps/${APP}/server.js /app/server.js
USER node
EXPOSE 3000
CMD ["node", "server.js"]
