---
id: HB-011
title: Hợp đồng F1 — endpoint, mã lỗi và client bổ sung theo QĐ-03
risk: R2
owner: deepseek
max_lines: 800 # 7 endpoint + 7 mã lỗi + client + 2 bề mặt UI; lead nâng từ 700 (PR #19)
allow:
  - packages/contracts/src/**
  - packages/contracts/test/**
  - packages/contracts/openapi.json
  - packages/api-client/src/**
  - packages/api-client/test/**
  - packages/ui-web/src/messages.ts
  - packages/ui-web/src/errors.ts
  - packages/ui-web/test/**
  - packages/ui-native/src/stateMessages.ts
  - packages/ui-native/test/**
unlock:
  - docs/04-thiet-ke/api.md
---

# HB-011 — Hợp đồng F1

## Mục tiêu

`packages/contracts` (và OpenAPI sinh ra) mô tả đủ mọi endpoint F1 theo [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md); `api-client` gọi được tất cả; UI có thông điệp cho mã lỗi mới. Backend và 4 frontend F1 làm song song trên hợp đồng này.

## Căn cứ

- QĐ-03 T5, T6, T7, T10, T11; quyết định 5, 7, 8, 9, 10
- [api.md](../../04-thiet-ke/api.md) §1.2, §2.1, §4.2, §6.1–6.3
- BR-RBAC-01, BR-RBAC-02, BR-RBAC-05, BR-RBAC-06, BR-CRM-01; UC-AUTH-01, UC-AUTH-02, UC-AUTH-03

## Tiêu chí nghiệm thu

1. **Mã lỗi** thêm vào `errors.ts` (đúng HTTP status): `E_AUTH_ACCOUNT_LOCKED` 401, `E_AUTH_PIN_LOCKED` 403, `E_AUTH_PASSWORD_CHANGE_REQUIRED` 403, `E_AUTH_USERNAME_TAKEN` 409, `E_AUTH_PHONE_REGISTERED` 409, `E_AUTH_RESET_TOKEN_INVALID` 400, `E_GEN_RATE_LIMITED` 429. `errorBodySchema` thêm trường tuỳ chọn `retryAfterSeconds` (số nguyên ≥ 1). Bảng api.md §4.2 thêm 7 dòng (cùng cột với các dòng hiện có).
2. **Schema/endpoint mới** (request `strictObject`, response `object`; khai trong `registry.ts`; thêm dòng vào api.md §2.1):
   - `GET /api/v1/users?cursor&limit&role&propertyId&q` → danh sách `userSummary` (`id`, `username`, `fullName`, `role`, `propertyScope[]`, `isActive`, `lockedUntil|null`, `hasPin`, `version`) theo bao hình danh sách hiện có. Bearer; 403 `E_RBAC_FORBIDDEN`.
   - `POST /api/v1/users` (`username`, `fullName`, `phone?`, `role`, `propertyScope[]`, `temporaryPassword`) → 201 `userSummary`. 409 `E_AUTH_USERNAME_TAKEN`, 403.
   - `POST /api/v1/auth/password` (`currentPassword`, `newPassword` 8–128) → 204. 401 `E_AUTH_INVALID_CREDENTIALS`.
   - `PUT /api/v1/auth/pin` (`pin` 6 số, `currentPassword`) → 204.
   - `DELETE /api/v1/users/{userId}/pin` → 204; 403 `E_RBAC_FORBIDDEN`/`E_AUTH_OUT_OF_SCOPE`, 404.
   - `POST /api/v1/guest-auth/password-reset/request` (`phone`) → **luôn 202** (T7). 429.
   - `POST /api/v1/guest-auth/password-reset/confirm` (`token`, `newPassword`) → 204; 400 `E_AUTH_RESET_TOKEN_INVALID`.
3. **Sửa schema hiện có, không phá vỡ:** `loginRequest` thêm `clientSurface?` (`OPS_WEB`|`OPS_ANDROID`, T10); `guestLoginRequest` thêm `clientSurface?` (`GUEST_WEB`|`GUEST_ANDROID`); `tokenPair` thêm `mustChangePassword?` boolean; `guest-auth/register` thêm response 409 `E_AUTH_PHONE_REGISTERED`; `auth/login` và `guest-auth/login` thêm 401 `E_AUTH_ACCOUNT_LOCKED` và 429 `E_GEN_RATE_LIMITED`; `auth/pin/verify` thêm 403 `E_AUTH_PIN_LOCKED`; `PUT /users/{userId}/access` thêm 403 `E_AUTH_OUT_OF_SCOPE` (QĐ-02 F1-d).
4. `pnpm openapi:generate` cập nhật `openapi.json`; `pnpm check:openapi` xanh; `pnpm check:contract` báo **0 thay đổi phá vỡ** (không sửa `openapi.baseline.json`).
5. `api-client`: hàm cho 7 endpoint mới trong `createAuthApi` (hoặc `createUsersApi` cho `/users`), cùng cơ chế If-Match/correlation/retry hiện có; `DELETE …/pin` và `POST /users` không retry tự động. Test HTTP thật như các test hiện có.
6. `ui-web`/`ui-native`: thông điệp tiếng Việt + hành động UI cho 7 mã mới; `E_AUTH_ACCOUNT_LOCKED` và `E_GEN_RATE_LIMITED` hiển thị thời gian chờ từ `retryAfterSeconds`.
7. `pnpm run ci` và `npm run check:docs` xanh.

## Ngoài phạm vi

- Hiện thực backend (HB-013…HB-017, HB-028), màn hình (HB-019…HB-024).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `npm run check:docs`
