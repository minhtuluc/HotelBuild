---
id: HB-012
title: Bổ sung hợp đồng F1 — GET /auth/me, clientSurface khi khách đăng ký, retryAfterSeconds và tự refresh trong api-client; nối vào 2 app Android
risk: R2
owner: deepseek
max_lines: 650
allow:
  - packages/contracts/src/**
  - packages/contracts/test/**
  - packages/contracts/openapi.json
  - packages/api-client/src/**
  - packages/api-client/test/**
  - apps/operations-android/app/**
  - apps/operations-android/src/**
  - apps/operations-android/test/**
  - apps/customer-android/app/**
  - apps/customer-android/src/**
  - apps/customer-android/test/**
unlock:
  - docs/04-thiet-ke/api.md
---

# HB-012 — Bổ sung hợp đồng F1

## Mục tiêu

Lấp bốn lỗ hổng DeepSeek phát hiện khi làm HB-022/HB-024 (02/10/2026): app không biết người dùng đã có PIN chưa và có những cơ sở nào; khách đăng ký không khai được bề mặt Android; app không đọc được thời gian chờ khi bị khoá; access token hết hạn sau 15 phút không tự refresh.

## Căn cứ

- [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) quyết định 3, 4, 5, 9; T5, T10
- Review PR #22, PR #23; [api.md](../../04-thiet-ke/api.md) §1.2, §2.1
- BR-RBAC-02, BR-RBAC-05, BR-RBAC-06; UC-AUTH-01, UC-AUTH-03

## Tiêu chí nghiệm thu

1. **`GET /api/v1/auth/me`** (bearer, nhân viên): `{ userId, username, fullName, role, propertyScope[], hasPin, mustChangePassword }`; 401 `E_AUTH_INVALID_CREDENTIALS`. Thêm dòng api.md §2.1. Bản cho khách chưa cần.
2. `guestRegisterRequest` thêm `clientSurface?` (`GUEST_WEB` | `GUEST_ANDROID`). `check:contract` báo 0 thay đổi phá vỡ; không sửa `openapi.baseline.json`.
3. `api-client`:
   - `ApiError.retryAfterSeconds`: lấy từ body lỗi, nếu thiếu thì từ header `Retry-After`; có test cả hai nguồn.
   - `guestLogin` nhận `clientSurface` (tham số tuỳ chọn, giữ tương thích lời gọi cũ); `createAuthApi().me()`.
   - Tuỳ chọn `ApiClient({ onUnauthorized })`: khi request đã xác thực nhận 401, gọi hook **một lần**; hook trả `true` thì gửi lại request đúng một lần. Nhiều request 401 đồng thời chỉ gọi hook một lần. Endpoint `refresh`/`login` không kích hoạt hook.
4. **operations Android:** sau đăng nhập gọi `me()` → chưa có PIN thì vào đặt PIN, nhiều cơ sở thì chọn cơ sở đang làm việc (QĐ-03 quyết định 9, lưu lựa chọn trong bộ nhớ phiên); `E_AUTH_PIN_LOCKED`/`E_AUTH_ACCOUNT_LOCKED` hiện thời gian từ `retryAfterSeconds` (bỏ hằng 900 giây khi có giá trị); `onUnauthorized` → refresh im lặng.
5. **customer Android:** đăng ký/đăng nhập gửi `clientSurface: GUEST_ANDROID`; hiện thời gian chờ từ `retryAfterSeconds`; `onUnauthorized` → `silentRefresh`.
6. **Đăng xuất thu hồi trên máy chủ (cả hai app):** gọi `/auth/logout` (khách: endpoint tương ứng) bằng access token hiện có trước khi xoá secure storage; API lỗi hoặc mất mạng vẫn xoá storage (review PR #22, #23).
7. Test logic cho mục 3–6; bundle Hermes hai app build được; `pnpm run ci` xanh.

## Ngoài phạm vi

- Hiện thực backend `/auth/me` (HB-013) và `clientSurface` khi đăng ký (HB-017).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `npm run check:docs`
