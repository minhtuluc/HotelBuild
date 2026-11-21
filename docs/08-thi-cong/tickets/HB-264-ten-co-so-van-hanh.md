---
id: HB-264
title: Màn "Chọn cơ sở" của app vận hành hiện tên cơ sở thay vì UUID
risk: R1
owner: claude
max_lines: 150
allow:
  - apps/operations-android/app/select-property.tsx
  - apps/operations-android/app/index.tsx
  - apps/operations-android/src/property-names.ts
  - apps/operations-android/test/property-names.spec.ts
  - docs/08-thi-cong/tickets/HB-264-ten-co-so-van-hanh.md
unlock:
  - docs/08-thi-cong/tickets/HB-264-ten-co-so-van-hanh.md
---

# HB-264 — Tên cơ sở khi chọn cơ sở

> Đặc tả do Claude soạn ngày 19/11/2026 từ máy thật (kế toán có hai cơ sở). Xếp chồng trên HB-263 (#349), vì cùng sửa `app/index.tsx`.

## Vấn đề

- Nhân viên có nhiều cơ sở phải chọn giữa các UUID, vì `/auth/me` chỉ trả id trong `propertyScope`.

## Thay đổi

1. `src/property-names.ts`: tải tên từ `GET /public/properties` qua client của phiên. Lỗi tải thì vẫn hiện id, để không chặn đăng nhập.
2. Client được tạo ở **từng lần gọi**, vì `resourceClient()` ghim token lúc tạo. Nếu tạo khi chưa đăng nhập, lời gọi bị chặn ngay ở phía client.

## Tiêu chí nghiệm thu

1. `apps/operations-android/test/property-names.spec.ts`.
2. Máy thật: tài khoản `accountant` có hai cơ sở thấy "Pine Hill Phan Thiết" và "Pine Hill Đà Lạt".

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
