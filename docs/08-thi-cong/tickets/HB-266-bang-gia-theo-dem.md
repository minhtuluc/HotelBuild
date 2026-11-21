---
id: HB-266
title: Bảng giá theo đêm đã chốt cho booking (`GET /bookings/{id}/nights`) và hiện trên chi tiết đơn của app khách
risk: R1
owner: claude
max_lines: 600
allow:
  - packages/contracts/src/booking.ts
  - packages/contracts/src/openapi/paths/f4.ts
  - packages/contracts/openapi.json
  - packages/contracts/test/openapi.spec.ts
  - docs/04-thiet-ke/api.md
  - apps/api/src/modules/book/bookings/controller.ts
  - apps/api/src/modules/book/bookings/price-view.ts
  - apps/api/test/bookings/nights.spec.ts
  - apps/customer-android/src/nights.ts
  - apps/customer-android/src/strings.ts
  - apps/customer-android/app/booking/[code].tsx
  - apps/customer-android/test/nights.spec.ts
  - docs/08-thi-cong/tickets/HB-266-bang-gia-theo-dem.md
unlock:
  - docs/08-thi-cong/tickets/HB-266-bang-gia-theo-dem.md
---

# HB-266 — Giá theo đêm của booking

> Đặc tả do Claude soạn ngày 19/11/2026. Xếp chồng trên HB-265 (#351), vì cùng sửa màn chi tiết đơn.

## Vấn đề

- SCR-80 cần bảng giá từng đêm (PriceSnapshot). Snapshot bất biến đã lưu từ HB-077 nhưng API không có tuyến đọc.
- Vì vậy app khách ghi "Bảng giá theo đêm: chờ ticket hợp đồng".

## Thay đổi

1. `GET /bookings/{bookingId}/nights` đọc snapshot mới nhất (sau đổi ngày hay huỷ một phần là bản mới):
   - Mỗi đêm một dòng: ngày, tiền (tổng các phòng của đêm đó), số phòng.
   - Kèm tạm tính, giảm giá, tổng.
   - **Không** trả hoa hồng kênh hay hệ số định giá nội bộ.
   - Quyền đọc như `GET /bookings/{id}`: khách lạ 404, nhân viên theo phạm vi.
2. Tên tuyến cố ý **không** chứa `price`, để giữ bất biến "không có tuyến nào trên price snapshot" của `openapi.spec`/F6 (§2.14, BR-RATE-16). Đây là tuyến chỉ đọc.
3. Thêm vào hợp đồng (`bookingPriceSnapshotSchema`), OpenAPI (126 path) và api.md.
4. Android: màn chi tiết đơn đọc giá theo đêm sau khi có booking. Đọc lỗi thì báo "chưa xem được", không chặn màn.

## Tiêu chí nghiệm thu

1. `apps/api/test/bookings/nights.spec.ts`:
   - Tổng các đêm bằng `totals.grossAmount` và bằng `booking.totalAmount`; không có trường nội bộ.
   - Khách lạ 404; nhân viên đọc được.
2. `apps/customer-android/test/nights.spec.ts`.
3. Máy thật, PH-261119-00006 sau khi đổi ngày: 17/01 và 18/01/2027, mỗi đêm 1.100.000 ₫.

## Ghi chú merge

- `packages/contracts/test/openapi.spec.ts` sẽ xung đột nhẹ với #348 (HB-262), vì cả hai cùng thêm một path vào danh sách. Khi gộp, giữ cả hai path và đổi số đếm thành 127.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
