---
id: HB-130
title: Outbox relay và event deliveries bền với lease, dedup và dead letter
risk: R2
owner: codex
max_lines: 700
allow:
  - apps/api/src/modules/integrations/outbox/**
  - apps/api/src/modules/over/notifications/**
  - apps/api/src/worker-runtime/outbox.ts
  - apps/api/test/outbox/**
  - apps/worker/src/jobs/outbox-relay/**
  - apps/worker/src/jobs/relocation-notification/**
  - apps/worker/src/worker-app.ts
  - apps/worker/src/bullmq.factory.ts
  - apps/worker/test/outbox-relay/**
  - apps/worker/test/relocation-notification/**
locked:
---

# HB-130 — Relay outbox và xác nhận giao hàng bền

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

`q.outbox-relay` vận chuyển ít nhất một lần với dấu vết bền theo consumer. Sự kiện không mất khi relay/consumer chết hay Redis bị xoá; mỗi consumer chỉ commit tác động một lần và vận hành vẫn tìm được payload sau 5 lần vận chuyển thất bại.

## Căn cứ

- Pha F6: [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md); [backlog](../backlog-f6-f7.md), HB-130.
- [ADR-017](../../04-thiet-ke/adr/ADR-017-inbox-outbox-idempotency.md) quyết định 6–8; [CSDL](../../04-thiet-ke/csdl.md) §3.2.8/§3.4 `outbox_events`, `event_deliveries` và chỉ mục recovery.
- [Quy tắc nghiệp vụ](../../02-nghiep-vu/quy-tac-nghiep-vu.md) BR-GEN-07/08, BR-CHAN-02/06/07, BR-OVER-10, BR-SYS-06; [API](../../04-thiet-ke/api.md) §5.1 retry 5 lần vận chuyển, §5.3.
- [Kiểm thử](../../05-ke-hoach/ke-hoach-kiem-thu.md) TC-CHAN-02, TC-SYS-09; [yêu cầu](../../01-yeu-cau/yeu-cau-chuc-nang.md) FR-CHAN-03/07; [use case](../../01-yeu-cau/mo-hinh-use-case.md) UC-CHAN-02.

## Phụ thuộc

- Backlog: HB-006 (queue runtime), HB-005/HB-091 (schema hạ tầng đã có; HB-091 đã đóng), HB-093 (ledger producer). Dùng HB-009 (audit), HB-121 khi schema thiếu, HB-127 (composition seam), HB-028 (Mailer/SMTP adapter). HB-131 là consumer ảnh tồn/giá; thống nhất consumer ID/version trước bàn giao, không chờ HB-131 để test relay.
- Codex tự viết test R2; không giao phần B và không khoá test do mình cần hiện thực trong cùng ticket.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test tương lai)

1. Relay chỉ đọc sự kiện đã commit; producer mutation + audit/outbox rollback cùng nhau khi lỗi, envelope chứa eventId/schemaVersion/aggregateId/aggregateVersion/occurredAt/correlationId/causationId theo ADR-017 — test: `apps/api/test/outbox/transaction.spec.ts::committed-event-and-envelope`.
2. Tạo đúng một delivery cho mỗi `(consumer,eventId)`; hai relay claim bằng lease/CAS chỉ một owner tại một thời điểm; timeout lease cho phép takeover, worker cũ không được ghi hoàn tất bằng token cũ — test: `apps/worker/test/outbox-relay/lease.spec.ts::claim-takeover-and-stale-token`.
3. Crash trước publish, sau publish trước đánh dấu hoặc sau enqueue không mất sự kiện; có thể publish lặp nhưng không báo COMPLETED chỉ vì enqueue thành công — test: `apps/worker/test/outbox-relay/recovery.spec.ts::crash-at-publish-boundaries`.
4. Consumer unique `(consumer,eventId)` cùng transaction với projection/external intent và completion; hai worker hay 5 replay chỉ một tác động, hai consumer khác nhau mỗi bên xử lý đủ — test: `apps/api/test/outbox/consumer.spec.ts::transactional-consumer-dedup`.
5. External I/O thực hiện ngoài TX consumer qua operation/key idempotent bền; timeout retry/truy vấn operation cũ, không tạo intent mới; chưa có xác nhận hoàn tất nghiệp vụ thì delivery chưa COMPLETED — test: `apps/api/test/outbox/consumer.spec.ts::external-intent-and-completion`.
6. Reconciler quét delivery pending/lease hết và enqueue lại từ PostgreSQL sau Redis/BullMQ mất job, kể cả outbox đã đánh PUBLISHED; không suy ra completed từ dấu PUBLISHED — test: `apps/worker/test/outbox-relay/recovery.spec.ts::redis-loss-after-published`.
7. Backoff có clock và cấu hình; đúng 5 lần vận chuyển thất bại chuyển DEAD_LETTER bền với event/consumer/attempts/error đã che, giữ payload; lỗi consumer này không xoá delivery consumer khác — test: `apps/worker/test/outbox-relay/retry.spec.ts::fifth-failure-dead-letter`.
8. Retention không dọn outbox còn consumer bắt buộc chưa COMPLETED hoặc dead letter chưa giải quyết; foreign key/delivery receipt còn đối soát được; requeue có kiểm soát giữ eventId nên không lặp tác động — test: `apps/api/test/outbox/retention.spec.ts::retain-and-controlled-requeue`.
9. Consumer bỏ version cũ, phát hiện gap thì reload primary/replay; consumer sync HB-131 nhận ảnh mới nhất theo key/version, không cộng trừ delta theo thứ tự queue — test: `apps/api/test/outbox/consumer.spec.ts::version-gap-and-latest-snapshot`.
10. Với consumer simulator kiểm soát được tại port, sự kiện tồn/giá đi qua relay trong ≤5 phút ở kịch bản không lỗi; lỗi consumer thông báo không đảo booking/move. Kiểm toàn tuyến tới channel-sync thật thuộc HB-131/HB-194, không phụ thuộc ngược HB-130 → HB-131; log không lộ payload/PII/bí mật — test: `apps/worker/test/outbox-relay/recovery.spec.ts::five-minute-delivery-and-consumer-isolation`.

11. HB-130 cung cấp consumer thông báo điều chuyển tối thiểu cho F6: từ event sau execute tạo Notification/external intent một lần, gửi qua port Mailer HB-028 sau commit, lưu kết quả từng lần và dấu thời gian. Kịch bản provider bình thường có thư/bản tin nhận ở Mailpit/adapter nhận thật trong ≤15 phút; không coi enqueue/outbox row là khách đã nhận. Lỗi retry ≤3 lần cách ≥5 phút theo BR-SYS-06, hết lượt FAILED/cảnh báo, không đảo RoomMove — test: `apps/worker/test/relocation-notification/delivery.spec.ts::committed_move_delivered_within_fifteen_minutes`; `::bounded_retry_without_business_rollback`.
12. Consumer relocation có tên/key/version bền, dùng composition HB-127, scope/contact projection tối thiểu và quyền service riêng; replay không nhân Notification/intent. Receipt gửi chưa rõ kết quả được xử lý theo khả năng adapter, không hứa exactly-once email qua mạng. Build/dist worker gửi tới Mailpit với thông tin tổng hợp, log không PII — test: `apps/worker/test/relocation-notification/delivery.spec.ts::durable_intent_built_runtime_and_safe_projection`.

## Ngoài phạm vi

- Hứa exactly-once qua mạng; dùng Redis làm sổ completion hoặc xoá payload khi đủ 5 lần.
- HTTP inbox/ACK (HB-128), áp booking OTA (HB-129), 3 lỗi đồng bộ và đóng/mở bán (HB-131), UI outbox SCR-41 (HB-133).
- Thêm miền `EventDelivery`; đây là bảng hạ tầng. Không sửa producer của ticket đang làm để đổi envelope âm thầm. Không làm đầy đủ UI/template/NOTI của HB-168 F8; HB-168 dùng lại consumer/port/key F6 khi tới lượt, không gửi hai consumer cho cùng notification.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `npm run check` khi đụng docs/scripts/DDL; `pnpm --filter @pinehill/api test test/outbox` và `pnpm --filter @pinehill/worker test test/outbox-relay` trên PostgreSQL 16/Redis. Chạy thật `pnpm infra:up` + `pnpm migrate`, dừng/khởi động tiến trình tại ranh giới publish và xoá queue thử nghiệm riêng, kiểm receipts/tác động trước-sau. CI PR phải xanh trên đúng commit nộp; ghi rõ điểm fail injection và số attempt.

## Ghi chú cho người làm

DDL outbox không có lease riêng nhưng event_deliveries có lease: có thể dùng delivery lease làm claim relay, phải chứng minh AC2/3, không tự thêm enum PROCESSING vào outbox. PUBLISHED là mốc vận chuyển, COMPLETED là completion bền consumer; đừng đổi ngữ nghĩa cột để làm test xanh. Ngưỡng 5 attempt vận chuyển khác ngưỡng 3 lỗi sync liên tiếp HB-131. Hook xử lý dead letter phải là nội bộ có kiểm soát; API vận hành mới ngoài hợp đồng HB-120 cần phối hợp owner và permission, không mở endpoint bypass.

HB-028 chỉ password-reset Mailer và HB-168 đầy đủ nằm F8, nên consumer AC11/12 được bổ sung rõ vào HB-130 cho M7. Lead xác nhận phạm vi này khi công bố, ghi điểm nối cho HB-168. Bằng chứng timing của HB-125/139/194 dùng receipt consumer này, không chỉ log phát event.
