---
id: HB-122
title: OverbookingPlanner thuần, xếp khách tất định và thang thực tế 1→2→4
risk: R2
owner: codex
max_lines: 750
allow:
  - packages/domain/src/overbooking/planner/**
  - packages/domain/src/overbooking/index.ts
  - packages/domain/package.json
  - packages/domain/test/overbooking/planner.spec.ts
  - packages/domain/test/overbooking/planner-properties.spec.ts
locked:
  - packages/domain/test/architecture.spec.ts
  - packages/domain/test/inventory/**
---

# HB-122 — Engine OverbookingPlanner

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

Đưa ra ứng viên điều chuyển theo BR, bảng giải thích từng thành phần `keepScore`, bậc đầu tiên khả dụng và phép kiểm trần bán vượt chủ động dùng chung. Engine nhận snapshot dữ liệu đã nạp, `now`, ID và cấu hình địa lý qua tham số; không đọc DB/Redis/mạng/đồng hồ hay sinh ID/ngẫu nhiên. Đề xuất không giữ tồn và không sửa assignment.

## Phụ thuộc

- HB-003: Money, ngày VN, lỗi miền, Clock/ID dùng chung.
- HB-032: tồn thương mại/vật lý theo từng đêm và phòng trống liên tục; dùng giao diện hiện có, không sửa engine của ticket khác.
- HB-120 trước khi API tiêu thụ DTO đầu ra; không phụ thuộc endpoint để kiểm miền.

## Căn cứ

- Pha F6: [backlog](../backlog-f6-f7.md), HB-122.
- [Quy tắc nghiệp vụ](../../02-nghiep-vu/quy-tac-nghiep-vu.md): BR-OVER-01/02/06…12, BR-CHAN-03/08, §9.1–9.3, BR-GEN-02/04/05, BR-INV-07.
- [Quá tải](../../02-nghiep-vu/qua-tai-ghep-doi-phong.md): §6–7 và §9; §7.4 khóa nhóm ưu tiên yếu trước điểm.
- [API](../../04-thiet-ke/api.md): §3.9 `ladderPreview` đủ bốn bậc; `POST /api/v1/overbooking-cases/{caseId}/relocation-plan`, lỗi `E_OVER_NO_PLAN_AVAILABLE`.
- [Kế hoạch kiểm thử](../../05-ke-hoach/ke-hoach-kiem-thu.md): TC-OVER-05/06/10; SCR-43/44.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Tổng điểm gồm loyalty PLATINUM/GOLD/SILVER/MEMBER/GUEST = 100/80/50/20/0; thanh toán đủ tổng =20, đủ cọc=10, chưa trả=0; `min(nights,14)*2`; ≥3 lượt ở trong 12 tháng=15; CHECKED_IN hoặc còn ≤6 giờ tới nhận phòng=10 — test: `packages/domain/test/overbooking/planner.spec.ts::HB122_score_components_and_boundaries`.
2. Danh sách **bị điều chuyển trước** tách nhóm HELD hoặc WALKIN chưa đóng tiền lên trước mọi booking mạnh; trong mỗi nhóm sắp `keepScore ASC, createdAt DESC, Booking.seq ASC`; không dùng UUID phá hòa — test: `packages/domain/test/overbooking/planner.spec.ts::HB122_weak_group_before_score_and_seq_tiebreak`.
3. Với bộ K-A…K-H của tài liệu §7, trả đủ điểm/thành phần/nhóm/khoá phá hòa cho quản lý; kết quả giữ nguyên khi đổi thứ tự đầu vào và đổi UUID nhưng giữ seq — test: `packages/domain/test/overbooking/planner.spec.ts::HB122_explained_order_matches_examples`.
4. 10.000 tập bằng seed cố định, gọi lặp cùng input và snapshot clock/ID cho cùng thứ tự, score, ladder; input không bị mutate — test: `packages/domain/test/overbooking/planner-properties.spec.ts::TC_OVER_10_deterministic_10000`.
5. Còn cùng loại/cơ sở trống **toàn kỳ** thì chọn bậc 1; nếu hết chỉ chọn hạng cao hơn đủ sức chứa cùng cơ sở bậc 2; không ghép phòng trống xen kẽ thành phòng trống cả kỳ — test: `packages/domain/test/overbooking/planner.spec.ts::TC_OVER_05_first_feasible_and_continuous_stay`.
6. Cấu hình Đà Lạt–Vũng Tàu–Phan Thiết cách 160–300 km trả thang thực thi 1→2→4 và preview đủ bốn bậc với bậc 3 false + lý do; không dùng fallback đi xa như bậc 3 — test: `packages/domain/test/overbooking/planner.spec.ts::TC_OVER_06_current_geography_skips_step3`.
7. Fixture tương lai ≤15 km cùng thành phố mới cho bậc 3; >15 km/khác thành phố loại khỏi thang chuẩn, ngoại lệ BR-OVER-07 phải là phương án riêng cần consent văn bản + MANAGER và hỗ trợ thực tế — test: `packages/domain/test/overbooking/planner.spec.ts::HB122_geo_boundary_and_explicit_exception`.
8. Cạn phương án phòng thì trả WALK_OUT dự kiến, không tự chi/huỷ booking; CHECKED_IN được đánh dấu cần bất khả kháng + duyệt MANAGER, không tự coi điểm đến nơi là quyền execute — test: `packages/domain/test/overbooking/planner.spec.ts::HB122_no_room_returns_walkout_without_effects`.
9. Import engine tuân miền thuần, không Date.now/new Date lấy giờ hiện tại/Math.random/I/O; thời điểm danh nghĩa theo giờ VN được truyền rõ — test: `packages/domain/test/overbooking/planner.spec.ts::HB122_clock_ids_and_purity`.
10. Hàm thuần kiểm bán vượt **chủ động**: mặc định pct0 cấm, pct>5 không hợp lệ, channel phải overbookAllowed và số vượt mỗi ngày không quá ceil(ACTIVE rooms×pct/100), min1 khi pct>0 theo BR-OVER-02. Fixture24/18/13 ở5% cho2/1/1, chuỗi4 không ceil55; vượt trả E_OVER_LIMIT_EXCEEDED. Nhận cam kết OTA đã xác nhận đi đường miễn trừ BR-CHAN-03/08, không bị hàm này từ chối. Kiểm biên pct0/3/5 và 10.000 cấu hình seed cố định — test: `packages/domain/test/overbooking/planner.spec.ts::TC_OVER_03_active_oversell_limits`; `packages/domain/test/overbooking/planner-properties.spec.ts::active_oversell_10000`.

## Ngoài phạm vi

- Consent/duyệt/execute, transaction, giữ chỗ, ledger, tự gọi worker/API; ghép phòng là policy HB-123.
- Hard-code Guest.totalStays toàn đời thành số lần ở 12 tháng; adapter phải nạp số đếm đúng cửa sổ.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · test planner/thuộc tính và ngưỡng nhánh miền ≥90%; nếu cập nhật tài liệu/export cấu hình cần `npm run check`. Ví dụ điểm/địa lý phải có fixture không dùng dữ liệu khách thật.

## Ghi chú cho người làm

- Bảng đang “giữ phòng” có chiều ngược danh sách “điều chuyển trước”; API trả một chiều và label rõ. TC-OVER-10 đã được đồng bộ trong PR công bố: nhóm yếu đứng trước trong danh sách điều chuyển.
- Khoản trả dương nhưng chưa đủ cọc chưa được bảng BR mô tả rõ: trình lead cách chấm trước khi khóa fixture ca đó; không tự biến thành đã cọc.
- seq là bigint; tránh ép Number gây mất thứ tự trên `Number.MAX_SAFE_INTEGER`. Candidate IDs có thể là UUID nhưng không phải khóa ưu tiên.
- Công bố subpath overbooking với export nguồn/dist theo convention package; index là điểm ghép HB-123, rebase giữ export cả hai. Backend tạo booking chủ động F4 HB-076/077 phải gọi guard trong cùng khoá/TX, nhưng ticket này không sửa phần F4 đang làm. Lead bổ sung chủ trách nhiệm tích hợp và bằng chứng TC-OVER-03/04 trước M7; không coi test hàm thuần đã chứng minh endpoint.
