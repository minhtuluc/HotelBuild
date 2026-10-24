---
id: HB-212
title: Hold hết hạn khi đã thu tiền — lập hoàn 100%, không để tiền nằm lại sổ
risk: R2
owner: codex
max_lines: 450
allow:
  - apps/worker/src/jobs/hold-expiry/**
  - apps/worker/test/hold-expiry/**
  - apps/api/src/modules/pay/refunds/**
  - apps/api/test/duyet-hoan-tien/**
---

# HB-212 — Hết hạn giữ chỗ khi PSP đã thu tiền

## Mục tiêu

Không còn trạng thái "booking `EXPIRED`, `paid_amount > 0`, **0** `RefundRequest`" — khách đóng trình duyệt sau khi PSP đã thu mà không gọi `confirm`, hold hết hạn (F5-QA-01).

## Căn cứ

- BR-BOOK-09 (CONFIRMED chỉ khi hold còn hạn), BR-BOOK-18, BR-PAY-11, BR-CANCEL-15…18; QĐ-05 §1 ("hoàn **đúng số đã thu**", không làm tròn xuống); QĐ-07 mục 2
- Bằng chứng: `bang-chung-f5.md` §3 F5-QA-01; script `tests/e2e/f5/sc-psp.mjs`
- Mã: `apps/worker/src/jobs/hold-expiry/**`, `apps/api/src/modules/pay/refunds/**`, `apps/api/src/modules/pay/webhooks/apply.ts`

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Job `q.hold-expiry`/reconcile: booking `HELD`/`PENDING_PAYMENT` hết hạn có `paid_amount > 0` ⇒ trong **cùng** transaction: `EXPIRED`, nhả phân công/allotment như hiện tại, **và** một `RefundRequest` hoàn **đúng số đã thu** (`requested_by = SYSTEM`, hạn mức hoàn được giữ), audit + outbox.
2. Hồ sơ đi qua maker-checker như mọi hồ sơ khác: **không** tự duyệt; > 5.000.000 cần MANAGER+; hiện ở danh sách của HB-213.
3. **Idempotent**: chạy lại job (cùng hoặc khác worker) không lập hồ sơ thứ hai cho cùng booking + nguyên nhân.
4. Booking hết hạn **không** có tiền: hành vi cũ không đổi (hồi quy `hold-expiry`).
5. Tiền đến **sau** khi `EXPIRED`: vẫn theo BR-PAY-11 (đã có), không sinh hồ sơ mới.
6. Tái hiện F5-QA-01 bằng `tests/e2e/f5/sc-psp.mjs`: xanh, và không còn dòng `EXPIRED` với `paid_amount > 0` mà thiếu hồ sơ.

## Ngoài phạm vi

- Webhook tự xác nhận booking (đổi BR-BOOK-09) — không làm.
- Đối soát ngân hàng tự động (xem HB-215).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · vitest `hold-expiry` (worker) + `duyet-hoan-tien` (api) · `node tests/e2e/f5/sc-psp.mjs` · **review độc lập Opus trước merge**.

## Ghi chú cho người làm

Hoàn **đúng số đã thu**, không áp bậc phí huỷ: booking hết hạn không phải khách huỷ (QĐ-05 §1). Hạn mức hoàn (`refund cap`, BR-CANCEL-17) vẫn phải giữ; nếu HB-214 đã vào `main` thì trigger CSDL là lưới an toàn cuối, không thay thế kiểm ở tầng ứng dụng.
