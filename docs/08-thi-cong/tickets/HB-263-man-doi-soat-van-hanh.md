---
id: HB-263
title: App vận hành có màn SCR-68 đối soát tiền mặt theo ngày VN (lễ tân xem, kế toán đếm và chốt có PIN)
risk: R1
owner: claude
max_lines: 600
allow:
  - apps/operations-android/src/reconciliation/**
  - apps/operations-android/src/stages.ts
  - apps/operations-android/src/strings.ts
  - apps/operations-android/app/home.tsx
  - apps/operations-android/app/index.tsx
  - apps/operations-android/test/reconciliation-model.spec.ts
  - apps/operations-android/test/home-nav.spec.ts
  - docs/08-thi-cong/tickets/HB-263-man-doi-soat-van-hanh.md
unlock:
  - docs/08-thi-cong/tickets/HB-263-man-doi-soat-van-hanh.md
---

# HB-263 — SCR-68 trên app vận hành

> Xếp chồng trên HB-262 (#348, API) và HB-261 (#347, thẻ màn chính).

## Thay đổi

- Màn chính có thẻ "Đối soát tiền mặt hôm nay".
- Màn SCR-68 đọc `GET /reconciliation/daily` cho ngày VN của cơ sở đang làm việc:
  - Lễ tân thấy tổng mình thu.
  - Kế toán thấy từng người thu; đếm quỹ, mở PIN (FINANCIAL, không gắn booking) rồi chốt bằng `collectorId`.
  - Khi chưa rõ kết quả, giữ nguyên khoá chống trùng (`PinnedWriter`).
- Phần logic thuần nằm ở `src/reconciliation/model.ts`.

## Tiêu chí nghiệm thu

1. `test/reconciliation-model.spec.ts` và `test/home-nav.spec.ts` xanh.
2. Máy thật: chưa thử (điện thoại khoá màn hình hoặc mất kết nối trong phiên).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
