---
id: HB-214
title: Trigger CSDL chặn tổng REFUND vượt tổng đã thu của booking
risk: R2
owner: codex
max_lines: 450
allow:
  - apps/api/prisma/migrations/0008_refund_cap_guard/**
  - docs/04-thiet-ke/csdl.md
  - apps/api/test/migration/**
---

# HB-214 — Hàng rào CSDL cho trần hoàn luỹ kế

## Mục tiêu

`INSERT` thẳng một `Payment` loại `REFUND` làm `Σ REFUND` vượt `Σ thu SUCCEEDED` của cùng booking bị **CSDL từ chối**. Hiện CSDL chấp nhận, chỉ tầng ứng dụng chặn (F5-QA-05, FAIL duy nhất của lượt QA F5).

## Căn cứ

- `TC-PAY-21`; BR-CANCEL-17 (trần hoàn luỹ kế), BR-PAY-07; QĐ-02 §2–§4 (migration chỉ tiến; `csdl.md` §3 cập nhật **cùng PR**); ADR-014 (thứ tự khoá `booking → payments → refund_requests`); TD-12 (khối `REVOKE` cho hàm/bảng mới)
- Bất biến `csdl.md` §1 #8 ("ép được ở CSDL thì ép ở CSDL"); mẫu trigger: `docs/04-thiet-ke/csdl.md` §3.3 (`trg_refund_payout_operations_version`)
- Migration hiện tại: `0007_refund_payout_operations` ⇒ ticket này tạo `0008`; bằng chứng `bang-chung-f5.md` §3 F5-QA-05 (`tests/e2e/f5/sc-final.mjs`)

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Migration `0008_refund_cap_guard`: hàm + trigger `BEFORE INSERT OR UPDATE` trên `payments` cho `kind = 'REFUND'` với trạng thái **không** `FAILED`: từ chối khi `Σ REFUND(booking) > Σ thu SUCCEEDED(booking)`; lỗi SQLSTATE rõ ràng, thông điệp nêu mã BR.
2. **Đồng thời**: hai `REFUND` song song không cùng lọt qua — khoá theo thứ tự `booking → payments` (ADR-014).
3. **Dữ liệu hiện có**: migration kiểm trước khi bật; phát hiện vi phạm thì **dừng**, không tự sửa tiền.
4. `apps/api/test/migration/**` có ca: trigger từ chối khi vượt; **chấp nhận** khi `Σ REFUND` đúng bằng `Σ thu`; hai `REFUND` đồng thời.
5. Hồi quy tiền giữ xanh: `chi-hoan`, `huy-booking`, `thu-tien-tai-quay`, `so-cai-tien`, worker `refund-payout`; chạy lại `tests/e2e/f5/sc-final.mjs` ⇒ ca INSERT vượt bị từ chối (**F5 hết FAIL**).
6. `docs/04-thiet-ke/csdl.md` §3.3 ghi hàm/trigger mới cùng PR; khối `REVOKE` đúng TD-12.

## Ngoài phạm vi

- Đổi mô hình `payments`; trần hoàn **theo phòng** (HB-211).
- Sửa dữ liệu lịch sử.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `cd apps/api && pnpm exec vitest run test/migration --no-file-parallelism` · `node tests/e2e/f5/sc-final.mjs` · **review độc lập Opus trước merge**.

## Ghi chú cho người làm

`docs/04-thiet-ke/csdl.md` **không** nằm trong danh sách `PROTECTED` của `check:scope` nên ticket này không cần `unlock`; nhưng vẫn phải sửa cùng PR vì QĐ-02 §2 buộc migration đi kèm tài liệu lược đồ. Luật "🔒 migration chỉ tiến": nếu cần sửa sau, tạo `0009`, **không** sửa `0008`.
