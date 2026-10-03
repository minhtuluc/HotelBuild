---
id: HB-127
title: Worker quét quá tải mỗi 60 phút từ SystemSetting
risk: R2
owner: codex
max_lines: 650
allow:
  - apps/worker/src/overbooking/**
  - apps/worker/src/queues.ts
  - apps/worker/src/worker-app.ts
  - apps/worker/src/bullmq.factory.ts
  - apps/worker/src/worker-runtime.ts
  - apps/worker/src/types.ts
  - apps/worker/package.json
  - apps/worker/tsconfig.build.json
  - apps/api/src/worker-runtime/**
  - apps/api/package.json
  - apps/api/tsconfig.build.json
  - pnpm-lock.yaml
  - apps/worker/test/overbooking-scan.spec.ts
  - apps/worker/test/overbooking-scan.integration.spec.ts
  - docs/04-thiet-ke/kien-truc.md
locked:
  - apps/api/test/over/detection.locked.spec.ts
  - apps/api/test/over/detection-queries.locked.spec.ts
  - apps/api/test/over/detection-helpers/**
---

# HB-127 — Worker q.overbooking-scan

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

Đăng ký scheduler `q.overbooking-scan` và gọi cùng detection use case HB-126 theo `job.overbooking.scanIntervalMinutes` mặc định **60 phút**, đọc từ SystemSetting, đổi được không triển khai lại. Scan không tạo logic booking/tiền/tồn riêng; đồng hồ giả kiểm ranh giới T−24h và ca ngày đã qua.

## Phụ thuộc

- HB-006 BullMQ/worker skeleton/Redis/shutdown; HB-126 giai đoạn B đã xanh và có adapter dùng được ngoài HTTP.
- HB-018 seed khóa SystemSetting chính thức; HB-009 outbox/UnitOfWork, cơ chế job retry/lease dự án hiện có.
- HB-121 UNIQUE case; không trùng trách nhiệm lịch channel-sync HB-131.
- HB-127 sở hữu composition seam API→worker cho F6; HB-129/130/131 phụ thuộc seam này, không import entrypoint HTTP của API. Nếu HB-078 đã cung cấp seam tương đương khi triển khai, dùng lại sau kiểm build/runtime, không tạo bản thứ hai.

## Căn cứ

- Pha F6: [backlog](../backlog-f6-f7.md), HB-127; backlog đã được đồng bộ nhịp 60 phút theo BR trong PR công bố đặc tả.
- [Quy tắc nghiệp vụ](../../02-nghiep-vu/quy-tac-nghiep-vu.md): BR-OVER-04/05/16, BR-SYS-02 khóa `job.overbooking.scanIntervalMinutes=60`, BR-GEN-02/05/07.
- [Quá tải](../../02-nghiep-vu/qua-tai-ghep-doi-phong.md): §5 ghi scheduler mỗi giờ và SystemSetting 60 phút, khớp BR-OVER-05/BR-SYS-02.
- [Kiến trúc](../../04-thiet-ke/kien-truc.md): §11 hàng đợi; [API](../../04-thiet-ke/api.md): §3.9; [kiểm thử](../../05-ke-hoach/ke-hoach-kiem-thu.md): TC-OVER-01/02/17.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Chỉ một hằng tên `q.overbooking-scan`; scheduler mặc định 60 phút (3.600.000 ms), không nhầm minutes→seconds và không mặc định300 giây — test: `apps/worker/test/overbooking-scan.spec.ts::HB127_default_sixty_minutes_from_setting`.
2. Đọc khóa SystemSetting, thay đổi hợp lệ được worker cập nhật scheduler cũ theo identity ổn định, không nhân lịch hoặc cần redeploy; giá trị thiếu/sai có fallback60 phút và log không PII, không tự biến thành vòng lặp0 — test: `apps/worker/test/overbooking-scan.spec.ts::HB127_reload_setting_reschedules_one_identity`.
3. Job gọi detection HB-126 một lần với clock/ID port; cửa sổ30 ngày VN và gộp case do use case đảm nhiệm; sáu booking trên hai ngày vẫn đúng hai case — test: `apps/worker/test/overbooking-scan.integration.spec.ts::TC_OVER_01_worker_uses_shared_detection`.
4. Đẩy clock từ trước tới T−24h, chạy job kế tiếp làm ESCALATED/overdue và outbox OWNER; case mới nhận sau hạn leo thang ngay qua đường detection, không đợi scheduler mới mở — test: `apps/worker/test/overbooking-scan.integration.spec.ts::TC_OVER_02_fake_clock_deadline_escalation`.
5. Case ngày đã qua vẫn giữ/ESCALATED, không tự RESOLVED hoặc xóa khi rời cửa sổ tương lai; giữ metadata báo cáo và lý do trễ — test: `apps/worker/test/overbooking-scan.integration.spec.ts::TC_OVER_17_past_case_preserved`.
6. Hai worker/duplicate delivery/restart không tạo case/cảnh báo mới trùng; job fail trước/sau commit retry hội tụ, log lỗi có trace không nuốt rồi ACK thành công — test: `apps/worker/test/overbooking-scan.integration.spec.ts::HB127_duplicate_retry_and_restart_safe`.
7. SIGTERM ngừng nhận scan mới, chờ job đang chạy theo giới hạn HB-006, đóng Redis/DB; scheduler của channel-sync/hold/outbox không đổi nhịp khi thêm scan — test: `apps/worker/test/overbooking-scan.spec.ts::HB127_shutdown_and_other_queues_unchanged`.
8. Scan có start/end/duration/count/failed trace không bookingPII/token/PIN; không gửi thông báo/PSP trực tiếp trong TX và không ghi assignment/chi tiền — test: `apps/worker/test/overbooking-scan.spec.ts::HB127_observable_scan_without_financial_effects`.
9. Cung cấp server-only factory/export có hỗ trợ build cho worker lấy detection UnitOfWork/repository/clock/audit mà không khởi động HTTP hoặc import `../apps/api/src/...`. Phương án tối thiểu: `apps/api/src/worker-runtime/**` với package subpath/khai báo kiểu/dist hợp lệ, workspace dependency một chiều worker→API; không có import ngược API→worker. Nếu build boundary cần package backend chung, báo quyết định kỹ thuật/phạm vi cụ thể trước thay cấu trúc, giữ một implementation transaction — test: `apps/worker/test/overbooking-scan.integration.spec.ts::HB127_supported_server_composition_without_http_or_cycles`.
10. BullMQ factory chuyển đầy đủ job.data/id/name cho handler có kiểu, không bỏ eventId/key/version; build từ checkout sạch rồi start worker bằng `node --conditions=pinehill-dist dist/main.js` với DB/Redis thật, scan tạo case được. Typecheck/CI không phụ thuộc dist cũ hoặc TS source chạy nhờ dev loader; đóng connection factory khi shutdown — test: `apps/worker/test/overbooking-scan.integration.spec.ts::HB127_clean_build_dist_runtime_and_job_payload`.

11. Lưu metadata scan RUNNING/success/failure và lastSuccessfulScanAt theo schema HB-121, có run identity/clock/duration đã che. Chỉ đánh success sau hết lượt scan commit; failure giữ dữ liệu và last success trước đó, API HB-126 có thể phân biệt chưa quét/lỗi/rỗng thật — test: `apps/worker/test/overbooking-scan.integration.spec.ts::HB127_persisted_scan_freshness_after_success_or_failure`.

## Ngoài phạm vi

- Detection/ranking/resolve mới, xử lý booking OTA và channel-sync 300 giây, chi tiền/bồi thường.
- Sửa quy tắc02 hoặc protected backlog trong ticket implementation; lead xuất bản correction riêng.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `npm run check` khi cập nhật docs; Redis và PostgreSQL16 thật chạy job lặp qua adapter, log schedule identity/interval trước-sau thay cấu hình + case escalation + SHA commit. Không chỉ chứng minh bằng gọi handler fake.

## Ghi chú cho người làm

- Backlog HB-127/“Khoảng trống tài liệu” đã đồng bộ 60 phút cấu hình, khớp overdoc §5 và BR-OVER-05/BR-SYS-02. Không tự sửa nguồn docs02 protected. Nhánh tự đóng ca tương lai đã hết thiếu cần chốt tại F6-D07 trước nối vào job; ca ngày đã qua luôn giữ/ESCALATED, không tự đóng.
- `REPEATABLE_QUEUES` hiện chỉ hold-expiry/outbox-relay: thêm scan theo cơ chế runtime setting thay vì sao chép interval chung. Nếu thêm wiring file ngoài allow cần giải trình; không sửa contracts/config protected.
- Không sleep thật 60 phút để test; fake clock hoặc gọi run-due tại ranh giới và một smoke schedule thật. Seedsetting thuộc HB-018, fallback không thay nghĩa vụ seed.
- Hiện worker chỉ log job, không có dependency API/DB và factory bỏ job.data. Việc chỉ thêm handler/queue name chưa đủ AC9/10. Export/runtime mới là hạ tầng server, không được import vào bốn frontend; kiểm exports/types/tsconfig từ clean build và giữ cấu hình CI bảo vệ nguyên vẹn.
