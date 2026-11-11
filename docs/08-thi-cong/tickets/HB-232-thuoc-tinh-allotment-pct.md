---
id: HB-232
title: Test thuộc tính quota kênh phủ `allotmentPct` (nối HB-226 sau HB-224)
risk: R0
owner: claude
max_lines: 100
allow:
  - packages/domain/test/inventory/channel-quota.property.spec.ts
  - docs/08-thi-cong/tickets/HB-232-thuoc-tinh-allotment-pct.md
---

# HB-232 — Thuộc tính quota kênh có `allotmentPct`

HB-226 khoá 10.000 cấu hình với quota OTA mặc định cố định 80%. Từ HB-224, engine nhận `allotmentPct` (0..100) từ ánh xạ kênh. Ticket này mở rộng generator và oracle:

- `pct` ngẫu nhiên 0..100, hoặc vắng (khi đó dùng 80);
- quota mặc định = `max(1, floor(pct% × ACTIVE))` khi có đơn vị ACTIVE và `pct > 0`;
- quota = 0 khi `pct = 0`.

## Tiêu chí nghiệm thu

1. `packages/domain/test/inventory/channel-quota.property.spec.ts` xanh với seed cố định.
2. Phá thử: oracle bỏ qua `pct` ⇒ test đỏ, phản ví dụ `allotmentPct: 0`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`.
