---
id: HB-320
title: TD-44 phần 3 — danh sách booking (ô chọn cơ sở), tạo hạng phòng, ghi đè kênh, đối soát, khoá phòng, báo giá đa kênh, khách thân thiết mở ở cơ sở đang làm việc
risk: R1
owner: claude
max_lines: 800
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/**
  - tests/e2e/scr31-32-booking-ops.spec.ts
  - docs/04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/08-thi-cong/tickets/HB-320-co-so-dang-lam-viec-phan-3.md
unlock:
  - docs/08-thi-cong/tickets/HB-320-co-so-dang-lam-viec-phan-3.md
---

# HB-320 — TD-44 phần 3: cơ sở đang làm việc cho các màn vận hành còn lại

> Đặc tả do frontend lead tự soạn theo TD-44 ([sổ nợ kỹ thuật](../../07-ban-giao/no-ky-thuat.md)). Phần 1 là HB-308 (SCR-23, SCR-27), phần 2 là HB-314 (#309). Ticket này dựng trên nhánh HB-314 và dùng lại `chooseProperty`, `useWorkingPropertyId()`, `useFollowWorkingProperty`.

## Vấn đề

Sau HB-314 vẫn còn bảy màn tự mở ở cơ sở đầu danh sách hoặc ở "toàn chuỗi", không theo cơ sở đang làm việc trên thanh ngữ cảnh. Riêng danh sách booking (SCR-31), ô "Cơ sở" còn là ô nhập mã tự do.

## Thay đổi

1. **Danh sách booking (SCR-31):**
   - Ô "Cơ sở" thành ô chọn, nạp từ `GET /properties` (danh sách máy chủ trả), thêm lựa chọn "Tất cả cơ sở" (`?propertyId=all`).
   - Không có `propertyId` trên URL thì lọc theo cơ sở đang làm việc và đi theo khi đổi cơ sở. Id trên URL không có trong danh sách bị bỏ qua.
   - Không đọc được danh sách cơ sở thì chỉ còn "Tất cả cơ sở" (máy chủ vẫn giới hạn phạm vi).
2. **Form tạo hạng phòng (SCR-20), ghi đè kênh (SCR-29):** mở form với cơ sở đang làm việc chọn sẵn (nếu có trong danh sách); đổi cơ sở trên thanh ngữ cảnh khi form đang mở thì form đổi theo.
3. **Đối soát, khoá phòng, báo giá đa kênh:** mở ở cơ sở đang làm việc (`chooseProperty`); đổi cơ sở thì mở lại ở cơ sở mới.
4. **Khách thân thiết:** danh sách chọn khách lọc theo cơ sở đang làm việc (`GET /guests?propertyId=`); đổi cơ sở thì nạp lại và bỏ khách đang chọn.
5. `lib/working-property.ts` thêm `workingIfAvailable`; `useFollowWorkingProperty` nhận thêm danh sách máy chủ trả để bỏ qua id ngoài danh sách.

## Tiêu chí nghiệm thu

1. Unit: `test/working-property.spec.ts` (thêm `workingIfAvailable`), `test/scr31-32-booking-ops/booking-property-filter.spec.ts` (thứ tự ưu tiên, "tất cả", id ngoài danh sách bị bỏ qua); toàn bộ unit operations-web đạt.
2. E2E `scr31-32-booking-ops.spec.ts`: ô "Cơ sở" là ô chọn có "Tất cả cơ sở" và các cơ sở máy chủ trả; chọn một cơ sở thì `GET /bookings` gửi đúng `propertyId`, chọn "Tất cả" thì không gửi.
3. Toàn bộ E2E operations-web đạt trên bản build production.
4. Typecheck, lint đạt; không có cast `as` mới; không thêm quy tắc phân quyền (phạm vi cơ sở vẫn do máy chủ quyết).

## Ngoài phạm vi

- Màn người dùng: phạm vi cơ sở của tài khoản do quản trị gán, không phải "cơ sở đang làm việc".
- Bảng booking hiện tên cơ sở thay cho mã.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e` (operations-web)
