---
id: HB-215
title: Xác nhận đã chuyển khoản hoàn tiền tay — đưa hồ sơ tới PAID có bằng chứng
risk: R2
owner: codex
max_lines: 500
allow:
  - apps/api/src/modules/pay/refunds/**
  - apps/api/src/modules/pay/payout/**
  - apps/api/test/duyet-hoan-tien/**
  - packages/contracts/src/refund.ts
  - packages/contracts/openapi.json
  - packages/api-client/src/payment.ts
  - docs/04-thiet-ke/api.md
  - apps/operations-web/src/app/(ops)/bookings/[bookingId]/refunds/**
  - apps/operations-web/test
---

# HB-215 — Xác nhận chuyển khoản hoàn tiền tay

> **✅ Chủ dự án đã phê chuẩn ngày 24/10/2026** (AGENTS §4: đổi cách tiền **ra** khỏi hệ thống). Ticket này **được thi công**; giữ nguyên các ràng buộc bằng chứng/PIN/khác người duyệt ở dưới.

## Mục tiêu

Hoàn bằng `BANK_TRANSFER` hiện dừng ở operation `UNKNOWN` / `MANUAL_TRANSFER_AWAITING_CONFIRMATION` vì **không có đường nào** để kế toán xác nhận "đã chuyển khoản" ⇒ hồ sơ không bao giờ tới `PAID` (TD-25, F5-QA-02). Thêm đường xác nhận **có bằng chứng**, giữ nguyên nguyên tắc "không giả vờ đã chi".

## Căn cứ

- api.md §2.6 (`POST /refund-requests/{id}/pay`), §6.3 ("Chi hoàn/bồi thường, đối soát và xuất tài chính" — ACCOUNTANT; PIN gắn người/hành động/đối tượng/amount); TD-25; QĐ-07 mục 5
- Bằng chứng: `bang-chung-f5.md` §3 F5-QA-02; `apps/worker/src/jobs/refund-payout/**` (trạng thái `MANUAL_TRANSFER_AWAITING_CONFIRMATION`)

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. `POST /refund-requests/{refundRequestId}/confirm-transfer` 🔒 PIN, vai trò `ACCOUNTANT` (api.md §6.3), phạm vi theo cơ sở; thân lệnh **bắt buộc** có `bankReference` (mã tham chiếu giao dịch) và `note`/`evidenceRefs[]`; thiếu ⇒ 400 và **không** đổi trạng thái.
2. Chỉ áp cho hồ sơ đã duyệt và operation đang ở `MANUAL_TRANSFER_AWAITING_CONFIRMATION`; trạng thái khác ⇒ `409` (nêu mã hiện hành, không thêm mã mới nếu api.md đã có).
3. Cùng **một** transaction: operation → `PAID`, ghi sổ cái/khoản chi, audit (`REFUND_TRANSFER_CONFIRMED`, có `bankReference`), outbox. Lỗi bất kỳ ⇒ rollback toàn bộ.
4. **Không** cho người đã duyệt hồ sơ (`approved_by`) tự xác nhận — khác người (BR-CANCEL-15/16); không cho xác nhận hai lần (gửi lại ⇒ cùng phản hồi, không sinh giao dịch thứ hai).
5. Không lộ số tài khoản thô/`pinToken` trong phản hồi, audit hay log; `bankReference` được chuẩn hoá và **không** nhận chuỗi rỗng.
6. SCR-38 có lối "Xác nhận đã chuyển khoản" chỉ hiện khi hồ sơ ở trạng thái chờ xác nhận, kèm ô nhập mã tham chiếu; báo lỗi máy chủ nguyên văn (không tự suy `PAID`).
7. Tái hiện F5-QA-02 bằng `tests/e2e/f5/`: hồ sơ chuyển khoản tay đi được tới `PAID` chỉ khi có mã tham chiếu.

## Ngoài phạm vi

- **Đối soát ngân hàng tự động** (phương án B) — ngoài giai đoạn, giữ ở TD-25.
- Adapter hoàn tự động qua VNPay/MoMo (chưa có giao thức, xem TD-25).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · vitest `duyet-hoan-tien` + `rbac` + worker `refund-payout` · Playwright `scr38` · **review độc lập Opus trước merge**.

## Ghi chú cho người làm

Bất biến không được nới: tiền chỉ ra khỏi hệ thống khi có **bằng chứng** ngân hàng do người khác người duyệt nhập. Không dùng `bankNote` cũ của `/pay` thay cho `bankReference`; nếu cần hợp nhất hai trường thì nêu trong PR (chỉ-thêm hợp đồng).
