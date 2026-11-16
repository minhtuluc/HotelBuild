---
id: HB-324
title: Phiên khách — web-session phủ đăng ký và đặt lại mật khẩu, giữ Retry-After (TD-41); trạng thái đăng nhập trên mọi trang khách (TD-42)
risk: R1
owner: claude
max_lines: 1500
allow:
  - packages/api-client/src/client.ts
  - packages/api-client/src/transport.ts
  - packages/web-session/src/**
  - packages/web-session/test/**
  - apps/customer-web/src/**
  - apps/customer-web/test/**
  - tests/e2e/guest-auth.spec.ts
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md
  - docs/08-thi-cong/tickets/HB-324-phien-khach-web-session.md
unlock:
  - docs/08-thi-cong/tickets/HB-324-phien-khach-web-session.md
---

# HB-324 — Phiên khách: web-session đủ lệnh, trạng thái đăng nhập trên mọi trang

> Đặc tả do frontend lead soạn để trả TD-41 và TD-42 ([sổ nợ kỹ thuật](../../07-ban-giao/no-ky-thuat.md)). Chủ dự án giao ngày 16/11/2026. Chồng trên HB-323 (#325) vì cùng sửa header khách và danh mục câu chữ.

## Vấn đề

- **TD-41:**
  - Customer web có hai BFF phiên song song. `/api/session/*` của `@pinehill/web-session` lo đăng nhập, làm mới, đăng xuất; còn đăng ký và đặt lại mật khẩu đi qua BFF riêng `(guest)/account/api/*`.
  - Client phiên bỏ mất `Retry-After`, nên khi tài khoản bị khoá hay thao tác quá nhanh, khách chỉ đọc được "thử lại sau ít phút".
- **TD-42:**
  - Trạng thái đăng nhập chỉ hiện trong `/account/*`. Ở trang chủ, trang ga, báo giá, khách không biết mình đã đăng nhập chưa, và header luôn hiện cả "Hồ sơ" lẫn "Tài khoản".
  - Gắn kiểm phiên vào mọi trang thì khách chưa đăng nhập phải gọi `/api/session/refresh` ở mỗi lần tải trang: thêm một yêu cầu và sinh lỗi 401 trong console.

## Thay đổi

1. **`@pinehill/web-session` phủ ba lệnh công khai của khách** (`createGuestAccountHandler`, `server`):
   - `POST /api/session/register`, `/api/session/password-reset/request`, `/api/session/password-reset/confirm`.
   - CSRF như các lệnh phiên khác (`Origin` đúng + `x-session-request: 1`). Thân lệnh kiểm bằng schema hợp đồng; không ghi mật khẩu hay token.
   - Đăng ký giữ hành vi cũ: tạo tài khoản, thu hồi phiên vừa tạo, rồi client đăng nhập bằng chính SĐT và mật khẩu vừa nhập.
   - Client có `registerGuest`, `requestPasswordReset`, `confirmPasswordReset`.
   - Đọc thân lệnh chung một chỗ (`body.ts`) cho cả lệnh phiên và lệnh tài khoản.
2. **Giữ `Retry-After`:**
   - Client phiên và client tài khoản đọc header `retry-after` (hoặc `retryAfterSeconds` trong thân lỗi) vào `ApiError.retryAfterSeconds`.
   - Màn đăng nhập và quên mật khẩu báo thời gian chờ ("Thử lại sau khoảng N phút" / "sau N giây") khi bị khoá hoặc bị giới hạn tần suất.
3. **Gỡ BFF riêng của customer web:** xoá `(guest)/account/api/*` và `account-api.ts`; các màn SCR-08 gọi qua `@pinehill/web-session`.
4. **Cookie gợi ý đăng nhập, chỉ cho phiên khách:**
   - BFF đặt `pinehill_guest_signed=1` (không bí mật, không `HttpOnly`, `Path=/`, `SameSite=Strict`, cùng hạn với cookie refresh) khi đăng nhập hoặc làm mới thành công.
   - Xoá cookie này khi đăng xuất hoặc làm mới thất bại.
   - Cookie chỉ là gợi ý để trình duyệt biết có nên kiểm phiên hay không; quyền truy cập vẫn do máy chủ quyết.
5. **Header khách hiện trạng thái đăng nhập ở mọi trang:**
   - Không có cookie gợi ý thì hiện link "Tài khoản" và không gọi mạng.
   - Có cookie gợi ý thì kiểm phiên: còn phiên thì hiện "Hồ sơ" và nút "Đăng xuất"; hết phiên thì quay về "Tài khoản".
   - Đầu trang khu `/account` giữ nguyên.

## Tiêu chí nghiệm thu

1. Unit `packages/web-session`:
   - ba lệnh tài khoản: CSRF, schema, mã lỗi, `Retry-After`;
   - cookie gợi ý chỉ cho khách: đặt khi đăng nhập/làm mới thành công, xoá khi đăng xuất/làm mới thất bại;
   - client chuyển `Retry-After` vào lỗi.
2. Unit customer web: câu báo thời gian chờ; trạng thái header theo cookie gợi ý.
3. E2E:
   - `guest-auth` chạy qua tuyến mới;
   - khách chưa đăng nhập không gọi `/api/session/refresh` khi tải trang;
   - khách đã đăng nhập thấy "Hồ sơ" và đăng xuất được từ header trang chủ;
   - toàn bộ E2E hai web đạt trên bản build.
4. `session.spec` (hai tab, một lần làm mới) không đổi và vẫn đạt.

## Ngoài phạm vi

- `consentVersion` (`2026-10`) chưa có nguồn trong `docs/02`: cần chủ dự án hoặc nghiệp vụ chốt, giữ mở trong TD-42.
- `NEXT_PUBLIC_FRONT_DESK_CONTACT` đã có trong `docker/web.Dockerfile` và `infra/prod/docker-compose.yml`: chỉ cập nhật sổ nợ.
- Đăng ký đặt luôn cookie phiên (bỏ bước thu hồi rồi đăng nhập lại): cần API giả trả cặp token dùng được; để ticket sau.
