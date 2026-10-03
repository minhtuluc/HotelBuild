---
id: HB-129
title: Worker áp booking OTA nguyên tử, nhận cam kết vượt quota và giữ tombstone huỷ
risk: R2
owner: codex
max_lines: 750
allow:
  - apps/api/src/modules/chan/inbound/**
  - apps/api/src/modules/chan/ota-review/**
  - apps/api/src/modules/integrations/inbox/**
  - apps/api/test/ota-bookings/**
  - apps/worker/src/jobs/ota-inbox/**
  - apps/worker/src/worker-app.ts
  - apps/api/src/worker-runtime/ota-inbox.ts
  - apps/worker/test/ota-inbox/**
locked:
  - apps/api/test/ota-inbox/signature.locked.spec.ts
  - apps/api/test/ota-inbox/durability.locked.spec.ts
  - apps/api/test/ota-inbox/simulator.locked.spec.ts
---

# HB-129 — Áp booking OTA và tombstone huỷ

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

Áp inbox OTA đã xác minh thành booking/tồn/tiền/snapshot và audit/outbox trong một transaction. Cam kết OTA thu hộ luôn được ghi nhận dù hết quota, đóng bán hoặc thiếu cung; replay, crash và thứ tự bản tin không tạo booking/tiền thứ hai hay hồi sinh booking đã huỷ.

## Căn cứ

- Pha F6: [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md); [backlog](../backlog-f6-f7.md), HB-129.
- [Quy tắc nghiệp vụ](../../02-nghiep-vu/quy-tac-nghiep-vu.md) BR-CHAN-03/04/08, BR-OVER-02/03/04/05, BR-INV-01/03/05, BR-BOOK-16, BR-GEN-07/08.
- [Yêu cầu](../../01-yeu-cau/yeu-cau-chuc-nang.md) FR-CHAN-04/05/08, FR-OVER-02; [use case](../../01-yeu-cau/mo-hinh-use-case.md) UC-CHAN-03 §6.8.
- [API](../../04-thiet-ke/api.md) §5.1: `providerUpdatedAt`, cancel thắng modify, tombstone; [ADR-017](../../04-thiet-ke/adr/ADR-017-inbox-outbox-idempotency.md) quyết định 3–4/8.
- [CSDL](../../04-thiet-ke/csdl.md) §3.2.4/§3.2.8/§3.6/§9 Q1; [kiểm thử](../../05-ke-hoach/ke-hoach-kiem-thu.md) TC-CHAN-03/07/09/10/11, TC-OVER-01.

## Phụ thuộc

- Backlog: HB-128 (inbox bền đã verify), HB-126 (mở/gộp case).
- Dùng HB-121 (schema), HB-032/034 (tồn và facts), HB-093 (ledger), HB-009 (audit), HB-006 (worker), HB-127 (composition runtime), HB-120 (contract), HB-095 (claim/recovery inbox). HB-091 là audit schema đã đóng, không phải ledger. Chỉ bắt đầu khi seam tác động tiền/tồn có test và giao thức khoá rõ.
- Codex tự viết test R2 của mình; Codex viết cả test và implementation; locked chỉ giữ bộ intake HB-128 đã bàn giao. Không sửa các test khoá HB-128.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test tương lai)

1. Inbox xác minh `booking.created` có OTA_COLLECT tạo thẳng CONFIRMED cùng BookingRoom/PriceSnapshot theo giá kênh đã bán và khoản thu OTA_COLLECT qua ledger HB-093; không cần hold/cọc PSP, số tiền nguyên VND; không chỉ sửa `paidAmount` bằng tay — test: `apps/api/test/ota-bookings/apply.spec.ts::confirmed-ota-collect`.
2. OTA đã xác nhận được nhận khi `overbookLimitPct=0`, `overbookAllowed=false`, tồn 0, quota hết hoặc kênh đóng bán; 5 cam kết với quota còn 2 đều vào, used thực tế tăng đủ 5, cảnh báo đối soát khi vượt quota và tồn công bố bằng `max(0,min(pool,allotment-used))` — test: `apps/api/test/ota-bookings/apply.spec.ts::confirmed-over-quota-always-accepted`.
3. Kiểm từng đêm và đơn vị bán DOR theo giường: chỉ thiếu ít nhất một đêm mới đặt oversold và mở/cập nhật case HB-126; quota hết nhưng còn nguồn cung không tự thành oversold. Case gộp `(propertyId,date,roomTypeId)`, 6 booking thiếu trên 2 ngày chỉ 2 case, thiếu ở T−24h hoặc muộn hơn leo thang ngay — test: `apps/api/test/ota-bookings/apply.spec.ts::nightly-shortage-and-grouped-cases`.
4. Khoá booking tự nhiên có account/cơ sở ngoài khi mã không duy nhất toàn kênh; externalRef canonical giữ UNIQUE `(channelId,externalRef)` lâu hơn 7 ngày; 2 eventId cho cùng booking và 2 worker cạnh tranh chỉ tạo 1 booking/thu/snapshot/assignment, còn booking khác cùng SĐT không tự gộp hoặc xoá, chỉ cờ nghi trùng — test: `apps/api/test/ota-bookings/apply.spec.ts::durable-business-dedup`.
5. Khoá inbox/aggregate và tồn/quota theo giao thức §3.6; assignment chỉ cho đơn vị thật trống, không gán phòng/giường thứ hai vào đơn vị đã chiếm; cam kết thiếu chỗ vẫn tồn tại dưới dạng demand chưa gán — test: `apps/api/test/ota-bookings/apply.spec.ts::concurrent-inventory-and-unassigned-demand`.
6. Mutation booking/ledger/used/snapshot/history/case/audit/outbox và inbox PROCESSED commit cùng nhau; lỗi ở bất kỳ bước ghi nào rollback cả tập, replay sau crash trước commit làm một lần, sau commit không lặp tác động — test: `apps/api/test/ota-bookings/recovery.spec.ts::atomic-apply-and-crash-replay`.
7. `providerUpdatedAt` tiến đơn điệu; sự kiện cũ hơn không ghi đè booking, timestamp bằng nhau và khác nội dung được cách ly/đối soát; modify hợp lệ cập nhật toàn bộ đêm/quota/demand/snapshot nguyên tử, không chạy đường đổi ngày khách rồi vô tình áp phí/policy nội bộ — test: `apps/api/test/ota-bookings/order.spec.ts::monotonic-modify-and-equal-time-conflict`.
8. `booking.cancelled` thắng modified bất kể thứ tự nhận; huỷ ghi CANCELLED, cancelledAt, `cancelReason=OTA_CANCELLATION`, channelPolicyCode; giải phóng demand/assignment/used đúng một lần và ghi dấu đối soát tiền OTA, không áp BR-CANCEL, không tạo RefundRequest/REFUND/payment payout nội bộ — test: `apps/api/test/ota-bookings/order.spec.ts::ota-cancel-without-internal-refund`.
9. Cancel đến trước create lưu tombstone bền theo booking tự nhiên; create/modify cũ, cùng timestamp hoặc đến sau không hồi sinh booking đã huỷ. Tombstone giữ dấu huỷ và watermark đơn điệu qua restart/expiry dedup inbox; ca xung đột đưa đối soát, không đoán booking mới — test: `apps/api/test/ota-bookings/order.spec.ts::cancel-before-create-tombstone`.
10. Claim inbox bằng lease/CAS; hai worker không cùng commit, worker cũ mất lease không đánh PROCESSED; quét PENDING/FAILED và PROCESSING lease hết phục hồi sau Redis mất dữ liệu, backoff rồi dead letter giữ payload/kết quả lỗi đã che — test: `apps/worker/test/ota-inbox/recovery.spec.ts::lease-and-durable-recovery`.
11. Account/mapping/amount/currency không match hoặc booking chưa xác nhận thu hộ được cách ly/đối soát, không tạo thành công nghiệp vụ giả; worker chỉ có service principal luồng tích hợp, log không chứa payload/PII/token — test: `apps/api/test/ota-bookings/apply.spec.ts::unmatched-event-and-service-scope`.

12. `POST /channels/{channelId}/ota-bookings/{bookingId}/duplicate-flag`: MANAGER/OWNER có scope kênh và booking, Idempotency-Key/If-Match, flagged/reason hợp lệ; flag/actor/reason/version/audit cùng TX. Gắn hay gỡ cờ không huỷ/gộp booking, không sửa tiền/snapshot/used; replay không ghi hai quyết định — test: `apps/api/test/ota-bookings/review.spec.ts::scoped_duplicate_review_without_financial_effects`.
13. Worker dùng composition runtime HB-127 và các use case/provider exports được hỗ trợ; truyền đủ job.data/eventId, không import đường source apps/api tương đối hoặc sao chép transaction áp booking. Build workspace và chạy worker từ dist với `pinehill-dist`, rồi xử lý một inbox bền trên DB/Redis thật — test: `apps/worker/test/ota-inbox/runtime.spec.ts::built_runtime_applies_persisted_inbox`.

## Ngoài phạm vi

- Chủ động bán vượt hoặc đẩy tồn vượt quota; nới trần overbookLimitPct; PSP/refund do huỷ nội bộ.
- Saga điều chuyển/ghép/walk-out (HB-125), thuật toán phát hiện case (HB-126), scheduler quét case (HB-127), UI hàng đợi (HB-134).
- Sửa business rules, file bảo vệ hoặc migration nền. Nếu cần trạng thái watermark/tombstone mới, phối hợp HB-121 và lead trước khi sửa schema; không dùng cache Redis làm nguồn bền.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm check:contract` · `npm run check` khi đụng docs/scripts/DDL; `pnpm --filter @pinehill/api test test/ota-bookings` và `pnpm --filter @pinehill/worker test test/ota-inbox` trên PostgreSQL 16/Redis. Chạy thật `pnpm infra:up` + `pnpm migrate` rồi gửi simulator tạo/sửa/huỷ, phá queue trong môi trường riêng và khởi động lại worker; đối chiếu booking/ledger/used/case/inbox/outbox. CI PR phải xanh trên đúng commit nộp.

## Ghi chú cho người làm

TC-CHAN-10 và dòng backlog HB-129 đã được đồng bộ với BR-CHAN-08 trong PR công bố đặc tả: nhận cam kết OTA đã xác nhận dù quota hết, test mới theo AC2. Nguồn docs/01–02 và backlog bảo vệ chỉ lead xử lý, không tự sửa. DDL hiện chưa có watermark/tombstone OTA rõ ràng: đây là điều kiện schema cần chốt với HB-121 trước phần ordering, không được bỏ AC9. Reuse ledger cho OTA thu hộ và đối soát; không tự thêm ngữ nghĩa thu/hoàn để làm test xanh. Trạng thái FAILED/DEAD_LETTER là trạng thái inbox, không là trạng thái booking.
