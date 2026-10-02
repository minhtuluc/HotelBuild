---
id: HB-040
title: SCR-23 bảng điều khiển ngày (operations web, API giả)
risk: R1
owner: deepseek
max_lines: 800
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/**
  - tests/e2e/**
locked:
unlock:
---

# HB-040 — SCR-23 bảng điều khiển ngày

> Đặc tả tự soạn (QĐ-04 mục 6) từ dòng HB-040 của [backlog F2–F3](../backlog-f2-f3.md); lead duyệt cùng PR.

## Mục tiêu

Quản lý cơ sở mở một màn hình duy nhất cho **một ngày** của một cơ sở: tồn khả dụng từng loại phòng, mốc **"cập nhật lúc … giờ VN"**, và điều hướng nhanh sang các danh sách liên quan (lưới tồn, allotment, khoá phòng). Phần "đến/đi/ở trong ngày", "ca quá tải" và "kênh `DEGRADED`" **chưa làm được** vì phụ thuộc endpoint F4 — xem mục *Khoảng trống hợp đồng*.

## Căn cứ

- Pha: F2 — [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.4 (`SCR-23`); ticket phụ thuộc HB-035 (lưới tồn) + HB-020 (đăng nhập)
- Màn hình: `SCR-23` — vai trò `WEB-ADMIN`, tác nhân `ACT-02, ACT-03, ACT-04`; căn cứ `UC-INV-01, UC-FO-01, UC-OVER-01`; cột dữ liệu: *Đến/đi/ở trong ngày, tồn khả dụng, ca quá tải, kênh `DEGRADED`*
- Quy tắc nghiệp vụ: BR-INV-01 (tồn công bố `max(0, pool)`)
- API dùng được: `GET /api/v1/inventory/grid` (HOUSEKEEPING) — tồn khả dụng theo loại phòng × ngày; `GET /api/v1/operations/{operationId}` (theo dõi tác vụ 202)

## Khoảng trống hợp đồng (đã kiểm bằng grep, cần lead chốt)

1. **Không có endpoint nào trả "đến/đi/ở trong ngày"**: `GET /bookings` (§2.5) chỉ lọc `propertyId, status, channelCode, from, to, q` — không có tham số ngày lưu trú/ngày đến-đi, và `GET /bookings/{bookingId}` ghi rõ **"không cấp HOUSEKEEPING"**, trong khi SCR-23 là màn của `ACT-02/ACT-03/ACT-04`. Phần này thuộc F4 (UC-FO-01).
2. **Không có endpoint ca quá tải**: không tồn tại tuyến `OverbookingCase` nào trong api.md §2 (UC-OVER-01 thuộc F4).
3. **Không có endpoint kênh**: không có tuyến liệt kê kênh để biết kênh nào `DEGRADED` (trùng khoảng trống đã nêu ở HB-042/SCR-25).
4. **Vai trò**: `GET /inventory/grid` là HOUSEKEEPING, còn SCR-23 khai WEB-ADMIN — hai tập quyền khác nhau (BR-RBAC-03: không kế thừa bậc). Cần lead xác nhận màn này gọi `/inventory/grid` bằng quyền nào.

**Đề xuất (QĐ-04 mục 7):** ticket này làm phần **F2 làm được** (tồn khả dụng + mốc cập nhật + điều hướng); ba phần còn lại ghi vào [nợ kỹ thuật](../../07-ban-giao/no-ky-thuat.md) và bổ sung sau khi F4 có endpoint bảng điều khiển ngày (đề xuất `GET /api/v1/operations/day-board?propertyId&date` trả `arrivals[]`, `departures[]`, `inHouse[]`, `availability[]`, `overbookingCases[]`, `degradedChannels[]`). Nếu lead muốn SCR-23 đủ ngay thì cần viết trước endpoint đó cùng phân quyền.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Mở `/day-board` thì thấy ngày đang xem (mặc định hôm nay theo **giờ VN**), tên cơ sở và bảng tồn khả dụng từng loại phòng — test: `day-board.spec.ts::hiện bảng tồn của ngày`
2. Mốc cập nhật hiện đúng định dạng `dd/mm/yyyy hh:mm (giờ VN)` do máy chủ trả, **không** lấy đồng hồ trình duyệt làm thời gian nghiệp vụ — test: `day-board.spec.ts::mốc cập nhật theo giờ VN`
3. Đổi ngày rồi xem lại thì tải lại dữ liệu cho đúng ngày mới, không nạp lại trang — test: `day-board.spec.ts::đổi ngày tải lại dữ liệu`
4. `403` khi đọc thì hiện thiếu quyền, không lộ số liệu — test: `day-board.spec.ts::403 hiện thiếu quyền`
5. Lỗi đọc khác (mạng/5xx) thì hiện băng lỗi và **giữ nguyên** số liệu cũ, không hiện "chưa có dữ liệu" giả — test: `day-board.spec.ts::lỗi mạng giữ số liệu cũ`
6. Điều hướng nhanh sang `/inventory-grid`, `/channel-allotments`, `/room-blocks` (liên kết tĩnh, không gọi API) — test: `day-board.spec.ts::liên kết nhanh`
7. Ba phần chưa có endpoint **không** được hiện số 0 hay trạng thái giả: màn hình ghi rõ "chưa hỗ trợ" kèm lý do thay vì bịa — test: `day-board.spec.ts::phần chưa hỗ trợ ghi rõ lý do`
8. Mọi trạng thái §8.1 hiện đúng, không có vi phạm axe serious/critical, không cuộn ngang ở 360 px — test: `screens.spec.ts` (thêm `/day-board`)

## Ngoài phạm vi

- Không làm nghiệp vụ F4 (đến/đi/ở, ca quá tải, điều chuyển) và không tự suy số liệu đó từ `GET /bookings`.
- Không viết backend HB-035; E2E chạy trên API giả (`page.route`).
- Không sửa tồn, không xin khoá.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

- Thời gian: dùng `formatDateTimeVn` của `@pinehill/ui-web`; ngày nghiệp vụ tính theo `Asia/Ho_Chi_Minh` (bộ `lib/inventory-grid.ts` ở HB-041 đã có `businessDate`/`defaultRange`/`addDays` — tái dùng, không viết lại).
- Số liệu tồn suy thẳng từ ô máy chủ trả (`max(0, pool)`), **không** áp quy tắc nghiệp vụ ở giao diện (AGENTS §2).
- Địa chỉ API truyền từ server component + `dynamic = 'force-dynamic'` (bẫy `NEXT_PUBLIC_*` nhúng lúc build — xem đặc tả HB-037).
