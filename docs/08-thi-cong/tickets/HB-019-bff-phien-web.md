---
id: HB-019
title: BFF phiên cho 2 web app — refresh token trong cookie HttpOnly
risk: R2
owner: codex
max_lines: 750
allow:
  - packages/web-session/**
  - apps/operations-web/src/app/api/session/**
  - apps/customer-web/src/app/api/session/**
  - apps/operations-web/package.json
  - apps/customer-web/package.json
  - apps/operations-web/test/session/**
  - apps/customer-web/test/session/**
  - tests/e2e/fake-api/server.ts
  - tests/e2e/fake-api/core/**
  - tests/e2e/playwright.config.ts
  - pnpm-lock.yaml
---

# HB-019 — BFF phiên web

## Mục tiêu

Hai web app giữ refresh token trong cookie `HttpOnly` của chính app, trình duyệt chỉ cầm access token trong bộ nhớ. Màn hình F1 (HB-020, HB-021, HB-023) dùng một client phiên chung, không tự chạm token.

## Căn cứ

- [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) quyết định 1, 2; T10
- api.md §1.2, §6.3 (cookie HttpOnly/Secure + CSRF); ADR-018; NFR-SEC-01, NFR-SEC-03
- Hợp đồng `auth/*`, `guest-auth/*` sau HB-011

## Tiêu chí nghiệm thu

1. Gói `packages/web-session` (server-only, không import được từ client component — chặn bằng `server-only`): xử lý `login`, `refresh`, `logout` cho hai loại phiên (`staff` → `/auth/*` với `clientSurface: OPS_WEB`; `guest` → `/guest-auth/*` với `GUEST_WEB`) qua `@pinehill/api-client`.
2. Route handler mỗi app: `POST /api/session/login|refresh|logout`. Cookie `HttpOnly; Secure` (trừ `127.0.0.1` dev), `SameSite=Strict`, `Path=/api/session`, `Max-Age` theo `refreshExpiresInSeconds`. Response trả `accessToken`, `expiresInSeconds`, `mustChangePassword` — **không bao giờ** trả refresh token.
3. CSRF: từ chối khi `Origin` khác origin của app hoặc thiếu header `X-Session-Request: 1` → 403 bao lỗi chuẩn.
4. Client phía trình duyệt (export từ gói, file riêng không server-only): giữ access token trong bộ nhớ, tự refresh trước khi hết hạn và khi nhận 401 một lần; nhiều tab/request đồng thời chỉ gửi **một** refresh; refresh thất bại → phát sự kiện `session-expired`. Cung cấp `getAccessToken` cho `createApiClient`.
5. Logout: gọi `/auth/logout` (hoặc guest) với access token hiện có, xoá cookie kể cả khi API lỗi.
6. Test: unit cho cookie/CSRF/refresh đơn chuyến; test route handler với API giả (HTTP thật, như test `api-client`): refresh token không xuất hiện trong body/log; cookie bị xoá khi refresh 401.
7. **API giả dùng chung cho E2E** (thay `page.route`, vì request giờ đi từ server Next.js): `tests/e2e/fake-api/server.ts` là HTTP server thật ở `E2E_API_BASE_URL` (mặc định `:4000`), tự nạp handler từ các thư mục con (`core/` do ticket này viết: `auth/*`, `guest-auth/*`, `system/health`; `staff/`, `users/`, `guest/` để HB-020/021/023 thêm). Có endpoint điều khiển kịch bản cho test (vd. ép 401/423/429). `playwright.config.ts` khởi động server này; 72 ca E2E hiện có vẫn xanh.
8. `pnpm run ci` xanh; `pnpm check:imports` vẫn xanh (không chạm ranh giới frontend).

## Ngoài phạm vi

- Màn hình đăng nhập (HB-020, HB-023), Android (HB-022, HB-024).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
