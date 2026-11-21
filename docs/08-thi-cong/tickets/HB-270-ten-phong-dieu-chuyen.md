---
id: HB-270
title: Màn đổi phòng của app vận hành hiện số phòng, tên cơ sở và trạng thái tiếng Việt thay cho UUID và mã thô
risk: R1
owner: claude
max_lines: 360
allow:
  - apps/operations-android/src/features/f6-overbooking/labels.ts
  - apps/operations-android/src/features/f6-overbooking/relocation-parts.tsx
  - apps/operations-android/src/features/f6-overbooking/relocation-screen.tsx
  - apps/operations-android/src/features/f6-overbooking/messages.ts
  - apps/operations-android/test/f6-overbooking/labels.spec.ts
  - apps/operations-android/test/f6-overbooking/screen.spec.ts
  - docs/08-thi-cong/tickets/HB-270-ten-phong-dieu-chuyen.md
unlock:
  - docs/08-thi-cong/tickets/HB-270-ten-phong-dieu-chuyen.md
---

# HB-270 — Nhãn đọc được trên SCR-63

> Đặc tả do Claude soạn ngày 20/11/2026 từ máy thật (ca quá tải 25/11, Pine Hill Đà Lạt).

## Vấn đề

Màn đổi phòng in thẳng dữ liệu của hợp đồng:
- Phòng đích và cơ sở đích là UUID.
- Mã điều chuyển và người duyệt là UUID.
- Loại phương án, trạng thái và hành động là mã thô (`UPGRADE_SAME_PROPERTY`, `PROPOSED`, `EXECUTE`).

Vì vậy lễ tân không biết sẽ chuyển khách sang phòng nào.

## Thay đổi

1. `labels.ts`:
   - Tên lấy từ hai tuyến đọc có sẵn: `GET /rooms` (`propertyAdmin.read`: lễ tân, quản lý, chủ, buồng phòng; theo phạm vi; tối đa 20 trang × 100) và `GET /public/properties`.
   - Không thêm endpoint, không đổi hợp đồng.
   - Tải lỗi thì hiện "phòng chưa rõ tên" / "cơ sở chưa rõ tên". Không bao giờ in UUID.
   - Có bảng tiếng Việt cho loại phương án, trạng thái và hành động.
2. Phương án hiện dạng "Cùng loại phòng, cùng cơ sở → phòng FAM03 · Pine Hill Đà Lạt".
3. Tóm tắt điều chuyển hiện dạng "Điều chuyển (…): chờ duyệt", "Từ phòng FAM02 → phòng FAM03", "Đã được quản lý duyệt". Bỏ mã điều chuyển và UUID người duyệt.
4. Hook tải tên khai báo sau `useRelocation`, để giữ thứ tự hook của harness test.

## Tiêu chí nghiệm thu

1. `test/f6-overbooking/labels.spec.ts` đỏ trước khi sửa. Kiểm phân trang phòng, tải lỗi không lộ UUID và nhãn tiếng Việt.
2. `screen.spec.ts`: phương án không còn chứa id thô.
3. Ops Android: tsc, eslint và vitest (56 file) xanh.
4. Máy thật (20/11, lễ tân):
   - Cảnh báo 25/11 → "Xử lý" → phương án "→ phòng FAM03 · Pine Hill Đà Lạt".
   - Lập điều chuyển → "Từ phòng FAM02 → phòng FAM03: chờ duyệt".
   - PIN → "đã thực hiện / Đã đổi phòng xong."

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
