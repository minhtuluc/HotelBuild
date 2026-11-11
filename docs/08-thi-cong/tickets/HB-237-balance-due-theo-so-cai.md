---
id: HB-237
title: '`balance_due` khớp sổ cái sau ghép MERGE_CONNECTING (TD-18)'
risk: R1
owner: claude
max_lines: 150
allow:
  - apps/api/src/modules/over/merges/connecting.ts
  - apps/api/test/over/merge-connecting-balance.spec.ts
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/08-thi-cong/tickets/HB-237-balance-due-theo-so-cai.md
---

# HB-237 — `balance_due` theo sổ cái (TD-18)

## Vấn đề

TD-18 ghi rằng `bookings.balance_due` có thể lệch sổ cái nhưng "khách không thấy sai". Điều này **không đúng**: `book/bookings/projection.ts` trả thẳng cột cho `GET /bookings` và `GET /bookings/{id}`.

Rà mọi đường ghi tiền/nghĩa vụ (danh sách trong TD-18): tất cả đều `BookingLedger.sync`, **trừ ghép phòng**. Ở đó `reduceObligation` tự ghi `max(0, Σ ROOM − paid_amount)`, bỏ qua phụ thu (`EXTRA_SERVICE`, `PENALTY`…) và tiền đã hoàn.

Ví dụ: booking `MERGE_CONNECTING` đã trả đủ tiền phòng, còn 200.000 phụ thu ⇒ sau ghép cột báo 0, khách "không còn nợ".

## Thay đổi

`executeConnecting` gọi `BookingLedger.sync` ngay sau khi áp chiết khấu. `MERGE_SHARE` đã có `sync` trong HB-234 (#285); không sửa ở đây để hai PR không xung đột.

## Tiêu chí nghiệm thu

1. `MERGE_CONNECTING` trên booking đã trả đủ phòng, còn phụ thu 200.000 ⇒ `balance_due` = 200.000 ở CSDL và ở `GET /bookings/{id}`. Test: `apps/api/test/over/merge-connecting-balance.spec.ts::HB237_connecting_merge_keeps_balance_due_equal_to_ledger` (đỏ trên code cũ: `'0'`).
2. `test/over/**` xanh, test khoá không sửa.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · integration `apps/api/test/over`.
