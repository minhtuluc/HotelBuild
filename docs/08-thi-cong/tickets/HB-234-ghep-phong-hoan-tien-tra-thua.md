---
id: HB-234
title: Ghép phòng MERGE_SHARE lập hồ sơ hoàn cho phần khách trả thừa (QA-F6-13)
risk: R2
owner: claude
max_lines: 350
allow:
  - apps/api/src/modules/over/merges/overpayment.ts
  - apps/api/src/modules/over/merges/share-execute.ts
  - apps/api/src/modules/over/moves/writes.ts
  - apps/api/src/modules/over/moves/walkout.ts
  - apps/api/test/over/merge-overpayment-refund.spec.ts
  - docs/04-thiet-ke/api.md
  - docs/07-ban-giao/bang-chung-f6-qa.md
  - docs/08-thi-cong/tickets/HB-234-ghep-phong-hoan-tien-tra-thua.md
---

# HB-234 — Hoàn phần trả thừa sau ghép phòng

## Vấn đề (QA HB-194, QA-F6-13, P2 tiền)

`MERGE_SHARE` giảm nghĩa vụ phòng mỗi booking theo chiết khấu (BR-OVER-15). Khách đã trả đủ giá cũ thì trả thừa (lượt QA: 63.000 mỗi booking), nhưng không có hồ sơ hoàn hay đối soát, và `balance_due` = 0.

**Quyết định người dùng (11/11/2026):** tạo yêu cầu hoàn tiền.

## Thay đổi

- `merges/overpayment.ts`: sau khi áp chiết khấu, sync sổ cái và tính `trả thừa = Σ available − balanceDue`. Nếu > 0:
  - lập `refund_requests` `HOTEL_RELOCATION` PENDING, `event_key = merge:<id>` (idempotent theo `uq_refund_event`);
  - `requested_amount` = phần thừa, **phí 0**, bằng chứng `room-merge:<id>`;
  - `ledger.reserve` trên các nguồn thu khả dụng.
- Duyệt và chi đi theo luồng hoàn hai cấp sẵn có.
- `moves/writes.ts`: tách `insertRelocationRefund` và `reservationLegs` dùng chung với walk-out (hành vi walk-out không đổi).
- Outbox `RoomMergeActivated` và audit `ROOM_MERGE_ACTIVATED` mang id hồ sơ hoàn.

## Quyết định tự đưa ra

- Lý do `HOTEL_RELOCATION`, không thêm giá trị CHECK mới: ghép phòng là điều chuyển do khách sạn chủ động, và như vậy không cần DDL.
- Phí hoàn 0: đây là nhượng bộ của khách sạn. Áp `refund.feeAmount` sẽ ăn mất khoản chiết khấu nhỏ.
- Số hoàn lấy từ sổ cái, không lấy từ `discountAmount` của quyết định, nên khớp đúng tiền khách đã trả kể cả khi lệch làm tròn floor 1.000.

## Tiêu chí nghiệm thu

1. Hai booking đã trả đủ ⇒ mỗi bên đúng 1 hồ sơ PENDING bằng `paid − nghĩa vụ mới`, phí 0, giữ chỗ đủ số, `balance_due` 0. Test: `apps/api/test/over/merge-overpayment-refund.spec.ts::HB234_paid_in_full_merge_creates_pending_refund_for_the_overpayment` (đỏ trên code cũ).
2. Chưa trả thừa ⇒ không có hồ sơ. Test: `…::HB234_no_refund_when_guest_has_not_overpaid`.
3. MANAGER duyệt bằng PIN qua `POST /refund-requests/{id}/approve` ⇒ APPROVED. Test: `…::HB234_merge_refund_goes_through_existing_two_level_approval`.
4. Test khoá HB-124 (`merge.locked.spec.ts`, `walkout.locked.spec.ts`) xanh, không sửa.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · integration `apps/api/test/{over,duyet-hoan-tien,chi-hoan}`.
