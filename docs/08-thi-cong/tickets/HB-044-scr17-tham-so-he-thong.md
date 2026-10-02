---
id: HB-044
title: SCR-17 tham số hệ thống (OWNER, lý do + lịch sử) — operations web, API giả
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

# HB-044 — SCR-17 tham số hệ thống

> Đặc tả tự soạn (QĐ-04 mục 6) từ dòng HB-044 của [backlog F2–F3](../backlog-f2-f3.md); lead duyệt cùng PR.

## Mục tiêu

Chủ chuỗi (OWNER) xem và sửa **tham số hệ thống** (ví dụ `channel.lowInventoryThreshold`), mỗi lần sửa **bắt buộc có lý do**, và tra được **lịch sử thay đổi** của từng tham số. Việc ghi `AuditLog` cùng transaction là của backend; màn hình chỉ gửi yêu cầu và hiển thị kết quả.

## Căn cứ

- Pha: F2 — [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.4 (`SCR-17`); ticket phụ thuộc HB-036 + HB-043 (đã có đặc tả do lead viết)
- Màn hình: `SCR-17` — `WEB-ADMIN`, `ACT-12`; căn cứ `UC-SYS-02`; cột dữ liệu: *tham số hệ thống*
- Quy tắc nghiệp vụ: BR-SYS-02, BR-SYS-05, BR-GEN-07 (audit mọi thao tác ghi), BR-RBAC-01/03 (OWNER; không kế thừa bậc); ADR-017 (`Idempotency-Key`, `If-Match`)
- Yêu cầu: FR-SYS-02; UC-SYS-02; TC-SYS-03, TC-SYS-11
- API: `PUT /api/v1/system-settings/{key}` (OWNER) với `value` + `reason`, `If-Match`; mã lỗi `E_RBAC_FORBIDDEN`, `E_GEN_NOT_FOUND`, `E_GEN_VERSION_CONFLICT`, `E_GEN_PRECONDITION_REQUIRED`, `E_GEN_VALIDATION_FAILED`

## Khoảng trống hợp đồng (cần lead chốt)

api.md §2.13 chỉ có `PUT /system-settings/{key}` — **không có tuyến đọc**. Không có tuyến đọc thì màn hình **không biết giá trị hiện tại, `value_type` hay phiên bản (`ETag`)** để (a) hiển thị, (b) gửi `If-Match`, (c) hiện lịch sử.

**Đề xuất (QĐ-04 mục 7):** bổ sung `GET /api/v1/system-settings` (danh sách: `key`, `value`, `valueType`, `description`, `updatedAt`, `updatedBy`, `version`) và/hoặc `GET /api/v1/system-settings/{key}` trả `ETag`; vai trò **OWNER** (đây là cấu hình toàn hệ thống, không theo cơ sở — khác `GET /audit-logs` của MANAGER). Đã có `systemSettingUpdateRequestSchema` và `If-Match` ở hợp đồng F2 (HB-030) nên phần ghi không cần đổi. Chờ lead chốt trước khi viết mã.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Mở `/system-settings` thì thấy từng tham số kèm **giá trị hiện tại, kiểu giá trị, mô tả, ai sửa lần cuối, lúc nào (giờ VN), phiên bản** — test: `system-settings.spec.ts::hiện bảng tham số`
2. Ô nhập kiểm theo `value_type` tại chỗ (số nguyên/`boolean`/chuỗi có mẫu), sai thì chặn trước khi gọi API — test: `system-settings.spec.ts::kiểu giá trị sai thì không gọi API`
3. Lưu gửi `PUT` kèm `If-Match` = `ETag` đã đọc, `Idempotency-Key` và `reason` bắt buộc; không nhập `reason` thì chặn tại chỗ — test: `system-settings.spec.ts::lưu gửi If-Match và lý do`
4. `412`/`428` thì hiện xung đột **và giữ nguyên bản nhập** (không tự ghi đè, không xoá ô đang sửa) — test: `system-settings.spec.ts::412 giữ nguyên bản nhập`
5. `403` (ví dụ MANAGER) thì hiện thiếu quyền và **không** render ô sửa — test: `system-settings.spec.ts::403 hiện thiếu quyền`
6. Lịch sử: mở lịch sử của một tham số thì điều hướng sang `/audit-logs` **kèm lọc sẵn** `entityType=SystemSetting` + `entityId=<key>` — test: `system-settings.spec.ts::lịch sử mở sang SCR-16 kèm lọc`
7. Mất mạng khi lưu là "chưa xác định kết quả" kèm mã tra cứu, không báo thất bại chắc chắn — test: `system-settings.spec.ts::mất mạng là chưa xác định kết quả`
8. Mọi trạng thái §8.1 hiện đúng, không có vi phạm axe serious/critical — test: `screens.spec.ts` (thêm `/system-settings`)

## Ngoài phạm vi

- Không làm màn SCR-16 (HB-043) — chỉ **liên kết** sang, kèm tham số lọc trên URL.
- Không làm sao lưu/phục hồi (SCR-18, HB-045 — thuộc F9) và không hiện tham số của module chưa có trong danh mục `SystemSetting`.
- Không tự đặt giá trị mặc định hay tự suy kiểu giá trị khi máy chủ chưa trả.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

- Nhãn trạng thái/khoá i18n đặt trong `lib/i18n.ts` của operations web; không viết cứng chuỗi trong component (NFR-LOC-01).
- Lý do sửa gửi nguyên văn trong `reason`, tối đa 500 ký tự theo hợp đồng (`systemSettingUpdateRequestSchema`).
- Địa chỉ API truyền từ server component + `dynamic = 'force-dynamic'`; tái dùng bộ dùng chung của HB-037.
