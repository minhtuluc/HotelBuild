---
id: HB-131
title: Endpoint CHAN và channel sync 5 phút với quota, đóng bán và cảnh báo DEGRADED
risk: R2
owner: deepseek
max_lines: 750
allow:
  - apps/api/src/modules/chan/sync/**
  - apps/api/src/modules/chan/mappings/**
  - apps/api/src/modules/chan/sales-closure/**
  - apps/api/src/modules/chan/ota-bookings/**
  - apps/api/src/modules/chan/monitoring/**
  - apps/api/src/modules/chan/permissions.ts
  - apps/api/src/app.module.ts
  - apps/api/test/channel-sync/**
  - apps/worker/src/jobs/channel-sync/**
  - apps/api/src/worker-runtime/channel-sync.ts
  - apps/worker/src/queues.ts
  - apps/worker/src/worker-app.ts
  - apps/worker/test/channel-sync/**
locked:
  - apps/api/test/channel-sync/endpoints.locked.spec.ts
  - apps/api/test/channel-sync/inventory.locked.spec.ts
  - apps/worker/test/channel-sync/scheduler.locked.spec.ts
  - apps/worker/test/channel-sync/failures.locked.spec.ts
---

# HB-131 — Endpoint CHAN và đồng bộ tồn/giá

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

Operations gọi được endpoint cấu hình ánh xạ, đóng bán, sync và xem hàng đợi booking OTA với permission/scoping đúng. Outbox kích hoạt đồng bộ ngay và job `q.channel-sync` quét mỗi 300 giây; OTA thấy ảnh tồn hiện hành đã kẹp quota, ba lỗi liên tiếp tạo cảnh báo MANAGER và trạng thái DEGRADED.

## Căn cứ

- Pha F6: [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md); [backlog](../backlog-f6-f7.md), HB-131.
- [Quy tắc nghiệp vụ](../../02-nghiep-vu/quy-tac-nghiep-vu.md) BR-CHAN-01/02/05/06/07/08, BR-INV-05, BR-RBAC-03, BR-SYS-02; [yêu cầu](../../01-yeu-cau/yeu-cau-chuc-nang.md) FR-CHAN-01…03/06…08.
- [Use case](../../01-yeu-cau/mo-hinh-use-case.md) UC-CHAN-01/02/03; [API](../../04-thiet-ke/api.md) §2.7/§1.6/§6.3/§6.4: `POST /api/v1/channels/{channelId}/sync`, `PUT /api/v1/channels/{channelId}/mappings`, `POST /api/v1/channels/{channelId}/sales-closure`, `GET /api/v1/channels/{channelId}/ota-bookings`; `E_CHAN_SYNC_FAILED`.
- [CSDL](../../04-thiet-ke/csdl.md) §3.2.2/§3.6/§9 Q1; [ADR-017](../../04-thiet-ke/adr/ADR-017-inbox-outbox-idempotency.md) quyết định 6–8.
- [Kiểm thử](../../05-ke-hoach/ke-hoach-kiem-thu.md) TC-CHAN-02/04/05/06; [NFR](../../01-yeu-cau/yeu-cau-phi-chuc-nang.md) NFR-REL-03.

## Phụ thuộc và bàn giao A → B

- Backlog: HB-130 (relay/delivery). Điều kiện hiện thực: HB-120 (contract/client), HB-121 (schema), HB-014 (permission), HB-035 (quota/facts), HB-009 (audit), HB-006 (runtime), HB-128/129 (inbox/projection), HB-127 (composition runtime), HB-018 (seed SystemSetting; HB-036 là lưới tồn).
- **A — Codex:** viết bốn file test khoá, chạy đỏ đúng ca thiếu endpoint/quota/scheduler/failure; fixtures synthetic, kiểm DB/HTTP thật và adapter simulator ở ranh giới mạng.
- **Merge A trước B. B — DeepSeek:** checkout commit đã tích hợp A; hiện thực module/API/job cho toàn bộ test khoá xanh. Không sửa test/fixture khoá. Owner backlog giữ Codex (test khoá) → DeepSeek; frontmatter là owner B.
- `locked` là phạm vi bàn giao B. Vì `check:scope` chặn sửa/tạo file khoá, lead tổ chức scope tích hợp A trước; không tự thêm `unlock`, không sửa ticket trên main. Báo bằng chứng đỏ dự kiến A riêng, mọi cổng B phải xanh.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test tương lai)

1. Quyền tường minh và scope cơ sở: sync/đóng bán được MANAGER và OWNER, mappings được OWNER; hàng đợi tích hợp OTA/sync/outbox dùng MANAGER/OWNER đúng scope theo HB-120; không tự mở quyền đối soát kênh cho FRONT_DESK/RESERVATION_AGENT bằng quyền đọc booking thông thường. HOUSEKEEPING/khách/service OTA không được route nội bộ; principal ACCOUNTANT chỉ projection đối soát nếu có permission được chốt, không trả DTO vận hành rộng — test: `apps/api/test/channel-sync/endpoints.locked.spec.ts::explicit-permissions-and-property-scope`.
2. Sync trả `202 {operationId,status,statusUrl}` và Location; tra operation kiểm quyền hiện tại/người khởi tạo. Idempotency-Key cùng principal/operation/hash replay cùng operation, khác payload hoặc If-Match conflict; không cấp lại scope từ body/cursor — test: `apps/api/test/channel-sync/endpoints.locked.spec.ts::sync-operation-and-idempotency`.
3. PUT mappings kiểm một loại phòng/một mã OTA duy nhất trong kênh, đúng cơ sở, trường lạ bị từ chối; kiểm If-Match và audit/outbox cùng TX; allotmentPct cấu hình qua BR-INV-05, không đổi used hoặc ép tổng quota mọi kênh ≤ supply — test: `apps/api/test/channel-sync/endpoints.locked.spec.ts::mapping-validation-and-atomicity`.
4. Mặc định từng OTA = floor(80% đơn vị ACTIVE), min 1 khi supply>0, 0 khi supply=0; DOR theo giường, trực tiếp WEB/PHONE/WALKIN không quota, AGENCY thiếu cấu hình đóng bán; tồn đẩy luôn `max(0,min(pool,allotment-used))`, quota used có thể lớn hơn allotment. Khoá test thuộc tính 10.000 cấu hình với seed cố định theo TC-CHAN-06 — test: `apps/api/test/channel-sync/inventory.locked.spec.ts::per-channel-quota-and-nonnegative-inventory`.
5. pool≤2 tự đóng mọi OTA theo cơ sở/loại phòng/đêm, không đóng loại/đêm khác hay kênh trực tiếp; pool>2 chỉ mở lại nếu không đóng thủ công và chỉ công bố tồn đã kẹp quota, không gửi allotment thô — test: `apps/api/test/channel-sync/inventory.locked.spec.ts::automatic-and-manual-closure`.
6. Sales-closure có reason, khoảng ngày hợp lệ và guard scope; audit/outbox/closure cùng TX, replay không nhân đôi. Đóng thủ công vẫn nhận cam kết webhook đã xác nhận tại HB-129 — test: `apps/api/test/channel-sync/endpoints.locked.spec.ts::manual-closure-and-inbound-exemption`.
7. Mỗi thay đổi giá/tồn đã commit kích sync qua HB-130 ngay, periodic `q.channel-sync` đọc `job.channelSync.intervalSeconds=300` và đăng ký repeat không trùng qua restart; advance clock qua 300s có sweep, cấu hình cập nhật đổi nhịp; record timestamp đơn vị rõ — test: `apps/worker/test/channel-sync/scheduler.locked.spec.ts::outbox-trigger-and-configurable-five-minute-sweep`.
8. Mỗi consumer gửi ảnh tồn/giá mới nhất theo scope/key/version; duplicate không cộng delta, version cũ không ghi đè ảnh mới, gap reload primary; sự kiện chưa giao còn bền ở delivery và được phục hồi — test: `apps/worker/test/channel-sync/scheduler.locked.spec.ts::latest-snapshot-version-and-recovery`.
9. Ba kết quả sync thất bại riêng biệt liên tiếp cập nhật counter 1→2→3; ở lần 3 lưu `syncStatus=DEGRADED`, `lastSyncError` đã che, phát cảnh báo MANAGER và lỗi `E_CHAN_SYNC_FAILED`; kênh khác vẫn OK, replay cùng attempt không tăng counter/phát cảnh báo lần hai — test: `apps/worker/test/channel-sync/failures.locked.spec.ts::three-failures-degraded-once`.
10. Sync thành công được ghi nhận bằng kết quả adapter thật trong simulator, cập nhật lastSyncAt và reset consecutiveSyncFailures để lần thất bại kế tiếp đếm lại từ 1; trạng thái DEGRADED phục hồi theo quy ước recovery đã ghi trong contract, không xoá lịch sử lỗi/cảnh báo; ngưỡng 3 tách khỏi 5 attempt DLQ HB-130 — test: `apps/worker/test/channel-sync/failures.locked.spec.ts::success-breaks-consecutive-streak`.
11. GET ota-bookings lọc from/to/status/q, thứ tự ổn định/cursor gắn filter/scope, gồm trạng thái xử lý/cờ duplicateSuspected/caseRef được phép; không lộ raw payload/chữ ký/token/PII dư hoặc booking cơ sở khác — test: `apps/api/test/channel-sync/endpoints.locked.spec.ts::ota-queue-projection-and-stable-pagination`.

12. Cung cấp đủ routes bổ sung HB-120: GET channels scoped, GET `/{channelId}/sync-status`, GET `/{channelId}/outbox-deliveries`, POST `/{channelId}/outbox-deliveries/{deliveryId}/retry`. Chỉ MANAGER/OWNER có permission/scope hiện tại; counter/trạng thái/cursor/error projection đã che, không raw payload. Retry chỉ trạng thái được phép và version hiện tại, giữ consumer/event/operation key, không gửi I/O trong TX hay đánh COMPLETED trước thực xử lý — test: `apps/api/test/channel-sync/endpoints.locked.spec.ts::monitoring_reads_and_authorized_delivery_retry`.
13. Closure có provenance manual/automatic persisted theo HB-121; sales-closure thêm trường không phá vỡ `closed` mặc định true để MANAGER/OWNER trong scope mở lại thủ công. Mở thủ công chỉ gỡ manual closure, vẫn giữ auto closure/quota nếu tồn≤2; audit/version/outbox đồng TX. Sau sync success đã xác minh, counter về0 và status OK, giữ lịch sử lỗi; quy ước recovery công bố HB-120 trước test — test: `apps/api/test/channel-sync/inventory.locked.spec.ts::manual_reopen_respects_automatic_closure`; `apps/worker/test/channel-sync/failures.locked.spec.ts::verified_success_restores_ok`.
14. Consumer/scheduler dùng composition runtime HB-127, job.data/key/version được chuyển đầy đủ; build và start từ dist theo `pinehill-dist` rồi sync tới simulator, không chỉ test handler trực tiếp hoặc import source cross-app — test: `apps/worker/test/channel-sync/scheduler.locked.spec.ts::built_worker_runtime_and_payload`.

## Ngoài phạm vi

- PATCH hệ số/hoa hồng/hold/overbookAllowed của RATE (HB-055), quota CRUD HB-035, webhook/áp booking HB-128/129, relay HB-130, UI SCR-40/41/42 HB-132…134.
- API thật OTA, nới quota để né cảnh báo, quyền theo thứ bậc role, gửi I/O OTA trong TX cấu hình.
- Đổi hợp đồng mở lại thủ công/monitoring/retry trước khi HB-120 công bố; chỉ hiện thực các bổ sung AC12/13, không tự sửa nguồn/CI/file bảo vệ.

## Cổng phải xanh

Ở B: `pnpm check:scope` · `pnpm run ci` · `pnpm check:contract` · `npm run check` khi đụng docs/scripts/DDL; `pnpm --filter @pinehill/api test test/channel-sync` và `pnpm --filter @pinehill/worker test test/channel-sync` trên PostgreSQL 16/Redis. Chạy thật `pnpm infra:up` + `pnpm migrate`, gọi route các role/scope, chạy scheduler với simulator 500×3 rồi success, kiểm counter/notification/delivery. CI PR xanh trên đúng commit nộp; bằng chứng A ghi riêng ca đỏ dự kiến.

## Ghi chú cho người làm

`q.channel-sync` có tên trong queues.ts nhưng chưa nằm trong REPEATABLE_QUEUES; dùng runtime có sẵn, không chỉ thêm tên. TC-CHAN-01 đã được đồng bộ trong PR công bố với BR-CHAN-01 và TC-CHAN-06: allotment 80% cho từng OTA, không dành riêng 20% trực tiếp. Bổ sung `closed` mặc định true, provenance riêng và recovery OK sau success được công bố ở HB-120/HB-121 trước AC5/10/13, không thêm enum ngoài OK/DEGRADED. HB-127 cung cấp composition seam; HB-129 sở hữu review flag/watermark, monitoring chỉ đọc projection được phép.

### Điều kiện bàn giao test A

Lead phải giải quyết mâu thuẫn giữa “merge test đỏ A trước B” (sổ tay lead §3.6) và “CI xanh mới được merge” (AGENTS §3, merge guard). Bản nháp không cấp ngoại lệ: đề xuất A bàn giao SHA/test bất biến có log đỏ, B tích hợp trên đúng SHA, lead xuất bản A+B khi CI xanh với scope được duyệt. Không đổi CI, skip hoặc tự mở lead branch để vượt guard; chờ lead chốt cơ chế trước thi công A.
