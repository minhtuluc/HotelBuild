---
id: HB-121
title: Kiểm chứng baseline CHAN và OVER, chỉ migration tiến khi có thiếu hụt
risk: R2
owner: codex
max_lines: 450
allow:
  - apps/api/test/migration/chan-over-audit.spec.ts
  - apps/api/prisma/migrations/*_f6_chan_over/**
  - apps/api/prisma/schema.prisma
  - docs/04-thiet-ke/csdl.md
locked:
  - apps/api/prisma/migrations/0001_baseline/**
  - apps/api/test/migration/baseline.spec.ts
  - apps/api/test/migration/dev-roles.spec.ts
---

# HB-121 — Kiểm chứng schema CHAN và OVER

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

Đối chiếu schema F6 với baseline HB-005 và hợp đồng đã chốt. Các bảng CHAN/OVER đã tồn tại nên không thêm lại; migration tiến chỉ bổ sung gap được chứng minh về version, ordering OTA, cờ vận hành và guard thực thi. Việc cần lead quyết định được đánh dấu riêng trước thay DDL, không sửa `0001_baseline` đã đóng băng.

## Phụ thuộc

- HB-005: baseline triển khai được trên PostgreSQL 16, vai trò runtime và migration riêng.
- HB-120 cung cấp hợp đồng F6 để kiểm định tên trường; thay đổi thiết kế do các mâu thuẫn ghép phòng phải được lead chốt riêng, không coi là thiếu baseline.

## Căn cứ

- Pha F6: [backlog F6–F7](../backlog-f6-f7.md), dòng HB-121.
- [Quy tắc nghiệp vụ](../../02-nghiep-vu/quy-tac-nghiep-vu.md): BR-CHAN-07, BR-OVER-03…05/08/13…16, BR-SYS-02, BR-INV-03.
- [CSDL](../../04-thiet-ke/csdl.md): §3.2 CHAN/BOOK/OVER/PAY, §3 phần version và các chỉ mục, §8.3.
- [API](../../04-thiet-ke/api.md): §1.3 version, §3.9–3.10; UC-OVER-01…04.
- [HB-005](HB-005-migration-baseline.md), `apps/api/prisma/migrations/0001_baseline/migration.sql`, `apps/api/prisma/schema.prisma`.

## Hiện trạng đã đối chiếu khi soạn

`0001_baseline` ghi Source SHA `8a3b9f9540237fac404c25c1405af007043fb50d`. Đối chiếu văn bản từng `CREATE TABLE` cho `channels`, `channel_property_settings`, `channel_mappings`, `channel_allotments`, `overbooking_cases`, `room_moves`, `room_merges` với csdl §3: cả bảy khối giống nhau. Đã có `sync_status`, `consecutive_sync_failures`, `last_sync_at`, `last_sync_error`; OVER có deadline phục vụ suy ra từ ngày, dấu thời gian giải quyết/leo thang, lý do trễ, chứng từ walk-out, consent, discount; `bookings.seq`, version của booking/move/merge và UNIQUE case chưa resolved cũng đã có. Đây là bằng chứng tĩnh; chưa thay thế kiểm chứng catalog trên DB thật.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Migration trên DB trống có CHAN: cột/kiểu/default/CHECK/FK/UNIQUE khớp csdl §3, bao gồm bốn trường đồng bộ trên — test: `apps/api/test/migration/chan-over-audit.spec.ts::HB121_CHAN_catalog_matches_design`.
2. Catalog OVER có cả ba bảng, enum trạng thái, `price_locked` luôn true, giá trị tiền bigint không âm, consent/approval, walk-out document và chỉ mục case mở duy nhất theo `(property_id,date,room_type_id)` — test: `apps/api/test/migration/chan-over-audit.spec.ts::HB121_OVER_catalog_matches_design`.
3. `bookings.seq` tăng đơn điệu/duy nhất; booking/move/merge có version tăng khi cập nhật; assignment có khóa loại trừ theo đơn vị bán và kỳ `[checkIn,checkOut)` — test: `apps/api/test/migration/chan-over-audit.spec.ts::HB121_prerequisites_present`.
4. Hai scan đồng thời không tạo hai case đang hoạt động cùng khóa; sau RESOLVED chỉ cho phép case mới khi còn thiếu thực tế — test: `apps/api/test/migration/chan-over-audit.spec.ts::HB121_open_case_unique`.
5. Báo cáo baseline chỉ ra bảng/cột có sẵn, không tạo lại channels/OVER hoặc inbox/delivery từ HB-005; “khớp DDL cũ” không đủ kết luận đáp ứng F6. Đối chiếu cả AC về version, closure provenance, watermark/tombstone, flag nghi trùng và chứng từ chi bồi thường — test: `apps/api/test/migration/chan-over-audit.spec.ts::HB121_no_duplicate_migration_when_complete`.
6. Chỉ khi có gap đã ghi rõ, migration tiến chạy một lần/lần hai an toàn, bảo toàn dữ liệu và Prisma Client sinh được; nếu không có gap ghi không áp dụng, không tạo test giả — test: `apps/api/test/migration/chan-over-audit.spec.ts::HB121_forward_migration_only_for_proven_gap`.
7. Đối tượng ghi với If-Match có version persisted, đặc biệt case resolve, cấu hình mapping/closure và review flag. Tăng version nguyên tử và response ETag khớp; không dùng updated_at hoặc timestamp client thay version — test: `apps/api/test/migration/chan-over-audit.spec.ts::HB121_f6_optimistic_versions`.
8. Lưu bền watermark/cancel tombstone theo channel/account/provider booking key và provenance manual/automatic closure, cờ suspectedDuplicate cùng actor/reason/version. Giữ tombstone/uniqueness nghiệp vụ qua việc dọn inbox 7 ngày; account khác cùng provider code không bị gộp. Schema cụ thể là quyết định kỹ thuật kèm DDL csdl §3 trong cùng PR — test: `apps/api/test/migration/chan-over-audit.spec.ts::HB121_ota_order_review_and_closure_persistence`.
9. Sau lead đồng bộ thiết kế, CHECK/guard cho phép move cùng cơ sở không chi phí chưa CHECKED_IN và SHARE cùng giới đủ consent theo BR; vẫn chặn phí chưa duyệt, bất khả kháng chưa duyệt, thiếu consent/khác giới chưa duyệt và price_locked=false. Không chỉ bỏ approved_by rồi cho mọi execute qua; predicate xuyên bảng thuộc service/trigger thích hợp và bộ test HB-124 — test: `apps/api/test/migration/chan-over-audit.spec.ts::HB121_approval_guards_follow_actual_br`.
10. Biểu diễn MERGE_CONNECTING theo lựa chọn lead, cùng liên kết hai chiều/capacity và kiểm nguyên tử; bồi thường có tham chiếu RoomMove/phê duyệt/operation/Payment COMPENSATION bền, unique chống chi hai lần, không lấy refund_allocations làm quỹ chi bồi thường — test: `apps/api/test/migration/chan-over-audit.spec.ts::HB121_connecting_and_compensation_approved_model`.

## Ngoài phạm vi

- Seed `SystemSetting` (HB-018), planner, use case, worker; không thêm nhịp 300 giây.
- Sửa quy tắc nghiệp vụ/hợp đồng phá vỡ; không tự nới CHECK ghép phòng hoặc phương thức chi tiền khi lead chưa chốt gap liên quan.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `npm run check` · test migration phạm vi F6 trên PostgreSQL 16 thật; ghi SHA commit, SQL catalog và log. Nếu không có DB, ghi `BLOCKED` cho bằng chứng runtime, không kết luận schema triển khai đã đúng.

## Ghi chú cho người làm

- Các test ghi trong AC là công việc tương lai, chưa được tạo/chạy khi soạn đặc tả.
- Migration dùng số thứ tự tiếp theo với hậu tố `_f6_chan_over`, tương thích các migration đã merge; không dùng `db push` thay migration.
- `overbooking_cases` hiện chưa có `version` trong danh sách tự thêm version; If-Match của resolve phải được HB-120/HB-125 xác định và gap này kiểm chứng riêng. Không tự coi `updated_at` là version.
- Rà quyết định về `MERGE_CONNECTING`/duyệt ghép tại HB-123/HB-124 trước mọi đề xuất thay DDL; báo lead nếu đổi ngữ nghĩa tiền/tồn/quyền.
- HB-091 đã đóng do hạ tầng có sẵn; không chờ một implementation HB-091 mới. Runtime inbox/outbox dùng schema baseline, phần gap F6 nằm ở ticket này. Các trường scan success metadata cũng cần lưu bền khi HB-126/127 cung cấp trạng thái “chưa quét/lỗi/đã quét”.
