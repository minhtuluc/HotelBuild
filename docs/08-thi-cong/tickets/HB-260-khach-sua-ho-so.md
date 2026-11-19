---
id: HB-260
title: Khách tự sửa hồ sơ trên app (`PATCH /guests/me`) — SCR-83 "Cập nhật hồ sơ"
risk: R1
owner: claude
max_lines: 600
allow:
  - packages/contracts/src/guest.ts
  - packages/contracts/src/openapi/paths/f8.ts
  - packages/contracts/openapi.json
  - docs/04-thiet-ke/api.md
  - apps/api/src/modules/crm/guests/me.controller.ts
  - apps/api/src/modules/crm/guests/self-update.ts
  - apps/api/test/crm/guests-me-update.spec.ts
  - apps/customer-android/src/profile.ts
  - apps/customer-android/src/profile-editor.tsx
  - apps/customer-android/src/strings.ts
  - apps/customer-android/app/(tabs)/account.tsx
  - apps/customer-android/test/profile.spec.ts
  - apps/customer-android/test/profile-update.spec.ts
  - docs/08-thi-cong/tickets/HB-260-khach-sua-ho-so.md
unlock:
  - docs/08-thi-cong/tickets/HB-260-khach-sua-ho-so.md
---

# HB-260 — Khách tự sửa hồ sơ

> Đặc tả do Claude soạn ngày 19/11/2026 khi rà đủ chức năng app khách Android.

## Vấn đề

- SCR-83 có thao tác "Cập nhật hồ sơ", nhưng API chỉ có `GET /guests/me`.
- Tab Tài khoản của app khách vì thế chỉ xem được, kèm ghi chú "Cập nhật hồ sơ sẽ bổ sung khi có tuyến ghi (PATCH /guests/me)" (HB-105/HB-115).

## Thay đổi

1. Hợp đồng `guestSelfUpdateRequestSchema` (strict), cho đúng các trường khách tự quản:
   - `fullName`;
   - `email` (`null` để xoá);
   - `consentMarketing`, phải kèm `consentVersion` khi bật (NFR-COMP-01).
   - Thân rỗng hoặc có trường lạ (SĐT, điểm…) ⇒ 400. SĐT là định danh (BR-CRM-01) nên không sửa ở đây.
2. Thêm dòng vào api.md §2.10 và khai OpenAPI.
3. API `PATCH /guests/me` (`@Public`, chủ thể qua `bookingCaller` như HB-250):
   - Phiên nhân viên ⇒ 403; hồ sơ đã ẩn danh ⇒ 404.
   - Bật đồng ý thì ghi `consent_at` = giờ máy chủ cùng phiên bản điều khoản; rút đồng ý thì xoá cả hai.
   - Audit `GUEST_PROFILE_UPDATED` chỉ ghi **tên** trường đổi, không chép họ tên/email (NFR-SEC-03).
4. Android:
   - `updateRequestFor` chỉ gửi trường đã đổi và kiểm tại chỗ (tên trống, email sai dạng, không đổi gì).
   - `saveProfile`: offline thì không gọi mạng.
   - Form `ProfileEditor` trên tab Tài khoản thay cho ghi chú "chờ tuyến ghi".

## Tiêu chí nghiệm thu

1. `apps/api/test/crm/guests-me-update.spec.ts` (đỏ trước khi sửa). Kiểm:
   - Sửa tên, email và đồng ý nhận tin; mốc đồng ý do máy chủ ghi.
   - Audit không chứa email.
   - Xoá được email và rút được đồng ý.
   - SĐT, trường lạ, đồng ý thiếu phiên bản, email sai, thân rỗng ⇒ 400.
   - Phiên nhân viên ⇒ 403; không token ⇒ 401.
2. `apps/customer-android/test/profile-update.spec.ts` (đỏ trước khi sửa).
3. `check:openapi` khớp bản commit; `check:contract` không có thay đổi phá vỡ.
4. Máy thật: chưa thử được vì điện thoại mất kết nối adb trong phiên. Bổ sung khi máy cắm lại.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
