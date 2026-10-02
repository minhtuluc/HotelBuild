---
id: HB-043
title: SCR-16 nhật ký kiểm toán (chỉ đọc, lọc, xuất CSV) — operations web, API giả
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

# HB-043 — SCR-16 nhật ký kiểm toán

> Đặc tả tự soạn (QĐ-04 mục 6) từ dòng HB-043 của [backlog F2–F3](../backlog-f2-f3.md); lead duyệt cùng PR.

## Mục tiêu

Quản lý cơ sở tra được **nhật ký kiểm toán** theo bộ lọc (người thao tác, loại đối tượng, mã đối tượng, hành động, khoảng thời gian), xem chi tiết từng bản ghi và **xuất CSV** phần đang xem. Màn hình **chỉ đọc** — không có bất kỳ thao tác sửa/xoá nào, kể cả trên giao diện.

## Căn cứ

- Pha: F2 — [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.4 (`SCR-16`); ticket phụ thuộc HB-036 (đã có đặc tả do lead viết)
- Màn hình: `SCR-16` — `WEB-ADMIN`, `ACT-12`; căn cứ `UC-SYS-01`; cột dữ liệu: *bản ghi kiểm toán*
- Quy tắc nghiệp vụ: BR-SYS-01 (`AuditLog` append-only), BR-SYS-05 (đủ trường tối thiểu), BR-RBAC-02 (giới hạn theo `propertyScope`), NFR-SEC-04
- Yêu cầu: FR-SYS-01; UC-SYS-01; TC-SYS-01
- API: `GET /api/v1/audit-logs` (MANAGER) với `actorId`, `entityType`, `entityId`, `action`, `from`, `to`; mã lỗi `E_RBAC_FORBIDDEN`, `E_AUTH_OUT_OF_SCOPE`, `E_GEN_VALIDATION_FAILED`
- Ràng buộc âm (§2.14): **không** có `PUT`/`PATCH`/`DELETE /audit-logs/**` — đã có test khẳng định ở `packages/contracts/test/openapi.spec.ts`

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Mở `/audit-logs` thì thấy bảng bản ghi kèm các trường tối thiểu của BR-SYS-05 (thời điểm giờ VN, người thao tác, hành động, loại + mã đối tượng, lý do) — test: `audit-logs.spec.ts::hiện bảng nhật ký`
2. Lọc theo `actorId`/`entityType`/`entityId`/`action`/khoảng thời gian gửi đúng tham số truy vấn và chỉ hiện bản ghi khớp — test: `audit-logs.spec.ts::lọc gửi đúng tham số`
3. Phân trang theo con trỏ: bấm "Tải thêm" nối thêm bản ghi, không trùng và không mất dòng — test: `audit-logs.spec.ts::tải thêm nối đúng trang`
4. Màn hình **không** có nút sửa/xoá/tạo nào (khẳng định âm) — test: `audit-logs.spec.ts::không có thao tác ghi`
5. Xuất CSV tạo tệp từ **đúng các dòng đang hiển thị**, có tiêu đề cột, và không chứa trường không hiển thị (không rò PII/`beforeJson`/token) — test: `audit-logs.spec.ts::xuất CSV đúng dữ liệu đang xem`
6. `403 E_AUTH_OUT_OF_SCOPE` khi lọc ra ngoài phạm vi cơ sở thì hiện thiếu quyền, không lộ bản ghi — test: `audit-logs.spec.ts::403 hiện thiếu quyền`
7. Lỗi đọc (mạng/5xx) thì hiện băng lỗi + giữ bảng cũ, không hiện "chưa có dữ liệu" — test: `audit-logs.spec.ts::lỗi mạng giữ bảng cũ`
8. Mọi trạng thái §8.1 hiện đúng, không có vi phạm axe serious/critical, không cuộn ngang ở 360 px — test: `screens.spec.ts` (thêm `/audit-logs`)

## Ngoài phạm vi

- **Không** thêm endpoint xuất tệp phía máy chủ: CSV dựng ở trình duyệt từ dữ liệu đã tải (hợp đồng không có tuyến export; thêm tuyến mới cần lead duyệt).
- Không viết backend HB-036; E2E chạy trên API giả (`page.route`).
- Không làm SCR-17 (tham số) — cùng cặp màn nhưng là ticket HB-044; màn HB-044 sẽ **liên kết** sang đây kèm lọc sẵn `entityType=SystemSetting`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

- Trường `beforeJson`/`afterJson` (nếu có trong phản hồi) **không** hiển thị nguyên khối: chỉ hiện khi người dùng mở chi tiết và phải lọc theo danh sách trường an toàn (bí mật/PII — AGENTS §3 mục 4).
- CSV: `\r\n` kết dòng, escape dấu `"` theo RFC 4180; dùng `BOM` UTF-8 để Excel tiếng Việt hiển thị đúng — chú ý BOM không làm hỏng test so khớp nội dung.
- Thời điểm hiển thị bằng `formatDateTimeVn`; dữ liệu lưu UTC.
- Địa chỉ API truyền từ server component + `dynamic = 'force-dynamic'`; tái dùng `lib/screen-state.ts`, `components/screen-alert.tsx`, `components/forced-state.ts` (HB-037).
