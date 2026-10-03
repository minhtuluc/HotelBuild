---
id: HB-126
title: Phát hiện và đọc ca quá tải, Codex khóa test trước DeepSeek triển khai
risk: R2
owner: deepseek
max_lines: 1000
allow:
  - apps/api/src/modules/over/detection/**
  - apps/api/src/modules/over/queries/**
  - apps/api/src/modules/over/over.module.ts
  - apps/api/src/modules/over/permissions.ts
  - apps/api/src/app.module.ts
  - apps/api/test/over/detection-routes.spec.ts
locked:
  - apps/api/test/over/detection.locked.spec.ts
  - apps/api/test/over/detection-queries.locked.spec.ts
  - apps/api/test/over/detection-helpers/**
  - packages/domain/test/overbooking/**
  - apps/api/test/over/relocation.locked.spec.ts
  - apps/api/test/over/merge.locked.spec.ts
  - apps/api/test/over/walkout.locked.spec.ts
---

# HB-126 — Phát hiện quá tải và đọc ca

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

Một use case dùng chung cho scanner và đường nhận booking OTA: phát hiện thiếu theo cơ sở/ngày VN/loại phòng, mở/cập nhật case không trùng và leo thang đúng thời điểm T−24h. API list/detail có quyền đọc đúng scope và bảng ứng viên đầy đủ. Codex chịu trách nhiệm giai đoạn A; DeepSeek chỉ làm B sau khi nhận test khóa/log đỏ.

## Phụ thuộc

- HB-121 schema/UNIQUE case đang hoạt động; HB-122 planner; HB-032 tồn theo đơn vị bán/giường, không đếm assignment lần hai.
- HB-120 contracts list/detail OVER; HB-007 DB/UnitOfWork, HB-009 audit/clock/ID, HB-014 quyền. Module detection/query độc lập; over.module.ts là điểm ghép, phối hợp HB-125 nhưng không chờ implementation HB-125 mới nghiệm thu detection.
- HB-129 gọi detection trong transaction tạo booking; HB-127 chỉ lên lịch/gọi cùng use case, không viết thuật toán thiếu khác.

## Căn cứ

- F6 [backlog](../backlog-f6-f7.md), HB-126.
- [Quy tắc nghiệp vụ](../../02-nghiep-vu/quy-tac-nghiep-vu.md): BR-OVER-03…05/11/12/16, BR-INV-01/04/07, BR-GEN-02/04/05/07/08, BR-RBAC-02/03, BR-SYS-02.
- [Quá tải](../../02-nghiep-vu/qua-tai-ghep-doi-phong.md): §4–5/7; [API](../../04-thiet-ke/api.md): §2.8/3.9/6.3; `GET /api/v1/overbooking-cases`, `GET /api/v1/overbooking-cases/{caseId}`.
- [Kiểm thử](../../05-ke-hoach/ke-hoach-kiem-thu.md): TC-OVER-01/02/17; SCR-43/67.

## Phân công bắt buộc

- **A — Codex:** viết `detection.locked.spec.ts`, `detection-queries.locked.spec.ts` và helpers; fixtures clock/ID cố định; chứng minh đỏ đúng vì thiếu hành vi; bàn giao commit/SHA và mô tả Oracle. Không viết production để giấu lỗi.
- **B — DeepSeek:** chỉ sửa production và test routes trong allow; hai file test và detection-helpers đã nằm trong locked của frontmatter. Lead tổ chức phạm vi tích hợp A trước bàn giao như HB-128/131; không dùng lời hứa khóa sau thay khóa máy kiểm.
- Không giao B trước khi locked manifest/commit được ghi nhận; owner frontmatter là DeepSeek giai đoạn B; Codex chịu trách nhiệm bộ test A.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Sáu booking thiếu trên hai ngày cùng cơ sở/loại phòng tạo đúng hai case OPEN khi còn trước hạn, shortage theo thiếu từng ngày, không một case/booking và không gộp khác cơ sở/loại — test: `apps/api/test/over/detection.locked.spec.ts::TC_OVER_01_six_bookings_two_daily_cases`.
2. Quét cửa sổ 30 ngày tới theo ngày VN và nhận now/ID qua cổng; availability âm giữ giá trị thiếu, trừ hold còn hạn, loại hold hết hạn tại now, DOR tính giường, block trùng không đếm hai lần — test: `apps/api/test/over/detection.locked.spec.ts::HB126_window_and_inventory_units`.
3. Hai scan/chèn OTA đồng thời cùng `(propertyId,date,roomTypeId)` tạo một case chưa RESOLVED; retry cập nhật affectedBookingIds/shortage không trùng và không mất detectedAt ban đầu — test: `apps/api/test/over/detection.locked.spec.ts::HB126_concurrent_detection_deduplicates`.
4. T là giờ nhận phòng danh nghĩa của cơ sở/ngày VN; ngay tại T−24h chưa xử lý thì ESCALATED + overdue, thông báo OWNER/outbox chỉ một sự kiện chuyển trạng thái; trước ranh giới vẫn OPEN/PROPOSED — test: `apps/api/test/over/detection.locked.spec.ts::TC_OVER_02_deadline_boundary_and_owner_escalation`.
5. Case được biết lần đầu sau T−24h mở và leo thang ngay; detectedAt là lúc biết, không gán phát hiện hồi tố hay báo vi phạm trước lúc tiếp nhận — test: `apps/api/test/over/detection.locked.spec.ts::HB126_late_discovery_escalates_without_retroactive_detection`.
6. Case OPEN/PROPOSED/ESCALATED ngày đã qua vẫn ESCALATED và được giữ sau cửa sổ 30 ngày tương lai; không tự RESOLVED kể cả shortage hiện về 0; giữ detectedAt/escalatedAt/resolvedAt/người xử lý/delayReason để UC-REP-04 — test: `apps/api/test/over/detection.locked.spec.ts::TC_OVER_17_past_case_never_auto_closes`.
7. GET list/detail chỉ MANAGER/OWNER theo quyền tường minh + scope; scope phía server gồm cả query/list/overdueCount, không lộ cross-property qua filter hoặc includeCandidates — test: `apps/api/test/over/detection-queries.locked.spec.ts::HB126_query_role_scope_and_no_leak`.
8. List theo pagination/filter hợp đồng, detail includeCandidates giữ đủ điểm/nhóm/khoá seq; preview đủ bốn bậc có lý do bậc3 false và 1→2→4 trên cấu hình hiện tại — test: `apps/api/test/over/detection-queries.locked.spec.ts::HB126_contract_filters_preview_and_candidates`.
9. Ghi case/đổi trạng thái + audit/outbox cùng TX, lỗi rollback và retry không mất cảnh báo; scan không sửa tiền/assignment; ca ngày đã qua không tự giải quyết thay người dùng. Nhánh tự đóng ca tương lai khi hết thiếu đang BLOCKED tại F6-D07, không khoá test thành luật cấm tự đóng mọi ca — test: `apps/api/test/over/detection.locked.spec.ts::HB126_detection_atomic_without_resolution_side_effects`.
10. Sau B cả bộ A xanh nguyên vẹn và endpoint list/detail thực chạy trên DB thật; A có log đỏ đúng nguyên nhân để review — test: `apps/api/test/over/detection-routes.spec.ts::HB126_stageB_http_integration`.

11. `GET /overbooking-alerts` chỉ FRONT_DESK có scope, projection booking cần xử lý/ngày/nhãn cảnh báo/deep link tối thiểu; không trả rank/candidate/PII booking khác hoặc cho lễ tân đọc case quản lý bằng cách đổi route. Danh sách vẫn tồn tại sau ngày thiếu phòng nếu sự cố chưa giải quyết — test: `apps/api/test/over/detection-queries.locked.spec.ts::HB126_staff_alert_projection_without_case_privilege`.
12. List metadata có lần scan thành công, trạng thái đang chạy/lỗi/chưa quét và thời điểm dữ liệu; empty chỉ sau một scan thành công. Thất bại một lượt không xoá mốc thành công cũ hay biến response thành “0 case”; read scope áp cả metadata/count — test: `apps/api/test/over/detection-queries.locked.spec.ts::HB126_scan_freshness_and_unknown_empty`.

## Ngoài phạm vi

- Scheduling (HB-127), quyết định bán vượt/allotment/áp booking OTA (HB-129), resolve/execute HB-125, UI/notification transport.
- Tự đóng case ngày đã qua; không tự hủy booking qua job. Nhánh đóng ca tương lai khi hết thiếu chỉ hiện thực sau chốt F6-D07, không suy ra BR cấm tự đóng mọi ca.

## Cổng phải xanh

A: scope/docs/type/lint xanh, lưu log đỏ nghiệp vụ có chủ đích; chưa báo CI full xanh. B: `pnpm check:scope` · `pnpm run ci` · `pnpm check:contract` · `npm run check` khi có docs/scripts; PG16 concurrency và backend smoke thật bắt buộc.

## Ghi chú cho người làm

- `shortage_count` DDL >0: khi kiểm lại hết thiếu, không update shortage=0 vào case còn mở; resolve thủ công theo HB-125 ghi bằng chứng tồn. Chuyên đề §5 mô tả tự đóng ca tương lai, nhưng cách ghi resolvedBy của worker và ranh giới sau T−24h/trước ngày thiếu phòng chưa thống nhất đầy đủ; nhánh này BLOCKED tại F6-D07 trước khoá test. Ca ngày đã qua không tự đóng theo BR-OVER-16. Không nới CHECK hoặc gán người xử lý giả.
- Không tự suy ra deadline từ UTC 00:00; BR-GEN-04 là giờ danh nghĩa của property. Đồng hồ kiểm còn hạn lấy cùng nguồn trong TX, tránh clock drift job/client.
- Mâu thuẫn nhịp quét xử lý HB-127 theo BR 60 phút; đọc tồn/case tại thời điểm scan, không coi đề xuất planner là giữ phòng.

### Điều kiện bàn giao test A

Lead phải giải quyết mâu thuẫn giữa “merge test đỏ A trước B” (sổ tay lead §3.6) và “CI xanh mới được merge” (AGENTS §3, merge guard). Bản nháp không cấp ngoại lệ: đề xuất A bàn giao SHA/test bất biến có log đỏ, B tích hợp trên đúng SHA, lead xuất bản A+B khi CI xanh với scope được duyệt. Không đổi CI, skip hoặc tự mở lead branch để vượt guard; chờ lead chốt cơ chế trước thi công A.
